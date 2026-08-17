/**
 * Scout — disposable read-only subagents for MetaPi
 *
 * Inspired by the "拯救 5.6 Sol" Codex subagent practice (linux.do/t/topic/2578075):
 * fight context rot by dispatching cheap, fast, read-only "scouts" that explore the
 * codebase in a throwaway context and return only compressed, evidence-backed
 * findings (file:line, symbols, verbatim excerpts) to the main agent.
 *
 * Design decisions:
 *  - Single blocking `scout` tool: { task, cwd? }. Parallelism comes for free —
 *    MetaPi executes multiple tool calls from one assistant message concurrently,
 *    which is exactly "dispatch in one batch, then wait for all".
 *  - Each scout is an isolated `metapi --mode json -p --no-session` subprocess.
 *  - Scout model/thinking is stored by Profile Config in
 *    `<agentDir>/plugin-configs/scout.json` (legacy `<agentDir>/scout.json` remains a
 *    read-only fallback). It is never exposed as a tool parameter, so the main model
 *    cannot pick expensive models.
 *    Fallback: main model + "low" thinking, with a one-time hint to configure
 *    a cheaper model.
 *  - Tools are fixed to read,grep,find,ls,bash. Read-only discipline is enforced
 *    by the scout system prompt (same approach as the Codex practice). The prompt
 *    steers scouts toward the dedicated find/grep tools and away from bash-driven
 *    recursive scans that thrash Windows process trees.
 *  - Hard 10-minute timeout: the subprocess process tree is killed (taskkill /T on
 *    Windows) and partial findings are returned so the main agent can re-dispatch
 *    smaller tasks. Live UI updates are throttled to avoid full-screen TUI jumps.
 *  - Orchestration doctrine (when to delegate / when not / how to verify) is
 *    injected into the main agent's system prompt; can be disabled via
 *    `"injectGuidelines": false` in Profile Config.
 *
 * Files:
 *  - Config: `<agentDir>/plugin-configs/scout.json`; legacy `<agentDir>/scout.json`
 *    is read only when no Profile Config value is available
 *  - Command: /scout — compatibility alias for /config scout
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	getMarkdownTheme,
	keyHint,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SCOUT_TIMEOUT_MS = 10 * 60 * 1000; // hard limit per scout
const SCOUT_STALL_TIMEOUT_MS = 2 * 60 * 1000; // active filesystem tool with no child events
const SCOUT_WATCHDOG_MS = 1000; // check active filesystem tools for stalls
const SCOUT_UI_THROTTLE_MS = 400; // coalesce live TUI updates (prevents scroll jumps)
const SCOUT_FORCE_KILL_MS = 1500; // escalate to hard tree-kill quickly on Windows
const SCOUT_TOOLS = "read,grep,find,ls,bash";
const COLLAPSED_ITEM_COUNT = 6;
const COLLAPSED_TRAIL_MAX_CHARS = 900; // keep live card height stable
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Prompts (hardcoded, English; scout reports follow the task's language)
// ─────────────────────────────────────────────────────────────────────────────

const SCOUT_SYSTEM_PROMPT = `
# Scout subagent

You are a scout: a disposable, read-only reconnaissance subagent dispatched by a main
agent. You only explore, search, and verify. You never modify anything, never make
design decisions or final judgments — those belong to the main agent. Do not attempt
to spawn or request further subagents; if the task should be split, return a split
suggestion instead.

Hard rules:
- READ-ONLY. Never create, modify, or delete files. Never run commands with side
  effects (no writes, installs, network mutations, git commits).
- You get exactly ONE turn and the task is self-contained: there is no opportunity
  to ask follow-up questions. Cover the requested scope as completely as you can.
- Be focused and evidence-complete. Prefer a few precise tool calls over broad recursive scans.

Tool strategy (critical — wrong tools thrash CPU and hang):
- Prefer the dedicated tools: \`find\` (glob files), \`grep\` (search content),
  \`ls\`, and \`read\` with offset/limit. These are bounded and respect .gitignore.
- NEVER use bash for codebase search. Forbidden via bash: find, grep, rg, ag,
  dir /s, Get-ChildItem -Recurse, tree, locate, mdfind, and any recursive walk of
  large trees (home, drive roots, node_modules, .git, dist, build, target, vendor).
- bash is only for narrow read-only inspection that the other tools cannot do
  (e.g. \`git log -n 5 -- path\`, \`git blame -L\`, \`git show\`, listing a package
  manager lock version). Always pass a tight path and prefer timeouts via short
  commands. If a command might scan broadly, do not run it — use find/grep instead.
- Start narrow: known directories and exact names first. Widen only if needed.
- When reading files, use offset/limit and pull only the relevant sections.
- Stop when every requested question has either an evidence-backed answer, an explicit
  not-found result with the searched scope, or a clearly stated unresolved dependency.
  Do not stop merely because exploration took many tool calls; stay within the task scope
  and avoid redundant searches.

What you hand back to the main agent:
- Your output is data the main agent acts on, not prose for a human. Dense, no
  greetings, no process narration, no filler conclusions.
- Evidence over packaging: attach \`file:line\`, symbol names, and short verbatim
  excerpts at every load-bearing point. The main agent uses these references to
  spot-check you cheaply instead of re-reading sources — they must be accurate and
  sufficient for verification.
- Separate "observed facts" from "your inference"; mark uncertainty explicitly.
  Never present a guess as a fact.
- Compress volume, but keep precision-critical information (exact names,
  signatures, values, paths) verbatim — do not paraphrase them away.
- If you cannot fully answer, state plainly what was found, what was not covered,
  and where things are unclear or contradictory. An explicit "not found / not
  covered" beats a vague answer — silent gaps cannot be verified by the main agent.

Write your report in the same language as the task you were given.
`.trim();

const ORCHESTRATION_GUIDELINES = `
## Scout subagents (context hygiene)

The \`scout\` tool spawns a disposable, read-only subagent in an isolated context. Use
it for wide, heavy reads so raw exploration debris (long grep output, dozens of file
reads, dead ends) never enters this conversation — only compressed, evidence-backed
findings return. Dispatch scouts proactively whenever useful, not just at the start
of a task; you are the orchestrator and frequent scouting is how context rot is
avoided.

Handle directly (do NOT delegate):
- Small files at known locations, tiny code snippets, single facts.
- The exact code you are about to modify — always read that yourself.
- Foundational documents (architecture/design docs, handoff memos): their value
  lies in detail and nuance which a scout's summary would distort. Read them in
  full yourself regardless of length; a scout may at most help locate them.
- Tasks where dispatching + verifying costs no less than just reading.

Delegate to scouts:
- Huge files (except foundational docs), cross-file or cross-directory searches.
- Independent explorations or verifications that can run in parallel.
- Re-confirming the current state of a module mid-way through a long task.
- Anything producing lots of logs, search results, or peripheral reading.

Dispatch mechanics:
- Tasks must be self-contained: scope to search, concrete questions, expected
  output. When precision matters, require \`file:line\`, symbol names, and verbatim
  excerpts in the report.
- Split heavy explorations into several small independent tasks and emit multiple
  \`scout\` calls in ONE message — they run concurrently. Up to ~6 in parallel is
  fine; scouts are cheap.
- Each scout is single-use with a fresh context. It knows nothing about this
  conversation, so put all needed background into the task text.

Verifying results:
- Scout reports are leads, not ground truth — they may miss or err. But do not
  re-read what the scout already read; that refunds the compression you paid for.
  Verify by following the returned \`file:line\` references and spot-checking only
  the load-bearing or suspicious claims.
- The only two things you always read in full yourself: code you are about to
  change, and foundational documents (see above).
- Scouts only explore, search, and verify. Code changes, trade-off decisions, and
  final validation stay with you.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

interface ScoutConfig {
	/** "provider/model-id" for the scout model. Unset = follow main model. */
	model?: string;
	/** Thinking level for scouts. Default "low". */
	thinkingLevel?: ThinkingLevel;
	/** Inject orchestration guidelines into the main agent's system prompt. Default true. */
	injectGuidelines?: boolean;
}

function legacyConfigPath(): string {
	return path.join(getAgentDir(), "scout.json");
}

function normalizeConfig(value: unknown): ScoutConfig {
	const parsed = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const cfg: ScoutConfig = {};
	if (typeof parsed.model === "string" && (!parsed.model || parsed.model.includes("/"))) cfg.model = parsed.model;
	if (typeof parsed.thinkingLevel === "string" && (THINKING_LEVELS as readonly string[]).includes(parsed.thinkingLevel)) {
		cfg.thinkingLevel = parsed.thinkingLevel as ThinkingLevel;
	}
	if (typeof parsed.injectGuidelines === "boolean") cfg.injectGuidelines = parsed.injectGuidelines;
	return cfg;
}

function loadLegacyConfig(): ScoutConfig {
	try {
		return normalizeConfig(JSON.parse(fs.readFileSync(legacyConfigPath(), "utf-8")));
	} catch {
		return {};
	}
}

function readConfig(pi: ExtensionAPI): ScoutConfig {
	let value: unknown;
	pi.events.emit("config:get", {
		id: "scout",
		callback: (next: unknown) => {
			value = next;
		},
	});
	return value && Object.keys(value as Record<string, unknown>).length > 0 ? normalizeConfig(value) : loadLegacyConfig();
}

function splitModelRef(ref: string): { provider: string; id: string } {
	const slash = ref.indexOf("/");
	return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function formatUsageStats(usage: UsageStats, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

type ThemeFg = (color: string, text: string) => string;

function formatToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 64 ? `${command.slice(0, 64)}...` : command;
			return fg("muted", "$ ") + fg("toolOutput", preview.replace(/\n/g, " ⏎ "));
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			let text = fg("accent", shortenPath(rawPath));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return fg("muted", "grep ") + fg("accent", `/${pattern}/`) + fg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return fg("muted", "find ") + fg("accent", pattern) + fg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return fg("muted", "ls ") + fg("accent", shortenPath(rawPath));
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return fg("accent", toolName) + fg("dim", ` ${preview}`);
		}
	}
}

/** Stable collapsed trail text so live updates do not thrash TUI height. */
function formatCollapsedTrail(
	items: DisplayItem[],
	fg: ThemeFg,
	maxItems = COLLAPSED_ITEM_COUNT,
	maxChars = COLLAPSED_TRAIL_MAX_CHARS,
): string {
	const toolItems = items.filter((i) => i.type === "toolCall");
	const textItems = items.filter((i) => i.type === "text");
	// Prefer tool trail while running; text deltas cause height thrash and scroll jumps.
	const preferred = toolItems.length > 0 ? toolItems : textItems;
	const toShow = preferred.slice(-maxItems);
	const skipped = preferred.length - toShow.length;
	const lines: string[] = [];
	if (skipped > 0) lines.push(fg("muted", `... ${skipped} earlier items`));
	for (const item of toShow) {
		if (item.type === "toolCall") {
			lines.push(`${fg("muted", "→ ")}${formatToolCall(item.name, item.args, fg)}`);
		} else {
			const firstLine = item.text.trim().split("\n")[0] ?? "";
			const preview = firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
			if (preview) lines.push(fg("toolOutput", preview));
		}
	}
	let out = lines.join("\n");
	if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n${fg("muted", "...")}`;
	return out;
}

function killProcessTree(pid: number | undefined): void {
	if (!pid || !Number.isFinite(pid) || pid <= 0) return;
	if (process.platform === "win32") {
		// This must be synchronous: if the Scout parent exits before taskkill snapshots
		// its descendants, grep/find grandchildren are reparented and escape /T.
		try {
			const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
			spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
				timeout: 10_000,
			});
		} catch {
			/* already dead or taskkill unavailable */
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already dead */
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Scout run state
// ─────────────────────────────────────────────────────────────────────────────

type ScoutStatus = "running" | "done" | "timeout" | "error";

interface ScoutDetails {
	task: string;
	cwd?: string;
	model?: string;
	status: ScoutStatus;
	messages: Message[];
	displayItems: DisplayItem[];
	stderr: string;
	usage: UsageStats;
	elapsedMs: number;
	errorMessage?: string;
}

interface LiveScoutDetails {
	task: string;
	cwd?: string;
	model?: string;
	status: "running";
	displayItems: DisplayItem[];
	usage: UsageStats;
	elapsedMs: number;
	errorMessage?: string;
}

/**
 * Persisted tool details deliberately exclude the child session's raw messages and
 * numeric usage object. Keeping those in a parent session makes JSONL files balloon
 * and lets generic/recursive usage collectors mistake subagent usage for parent
 * usage. The model-visible report already lives in ToolResult.content.
 */
interface StoredScoutDetails {
	task: string;
	cwd?: string;
	model?: string;
	status: Exclude<ScoutStatus, "running">;
	trail: DisplayItem[];
	usageLine: string;
	elapsedMs: number;
	errorMessage?: string;
	stderrTail?: string;
}

type ScoutResultDetails = LiveScoutDetails | StoredScoutDetails;

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text" && part.text.trim()) items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
		}
	}
	return items;
}

function getFinalReport(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text" && part.text.trim()) return part.text;
		}
	}
	return "";
}

function getAllAssistantText(messages: Message[]): string {
	const chunks: string[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text" && part.text.trim()) chunks.push(part.text.trim());
		}
	}
	return chunks.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Subprocess plumbing
// ─────────────────────────────────────────────────────────────────────────────

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "metapi", args };
}

async function writePromptTempFile(content: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-scout-"));
	const filePath = path.join(dir, "scout-prompt.md");
	await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
	return { dir, filePath };
}

interface RunScoutOptions {
	task: string;
	cwd: string;
	modelRef?: string; // "provider/id"
	thinkingLevel: ThinkingLevel;
	signal?: AbortSignal;
	onUpdate?: (details: ScoutDetails) => void;
	onSpawn?: (pid: number) => void;
	onExit?: (pid: number) => void;
}

async function runScout(opts: RunScoutOptions): Promise<ScoutDetails> {
	const startedAt = Date.now();
	const details: ScoutDetails = {
		task: opts.task,
		cwd: opts.cwd,
		model: opts.modelRef,
		status: "running",
		messages: [],
		displayItems: [],
		stderr: "",
		usage: emptyUsage(),
		elapsedMs: 0,
	};

	let lastUiEmitAt = 0;
	let uiEmitTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingUiEmit = false;

	const emitNow = () => {
		pendingUiEmit = false;
		lastUiEmitAt = Date.now();
		details.elapsedMs = Date.now() - startedAt;
		opts.onUpdate?.({
			...details,
			messages: [...details.messages],
			displayItems: [...details.displayItems],
		});
	};

	/** Throttle partial UI updates so the parent TUI does not full-redraw on every token. */
	const emit = (force = false) => {
		details.elapsedMs = Date.now() - startedAt;
		if (force) {
			if (uiEmitTimer) {
				clearTimeout(uiEmitTimer);
				uiEmitTimer = undefined;
			}
			emitNow();
			return;
		}
		const since = Date.now() - lastUiEmitAt;
		if (since >= SCOUT_UI_THROTTLE_MS) {
			if (uiEmitTimer) {
				clearTimeout(uiEmitTimer);
				uiEmitTimer = undefined;
			}
			emitNow();
			return;
		}
		pendingUiEmit = true;
		if (!uiEmitTimer) {
			uiEmitTimer = setTimeout(() => {
				uiEmitTimer = undefined;
				if (pendingUiEmit) emitNow();
			}, SCOUT_UI_THROTTLE_MS - since);
		}
	};

	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--tools",
		SCOUT_TOOLS,
		"--thinking",
		opts.thinkingLevel,
	];
	if (opts.modelRef) args.push("--model", opts.modelRef);

	let tmpDir: string | null = null;
	let timedOut = false;
	let wasAborted = false;
	let timeoutMessage: string | undefined;

	try {
		const tmp = await writePromptTempFile(SCOUT_SYSTEM_PROMPT);
		tmpDir = tmp.dir;
		args.push("--append-system-prompt", tmp.filePath);
		args.push(`Task: ${opts.task}`);

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: opts.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (proc.pid) opts.onSpawn?.(proc.pid);

			let buffer = "";
			let lastProgressAt = Date.now();
			let activeToolCount = 0;
			let settled = false;
			let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
			let abortHandler: (() => void) | undefined;

			const finish = (code: number) => {
				if (settled) return;
				settled = true;
				if (forceKillTimer) clearTimeout(forceKillTimer);
				resolve(code);
			};

			const markProgress = () => {
				lastProgressAt = Date.now();
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				markProgress();
				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					details.messages.push(msg);
					details.displayItems = getDisplayItems(details.messages);
					if (msg.role === "assistant") {
						details.usage.turns++;
						const usage = (msg as any).usage;
						if (usage) {
							details.usage.input += usage.input || 0;
							details.usage.output += usage.output || 0;
							details.usage.cacheRead += usage.cacheRead || 0;
							details.usage.cacheWrite += usage.cacheWrite || 0;
							details.usage.cost += usage.cost?.total || 0;
							details.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!details.model && (msg as any).model) details.model = (msg as any).model;
						if ((msg as any).errorMessage) details.errorMessage = (msg as any).errorMessage;
					}
					emit();
				} else if (event.type === "message_update" && event.message?.role === "assistant") {
					// Pi emits streaming assistant snapshots before message_end. Rendering the
					// latest snapshot makes reasoning/text/tool calls visibly advance instead
					// of leaving the Scout card blank until an entire model turn completes.
					details.displayItems = getDisplayItems([...details.messages, event.message as Message]);
					emit();
				} else if (event.type === "tool_execution_start") {
					activeToolCount++;
					// Some providers do not stream a complete assistant snapshot. Ensure the
					// tool appears as soon as execution starts, without waiting for message_end.
					const duplicate = details.displayItems.some(
						(item) =>
							item.type === "toolCall" &&
							item.name === event.toolName &&
							JSON.stringify(item.args) === JSON.stringify(event.args ?? {}),
					);
					if (!duplicate) {
						details.displayItems.push({ type: "toolCall", name: event.toolName, args: event.args ?? {} });
					}
					emit();
				} else if (event.type === "tool_execution_end" || event.type === "tool_result_end") {
					if (event.type === "tool_execution_end") activeToolCount = Math.max(0, activeToolCount - 1);
					if (event.message) details.messages.push(event.message as Message);
					emit();
				}
			};

			proc.stdout.on("data", (data) => {
				markProgress();
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				markProgress();
				details.stderr += data.toString();
				emit();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				finish(code ?? 0);
			});

			proc.on("error", (err) => {
				details.stderr += `\nspawn error: ${err.message}`;
				finish(1);
			});

			const killProc = () => {
				if (proc.exitCode !== null) return;
				// Windows: tree-kill immediately. SIGTERM only hits node; bash/find
				// grandchildren otherwise become orphans and keep burning CPU.
				if (process.platform === "win32") {
					killProcessTree(proc.pid);
					// Second pass in case children reparented mid-kill.
					if (!forceKillTimer) {
						forceKillTimer = setTimeout(() => {
							if (proc.exitCode !== null) return;
							killProcessTree(proc.pid);
						}, SCOUT_FORCE_KILL_MS);
					}
					return;
				}
				try {
					proc.kill("SIGTERM");
				} catch {
					/* process may already be gone */
				}
				if (!forceKillTimer) {
					forceKillTimer = setTimeout(() => {
						if (proc.exitCode !== null) return;
						killProcessTree(proc.pid);
					}, SCOUT_FORCE_KILL_MS);
				}
			};

			const hardTimer = setTimeout(() => {
				timedOut = true;
				timeoutMessage = `hard timeout after ${SCOUT_TIMEOUT_MS / 60000} minutes`;
				killProc();
			}, SCOUT_TIMEOUT_MS);

			const watchdog = setInterval(() => {
				// Provider/model silence can be legitimate. Only declare a stall while a
				// filesystem tool is actually running without producing child events.
				if (!timedOut && activeToolCount > 0 && Date.now() - lastProgressAt >= SCOUT_STALL_TIMEOUT_MS) {
					timedOut = true;
					timeoutMessage = `filesystem tool produced no progress for ${SCOUT_STALL_TIMEOUT_MS / 60000} minutes`;
					killProc();
				}
			}, SCOUT_WATCHDOG_MS);

			proc.on("close", () => {
				clearTimeout(hardTimer);
				clearInterval(watchdog);
				if (uiEmitTimer) {
					clearTimeout(uiEmitTimer);
					uiEmitTimer = undefined;
				}
				if (opts.signal && abortHandler) opts.signal.removeEventListener("abort", abortHandler);
				// Ensure any in-flight grandchildren die with the scout process.
				if (process.platform === "win32" && proc.pid) {
					killProcessTree(proc.pid);
				}
				if (proc.pid) opts.onExit?.(proc.pid);
				emit(true);
			});

			if (opts.signal) {
				abortHandler = () => {
					wasAborted = true;
					killProc();
				};
				if (opts.signal.aborted) abortHandler();
				else opts.signal.addEventListener("abort", abortHandler, { once: true });
			}
		});

		details.elapsedMs = Date.now() - startedAt;
		emit(true);

		if (wasAborted) {
			details.status = "error";
			details.errorMessage = "aborted";
			throw new Error("Scout was aborted");
		}

		if (timedOut) {
			details.status = "timeout";
			details.errorMessage = timeoutMessage;
			return details;
		}

		const lastAssistant = [...details.messages].reverse().find((m) => m.role === "assistant") as any;
		const stopReason = lastAssistant?.stopReason as string | undefined;
		if (exitCode !== 0 || stopReason === "error" || stopReason === "aborted") {
			details.status = "error";
			if (!details.errorMessage) {
				details.errorMessage = stopReason ? `stopReason: ${stopReason}` : `exit code ${exitCode}`;
			}
			return details;
		}

		details.status = "done";
		return details;
	} finally {
		if (uiEmitTimer) {
			clearTimeout(uiEmitTimer);
			uiEmitTimer = undefined;
		}
		if (tmpDir) {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Model resolution
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedScoutModel {
	modelRef?: string; // "provider/id" to pass to child; undefined = child default
	label: string;
	usedFallback: boolean;
	warning?: string;
}

function resolveScoutModel(cfg: ScoutConfig, ctx: ExtensionContext): ResolvedScoutModel {
	if (cfg.model) {
		const { provider, id } = splitModelRef(cfg.model);
		const model: Model<Api> | undefined = ctx.modelRegistry.find(provider, id);
		if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
			return { modelRef: cfg.model, label: cfg.model, usedFallback: false };
		}
		const reason = model ? "no API key configured" : "not found in model registry";
		const main = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
		return {
			modelRef: main,
			label: main ?? "(default)",
			usedFallback: true,
			warning: `scout: configured model "${cfg.model}" unusable (${reason}); falling back to main model.`,
		};
	}

	const main = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	return { modelRef: main, label: main ?? "(default)", usedFallback: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function scoutExtension(pi: ExtensionAPI) {
	let fallbackHintShown = false;
	const legacyConfig = loadLegacyConfig();
	pi.events.emit("config:register", {
		id: "scout",
		label: { en: "Scout", zh: "Scout" },
		icon: "S",
		fields: [
			{
				key: "model",
				label: { en: "Model", zh: "模型" },
				type: "string",
				placeholder: { en: "provider/model-id (empty follows main model)", zh: "provider/model-id（留空跟随主模型）" },
			},
			{
				key: "thinkingLevel",
				label: { en: "Thinking level", zh: "Thinking 等级" },
				type: "select",
				options: [...THINKING_LEVELS],
				hint: { en: "Low is recommended for Scout tasks", zh: "Scout 任务建议使用 low" },
			},
			{
				key: "injectGuidelines",
				label: { en: "Inject orchestration guidelines", zh: "注入编排指南" },
				type: "boolean",
			},
		],
		defaults: {
			model: legacyConfig.model ?? "",
			thinkingLevel: legacyConfig.thinkingLevel ?? "low",
			injectGuidelines: legacyConfig.injectGuidelines ?? true,
		},
	});
	const activeScoutPids = new Set<number>();
	const cleanupActiveScouts = () => {
		for (const pid of activeScoutPids) killProcessTree(pid);
		activeScoutPids.clear();
	};

	// spawnSync in killProcessTree makes this effective even during Node's exit event.
	process.once("exit", cleanupActiveScouts);

	pi.on("session_start", async () => {
		fallbackHintShown = false;
	});

	pi.on("session_shutdown", async () => {
		cleanupActiveScouts();
		process.off("exit", cleanupActiveScouts);
	});

	// Inject orchestration doctrine into the main agent's system prompt
	pi.on("before_agent_start", async (event) => {
		const cfg = readConfig(pi);
		if (cfg.injectGuidelines === false) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${ORCHESTRATION_GUIDELINES}` };
	});

	// ── The scout tool ─────────────────────────────────────────────────────────

	pi.registerTool<typeof ScoutParams, ScoutResultDetails>({
		name: "scout",
		label: "Scout",
		description: [
			"Dispatch a disposable, read-only scout subagent in an isolated context to explore,",
			"search, or verify — its raw reading never enters your context, only a compressed",
			"evidence report (file:line, symbols, verbatim excerpts) comes back.",
			"The task must be self-contained (scope, concrete questions, expected output);",
			"the scout has a fresh context and gets exactly one turn, so include all background.",
			"To parallelize, emit several scout calls in ONE message — they run concurrently.",
			`Scouts cannot modify anything and time out after ${SCOUT_TIMEOUT_MS / 60000} minutes (partial findings are returned).`,
		].join(" "),
		promptSnippet: "Dispatch disposable read-only scout subagents for wide/heavy exploration and verification",
		promptGuidelines: [
			"Use scout for wide, heavy reads (huge files, cross-directory searches, parallel independent explorations) instead of reading everything yourself; issue multiple scout calls in one message to run them in parallel.",
		],
		parameters: ScoutParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const task = params.task?.trim();
			if (!task) throw new Error("scout: task must not be empty");

			const cfg = readConfig(pi);
			const resolved = resolveScoutModel(cfg, ctx);

			if (resolved.warning && ctx.hasUI) {
				ctx.ui.notify(resolved.warning, "warning");
			} else if (resolved.usedFallback && !fallbackHintShown && ctx.hasUI) {
				fallbackHintShown = true;
				ctx.ui.notify(
					`scout: no scout model configured — using main model (${resolved.label}) with "${cfg.thinkingLevel ?? "low"}" thinking. Configure a cheaper/faster model via /scout.`,
					"info",
				);
			}

			let scoutCwd = ctx.cwd;
			if (params.cwd) {
				const cleaned = params.cwd.replace(/^@/, "");
				scoutCwd = path.resolve(ctx.cwd, cleaned);
				if (!fs.existsSync(scoutCwd)) throw new Error(`scout: cwd does not exist: ${scoutCwd}`);
			}

			const details = await runScout({
				task,
				cwd: scoutCwd,
				modelRef: resolved.modelRef,
				thinkingLevel: cfg.thinkingLevel ?? "low",
				signal,
				onSpawn: (pid) => activeScoutPids.add(pid),
				onExit: (pid) => activeScoutPids.delete(pid),
				onUpdate: (d) => {
					const liveDetails: LiveScoutDetails = {
						task: d.task,
						cwd: d.cwd,
						model: d.model,
						status: "running",
						displayItems: [...d.displayItems],
						usage: { ...d.usage },
						elapsedMs: d.elapsedMs,
						errorMessage: d.errorMessage,
					};
					onUpdate?.({
						content: [{ type: "text", text: "(scouting...)" }],
						details: liveDetails,
					});
				},
			});

			// Compose the model-visible result
			let text: string;
			if (details.status === "timeout") {
				const partial = getAllAssistantText(details.messages);
				const timeoutReason = details.errorMessage ?? `hard timeout after ${SCOUT_TIMEOUT_MS / 60000} minutes`;
				text = partial
					? `[Scout timed out: ${timeoutReason}. Partial findings below — treat as incomplete; consider re-dispatching smaller, narrower tasks.]\n\n${partial}`
					: `[Scout timed out: ${timeoutReason}, with no findings. Re-dispatch with a smaller, narrower task.]`;
			} else if (details.status === "error") {
				const partial = getAllAssistantText(details.messages);
				const diag = details.errorMessage || details.stderr.trim().slice(-500) || "unknown error";
				text = `[Scout failed: ${diag}]${partial ? `\n\nPartial findings:\n\n${partial}` : ""}`;
			} else {
				text = getFinalReport(details.messages) || "(scout returned no report)";
			}

			const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			let finalText = truncation.content;
			if (truncation.truncated) {
				finalText += `\n\n[Scout report truncated to ${DEFAULT_MAX_LINES} lines / 50KB.]`;
			}

			// Persist only compact rendering metadata. Raw child messages can be hundreds
			// of KB and contain nested assistant usage records; they are useful while the
			// scout is running, but must not become part of the parent session.
			const storedDetails: StoredScoutDetails = {
				task: details.task,
				cwd: details.cwd,
				model: details.model,
				status: details.status as Exclude<ScoutStatus, "running">,
				trail: details.displayItems.filter((item) => item.type === "toolCall"),
				usageLine: formatUsageStats(details.usage, details.model),
				elapsedMs: details.elapsedMs,
				errorMessage: details.errorMessage,
				stderrTail: details.status === "error" && details.stderr.trim() ? details.stderr.trim().slice(-800) : undefined,
			};

			return {
				content: [{ type: "text", text: finalText }],
				details: storedDetails,
			};
		},

		// ── Rendering ────────────────────────────────────────────────────────────

		renderCall(args, theme, context) {
			const task = (args.task as string) || "...";
			const firstLine = task.split("\n")[0];
			const preview = firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine;
			let text = theme.fg("toolTitle", theme.bold("scout "));
			text += theme.fg("dim", preview);
			if (args.cwd) text += theme.fg("muted", `  [${args.cwd}]`);
			// Reuse Text instance so live redraws don't churn component identity.
			const node = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			node.setText(text);
			return node;
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const details = result.details as ScoutResultDetails | undefined;
			if (!details) {
				const c = result.content[0];
				const fallback = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
				fallback.setText(c?.type === "text" ? c.text : "(no output)");
				return fallback;
			}

			const isLiveDetails = details.status === "running" || !!isPartial;
			const fg = theme.fg.bind(theme) as ThemeFg;
			const items = isLiveDetails ? ("displayItems" in details ? details.displayItems : details.trail) : details.trail;
			const resultText = result.content.find((c) => c.type === "text")?.text ?? "";

			const statusIcon =
				details.status === "running"
					? theme.fg("warning", "⏳")
					: details.status === "done"
						? theme.fg("success", "✓")
						: details.status === "timeout"
							? theme.fg("warning", "⏱")
							: theme.fg("error", "✗");

			const statusSuffix =
				details.status === "timeout"
					? ` ${theme.fg("warning", "[timeout]")}`
					: details.status === "error"
						? ` ${theme.fg("error", `[${details.errorMessage ?? "failed"}]`)}`
						: "";

			const header = `${statusIcon} ${theme.fg("toolTitle", theme.bold("scout"))}${statusSuffix}`;
			const usageLine =
				details.status === "running" && "usage" in details
					? formatUsageStats(details.usage, details.model)
					: "usageLine" in details
						? details.usageLine
						: "";

			// ── Expanded: full trail + Markdown report ──
			if (expanded && details.status !== "running") {
				const container = new Container();
				container.addChild(new Text(header, 0, 0));
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
				container.addChild(new Text(theme.fg("dim", details.task), 0, 0));

				const toolCalls = items.filter((i) => i.type === "toolCall");
				if (toolCalls.length > 0) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", `─── Trail (${toolCalls.length} tool calls) ───`), 0, 0));
					for (const item of toolCalls) {
						if (item.type === "toolCall") {
							container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0));
						}
					}
				}

				const report = resultText;
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Report ───"), 0, 0));
				if (report && report !== "(scouting...)") {
					container.addChild(new Markdown(report.trim(), 0, 0, getMarkdownTheme()));
				} else {
					container.addChild(new Text(theme.fg("muted", "(no report)"), 0, 0));
				}
				if (details.status === "error") {
					const stderrTail = "stderrTail" in details ? details.stderrTail : undefined;
					if (stderrTail) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("error", stderrTail), 0, 0));
					}
				}
				if (usageLine) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("dim", usageLine), 0, 0));
				}
				return container;
			}

			// ── Collapsed / running: keep height stable and reuse Text node ──
			let text = header;
			const trail = formatCollapsedTrail(items, fg);
			if (trail) text += `\n${trail}`;
			else text += `\n${theme.fg("muted", details.status === "running" ? "(scouting...)" : "(no output)")}`;
			if (usageLine && details.status !== "running") text += `\n${theme.fg("dim", usageLine)}`;
			if (details.status !== "running")
				text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;

			const node = (context?.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			node.setText(text);
			return node;
		},
	});

	// /scout remains a compatibility alias for the unified Profile Config page.
	pi.registerCommand("scout", {
		description: "Open Scout configuration",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (!(await ctx.executeCommand("/config scout"))) {
				ctx.ui.notify("Scout configuration is unavailable in the current mode.", "error");
			}
		},
	});
}

// Tool parameters (kept at bottom to keep the tool registration readable)
const ScoutParams = Type.Object({
	task: Type.String({
		description:
			"Self-contained task for the scout: what to search, the concrete questions to answer, and the expected output. Require file:line references and verbatim excerpts when precision matters. Include all background — the scout has a fresh context.",
	}),
	cwd: Type.Optional(
		Type.String({
			description:
				"Optional working directory for the scout (relative to the project root). Use it to confine the scout to a subdirectory.",
		}),
	),
});
