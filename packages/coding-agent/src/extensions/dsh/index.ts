import Schema from "@deepseek-ai/schemastery";
import {
	Box,
	Container,
	Image,
	Markdown,
	matchesKey,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type {
	EntryRenderer,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "../../core/extensions/types.ts";
import type { ProfileRuntimePackageRequest } from "../../core/profile-agent-runtime.ts";
import { dshFileReferenceFromCompletion, expandSelectedDshFileReferences } from "../../meldra/dsh-file-references.ts";
import {
	DshProfileRuntime,
	LEGACY_METAPI_DSH_MESSAGE_ENTRY,
	MELDRA_DSH_MESSAGE_ENTRY,
} from "../../meldra/dsh-profile-runtime.ts";
import { DSH_PROFILE_RUNTIME_PROVIDER } from "../../meldra/dsh-profile-runtime-provider.ts";
import { BorderedLoader } from "../../modes/interactive/components/bordered-loader.ts";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import {
	SessionBrowserComponent,
	type SessionBrowserItem,
} from "../../modes/interactive/components/session-selector.ts";
import { getMarkdownTheme, theme as interactiveTheme } from "../../modes/interactive/theme/theme.ts";
import { resolvePath } from "../../utils/paths.ts";
import { type DshRewindChoice, runDshRewind } from "./rewind-controller.ts";

interface DshEntryData {
	kind: "user" | "assistant" | "tool" | "error" | "info";
	text: string;
}

function activeDshProfile(): boolean {
	const provider = process.env.MELDRA_PROFILE_RUNTIME_PROVIDER ?? process.env.METAPI_PROFILE_RUNTIME_PROVIDER;
	if (provider) return provider === DSH_PROFILE_RUNTIME_PROVIDER;
	const name = process.env.MELDRA_PROFILE_NAME ?? process.env.METAPI_PROFILE_NAME;
	return name === "dsh" || name === "deepseek-harness";
}

function runtimeOf(ctx: ExtensionContext): DshProfileRuntime | undefined {
	return ctx.profileRuntime instanceof DshProfileRuntime ? ctx.profileRuntime : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function queueMessageText(item: Record<string, unknown>): string | undefined {
	if (!item.message || typeof item.message !== "object") return undefined;
	const content = records((item.message as Record<string, unknown>).content);
	if (content.length === 0 || content.some((block) => block.type !== "text" || typeof block.text !== "string"))
		return undefined;
	return content.map((block) => block.text as string).join("");
}

function queuePreview(item: Record<string, unknown>): string {
	const text = queueMessageText(item)?.replace(/\s+/g, " ").trim();
	if (!text) return "[non-text message]";
	return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

function dshSessionBrowserItem(
	session: Record<string, unknown>,
	currentSessionId: string | undefined,
): SessionBrowserItem | undefined {
	if (typeof session.sessionId !== "string") return undefined;
	const projections = isRecord(session.projections) ? session.projections : undefined;
	const values = isRecord(projections?.values) ? projections.values : undefined;
	const title = typeof values?.title === "string" && values.title.trim() ? values.title.trim() : undefined;
	const updatedAt = typeof session.updatedAt === "number" ? new Date(session.updatedAt) : new Date(0);
	const preset = typeof session.agentPreset === "string" ? session.agentPreset : undefined;
	const cwd = typeof session.cwd === "string" ? session.cwd : "";
	const badges = [
		session.sessionId === currentSessionId ? "current" : undefined,
		session.running === true ? "running" : undefined,
		session.blank === true ? "blank" : undefined,
		preset,
	].filter((value): value is string => Boolean(value));
	return {
		key: session.sessionId,
		...(typeof session.parentSessionId === "string" ? { parentKey: session.parentSessionId } : {}),
		id: session.sessionId,
		cwd,
		...(title ? { name: title } : {}),
		created: updatedAt,
		modified: updatedAt,
		firstMessage:
			title ?? (session.blank === true ? "New DSH Session" : `DSH Session ${session.sessionId.slice(0, 8)}`),
		allMessagesText: [session.sessionId, title, cwd, preset].filter(Boolean).join(" "),
		badges,
	};
}

async function selectDshSession(ctx: ExtensionContext, runtime: DshProfileRuntime): Promise<string | undefined> {
	const loadAll = async (): Promise<SessionBrowserItem[]> =>
		(await runtime.listSessions()).flatMap((session) => {
			const item = dshSessionBrowserItem(session, runtime.sessionId);
			return item ? [item] : [];
		});
	const loadCurrent = async (): Promise<SessionBrowserItem[]> => {
		const cwd = resolvePath(ctx.cwd);
		return (await loadAll()).filter((session) => session.cwd && resolvePath(session.cwd) === cwd);
	};
	return ctx.ui.custom<string | undefined>((tui, _theme, keybindings, done) => {
		const browser = new SessionBrowserComponent(
			loadCurrent,
			loadAll,
			(sessionId) => done(sessionId),
			() => done(undefined),
			() => done(undefined),
			() => tui.requestRender(),
			{ title: "Resume DSH Session", keybindings },
			runtime.sessionId,
		);
		browser.focused = true;
		return browser;
	});
}

interface ScalarSettingChoice {
	namespace: Record<string, unknown>;
	path: string[];
	node: Schema;
	value: unknown;
	overridden: boolean;
	options?: unknown[];
	label: string;
}

function hasOwnPath(value: unknown, path: string[]): boolean {
	let current: unknown = value;
	for (const key of path) {
		if (!isRecord(current) || !Object.hasOwn(current, key)) return false;
		current = current[key];
	}
	return true;
}

function scalarSettingChoices(namespaces: Record<string, unknown>[]): ScalarSettingChoice[] {
	return namespaces.flatMap((namespace) => {
		if (typeof namespace.ns !== "string" || typeof namespace.revision !== "number" || !isRecord(namespace.value))
			return [];
		let root: Schema;
		try {
			root = new Schema(namespace.schema as Schema);
		} catch {
			return [];
		}
		const secretPaths = new Set(
			records(namespace.secrets).flatMap((secret) =>
				Array.isArray(secret.path) && secret.path.every((part) => typeof part === "string")
					? [(secret.path as string[]).join("\0")]
					: [],
			),
		);
		const choices: ScalarSettingChoice[] = [];
		const visit = (node: Schema, value: unknown, path: string[]): void => {
			if (
				secretPaths.has(path.join("\0")) ||
				node.meta?.role === "secret" ||
				node.meta?.role === "credential-ref" ||
				node.meta?.hidden === true ||
				node.meta?.disabled === true
			)
				return;
			if (node.type === "object" && node.dict) {
				const record = isRecord(value) ? value : {};
				for (const [key, child] of Object.entries(node.dict)) visit(child, record[key], [...path, key]);
				return;
			}
			if (node.type === "dict" && node.inner && isRecord(value)) {
				for (const [key, childValue] of Object.entries(value)) visit(node.inner, childValue, [...path, key]);
				return;
			}
			const options =
				node.type === "union" && Array.isArray(node.list) && node.list.every((item) => item.type === "const")
					? node.list.map((item) => item.value)
					: undefined;
			if (
				path.length === 0 ||
				(!options && node.type !== "string" && node.type !== "number" && node.type !== "boolean")
			)
				return;
			const overridden = hasOwnPath(namespace.user, path);
			choices.push({
				namespace,
				path,
				node,
				value,
				overridden,
				options,
				label: `${namespace.ns}.${path.join(".")} · ${JSON.stringify(value)}${overridden ? " · 用户覆盖" : " · 继承值"}`,
			});
		};
		visit(root, namespace.value, []);
		return choices;
	});
}

interface ArraySettingChoice {
	namespace: Record<string, unknown>;
	path: string[];
	node: Schema;
	value: unknown[];
	overridden: boolean;
	label: string;
}

function arraySettingChoices(namespaces: Record<string, unknown>[]): ArraySettingChoice[] {
	return namespaces.flatMap((namespace) => {
		if (typeof namespace.ns !== "string" || typeof namespace.revision !== "number" || !isRecord(namespace.value))
			return [];
		let root: Schema;
		try {
			root = new Schema(namespace.schema as Schema);
		} catch {
			return [];
		}
		const secretPaths = new Set(
			records(namespace.secrets).flatMap((secret) =>
				Array.isArray(secret.path) && secret.path.every((part) => typeof part === "string")
					? [(secret.path as string[]).join("\0")]
					: [],
			),
		);
		const choices: ArraySettingChoice[] = [];
		const visit = (node: Schema, value: unknown, path: string[]): void => {
			if (
				secretPaths.has(path.join("\0")) ||
				node.meta?.role === "secret" ||
				node.meta?.role === "credential-ref" ||
				node.meta?.hidden === true ||
				node.meta?.disabled === true
			)
				return;
			if (node.type === "array" && Array.isArray(value) && path.length > 0) {
				const overridden = hasOwnPath(namespace.user, path);
				choices.push({
					namespace,
					path,
					node,
					value,
					overridden,
					label: `${namespace.ns}.${path.join(".")} · ${value.length} 项${overridden ? " · 用户覆盖" : " · 继承值"}`,
				});
				return;
			}
			if (node.type === "object" && node.dict) {
				const record = isRecord(value) ? value : {};
				for (const [key, child] of Object.entries(node.dict)) visit(child, record[key], [...path, key]);
				return;
			}
			if (node.type === "dict" && node.inner && isRecord(value))
				for (const [key, childValue] of Object.entries(value)) visit(node.inner, childValue, [...path, key]);
		};
		visit(root, namespace.value, []);
		return choices;
	});
}

interface CredentialReference {
	ns: string;
	path: string[];
	ref: string;
}

function credentialReferences(namespaces: Record<string, unknown>[]): CredentialReference[] {
	const found = new Map<string, CredentialReference>();
	const visit = (ns: string, node: Schema, value: unknown, path: string[]): void => {
		if (node.meta?.role === "credential-ref" && typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
			found.set(value, { ns, path, ref: value });
			return;
		}
		if (node.type === "object" && node.dict && isRecord(value)) {
			for (const [key, child] of Object.entries(node.dict)) visit(ns, child, value[key], [...path, key]);
			return;
		}
		if (node.type === "dict" && node.inner && isRecord(value)) {
			for (const [key, childValue] of Object.entries(value)) visit(ns, node.inner, childValue, [...path, key]);
			return;
		}
		if (node.type === "array" && node.inner && Array.isArray(value)) {
			value.forEach((childValue, index) => {
				visit(ns, node.inner as Schema, childValue, [...path, String(index)]);
			});
		}
	};
	for (const namespace of namespaces) {
		if (typeof namespace.ns !== "string") continue;
		let root: Schema;
		try {
			root = new Schema(namespace.schema as Schema);
		} catch {
			continue;
		}
		visit(namespace.ns, root, namespace.value, []);
	}
	return [...found.values()];
}

interface TrajectoryChoice {
	entry: Record<string, unknown>;
	seq: number;
	type: string;
	label: string;
	searchText: string;
}

function trajectoryChoices(page: Record<string, unknown>): TrajectoryChoice[] {
	return records(page.events).flatMap((entry) => {
		if (!entry.event || typeof entry.event !== "object") return [];
		const event = entry.event as Record<string, unknown>;
		if (typeof event.seq !== "number" || typeof event.type !== "string") return [];
		const data = isRecord(event.data) ? event.data : undefined;
		return [
			{
				entry,
				seq: event.seq,
				type: event.type,
				label: [
					`#${event.seq}`,
					event.type,
					typeof data?.turn === "number" ? `turn ${data.turn}` : undefined,
					typeof data?.step === "number" ? `step ${data.step}` : undefined,
					typeof event.time === "number" ? new Date(event.time).toLocaleTimeString() : undefined,
				]
					.filter(Boolean)
					.join(" · "),
				searchText: JSON.stringify(entry),
			},
		];
	});
}

function trajectoryWaterfall(entries: TrajectoryChoice[]): Array<{ choice: TrajectoryChoice; label: string }> {
	const starts = new Map<string, number>();
	return [...entries]
		.sort((left, right) => left.seq - right.seq)
		.map((choice) => {
			const event = isRecord(choice.entry.event) ? choice.entry.event : {};
			const data = isRecord(event.data) ? event.data : undefined;
			const callId = typeof data?.callId === "string" ? data.callId : undefined;
			const time = typeof event.time === "number" ? event.time : undefined;
			if (choice.type === "tool/call" && callId && time !== undefined) starts.set(callId, time);
			const startedAt = callId ? starts.get(callId) : undefined;
			const duration =
				choice.type === "tool/result" && time !== undefined && startedAt !== undefined
					? Math.max(0, time - startedAt)
					: undefined;
			const step = typeof data?.step === "number" ? data.step : undefined;
			const tool =
				typeof data?.toolName === "string" ? data.toolName : typeof data?.name === "string" ? data.name : undefined;
			return {
				choice,
				label: [
					`#${choice.seq}`,
					time === undefined ? undefined : new Date(time).toISOString().slice(11, 23),
					`${"  ".repeat(Math.min(step ?? 0, 6))}${choice.type}`,
					typeof data?.turn === "number" ? `turn ${data.turn}` : undefined,
					step === undefined ? undefined : `step ${step}`,
					tool,
					duration === undefined ? undefined : `${duration}ms`,
				]
					.filter(Boolean)
					.join(" · "),
			};
		});
}

function metric(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatUsageStatus(
	message: Record<string, unknown>,
	usage: Record<string, unknown>,
	timing?: { ttftMs: number; tokensPerSecond?: number },
): string {
	const source = message.source;
	const model =
		source && typeof source === "object" && typeof (source as Record<string, unknown>).model === "string"
			? (source as Record<string, unknown>).model
			: "DSH";
	const input = metric(usage.inputTokens);
	const output = metric(usage.outputTokens);
	const cacheRead = metric(usage.cacheReadTokens);
	const cacheWrite = metric(usage.cacheWriteTokens);
	const totalInput = input + cacheRead + cacheWrite;
	const cacheRate = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;
	const timingText = timing
		? [
				`${timing.ttftMs < 1000 ? `${Math.round(timing.ttftMs)}ms` : `${(timing.ttftMs / 1000).toFixed(1)}s`} TTFT`,
				timing.tokensPerSecond === undefined ? undefined : `${timing.tokensPerSecond.toFixed(1)} tok/s`,
			]
				.filter(Boolean)
				.join(" · ")
		: undefined;
	return [model, `▲ ${input}`, `▼ ${output}`, cacheRate > 0 ? `⚡ ${cacheRate}%` : undefined, timingText]
		.filter(Boolean)
		.join("  ");
}

function formatDuration(ms: number): string {
	return ms < 60_000
		? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
		: `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function formatProjectionMetrics(values: Record<string, unknown>): string | undefined {
	const usage =
		values.tokenUsage && typeof values.tokenUsage === "object"
			? (values.tokenUsage as Record<string, unknown>)
			: undefined;
	const stats =
		values.sessionStats && typeof values.sessionStats === "object"
			? (values.sessionStats as Record<string, unknown>)
			: undefined;
	const pressure =
		values.contextPressure && typeof values.contextPressure === "object"
			? (values.contextPressure as Record<string, unknown>)
			: undefined;
	if (!usage && !stats && !pressure) return undefined;
	const groups: string[] = [];
	if (stats && metric(stats.steps) > 0) {
		groups.push(`${metric(stats.turns)} turns · ${metric(stats.steps)} steps`);
		const timings = [
			metric(stats.llmMs) > 0 ? `LLM ${formatDuration(metric(stats.llmMs))}` : undefined,
			metric(stats.toolMs) > 0 ? `tools ${formatDuration(metric(stats.toolMs))}` : undefined,
			metric(stats.ttftSteps) > 0
				? `${formatDuration(metric(stats.ttftMs) / metric(stats.ttftSteps))} TTFT`
				: undefined,
			metric(stats.decodeMs) > 0
				? `${(metric(stats.decodeTokens) / (metric(stats.decodeMs) / 1000)).toFixed(1)} tok/s`
				: undefined,
		].filter((part): part is string => Boolean(part));
		if (timings.length) groups.push(timings.join(" · "));
	}
	if (usage) {
		const uncached = metric(usage.uncachedInputTokens);
		const cacheRead = metric(usage.cacheReadTokens);
		const cacheWrite = metric(usage.cacheWriteTokens);
		const input = uncached + cacheRead + cacheWrite;
		const output = metric(usage.outputTokens);
		if (input > 0 || output > 0) {
			const cacheRate = input > 0 ? Math.round((cacheRead / input) * 100) : 0;
			groups.push(`▲ ${input}  ▼ ${output}${cacheRate > 0 ? `  ⚡ ${cacheRate}%` : ""}`);
		}
	}
	if (pressure) {
		const used = typeof pressure.projectedTokens === "number" ? pressure.projectedTokens : pressure.pressureTokens;
		if (typeof used === "number" && typeof pressure.contextWindow === "number")
			groups.push(`📊 ${Math.min(100, Math.round((used / pressure.contextWindow) * 100))}%`);
	}
	return groups.length ? groups.join("  |  ") : undefined;
}

function stepKey(data: Record<string, unknown>): string | undefined {
	return typeof data.turn === "number" && typeof data.step === "number" ? `${data.turn}\0${data.step}` : undefined;
}

function isTokenDelta(chunk: Record<string, unknown>): boolean {
	if (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
		return typeof chunk.text === "string" && chunk.text !== "";
	return (
		chunk.type === "tool-call-delta" &&
		((typeof chunk.argumentsDelta === "string" && chunk.argumentsDelta !== "") || typeof chunk.name === "string")
	);
}

function workspaceLabel(workspace: Record<string, unknown>): string | undefined {
	if (
		typeof workspace.workspaceId !== "string" ||
		typeof workspace.title !== "string" ||
		typeof workspace.path !== "string"
	)
		return undefined;
	return `${workspace.title} · ${workspace.path} · ${workspace.workspaceId}`;
}

async function dshRewindChoices(
	runtime: DshProfileRuntime,
): Promise<{ choices: DshRewindChoice[]; truncated: boolean }> {
	const entries = new Map<number, Record<string, unknown>>();
	let beforeSeq: number | undefined;
	let pages = 0;
	let hasMore = false;
	while (pages < 50 && entries.size < 1000) {
		const page = await runtime.history(beforeSeq);
		if (!isRecord(page)) break;
		const pageEntries = records(page.events);
		for (const entry of pageEntries) {
			const event = isRecord(entry.event) ? entry.event : undefined;
			if (typeof event?.seq === "number") entries.set(event.seq, entry);
			if (entries.size === 1000) break;
		}
		pages += 1;
		hasMore = page.hasMore === true;
		if (!hasMore || pageEntries.length === 0) break;
		const seqs = pageEntries.flatMap((entry) => {
			const event = isRecord(entry.event) ? entry.event : undefined;
			return typeof event?.seq === "number" ? [event.seq] : [];
		});
		if (seqs.length === 0) break;
		const nextBeforeSeq = Math.min(...seqs);
		if (nextBeforeSeq === beforeSeq) break;
		beforeSeq = nextBeforeSeq;
	}

	const ordered = [...entries.values()].sort((left, right) => {
		const leftEvent = isRecord(left.event) ? left.event : {};
		const rightEvent = isRecord(right.event) ? right.event : {};
		return Number(leftEvent.seq) - Number(rightEvent.seq);
	});
	let previousTurnEnd: number | undefined;
	let rewindBoundary: number | undefined;
	const choices: DshRewindChoice[] = [];
	for (const entry of ordered) {
		const event = isRecord(entry.event) ? entry.event : {};
		const seq = typeof event.seq === "number" ? event.seq : undefined;
		if (seq === undefined) continue;
		if (event.type === "turn/start") {
			rewindBoundary = previousTurnEnd;
			continue;
		}
		if (event.type === "turn/end") {
			previousTurnEnd = seq;
			rewindBoundary = undefined;
			continue;
		}
		if (event.type !== "user/message" || rewindBoundary === undefined) continue;
		const data = isRecord(event.data) ? event.data : undefined;
		const message = isRecord(data?.message) ? data.message : data;
		const content = records(message?.content);
		if (
			content.length === 0 ||
			content[0]?.type !== "text" ||
			typeof content[0].text !== "string" ||
			!content[0].text.trim()
		)
			continue;
		const attachments = content
			.slice(1)
			.flatMap((block) => (block.type === "image" && isRecord(block.attachment) ? [block.attachment] : []));
		if (attachments.length !== content.length - 1) continue;
		const text = content[0].text;
		choices.push({
			seq,
			boundary: rewindBoundary,
			text,
			attachments,
		});
	}
	return {
		choices: choices.reverse(),
		truncated: hasMore && (pages === 50 || entries.size === 1000),
	};
}

type DshMenuCategory = "common" | "session" | "agent" | "workspace" | "runtime" | "diagnostics";

interface DshActionDefinition {
	action: string;
	label: string;
	description: string;
	category?: DshMenuCategory;
}

const DSH_ACTIONS: DshActionDefinition[] = [
	{
		action: "sessions",
		label: "会话列表",
		description: "查看并切换 Harness 会话",
		category: "session",
	},
	{
		action: "new",
		label: "新建会话",
		description: "创建并切换到新的 Harness 会话",
		category: "session",
	},
	{
		action: "history",
		label: "消息历史",
		description: "分页查看原生消息和图片",
		category: "session",
	},
	{
		action: "rewind",
		label: "回退并重写",
		description: "从历史文本/图片消息前的已完成回合派生会话并回填草稿",
		category: "session",
	},
	{
		action: "fork",
		label: "派生会话",
		description: "从当前 Harness 会话创建分支",
		category: "session",
	},
	{
		action: "rename",
		label: "重命名会话",
		description: "修改当前 Harness 会话标题",
		category: "session",
	},
	{
		action: "queue",
		label: "待处理消息",
		description: "编辑、撤回或立即引导队列消息",
		category: "session",
	},
	{
		action: "cancel",
		label: "取消当前运行",
		description: "向正在运行的 Harness 回合发送取消请求",
		category: "session",
	},
	{
		action: "preset",
		label: "Agent 预设",
		description: "选择 Harness 原生 Agent Preset",
		category: "agent",
	},
	{
		action: "model",
		label: "模型",
		description: "查看并选择当前 Harness 模型",
		category: "agent",
	},
	{
		action: "effort",
		label: "推理等级",
		description: "按当前模型适配器声明切换原生 reasoning effort",
		category: "agent",
	},
	{
		action: "commands",
		label: "原生命令",
		description: "发现并执行当前 Agent 提供的命令",
		category: "agent",
	},
	{
		action: "skills",
		label: "Skills",
		description: "发现并调用当前 Agent 的原生 Skill",
		category: "agent",
	},
	{
		action: "plan",
		label: "计划模式",
		description: "开启或关闭 Harness Plan Mode",
		category: "agent",
	},
	{
		action: "goal",
		label: "目标",
		description: "创建、编辑和推进原生 Goal",
		category: "agent",
	},
	{
		action: "todo",
		label: "Todo",
		description: "查看 Harness Todo 投影",
		category: "agent",
	},
	{
		action: "subagents",
		label: "子 Agent",
		description: "查看历史、发送后续消息或请求中断",
		category: "agent",
	},
	{
		action: "jobs",
		label: "后台任务",
		description: "查看 Harness 后台 Job 状态与详情",
		category: "agent",
	},
	{
		action: "compact",
		label: "压缩上下文",
		description: "执行 Harness 原生 Compact 命令",
		category: "agent",
	},
	{
		action: "workspace",
		label: "工作区",
		description: "管理 Harness Workspace 和会话归属",
		category: "workspace",
	},
	{
		action: "settings",
		label: "设置",
		description: "查看和编辑 Settings、Provider 与凭据",
		category: "runtime",
	},
	{
		action: "plugins",
		label: "插件与包",
		description: "查看 Loader Inventory、管理 Profile 包或重载",
		category: "runtime",
	},
	{
		action: "context",
		label: "上下文统计",
		description: "查看token、cache、压力和会话统计",
		category: "runtime",
	},
	{
		action: "exit",
		label: "退出 Meldra",
		description: "通过统一生命周期关闭当前进程",
		category: "runtime",
	},
	{
		action: "evidence",
		label: "上下文证据",
		description: "查看最近真实请求快照和 durable 上下文注入",
		category: "diagnostics",
	},
	{
		action: "trajectory",
		label: "Trajectory",
		description: "搜索、折叠并查看事件时间线",
		category: "diagnostics",
	},
	{
		action: "attachments",
		label: "图片附件",
		description: "分页查看Harness历史图片",
		category: "diagnostics",
	},
	{
		action: "feedback",
		label: "消息反馈",
		description: "为最终Assistant消息维护正负反馈",
		category: "diagnostics",
	},
	{
		action: "run",
		label: "直接运行命令",
		description: "用 /dsh run /<command> 直接执行原生命令",
	},
	{
		action: "invoke",
		label: "直接调用 Skill",
		description: "用 /dsh invoke /<skill> 直接调用原生 Skill",
	},
];

const DSH_QUICK_ACTIONS = ["sessions", "new", "model", "preset", "plan", "goal", "queue", "cancel"] as const;

const DSH_MENU_CATEGORIES: Array<{
	id: DshMenuCategory;
	label: string;
	description: string;
}> = [
	{
		id: "common",
		label: "常用操作",
		description: "切换会话、选择模型、管理计划和处理队列",
	},
	{
		id: "session",
		label: "会话",
		description: "切换、创建、派生、历史和待处理消息",
	},
	{
		id: "agent",
		label: "Agent 与执行",
		description: "预设、模型、命令、Skills、计划、目标和子 Agent",
	},
	{
		id: "workspace",
		label: "工作区",
		description: "管理Workspace、目录和会话归属",
	},
	{
		id: "runtime",
		label: "设置与运行时",
		description: "Settings、Provider、凭据、插件、统计和退出",
	},
	{
		id: "diagnostics",
		label: "历史与诊断",
		description: "Trajectory、附件和消息反馈",
	},
];

async function selectDshMenuPage(
	ctx: ExtensionContext,
	title: string,
	subtitle: string,
	items: SelectItem[],
): Promise<string | undefined> {
	const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 1));
		container.addChild(new Text(theme.fg("dim", subtitle), 1, 0));
		container.addChild(new Spacer(1));
		const list = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("text", theme.bold(text)),
			description: (text) => theme.fg("muted", `  ${text}`),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", "↑↓ 选择 · Enter 打开 · Esc 返回"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return result ?? undefined;
}

async function showDshManagementMenu(ctx: ExtensionContext, runtime: DshProfileRuntime): Promise<string | undefined> {
	while (true) {
		const category = await selectDshMenuPage(
			ctx,
			"DeepSeek Harness 管理",
			`当前会话 ${runtime.sessionId} · 所有状态和操作均来自 Harness 原生服务`,
			DSH_MENU_CATEGORIES.map((item) => ({
				value: item.id,
				label: item.label,
				description: item.description,
			})),
		);
		if (!category) return undefined;
		const definition = DSH_MENU_CATEGORIES.find((item) => item.id === category);
		if (!definition) continue;
		const action = await selectDshMenuPage(
			ctx,
			definition.label,
			`${definition.description} · 也可直接使用 /dsh <action>`,
			(category === "common"
				? DSH_QUICK_ACTIONS.map((id) => DSH_ACTIONS.find((item) => item.action === id)).filter(
						(item): item is DshActionDefinition => item !== undefined,
					)
				: DSH_ACTIONS.filter((item) => item.category === category)
			).map((item) => ({
				value: item.action,
				label: `${item.label}  /dsh ${item.action}`,
				description: item.description,
			})),
		);
		if (!action) continue;
		if (action === "exit" && !(await ctx.ui.confirm("退出 Meldra", "关闭当前 Harness Runtime 和 Meldra 进程？")))
			continue;
		return action;
	}
}

export default function dshExtension(pi: ExtensionAPI): void {
	if (!activeDshProfile()) return;

	let unsubscribeEvents: (() => void) | undefined;
	let activeRuntime: DshProfileRuntime | undefined;
	let commandCatalogSessionId: string | undefined;
	let commandCatalogPromise: Promise<Record<string, unknown>[]> | undefined;
	let skillCatalogSessionId: string | undefined;
	let skillCatalogPromise: Promise<Record<string, unknown>[]> | undefined;
	let interactionTail = Promise.resolve();
	let interactionGeneration = 0;
	let running = false;
	let metrics: string | undefined;
	let jobs: Record<string, unknown>[] = [];
	let queueItems: Record<string, unknown>[] = [];
	let projections: Record<string, unknown> = {};
	let piActiveModel: { provider: string; id: string } | undefined;
	let profileModelPreference: { provider: string; id: string } | undefined;
	const selectedFileReferences = new Set<string>();
	const executeProfilePackageRequest = async (
		ctx: ExtensionContext,
		runtime: DshProfileRuntime,
		request: ProfileRuntimePackageRequest,
		confirmation?: { title: string; message: string },
	): Promise<void> => {
		if (confirmation && !(await ctx.ui.confirm(confirmation.title, confirmation.message))) return;
		let beforeInventory: Record<string, unknown>[] = [];
		if (request.operation !== "list") {
			try {
				beforeInventory = await runtime.plugins();
			} catch {
				// Package mutation remains available when the pre-change inventory cannot be read.
			}
		}
		const outcome = await ctx.ui.custom<
			{ result: Awaited<ReturnType<DshProfileRuntime["manageProfilePlugins"]>> } | { error: unknown }
		>((tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(tui, theme, `Harness Profile 包：${request.operation}`);
			runtime
				.manageProfilePlugins(request, { signal: loader.signal })
				.then((result) => done({ result }))
				.catch((error) => done({ error }));
			return loader;
		});
		if ("error" in outcome) {
			const aborted = outcome.error instanceof Error && outcome.error.name === "AbortError";
			ctx.ui.notify(aborted ? "Harness Profile 包操作已取消。" : String(outcome.error), aborted ? "info" : "error");
			return;
		}
		const { result } = outcome;
		if (result.code !== 0) {
			ctx.ui.notify(result.output || `dsh plugin 退出码：${result.code}。`, "error");
			return;
		}
		ctx.ui.notify(result.output || "Harness Profile 包操作已完成。", "info");
		if (
			request.operation !== "list" &&
			(await ctx.ui.confirm(
				"重新加载 Harness Runtime",
				"包变更将在下一次 Harness Runtime 启动时生效。现在重新加载？",
			))
		) {
			await runtime.restart();
			ctx.ui.notify("Harness Runtime 已重新加载。", "info");
			try {
				const afterInventory = await runtime.plugins();
				const before = new Set(
					beforeInventory.map((plugin) => `${plugin.entryId ?? ""}\0${plugin.moduleName ?? ""}`),
				);
				const after = new Set(
					afterInventory.map((plugin) => `${plugin.entryId ?? ""}\0${plugin.moduleName ?? ""}`),
				);
				const added = [...after].filter((identity) => !before.has(identity)).length;
				const removed = [...before].filter((identity) => !after.has(identity)).length;
				ctx.ui.notify(
					`Harness Loader Inventory 已验证：${afterInventory.length} 项${added || removed ? ` · +${added}/-${removed}` : " · 无条目变化"}。`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(`Runtime 已重新加载，但 Loader Inventory 验证失败：${String(error)}`, "error");
			}
		}
	};
	const updateQueueSurface = (ctx: ExtensionContext): void => {
		const visible = queueItems.filter((item) => item.placement === "queued" || item.placement === "steering");
		ctx.ui.setStatus(
			"meldra-dsh-2-queue",
			visible.length ? ctx.ui.theme.fg("warning", `队列 ${visible.length}`) : undefined,
		);
		const lines = visible.slice(0, 4).map((item) => {
			const steering = item.placement === "steering";
			const icon = steering ? "→" : "·";
			const state = steering ? "引导" : "后续";
			const preview = queuePreview(item);
			if (steering) {
				return `${ctx.ui.theme.fg("accent", icon)} ${ctx.ui.theme.fg("accent", state)} ${preview}`;
			}
			return `${ctx.ui.theme.fg("dim", icon)} ${ctx.ui.theme.fg("dim", state)} ${ctx.ui.theme.fg("dim", preview)}`;
		});
		if (visible.length > lines.length)
			lines.push(ctx.ui.theme.fg("muted", `  … 还有 ${visible.length - lines.length} 项`));
		ctx.ui.setWidget("meldra-dsh-2-queue", lines.length > 0 ? lines : undefined);
	};
	const clearQueueSurface = (ctx: ExtensionContext): void => {
		queueItems = [];
		updateQueueSurface(ctx);
	};
	const updateModelBridgeStatus = (ctx: ExtensionContext, catalog: unknown): void => {
		const record = isRecord(catalog) ? catalog : {};
		const current = isRecord(record.current) ? record.current : {};
		const provider = typeof current.provider === "string" ? current.provider : undefined;
		const model = typeof current.model === "string" ? current.model : undefined;
		const activeModel = piActiveModel;
		const activeModelInCatalog =
			activeModel !== undefined &&
			records(record.groups).some(
				(group) =>
					group.id === activeModel.provider &&
					records(group.models).some((candidate) => candidate.id === activeModel.id),
			);
		let label = provider && model ? `Harness native ${provider}/${model}` : "Harness preset/default";
		if (activeModel) {
			const routeMatches = provider === activeModel.provider && model === activeModel.id;
			label += routeMatches
				? " · Pi active matched"
				: activeModelInCatalog
					? ` · Pi active ${activeModel.provider}/${activeModel.id} · native differs`
					: ` · Pi active ${activeModel.provider}/${activeModel.id} · not in Harness catalog`;
		}
		const preference = profileModelPreference;
		if (
			preference &&
			(!activeModel || preference.provider !== activeModel.provider || preference.id !== activeModel.id)
		) {
			const preferenceInCatalog = records(record.groups).some(
				(group) =>
					group.id === preference.provider &&
					records(group.models).some((candidate) => candidate.id === preference.id),
			);
			label += ` · Profile preference ${preference.provider}/${preference.id}${preferenceInCatalog ? "" : " · not in Harness catalog"}`;
		}
		ctx.ui.setStatus("meldra-dsh-0-model", ctx.ui.theme.fg("dim", label));
	};
	const invalidateCommandCatalog = (): void => {
		commandCatalogSessionId = undefined;
		commandCatalogPromise = undefined;
	};
	const nativeCommands = async (runtime: DshProfileRuntime): Promise<Record<string, unknown>[]> => {
		if (commandCatalogPromise && commandCatalogSessionId === runtime.sessionId) return commandCatalogPromise;
		commandCatalogSessionId = runtime.sessionId;
		const pending = runtime.commands();
		commandCatalogPromise = pending;
		try {
			return await pending;
		} catch (error) {
			if (commandCatalogPromise === pending) commandCatalogPromise = undefined;
			throw error;
		}
	};
	const invalidateSkillCatalog = (): void => {
		skillCatalogSessionId = undefined;
		skillCatalogPromise = undefined;
	};
	const nativeSkills = async (runtime: DshProfileRuntime): Promise<Record<string, unknown>[]> => {
		if (skillCatalogPromise && skillCatalogSessionId === runtime.sessionId) return skillCatalogPromise;
		skillCatalogSessionId = runtime.sessionId;
		const pending = runtime.skills();
		skillCatalogPromise = pending;
		try {
			return await pending;
		} catch (error) {
			if (skillCatalogPromise === pending) skillCatalogPromise = undefined;
			throw error;
		}
	};
	const dshActions = DSH_ACTIONS.map(({ action }) => action);
	const stepTimings = new Map<string, { stepStartTime?: number; firstTokenTime?: number }>();
	const updateProjectionStatuses = (ctx: ExtensionContext): void => {
		const plan =
			projections.plan && typeof projections.plan === "object"
				? (projections.plan as Record<string, unknown>)
				: undefined;
		const planEnabled = plan ? (plan.pending === true ? plan.active !== true : plan.active === true) : false;
		ctx.ui.setStatus("meldra-dsh-4-plan", planEnabled ? ctx.ui.theme.fg("accent", "📝 计划") : undefined);
		const todos = Array.isArray(projections.todos)
			? projections.todos.filter(
					(todo): todo is Record<string, unknown> => todo !== null && typeof todo === "object",
				)
			: [];
		const complete = todos.filter((todo) => todo.status === "completed").length;
		ctx.ui.setStatus(
			"meldra-dsh-5-todos",
			todos.length
				? ctx.ui.theme.fg(complete === todos.length ? "success" : "muted", `✓ ${complete}/${todos.length}`)
				: undefined,
		);
		const projectedMetrics = formatProjectionMetrics(projections);
		if (projectedMetrics !== undefined) metrics = projectedMetrics;
		// Core status: running/idle only
		ctx.ui.setStatus("meldra-dsh-1-status", running ? ctx.ui.theme.fg("warning", "▶ 运行中") : undefined);
		// Detailed metrics: widget when available
		ctx.ui.setWidget("meldra-dsh-metrics", metrics ? [ctx.ui.theme.fg("dim", metrics)] : undefined, {
			placement: "aboveEditor",
		});
	};
	const renderDshEntry: EntryRenderer<DshEntryData> = (entry, _options, theme) => {
		const data = entry.data;
		if (!data || typeof data.text !== "string") return undefined;
		const label =
			data.kind === "user"
				? theme.fg("accent", "You")
				: data.kind === "assistant"
					? theme.fg("success", "DeepSeek Harness")
					: data.kind === "error"
						? theme.fg("error", "❌ 错误")
						: data.kind === "tool"
							? theme.fg("warning", "🔧 工具")
							: theme.fg("dim", "DSH");

		if (data.kind === "user") {
			const box = new Box(1, 1, (content: string) => interactiveTheme.bg("userMessageBg", content));
			box.addChild(new Text(label, 0, 0));
			box.addChild(new Spacer(1));
			box.addChild(
				new Markdown(data.text, 0, 0, getMarkdownTheme(), {
					color: (content: string) => theme.fg("userMessageText", content),
				}),
			);
			return box;
		}

		if (data.kind === "assistant") {
			const box = new Box(1, 0);
			box.addChild(new Spacer(1));
			box.addChild(new Text(label, 0, 0));
			box.addChild(new Markdown(data.text, 0, 0, getMarkdownTheme()));
			return box;
		}

		const box = new Box(1, 0);
		const formattedText = data.kind === "info" ? theme.fg("dim", data.text) : data.text;
		box.addChild(
			new Text(`${label}\n${data.kind === "error" ? theme.fg("error", formattedText) : formattedText}`, 0, 0),
		);
		return box;
	};
	pi.registerEntryRenderer<DshEntryData>(MELDRA_DSH_MESSAGE_ENTRY, renderDshEntry);
	pi.registerEntryRenderer<DshEntryData>(LEGACY_METAPI_DSH_MESSAGE_ENTRY, renderDshEntry);

	const dshCommand: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "打开 DeepSeek Harness 管理中心，或执行 /dsh <action>",
		getArgumentCompletions: async (argumentPrefix) => {
			if (argumentPrefix.startsWith("invoke ")) {
				const runtime = activeRuntime;
				if (!runtime) return null;
				const query = argumentPrefix.slice(7).trim().replace(/^\//, "");
				let skills: Record<string, unknown>[];
				try {
					skills = await nativeSkills(runtime);
				} catch {
					return null;
				}
				return skills.flatMap((skill) => {
					if (typeof skill.name !== "string" || !skill.name.toLowerCase().includes(query.toLowerCase())) return [];
					return [
						{
							value: `invoke /${skill.name}`,
							label: `invoke /${skill.name}`,
							description: typeof skill.description === "string" ? skill.description : undefined,
						},
					];
				});
			}
			if (argumentPrefix.startsWith("run ")) {
				const runtime = activeRuntime;
				if (!runtime) return null;
				const query = argumentPrefix.slice(4).trim().replace(/^\//, "");
				let commands: Record<string, unknown>[];
				try {
					commands = await nativeCommands(runtime);
				} catch {
					return null;
				}
				return commands.flatMap((command) => {
					if (typeof command.name !== "string" || !command.name.toLowerCase().includes(query.toLowerCase()))
						return [];
					return [
						{
							value: `run /${command.name}`,
							label: `run /${command.name}`,
							description: typeof command.description === "string" ? command.description : undefined,
						},
					];
				});
			}
			if (argumentPrefix.includes(" ")) return null;
			const query = argumentPrefix.toLowerCase();
			return DSH_ACTIONS.filter(({ action }) => action.startsWith(query)).map((item) => ({
				value: item.action,
				label: `${item.action} · ${item.label}`,
				description: item.description,
			}));
		},
		handler: async (args, ctx) => {
			const runtime = runtimeOf(ctx);
			if (!runtime) {
				ctx.ui.notify("当前 Profile 没有启用 DSH Runtime。", "info");
				return;
			}
			let effectiveArgs = args.trim();
			if (!effectiveArgs) {
				if (ctx.mode !== "tui") {
					ctx.ui.notify(`DSH 可用操作：${DSH_ACTIONS.map(({ action }) => action).join(", ")}`, "info");
					return;
				}
				const selected = await showDshManagementMenu(ctx, runtime);
				if (!selected) return;
				effectiveArgs = selected;
			}
			const [command = "", ...rest] = effectiveArgs.split(/\s+/);
			let action = command.toLowerCase();
			if (action === "settings-home") {
				if (ctx.mode !== "tui") {
					action = "settings";
				} else {
					const selected = await ctx.ui.select("DSH 设置", [
						"模型",
						"推理等级",
						"Harness Settings、Provider 与凭据",
					]);
					if (!selected) return;
					action = selected === "模型" ? "model" : selected === "推理等级" ? "effort" : "settings";
				}
			}
			if (action === "exit") {
				ctx.shutdown();
				return;
			}
			if (action === "sessions") {
				const sessionId = await selectDshSession(ctx, runtime);
				if (sessionId) {
					runtime.switchSession(sessionId);
					clearQueueSurface(ctx);
					projections = await runtime.projections();
				}
				return;
			}
			if (action === "new") {
				const sessionId = await runtime.newSession();
				clearQueueSurface(ctx);
				projections = await runtime.projections();
				ctx.ui.notify(`已创建 DSH Session：${sessionId}`, "info");
				return;
			}
			if (action === "history") {
				let beforeSeq: number | undefined;
				while (true) {
					const history = await runtime.history(beforeSeq);
					const historyRecord = isRecord(history) ? history : {};
					const entries = records(historyRecord.events);
					if (entries.length === 0) return ctx.ui.notify("当前 DSH Session 没有历史事件。", "info");
					const choices = entries.map((entry, index) => {
						const event = isRecord(entry.event) ? entry.event : {};
						const data = isRecord(event.data) ? event.data : undefined;
						const message = isRecord(data?.message) ? data.message : data;
						const preview = records(message?.content)
							.flatMap((block) =>
								block.type === "text" && typeof block.text === "string"
									? [block.text.replace(/\s+/g, " ").trim()]
									: block.type === "image"
										? ["[图片]"]
										: [],
							)
							.join(" ")
							.slice(0, 80);
						return {
							entry,
							event,
							message,
							seq: typeof event.seq === "number" ? event.seq : undefined,
							label: [
								`#${typeof event.seq === "number" ? event.seq : index + 1}`,
								typeof event.type === "string" ? event.type : "event",
								preview || undefined,
							]
								.filter(Boolean)
								.join(" · "),
						};
					});
					const loadOlder =
						historyRecord.hasMore === true && choices.some(({ seq }) => seq !== undefined)
							? "加载更早消息"
							: undefined;
					const selected = await ctx.ui.select(
						"DSH Session 历史",
						[...choices.map(({ label }) => label), loadOlder].filter((label): label is string => Boolean(label)),
					);
					if (selected === loadOlder) {
						beforeSeq = Math.min(...choices.flatMap(({ seq }) => (seq === undefined ? [] : [seq])));
						continue;
					}
					const choice = choices.find(({ label }) => label === selected);
					if (!choice) return;
					const content = records(choice.message?.content);
					if (content.length === 0 || ctx.mode !== "tui") {
						ctx.ui.notify(JSON.stringify(choice.entry, null, 2), "info");
						return;
					}
					const rendered: Array<
						| { type: "text"; text: string }
						| {
								type: "image";
								data: string;
								attachment: Record<string, unknown>;
						  }
					> = [];
					for (const block of content) {
						if (block.type === "text" && typeof block.text === "string") {
							rendered.push({ type: "text", text: block.text });
							continue;
						}
						const ref = isRecord(block.attachment) ? block.attachment : undefined;
						if (block.type !== "image" || typeof ref?.attachmentId !== "string") continue;
						const image = await runtime.attachment(ref.attachmentId);
						if (!isRecord(image.attachment) || typeof image.data !== "string")
							throw new Error("Harness 返回了无效Image Attachment。");
						rendered.push({
							type: "image",
							data: image.data,
							attachment: image.attachment,
						});
					}
					await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
						const container = new Container();
						container.addChild(new Text(theme.fg("accent", choice.label), 1, 0));
						for (const block of rendered) {
							container.addChild(new Spacer(1));
							if (block.type === "text") {
								container.addChild(new Text(block.text, 1, 0));
								continue;
							}
							const attachment = block.attachment;
							container.addChild(
								new Image(
									block.data,
									typeof attachment.mediaType === "string" ? attachment.mediaType : "image/png",
									{ fallbackColor: (text) => theme.fg("muted", text) },
									{
										maxWidthCells: 60,
										filename:
											typeof attachment.name === "string"
												? attachment.name
												: typeof attachment.attachmentId === "string"
													? attachment.attachmentId
													: "image",
									},
									typeof attachment.width === "number" && typeof attachment.height === "number"
										? { widthPx: attachment.width, heightPx: attachment.height }
										: undefined,
								),
							);
						}
						container.addChild(new Text(theme.fg("dim", "Enter / Esc 关闭"), 1, 0));
						return {
							render: (width: number) => container.render(width),
							invalidate: () => container.invalidate(),
							handleInput: (data: string) => {
								if (matchesKey(data, "enter") || matchesKey(data, "escape")) done();
							},
						};
					});
					return;
				}
			}
			if (action === "rewind") {
				const { choices, truncated } = await dshRewindChoices(runtime);
				if (choices.length === 0)
					return ctx.ui.notify(
						"没有可无损回填的历史消息。首轮消息以及非单一文本开头的内容结构暂不支持恢复。",
						"info",
					);
				await runDshRewind({
					ctx: ctx as ExtensionCommandContext,
					runtime,
					choices,
					truncated,
					isRunning: () => running,
					clearQueue: () => clearQueueSurface(ctx),
					invalidateCatalogs: () => {
						invalidateCommandCatalog();
						invalidateSkillCatalog();
					},
					refreshProjections: async () => {
						projections = await runtime.projections();
						updateProjectionStatuses(ctx);
					},
				});
				return;
			}
			if (action === "fork") {
				const sessionId = await runtime.fork();
				clearQueueSurface(ctx);
				ctx.ui.notify(`已 fork 并切换到 DSH Session：${sessionId}`, "info");
				return;
			}
			if (action === "rename") {
				const title = rest.join(" ") || (await ctx.ui.input("重命名 DSH Session", "输入标题"));
				if (title) await runtime.rename(title);
				return;
			}
			if (action === "cancel") {
				await runtime.cancel();
				ctx.ui.notify("已向 DSH 发送取消请求。", "info");
				return;
			}
			if (action === "queue") {
				const pending = queueItems.filter(
					(item) => typeof item.id === "string" && (item.placement === "queued" || item.placement === "steering"),
				);
				if (pending.length === 0) return ctx.ui.notify("当前 DSH Session 没有待处理消息。", "info");
				const choices = pending.map((item, index) => ({
					item,
					label: `#${index + 1} · ${item.placement === "steering" ? "立即引导" : "后续消息"} · ${queuePreview(item)} · ${item.id as string}`,
				}));
				const selected = await ctx.ui.select(
					"DSH 待处理消息",
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (!choice || typeof choice.item.id !== "string") return;
				const text = queueMessageText(choice.item);
				const actions = [
					...(text !== undefined ? ["取回到输入框", "编辑"] : []),
					"撤回",
					...(choice.item.placement === "queued" && running ? ["立即引导当前回合"] : []),
				];
				const operation = await ctx.ui.select("处理待处理消息", actions);
				if (operation === "取回到输入框" && text !== undefined) {
					try {
						await runtime.updateQueue(choice.item.id, { kind: "remove" });
					} catch (error) {
						ctx.ui.notify(
							`取回待处理消息失败：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
						return;
					}
					ctx.ui.setEditorText(text);
					ctx.ui.notify("待处理消息已取回输入框。", "info");
					return;
				}
				if (operation === "编辑" && text !== undefined) {
					const edited = await ctx.ui.editor("编辑待处理消息", text);
					if (edited === undefined || edited === text) return;
					if (!edited.trim()) return ctx.ui.notify("待处理消息不能为空。", "warning");
					try {
						await runtime.updateQueue(choice.item.id, {
							kind: "edit",
							content: [{ type: "text", text: edited }],
						});
					} catch (error) {
						ctx.ui.notify(
							`编辑待处理消息失败：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
						return;
					}
				} else if (operation === "撤回") {
					try {
						await runtime.updateQueue(choice.item.id, { kind: "remove" });
					} catch (error) {
						ctx.ui.notify(
							`撤回待处理消息失败：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
						return;
					}
				} else if (operation === "立即引导当前回合") {
					try {
						await runtime.updateQueue(choice.item.id, { kind: "steer" });
					} catch (error) {
						ctx.ui.notify(
							`立即引导待处理消息失败：${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
						return;
					}
				} else {
					return;
				}
				ctx.ui.notify("Harness 已接受队列更新。", "info");
				return;
			}
			if (action === "run") {
				const requested = rest.join(" ").trim();
				if (!requested) return ctx.ui.notify("请选择 Harness 命令，或使用 /dsh commands。", "info");
				const line = requested.startsWith("/") ? requested : `/${requested}`;
				const result = await runtime.executeCommand(line);
				const command = isRecord(result) && isRecord(result.command) ? result.command : undefined;
				ctx.ui.notify(typeof command?.text === "string" ? command.text : `Harness 已接受命令：${line}`, "info");
				return;
			}
			if (action === "invoke") {
				const requested = rest.join(" ").trim();
				if (!requested) return ctx.ui.notify("请选择 Harness Skill，或使用 /dsh skills。", "info");
				const line = requested.startsWith("/") ? requested : `/${requested}`;
				await runtime.prompt({ text: line });
				return;
			}
			if (action === "preset") {
				const presets = await runtime.presets();
				if (presets.length === 0) return ctx.ui.notify("当前 Harness composition 没有 Agent Preset。", "info");
				const choices = presets.flatMap((preset) => {
					if (typeof preset.id !== "string") return [];
					const name = typeof preset.name === "string" ? preset.name : preset.id;
					const flags = [
						preset.isDefault === true ? "默认" : undefined,
						typeof preset.trust === "string" ? preset.trust : undefined,
					].filter(Boolean);
					return [
						{
							id: preset.id,
							label: `${name} · ${preset.id}${flags.length ? ` · ${flags.join(" · ")}` : ""}`,
						},
					];
				});
				const selected = await ctx.ui.select(
					"选择 DSH Agent Preset（仅空 Session 可切换）",
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (choice) {
					const applied = await runtime.selectPreset(choice.id);
					invalidateCommandCatalog();
					invalidateSkillCatalog();
					ctx.ui.notify(`已选择 DSH Agent Preset：${applied}`, "info");
				}
				return;
			}
			if (action === "feedback") {
				const history = await runtime.history();
				const messages =
					history && typeof history === "object"
						? records((history as Record<string, unknown>).events).flatMap((entry) => {
								if (!entry.event || typeof entry.event !== "object") return [];
								const event = entry.event as Record<string, unknown>;
								const data =
									event.data && typeof event.data === "object"
										? (event.data as Record<string, unknown>)
										: undefined;
								const message =
									data?.message && typeof data.message === "object"
										? (data.message as Record<string, unknown>)
										: undefined;
								if (event.type !== "assistant/message" || !message || typeof message.id !== "string") return [];
								const preview = records(message.content)
									.flatMap((block) =>
										block.type === "text" && typeof block.text === "string"
											? [block.text.replace(/\s+/g, " ").trim()]
											: [],
									)
									.join(" ")
									.slice(0, 80);
								return [{ messageId: message.id, preview }];
							})
						: [];
				if (messages.length === 0) return ctx.ui.notify("当前 DSH 历史中没有可反馈的 Assistant 消息。", "info");
				const listed = await runtime.listMessageFeedback();
				if (listed.ok !== true || !listed.value || typeof listed.value !== "object")
					return ctx.ui.notify(`DSH 消息反馈读取失败：${JSON.stringify(listed)}`, "error");
				const items = records((listed.value as Record<string, unknown>).items);
				const choices = messages.map((message) => {
					const current = items.find((item) => item.messageId === message.messageId);
					return {
						...message,
						current,
						label: [
							message.preview || message.messageId,
							current?.rating === "positive" ? "正向" : current?.rating === "negative" ? "负向" : "未评价",
						].join(" · "),
					};
				});
				const selected = await ctx.ui.select(
					"DSH 消息反馈",
					choices.map(({ label }) => label),
				);
				const choice = choices.find(({ label }) => label === selected);
				if (!choice) return;
				const operation = await ctx.ui.select("反馈操作", ["正向", "负向", ...(choice.current ? ["移除"] : [])]);
				let result: Record<string, unknown> | undefined;
				if (operation === "移除") {
					if (typeof choice.current?.version !== "string") return;
					result = await runtime.deleteMessageFeedback(choice.messageId, choice.current.version);
				} else if (operation === "正向" || operation === "负向") {
					const note = await ctx.ui.input("反馈备注（可留空）", "可选备注");
					result = await runtime.putMessageFeedback(
						choice.messageId,
						operation === "正向" ? "positive" : "negative",
						note?.trim() || undefined,
						typeof choice.current?.version === "string" ? choice.current.version : null,
					);
				}
				if (!result) return;
				ctx.ui.notify(
					JSON.stringify(result.ok === true ? result.value : result.error, null, 2),
					result.ok === true ? "info" : "error",
				);
				return;
			}
			if (action === "attachments") {
				let beforeSeq: number | undefined;
				while (true) {
					const page = await runtime.history(beforeSeq);
					if (!page || typeof page !== "object") return ctx.ui.notify("Harness 未返回附件历史。", "error");
					const pageRecord = page as Record<string, unknown>;
					const refs = records(pageRecord.events).flatMap((entry) => {
						if (!entry.event || typeof entry.event !== "object") return [];
						const event = entry.event as Record<string, unknown>;
						const data =
							event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : undefined;
						const message =
							data?.message && typeof data.message === "object"
								? (data.message as Record<string, unknown>)
								: data;
						return records(message?.content).flatMap((block) => {
							const attachment =
								block.type === "image" && block.attachment && typeof block.attachment === "object"
									? (block.attachment as Record<string, unknown>)
									: undefined;
							if (!attachment || typeof attachment.attachmentId !== "string") return [];
							return [
								{
									attachment,
									seq: typeof event.seq === "number" ? event.seq : 0,
									label: [
										typeof attachment.name === "string" ? attachment.name : attachment.attachmentId,
										typeof attachment.width === "number" && typeof attachment.height === "number"
											? `${attachment.width}×${attachment.height}`
											: undefined,
										typeof attachment.bytes === "number" ? `${attachment.bytes} bytes` : undefined,
										`#${typeof event.seq === "number" ? event.seq : "?"}`,
									]
										.filter(Boolean)
										.join(" · "),
								},
							];
						});
					});
					const loadOlder = pageRecord.hasMore === true && refs.length > 0 ? "加载更早图片" : undefined;
					if (refs.length === 0 && !loadOlder) return ctx.ui.notify("当前DSH历史中没有图片。", "info");
					const selected = await ctx.ui.select(
						"DSH 图片附件",
						[...refs.map(({ label }) => label), loadOlder].filter((label): label is string => Boolean(label)),
					);
					if (!selected) return;
					if (selected === loadOlder) {
						beforeSeq = Math.min(...refs.map(({ seq }) => seq));
						continue;
					}
					const ref = refs.find(({ label }) => label === selected)?.attachment;
					if (!ref || typeof ref.attachmentId !== "string") return;
					const attachmentId = ref.attachmentId;
					const image = await runtime.attachment(attachmentId);
					const attachment =
						image.attachment && typeof image.attachment === "object"
							? (image.attachment as Record<string, unknown>)
							: undefined;
					if (!attachment || typeof image.data !== "string")
						throw new Error("Harness 返回了无效Image Attachment。");
					if (ctx.mode !== "tui") {
						ctx.ui.notify(JSON.stringify(attachment, null, 2), "info");
						return;
					}
					await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
						const container = new Container();
						container.addChild(new Text(theme.fg("accent", selected), 1, 0));
						container.addChild(new Spacer(1));
						container.addChild(
							new Image(
								image.data as string,
								typeof attachment.mediaType === "string" ? attachment.mediaType : "image/png",
								{ fallbackColor: (text) => theme.fg("muted", text) },
								{
									maxWidthCells: 60,
									filename:
										typeof attachment.name === "string"
											? attachment.name
											: typeof attachment.attachmentId === "string"
												? attachment.attachmentId
												: attachmentId,
								},
								typeof attachment.width === "number" && typeof attachment.height === "number"
									? {
											widthPx: attachment.width,
											heightPx: attachment.height,
										}
									: undefined,
							),
						);
						container.addChild(new Text(theme.fg("dim", "Enter / Esc 关闭"), 1, 0));
						return {
							render: (width: number) => container.render(width),
							invalidate: () => container.invalidate(),
							handleInput: (data: string) => {
								if (matchesKey(data, "enter") || matchesKey(data, "escape")) done();
							},
						};
					});
					return;
				}
			}
			if (action === "trajectory") {
				let beforeSeq: number | undefined;
				while (true) {
					const page = await runtime.history(beforeSeq);
					if (!page || typeof page !== "object") return ctx.ui.notify("Harness 未返回 Trajectory 历史。", "error");
					const pageRecord = page as Record<string, unknown>;
					const entries = trajectoryChoices(pageRecord);
					const ordered = [...entries].reverse();
					const loadOlder = pageRecord.hasMore === true && entries.length > 0 ? "加载更早记录" : undefined;
					const searchLabel = "搜索历史";
					const foldLabel = "按事件类型折叠";
					const waterfallLabel = "当前页时间线 / Waterfall";
					const fullWaterfallLabel = "跨页时间线 / Waterfall";
					const selected = await ctx.ui.select(
						"DSH Trajectory 轨迹",
						[
							searchLabel,
							foldLabel,
							waterfallLabel,
							fullWaterfallLabel,
							...ordered.map(({ label }) => label),
							loadOlder,
						].filter((label): label is string => Boolean(label)),
					);
					if (!selected) return;
					if (selected === fullWaterfallLabel) {
						const collected: TrajectoryChoice[] = [];
						let cursor: number | undefined;
						let pages = 0;
						let truncated = false;
						while (pages < 20 && collected.length < 500) {
							const timelinePage = await runtime.history(cursor);
							if (!isRecord(timelinePage)) break;
							const candidates = trajectoryChoices(timelinePage);
							collected.push(...candidates.slice(0, 500 - collected.length));
							pages += 1;
							if (timelinePage.hasMore !== true || candidates.length === 0) break;
							cursor = Math.min(...candidates.map(({ seq }) => seq));
						}
						if (pages === 20 || collected.length === 500) truncated = true;
						const rows = trajectoryWaterfall(collected);
						if (rows.length === 0) return ctx.ui.notify("当前 DSH Session 没有 Trajectory 历史。", "info");
						const selectedRow = await ctx.ui.select(
							`DSH Trajectory 时间线 ${rows.length}${truncated ? "+" : ""}`,
							rows.map(({ label }) => label),
						);
						const row = rows.find(({ label }) => label === selectedRow);
						if (row) ctx.ui.notify(JSON.stringify(row.choice.entry, null, 2), "info");
						return;
					}
					if (selected === waterfallLabel) {
						const rows = trajectoryWaterfall(entries);
						const selectedRow = await ctx.ui.select(
							"DSH Trajectory 时间线 / Waterfall",
							rows.map(({ label }) => label),
						);
						const row = rows.find(({ label }) => label === selectedRow);
						if (row) ctx.ui.notify(JSON.stringify(row.choice.entry, null, 2), "info");
						return;
					}
					if (selected === foldLabel) {
						const groups = new Map<string, TrajectoryChoice[]>();
						for (const entry of ordered) {
							const group = groups.get(entry.type) ?? [];
							group.push(entry);
							groups.set(entry.type, group);
						}
						const groupLabels = [...groups].map(([type, group]) => `${type} · ${group.length}`);
						const selectedGroup = await ctx.ui.select("DSH Trajectory 事件类型", groupLabels);
						const groupIndex = groupLabels.indexOf(selectedGroup ?? "");
						if (groupIndex < 0) return;
						const group = [...groups.values()][groupIndex] ?? [];
						const selectedEntry = await ctx.ui.select(
							selectedGroup ?? "DSH Trajectory",
							group.map(({ label }) => label),
						);
						const choice = group.find(({ label }) => label === selectedEntry);
						if (choice) ctx.ui.notify(JSON.stringify(choice.entry, null, 2), "info");
						return;
					}
					if (selected === searchLabel) {
						const query = (await ctx.ui.input("搜索 DSH Trajectory", "事件类型或内容"))?.trim();
						if (!query) return;
						const matches: TrajectoryChoice[] = [];
						let cursor: number | undefined;
						let pages = 0;
						let truncated = false;
						while (pages < 50 && matches.length < 100) {
							const searchPage = await runtime.history(cursor);
							if (!isRecord(searchPage)) break;
							const candidates = trajectoryChoices(searchPage);
							const folded = query.toLowerCase();
							for (const candidate of candidates) {
								if (candidate.searchText.toLowerCase().includes(folded)) matches.push(candidate);
								if (matches.length === 100) break;
							}
							pages += 1;
							if (searchPage.hasMore !== true || candidates.length === 0) break;
							cursor = Math.min(...candidates.map(({ seq }) => seq));
						}
						if (pages === 50 || matches.length === 100) truncated = true;
						if (matches.length === 0)
							return ctx.ui.notify(
								`没有匹配的 Trajectory 记录${truncated ? "（已达到扫描上限）" : ""}。`,
								"info",
							);
						const resultLabels = matches.map((match) => {
							const at = match.searchText.toLowerCase().indexOf(query.toLowerCase());
							const preview = match.searchText
								.slice(Math.max(0, at - 24), at + query.length + 48)
								.replace(/\s+/g, " ");
							return `${match.label} · ${preview}`;
						});
						const result = await ctx.ui.select(
							`DSH Trajectory matches ${matches.length}${truncated ? "+" : ""}`,
							resultLabels,
						);
						const match = matches[resultLabels.indexOf(result ?? "")];
						if (match) ctx.ui.notify(JSON.stringify(match.entry, null, 2), "info");
						return;
					}
					if (selected === loadOlder) {
						beforeSeq = Math.min(...entries.map(({ seq }) => seq));
						continue;
					}
					const choice = ordered.find(({ label }) => label === selected);
					if (choice) ctx.ui.notify(JSON.stringify(choice.entry, null, 2), "info");
					return;
				}
			}
			if (action === "plugins") {
				const plugins = await runtime.plugins();
				const choices = plugins.flatMap((plugin) =>
					typeof plugin.entryId === "string" && typeof plugin.moduleName === "string"
						? [
								{
									plugin,
									label: [
										plugin.moduleName,
										plugin.enabled === false ? "disabled" : plugin.fiberPhase,
										plugin.entryId,
									]
										.filter(Boolean)
										.join(" · "),
								},
							]
						: [],
				);
				const manageLabel = "管理 Profile 包";
				const reloadLabel = "重新加载 Harness Runtime";
				const selected = await ctx.ui.select("DSH 插件", [
					manageLabel,
					reloadLabel,
					...choices.map(({ label }) => label),
				]);
				if (selected === reloadLabel) {
					if (
						await ctx.ui.confirm(
							"重新加载 Harness Runtime",
							"当前 Harness 子进程会 graceful restart，Pi Profile 和 Session host 保持不变。是否继续？",
						)
					) {
						await runtime.restart();
						ctx.ui.notify("Harness Runtime 已重新加载。", "info");
					}
					return;
				}
				if (selected === manageLabel) {
					const operation = await ctx.ui.select("Harness Profile 包", [
						"查看已安装包",
						"安装包",
						"移除包",
						"更新全部",
					]);
					let request: ProfileRuntimePackageRequest | undefined;
					let confirmation: { title: string; message: string } | undefined;
					if (operation === "查看已安装包") request = { operation: "list" };
					else if (operation === "安装包") {
						const spec = await ctx.ui.input("Harness 包标识", "npm包、版本或本地路径");
						if (!spec?.trim()) return;
						confirmation = {
							title: "安装 Harness 包",
							message: `通过原生 dsh plugin add 安装 ${spec.trim()}？该操作可能访问包来源并执行其安装生命周期。`,
						};
						request = { operation: "add", source: spec.trim() };
					} else if (operation === "移除包") {
						const packageName = await ctx.ui.input("Harness 包名", "已安装的包名");
						if (!packageName?.trim()) return;
						confirmation = {
							title: "移除 Harness 包",
							message: `通过原生 dsh plugin remove 移除 ${packageName.trim()}？`,
						};
						request = { operation: "remove", packageName: packageName.trim() };
					} else if (operation === "更新全部") {
						confirmation = {
							title: "更新 Harness 包",
							message: "通过原生 dsh plugin update 更新当前 Meldra Profile 的 Harness 依赖？",
						};
						request = { operation: "update" };
					}
					if (!request) return;
					await executeProfilePackageRequest(ctx, runtime, request, confirmation);
					return;
				}
				const choice = choices.find(({ label }) => label === selected);
				if (choice) ctx.ui.notify(JSON.stringify(choice.plugin, null, 2), "info");
				return;
			}
			if (action === "settings") {
				const [settings, providers] = await Promise.all([runtime.settings(), runtime.providers()]);
				const namespaces = records(settings.namespaces);
				const secretChoices = namespaces.flatMap((namespace) => {
					if (typeof namespace.ns !== "string" || typeof namespace.revision !== "number") return [];
					return records(namespace.secrets).flatMap((secret) => {
						if (!Array.isArray(secret.path) || !secret.path.every((part) => typeof part === "string")) return [];
						return [
							{
								namespace,
								path: secret.path as string[],
								configured: secret.set === true,
								label: `${namespace.ns}.${(secret.path as string[]).join(".")} · ${secret.set === true ? "已配置" : "未配置"}`,
							},
						];
					});
				});
				const editableChoices = scalarSettingChoices(namespaces);
				const arrayChoices = arraySettingChoices(namespaces);
				const credentialRefs = credentialReferences(namespaces);
				const view = await ctx.ui.select("DSH 设置", [
					"设置命名空间",
					"Provider 目录",
					...(credentialRefs.length > 0 ? ["凭据引用"] : []),
					...(settings.writable === true && editableChoices.length > 0 ? ["可编辑字段"] : []),
					...(settings.writable === true && arrayChoices.length > 0 ? ["JSON 数组字段"] : []),
					...(settings.writable === true && secretChoices.length > 0 ? ["Secret 字段"] : []),
				]);
				if (view === "凭据引用") {
					const states = await runtime.describeCredentials(credentialRefs.map(({ ref }) => ref));
					const choices = credentialRefs.map((reference) => {
						const state = states[reference.ref] ?? {};
						return {
							reference,
							state,
							label: [
								reference.ref,
								state.configured === true ? "已配置" : "未配置",
								state.writable === true ? "可写" : "只读",
								typeof state.source === "string" ? state.source : undefined,
								`${reference.ns}.${reference.path.join(".")}`,
							]
								.filter(Boolean)
								.join(" · "),
						};
					});
					const selected = await ctx.ui.select(
						"DSH 凭据引用",
						choices.map(({ label }) => label),
					);
					const choice = choices.find(({ label }) => label === selected);
					if (!choice) return;
					if (choice.state.writable !== true) {
						ctx.ui.notify(
							`${choice.reference.ref} 为只读${typeof choice.state.source === "string" ? `（${choice.state.source}）` : ""}。`,
							"info",
						);
						return;
					}
					const operation = await ctx.ui.select("凭据操作", [
						"设置",
						...(choice.state.configured === true ? ["移除"] : []),
					]);
					if (operation === "设置") {
						const value = await ctx.ui.secretInput(`设置凭据 ${choice.reference.ref}`, "凭据值");
						if (!value) return;
						await runtime.setCredential(choice.reference.ref, value);
						ctx.ui.notify(`凭据 ${choice.reference.ref} 已更新。`, "info");
					} else if (
						operation === "移除" &&
						(await ctx.ui.confirm("移除 DSH 凭据", `移除可写凭据 ${choice.reference.ref}？`))
					) {
						await runtime.unsetCredential(choice.reference.ref);
						ctx.ui.notify(`凭据 ${choice.reference.ref} 已移除。`, "info");
					}
					return;
				}
				if (view === "JSON 数组字段") {
					const selected = await ctx.ui.select(
						"DSH Settings 数组字段",
						arrayChoices.map(({ label }) => label),
					);
					const choice = arrayChoices.find(({ label }) => label === selected);
					if (!choice || typeof choice.namespace.ns !== "string" || typeof choice.namespace.revision !== "number")
						return;
					const operation = await ctx.ui.select("数组设置操作", [
						"编辑 JSON",
						...(choice.overridden ? ["恢复继承值"] : []),
					]);
					let op: Record<string, unknown> | undefined;
					if (operation === "恢复继承值") {
						op = { op: "unset", path: choice.path };
					} else if (operation === "编辑 JSON") {
						const draft = await ctx.ui.editor(
							`编辑 ${choice.namespace.ns}.${choice.path.join(".")}`,
							JSON.stringify(choice.value, null, 2),
						);
						if (draft === undefined) return;
						let value: unknown;
						try {
							value = JSON.parse(draft);
							choice.node(value);
						} catch (error) {
							ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
							return;
						}
						op = { op: "set", path: choice.path, value };
					}
					if (!op) return;
					const updated = await runtime.mutateSettings(choice.namespace.ns, [op], choice.namespace.revision);
					ctx.ui.notify(
						`${choice.namespace.ns}.${choice.path.join(".")} 已更新 · ${updated.applies === "restart" ? "需重启" : "已实时生效"} · rev ${metric(updated.revision)}`,
						"info",
					);
					return;
				}
				if (view === "可编辑字段") {
					const selected = await ctx.ui.select(
						"DSH Settings 字段",
						editableChoices.map(({ label }) => label),
					);
					const choice = editableChoices.find(({ label }) => label === selected);
					if (!choice || typeof choice.namespace.ns !== "string" || typeof choice.namespace.revision !== "number")
						return;
					const operation = await ctx.ui.select("设置操作", [
						"写入",
						...(choice.overridden ? ["恢复继承值"] : []),
					]);
					let op: Record<string, unknown> | undefined;
					if (operation === "恢复继承值") {
						op = { op: "unset", path: choice.path };
					} else if (operation === "写入") {
						let value: unknown;
						if (choice.options) {
							const labels = choice.options.map((item) => JSON.stringify(item));
							const selectedValue = await ctx.ui.select(
								`写入 ${choice.namespace.ns}.${choice.path.join(".")}`,
								labels,
							);
							const index = labels.indexOf(selectedValue ?? "");
							if (index < 0) return;
							value = choice.options[index];
						} else if (choice.node.type === "boolean") {
							const selectedValue = await ctx.ui.select(`写入 ${choice.namespace.ns}.${choice.path.join(".")}`, [
								"true",
								"false",
							]);
							if (!selectedValue) return;
							value = selectedValue === "true";
						} else {
							const entered = await ctx.ui.input(
								`写入 ${choice.namespace.ns}.${choice.path.join(".")}`,
								choice.value === undefined ? "输入值" : String(choice.value),
							);
							if (entered === undefined) return;
							value = choice.node.type === "number" ? Number(entered) : entered;
						}
						try {
							choice.node(value);
						} catch (error) {
							ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
							return;
						}
						op = { op: "set", path: choice.path, value };
					}
					if (!op) return;
					const updated = await runtime.mutateSettings(choice.namespace.ns, [op], choice.namespace.revision);
					ctx.ui.notify(
						`${choice.namespace.ns}.${choice.path.join(".")} 已更新 · ${updated.applies === "restart" ? "需重启" : "已实时生效"} · rev ${metric(updated.revision)}`,
						"info",
					);
					return;
				}
				if (view === "Secret 字段") {
					const selected = await ctx.ui.select(
						"DSH Settings Secret 字段",
						secretChoices.map(({ label }) => label),
					);
					const choice = secretChoices.find(({ label }) => label === selected);
					if (!choice || typeof choice.namespace.ns !== "string") return;
					const operation = await ctx.ui.select("Secret 操作", ["设置", ...(choice.configured ? ["移除"] : [])]);
					let op: Record<string, unknown> | undefined;
					if (operation === "设置") {
						const value = await ctx.ui.secretInput(
							`设置 ${choice.namespace.ns}.${choice.path.join(".")}`,
							"Secret 值",
						);
						if (!value) return;
						op = { op: "set", path: choice.path, value };
					} else if (operation === "移除") {
						if (
							!(await ctx.ui.confirm(
								"移除 DSH Secret",
								`从可写 Settings 层移除 ${choice.namespace.ns}.${choice.path.join(".")}？`,
							))
						)
							return;
						op = { op: "unset", path: choice.path };
					}
					if (!op) return;
					const updated = await runtime.mutateSettings(
						choice.namespace.ns,
						[op],
						choice.namespace.revision as number,
					);
					ctx.ui.notify(
						`${choice.namespace.ns}.${choice.path.join(".")} 已更新 · ${updated.applies === "restart" ? "需重启" : "已实时生效"} · rev ${metric(updated.revision)}`,
						"info",
					);
					return;
				}
				if (view === "Provider 目录") {
					const choices = providers.flatMap((provider) =>
						typeof provider.provider === "string" && typeof provider.displayName === "string"
							? [
									{
										provider,
										label: `${provider.displayName} · ${provider.provider} · ${provider.active === true ? "已启用" : "未启用"}`,
									},
								]
							: [],
					);
					const selected = await ctx.ui.select(
						"DSH Provider 目录",
						choices.map(({ label }) => label),
					);
					const choice = choices.find(({ label }) => label === selected);
					if (choice) ctx.ui.notify(JSON.stringify(choice.provider, null, 2), "info");
					return;
				}
				if (view !== "设置命名空间") return;
				const choices = namespaces.flatMap((namespace) =>
					typeof namespace.ns === "string"
						? [
								{
									namespace,
									label: `${namespace.ns} · ${namespace.applies === "restart" ? "需重启" : "实时生效"} · rev ${metric(namespace.revision)}`,
								},
							]
						: [],
				);
				const selected = await ctx.ui.select(
					"DSH Settings 命名空间",
					choices.map(({ label }) => label),
				);
				const choice = choices.find(({ label }) => label === selected);
				if (!choice) return;
				const namespace = choice.namespace;
				const secrets = records(namespace.secrets).map((secret) => ({
					path: Array.isArray(secret.path) ? secret.path.join(".") : "",
					configured: secret.set === true,
				}));
				ctx.ui.notify(
					JSON.stringify(
						{
							ns: namespace.ns,
							applies: namespace.applies,
							revision: namespace.revision,
							value: namespace.value,
							base: namespace.base,
							user: namespace.user,
							secrets,
						},
						null,
						2,
					),
					"info",
				);
				return;
			}
			if (action === "evidence") {
				const evidence = await runtime.contextEvidence();
				if (!evidence.latestRequest && evidence.contextInjections.length === 0)
					return ctx.ui.notify("当前 DSH Session 尚无请求快照或 durable 上下文注入证据。", "info");
				ctx.ui.notify(JSON.stringify(evidence, null, 2), "info");
				return;
			}
			if (action === "context") {
				projections = { ...(await runtime.projections()), ...projections };
				updateProjectionStatuses(ctx);
				const pressure = projections.contextPressure;
				const breakdown = projections.contextBreakdown;
				const usage = projections.tokenUsage;
				const stats = projections.sessionStats;
				if (!pressure && !breakdown && !usage && !stats)
					return ctx.ui.notify("当前 DSH Session 尚无上下文统计。", "info");
				ctx.ui.notify(
					[
						"DSH Session 统计",
						JSON.stringify(
							{
								contextPressure: pressure,
								tokenUsage: usage,
								sessionStats: stats,
							},
							null,
							2,
						),
						breakdown
							? `启发式上下文构成（非 Provider 总量）：\n${JSON.stringify(breakdown, null, 2)}`
							: undefined,
					]
						.filter(Boolean)
						.join("\n\n"),
					"info",
				);
				return;
			}
			if (action === "commands") {
				const choices = (await nativeCommands(runtime)).flatMap((command) =>
					typeof command.name === "string" && typeof command.description === "string"
						? [{ command, label: `/${command.name} · ${command.description}` }]
						: [],
				);
				if (choices.length === 0) return ctx.ui.notify("当前 DSH Agent 没有可用命令。", "info");
				const selected = await ctx.ui.select(
					"DSH 原生命令",
					choices.map(({ label }) => label),
				);
				const choice = choices.find(({ label }) => label === selected);
				if (!choice || typeof choice.command.name !== "string") return;
				const inputDescriptor = choice.command.input;
				const input =
					inputDescriptor && typeof inputDescriptor === "object"
						? await ctx.ui.input(
								`/${choice.command.name} 参数`,
								typeof (inputDescriptor as Record<string, unknown>).hint === "string"
									? ((inputDescriptor as Record<string, unknown>).hint as string)
									: "输入参数",
							)
						: undefined;
				const result = await runtime.executeCommand(
					`/${choice.command.name}${input?.trim() ? ` ${input.trim()}` : ""}`,
				);
				const commandResult =
					result && typeof result === "object" ? (result as Record<string, unknown>).command : undefined;
				if (commandResult && typeof commandResult === "object") {
					const record = commandResult as Record<string, unknown>;
					ctx.ui.notify(
						typeof record.text === "string" ? record.text : `Harness 已执行 /${choice.command.name}。`,
						record.kind === "error" ? "error" : "info",
					);
				}
				return;
			}
			if (action === "compact") {
				if (
					!(await ctx.ui.confirm(
						"压缩当前 DSH Session",
						"由 Harness 原生 compaction service选择和替换可压缩历史。是否继续？",
					))
				)
					return;
				const result = await runtime.executeCommand("/compact");
				const command =
					result &&
					typeof result === "object" &&
					(result as Record<string, unknown>).command &&
					typeof (result as Record<string, unknown>).command === "object"
						? ((result as Record<string, unknown>).command as Record<string, unknown>)
						: undefined;
				ctx.ui.notify(typeof command?.text === "string" ? command.text : "Harness 已执行 Compact 命令。", "info");
				return;
			}
			if (action === "skills") {
				const skills = await nativeSkills(runtime);
				const choices = skills.flatMap((skill) => {
					if (typeof skill.name !== "string" || typeof skill.description !== "string") return [];
					return [
						{
							skill,
							label: [
								`/${skill.name}`,
								skill.description,
								skill.modelInvocable === false ? "仅用户调用" : undefined,
							]
								.filter(Boolean)
								.join(" · "),
						},
					];
				});
				if (choices.length === 0) return ctx.ui.notify("当前 DSH Session 没有可调用 Skill。", "info");
				const selected = await ctx.ui.select(
					"DSH 原生 Skills",
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (!choice || typeof choice.skill.name !== "string") return;
				const args = await ctx.ui.input(
					`/${choice.skill.name} 参数（可留空）`,
					typeof choice.skill.whenToUse === "string" ? choice.skill.whenToUse : "可选参数",
				);
				await runtime.prompt({
					text: `/${choice.skill.name}${args?.trim() ? ` ${args.trim()}` : ""}`,
				});
				return;
			}
			if (action === "plan") {
				const plan =
					projections.plan && typeof projections.plan === "object"
						? (projections.plan as Record<string, unknown>)
						: undefined;
				const enabled = plan ? (plan.pending === true ? plan.active !== true : plan.active === true) : false;
				const command = enabled ? "/plan off" : "/plan";
				const selected = await ctx.ui.select(
					`DSH Plan · ${enabled ? "已开启" : "已关闭"}${plan?.pending === true ? " · 等待生效" : ""}`,
					[enabled ? "关闭 Plan Mode" : "开启 Plan Mode"],
				);
				if (!selected) return;
				const result = await runtime.executeCommand(command);
				const commandResult =
					result &&
					typeof result === "object" &&
					(result as Record<string, unknown>).command &&
					typeof (result as Record<string, unknown>).command === "object"
						? ((result as Record<string, unknown>).command as Record<string, unknown>)
						: undefined;
				ctx.ui.notify(
					typeof commandResult?.text === "string" ? commandResult.text : "Harness 已执行 Plan 命令。",
					"info",
				);
				return;
			}
			if (action === "todo" || action === "todos") {
				const todos = Array.isArray(projections.todos)
					? projections.todos.filter(
							(todo): todo is Record<string, unknown> => todo !== null && typeof todo === "object",
						)
					: [];
				if (todos.length === 0) return ctx.ui.notify("当前 DSH Session 没有Todo projection。", "info");
				const labels = todos.map((todo, index) => {
					const marker = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○";
					return `${marker} ${typeof todo.content === "string" ? todo.content : `Todo ${index + 1}`}`;
				});
				const selected = await ctx.ui.select("Todos", labels);
				if (selected) {
					const todo = todos[labels.indexOf(selected)];
					if (todo) ctx.ui.notify(JSON.stringify(todo, null, 2), "info");
				}
				return;
			}
			if (action === "goal") {
				const projected = projections.goal;
				const projection =
					projected && typeof projected === "object" ? (projected as Record<string, unknown>) : undefined;
				const goal =
					projection?.goal && typeof projection.goal === "object"
						? (projection.goal as Record<string, unknown>)
						: undefined;
				if (!goal) {
					const create = await ctx.ui.select("DSH Goal", ["创建 Goal"]);
					if (create !== "创建 Goal") return;
					const objective = await ctx.ui.input("Goal 目标", "输入目标");
					if (!objective) return;
					const roundsText = await ctx.ui.input("Goal 最大轮数（可留空使用 Harness 默认值）", "正整数");
					const rounds = roundsText ? Number(roundsText) : undefined;
					if (rounds !== undefined && (!Number.isSafeInteger(rounds) || rounds < 1)) {
						ctx.ui.notify("Goal 最大轮数必须是正整数。", "error");
						return;
					}
					await runtime.createGoal(objective, rounds);
					ctx.ui.notify("DSH Goal 已创建。", "info");
					return;
				}
				if (typeof goal.id !== "string" || typeof goal.revision !== "number")
					return ctx.ui.notify("DSH Goal projection 缺少CAS引用。", "error");
				const ref = { id: goal.id, revision: goal.revision };
				const roundsStarted = typeof projection?.roundsStarted === "number" ? projection.roundsStarted : undefined;
				const editObjectiveLabel = "编辑目标";
				const editRoundsLabel = "编辑最大轮数";
				const pauseLabel = "暂停";
				const resumeLabel = "恢复";
				const completeLabel = "标记完成";
				const clearLabel = "清除";
				const goalAction = await ctx.ui.select(
					[
						typeof goal.objective === "string" ? goal.objective : goal.id,
						typeof goal.phase === "string" ? goal.phase : undefined,
						roundsStarted !== undefined && typeof goal.maxGoalRounds === "number"
							? `${roundsStarted}/${goal.maxGoalRounds} 轮`
							: undefined,
					]
						.filter(Boolean)
						.join(" · "),
					[
						editObjectiveLabel,
						editRoundsLabel,
						...(goal.phase === "active" ? [pauseLabel] : []),
						...(goal.phase === "paused" || goal.phase === "blocked" ? [resumeLabel] : []),
						...(goal.phase !== "complete" ? [completeLabel] : []),
						clearLabel,
					],
				);
				if (goalAction === editObjectiveLabel) {
					const objective = await ctx.ui.input(
						"Goal 目标",
						typeof goal.objective === "string" ? goal.objective : "输入目标",
					);
					if (objective) await runtime.mutateGoal("edit", ref, { objective });
					return;
				}
				if (goalAction === editRoundsLabel) {
					const value = await ctx.ui.input(
						"Goal 最大轮数",
						typeof goal.maxGoalRounds === "number" ? String(goal.maxGoalRounds) : "正整数",
					);
					if (!value) return;
					const maxGoalRounds = Number(value);
					if (!Number.isSafeInteger(maxGoalRounds) || maxGoalRounds < 1)
						return ctx.ui.notify("Goal 最大轮数必须是正整数。", "error");
					await runtime.mutateGoal("edit", ref, { maxGoalRounds });
					return;
				}
				if (goalAction === pauseLabel) await runtime.mutateGoal("pause", ref);
				else if (goalAction === resumeLabel) await runtime.mutateGoal("resume", ref);
				else if (goalAction === completeLabel) await runtime.mutateGoal("complete", ref);
				else if (
					goalAction === clearLabel &&
					(await ctx.ui.confirm("清除 DSH Goal", "Harness 会保留durable tombstone和历史。是否继续？"))
				)
					await runtime.mutateGoal("clear", ref);
				return;
			}
			if (action === "jobs") {
				if (jobs.length === 0) return ctx.ui.notify("当前 DSH Session 没有后台 Job。", "info");
				const choices = jobs.flatMap((job) => {
					if (
						typeof job.id !== "string" ||
						typeof job.kind !== "string" ||
						typeof job.label !== "string" ||
						typeof job.status !== "string"
					)
						return [];
					const duration =
						typeof job.startedAt === "number"
							? Math.max(0, (typeof job.finishedAt === "number" ? job.finishedAt : Date.now()) - job.startedAt)
							: undefined;
					return [
						{
							job,
							label: [
								job.id,
								job.kind,
								job.status,
								duration === undefined ? undefined : `${(duration / 1000).toFixed(1)}s`,
								job.label,
							]
								.filter(Boolean)
								.join(" · "),
						},
					];
				});
				const selected = await ctx.ui.select(
					"DSH 后台任务",
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (choice) ctx.ui.notify(JSON.stringify(choice.job, null, 2), "info");
				return;
			}
			if (action === "subagents") {
				const catalog = await runtime.subagents();
				if (catalog.entries.length === 0) return ctx.ui.notify("当前 DSH Session 没有 Subagent。", "info");
				const choices = catalog.entries.flatMap((entry) => {
					if (typeof entry.id !== "string" || typeof entry.kind !== "string") return [];
					if (entry.kind === "diagnostic") {
						return [
							{
								entry,
								label: `${entry.id} · 诊断 · ${typeof entry.reason === "string" ? entry.reason : "不可用"}`,
							},
						];
					}
					const parts = [
						typeof entry.label === "string" ? entry.label : entry.id,
						typeof entry.mode === "string" ? entry.mode : undefined,
						typeof entry.activity === "string" ? entry.activity : undefined,
						entry.hasChildren === true ? "有子 Agent" : undefined,
						entry.id,
					].filter(Boolean);
					return [{ entry, label: parts.join(" · ") }];
				});
				const selected = await ctx.ui.select(
					`DSH 子 Agent${catalog.parentAvailable ? "" : " · 父级不可用"}`,
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (!choice || typeof choice.entry.id !== "string") return;
				if (choice.entry.kind === "diagnostic") {
					ctx.ui.notify(
						`Subagent ${choice.entry.id}：${typeof choice.entry.reason === "string" ? choice.entry.reason : "不可用"}`,
						"warning",
					);
					return;
				}
				const mode = choice.entry.mode === "continuable" ? "continuable" : "one-shot";
				const historyLabel = "查看历史";
				const followUpLabel = "发送后续消息";
				const interruptLabel = "请求中断";
				const subagentAction = await ctx.ui.select("Subagent 操作", [
					historyLabel,
					...(mode === "continuable" ? [followUpLabel, interruptLabel] : []),
				]);
				if (subagentAction === historyLabel) {
					const history = await runtime.subagentHistory(choice.entry.id, mode);
					const events =
						history && typeof history === "object" ? records((history as Record<string, unknown>).events) : [];
					if (events.length === 0) return ctx.ui.notify("该 Subagent 没有历史事件。", "info");
					const labels = events.map((entry, index) => {
						const value = entry.event;
						const type =
							value && typeof value === "object" && typeof (value as Record<string, unknown>).type === "string"
								? (value as Record<string, unknown>).type
								: "event";
						return `${typeof entry.seq === "number" ? entry.seq : index + 1} · ${type}`;
					});
					const eventLabel = await ctx.ui.select("Subagent 历史", labels);
					if (eventLabel) ctx.ui.notify(JSON.stringify(events[labels.indexOf(eventLabel)], null, 2), "info");
					return;
				}
				if (subagentAction === followUpLabel && mode === "continuable") {
					const text = await ctx.ui.input("发送 Subagent 后续消息", "输入消息");
					if (!text) return;
					const receipt = await runtime.promptSubagent(choice.entry.id, text);
					const messageId =
						receipt &&
						typeof receipt === "object" &&
						typeof (receipt as Record<string, unknown>).messageId === "string"
							? (receipt as Record<string, unknown>).messageId
							: undefined;
					ctx.ui.notify(messageId ? `Subagent 已接受后续消息：${messageId}` : "Subagent 已接受后续消息。", "info");
					return;
				}
				if (subagentAction === interruptLabel && mode === "continuable") {
					await runtime.interruptSubagent(choice.entry.id);
					ctx.ui.notify("Subagent 已接受中断请求。", "info");
				}
				return;
			}
			if (action === "workspace" || action === "workspaces") {
				const snapshot = await runtime.workspaces();
				const workspaceChoices = snapshot.items.flatMap((workspace) => {
					const label = workspaceLabel(workspace);
					return label ? [{ workspace, label }] : [];
				});
				const addLabel = "采用已有目录作为 Workspace";
				const archiveLabel = "归档当前 DSH Session";
				const selected = await ctx.ui.select("DSH 工作区", [
					addLabel,
					archiveLabel,
					...workspaceChoices.map((choice) => choice.label),
				]);
				if (!selected) return;
				if (selected === addLabel) {
					const path = await ctx.ui.input("采用已有目录", "输入已存在的目录路径");
					if (!path) return;
					const result = await runtime.createWorkspace(path);
					const workspace = result.workspace;
					const title =
						workspace &&
						typeof workspace === "object" &&
						typeof (workspace as Record<string, unknown>).title === "string"
							? (workspace as Record<string, unknown>).title
							: path;
					ctx.ui.notify(
						result.created === true ? `已创建 DSH Workspace：${title}` : `目录已属于 DSH Workspace：${title}`,
						"info",
					);
					return;
				}
				if (selected === archiveLabel) {
					if (
						await ctx.ui.confirm(
							"归档当前 DSH Session",
							"归档会从 Workspace 分组界面隐藏该 Session，但保留其日志和排序位置。是否继续？",
						)
					) {
						await runtime.archiveCurrentSession();
						ctx.ui.notify("当前 DSH Session 已归档。", "info");
					}
					return;
				}
				const choice = workspaceChoices.find((item) => item.label === selected);
				if (!choice || typeof choice.workspace.workspaceId !== "string") return;
				const workspaceId = choice.workspace.workspaceId;
				const sessionIds = Array.isArray(choice.workspace.sessionIds)
					? choice.workspace.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string")
					: [];
				const newSessionLabel = "在此 Workspace 新建并切换 Session";
				const renameLabel = "重命名";
				const moveLabel = "调整 Workspace 顺序";
				const reorderLabel = "调整当前 Session 顺序";
				const removeLabel = "移除 Workspace 注册";
				const workspaceAction = await ctx.ui.select("Workspace 操作", [
					newSessionLabel,
					renameLabel,
					moveLabel,
					...(runtime.sessionId && sessionIds.includes(runtime.sessionId) ? [reorderLabel] : []),
					removeLabel,
				]);
				if (workspaceAction === newSessionLabel) {
					const sessionId = await runtime.newSession(workspaceId);
					clearQueueSurface(ctx);
					projections = await runtime.projections();
					ctx.ui.notify(`已创建并切换到 DSH Session：${sessionId}`, "info");
					return;
				}
				if (workspaceAction === renameLabel) {
					const title = await ctx.ui.input(
						"重命名 DSH Workspace",
						typeof choice.workspace.title === "string" ? choice.workspace.title : "输入标题",
					);
					if (title) await runtime.renameWorkspace(workspaceId, title);
					return;
				}
				if (workspaceAction === moveLabel) {
					const endLabel = "移到末尾";
					const anchors = workspaceChoices.filter((item) => item.workspace.workspaceId !== workspaceId);
					const before = await ctx.ui.select("移动到…之前", [...anchors.map((item) => item.label), endLabel]);
					if (!before) return;
					const anchor = anchors.find((item) => item.label === before);
					await runtime.moveWorkspace(
						workspaceId,
						typeof anchor?.workspace.workspaceId === "string" ? anchor.workspace.workspaceId : undefined,
					);
					return;
				}
				if (workspaceAction === reorderLabel) {
					const endLabel = "移到末尾";
					const currentSessionId = runtime.sessionId;
					if (!currentSessionId) return;
					const anchors = sessionIds.filter((sessionId) => sessionId !== currentSessionId);
					const before = await ctx.ui.select("移动当前 Session 到…之前", [...anchors, endLabel]);
					if (before) await runtime.moveCurrentSession(workspaceId, before === endLabel ? undefined : before);
					return;
				}
				if (
					workspaceAction === removeLabel &&
					(await ctx.ui.confirm(
						"移除 DSH Workspace 注册",
						"只移除 Workspace 注册；目录、文件和 Session 日志不会删除。是否继续？",
					))
				) {
					await runtime.deleteWorkspace(workspaceId);
				}
				return;
			}
			if (action === "model" || action === "effort") {
				const catalog = await runtime.models();
				const catalogRecord = isRecord(catalog) ? catalog : {};
				const current = isRecord(catalogRecord.current) ? catalogRecord.current : {};
				const groups = records(catalogRecord.groups);
				const choices = groups.flatMap((group) => {
					const provider = typeof group.id === "string" ? group.id : "";
					return records(group.models).flatMap((model) => {
						if (typeof model.id !== "string") return [];
						const reasoning = isRecord(model.reasoning) ? model.reasoning : undefined;
						const isCurrent = current.provider === provider && current.model === model.id;
						const effectiveEffort = isCurrent
							? typeof current.reasoningEffort === "string"
								? current.reasoningEffort
								: typeof reasoning?.defaultEffort === "string"
									? reasoning.defaultEffort
									: undefined
							: typeof reasoning?.defaultEffort === "string"
								? reasoning.defaultEffort
								: undefined;
						return [
							{
								provider,
								model: model.id,
								reasoning,
								isCurrent,
								effectiveEffort,
								label: [
									typeof model.name === "string" ? model.name : model.id,
									provider,
									effectiveEffort ? `effort ${effectiveEffort}` : undefined,
									isCurrent ? "当前" : undefined,
								]
									.filter(Boolean)
									.join(" · "),
							},
						];
					});
				});
				if (action === "effort") {
					const active = choices.find(({ isCurrent }) => isCurrent);
					const efforts = records(active?.reasoning?.efforts).flatMap((effort) =>
						typeof effort.id === "string" && typeof effort.name === "string"
							? [
									{
										effort: effort.id as string | undefined,
										label: [
											effort.name,
											effort.id,
											effort.id === active?.effectiveEffort ? "当前" : undefined,
											typeof effort.description === "string" ? effort.description : undefined,
										]
											.filter(Boolean)
											.join(" · "),
									},
								]
							: [],
					);
					if (!active || efforts.length === 0) return ctx.ui.notify("当前 DSH 模型没有声明可选推理等级。", "info");
					const providerDefault = {
						effort: undefined as string | undefined,
						label: `Provider 默认${
							typeof active.reasoning?.defaultEffort === "string" ? ` · ${active.reasoning.defaultEffort}` : ""
						}${current.reasoningEffort === undefined ? " · 当前" : ""}`,
					};
					const effortChoices = [providerDefault, ...efforts];
					const selected = await ctx.ui.select(
						`${active.label} · 推理等级`,
						effortChoices.map(({ label }) => label),
					);
					const choice = effortChoices.find(({ label }) => label === selected);
					if (!choice) return;
					await runtime.selectModel(active.provider, active.model, choice.effort);
					ctx.ui.notify(`DSH 推理等级已切换为：${choice.effort ?? "Provider 默认"}。`, "info");
					return;
				}
				const selected = await ctx.ui.select(
					"选择 DSH 模型",
					choices.map((choice) => choice.label),
				);
				const choice = choices.find((item) => item.label === selected);
				if (choice) {
					await runtime.selectModel(
						choice.provider,
						choice.model,
						choice.isCurrent
							? typeof current.reasoningEffort === "string"
								? current.reasoningEffort
								: undefined
							: typeof choice.reasoning?.defaultEffort === "string"
								? choice.reasoning.defaultEffort
								: undefined,
					);
					ctx.setModelPreference?.(choice.provider, choice.model);
					profileModelPreference = { provider: choice.provider, id: choice.model };
					updateModelBridgeStatus(ctx, await runtime.models());
				}
				return;
			}
			ctx.ui.notify(
				`DSH Profile Runtime\nSession：${runtime.sessionId ?? "尚未启动"}\n命令：/dsh ${dshActions.join(" | ")}`,
				"info",
			);
		},
	};
	pi.registerCommand("dsh", dshCommand);
	const directCommands = [
		["resume", "sessions", "恢复 Harness 会话"],
		["sessions", "sessions", "查看并切换 Harness 会话"],
		["new", "new", "创建新的 Harness 会话"],
		["history", "history", "查看 Harness 消息历史"],
		["rewind", "rewind", "回退并重写 Harness 会话"],
		["fork", "fork", "派生当前 Harness 会话"],
		["name", "rename", "重命名当前 Harness 会话"],
		["compact", "compact", "压缩当前 Harness 会话上下文"],
		["session", "context", "查看 Harness Session 统计"],
		["settings", "settings-home", "配置 Harness 模型、推理等级与 Settings"],
		["preset", "preset", "选择 Harness Agent 预设"],
		["plan", "plan", "切换 Harness Plan Mode"],
		["goal", "goal", "管理 Harness Goal"],
		["queue", "queue", "管理 Harness 待处理消息"],
		["cancel", "cancel", "取消当前 Harness 回合"],
		["plugins", "plugins", "管理当前 Profile 的 Harness 插件"],
	] as const;
	for (const [name, action, description] of directCommands) {
		pi.registerCommand(name, {
			description,
			handler: (args, ctx) => dshCommand.handler(`${action}${args.trim() ? ` ${args.trim()}` : ""}`, ctx),
		});
	}
	pi.registerCommand("permission", {
		description: "查看或切换 Harness 权限预设",
		getArgumentCompletions: (prefix) => {
			if (prefix.includes(" ")) return null;
			return ["read-only", "workspace-write", "danger-full-access"]
				.filter((preset) => preset.startsWith(prefix.toLowerCase()))
				.map((preset) => ({ value: preset, label: preset }));
		},
		handler: (args, ctx) => dshCommand.handler(`run /permission${args.trim() ? ` ${args.trim()}` : ""}`, ctx),
	});
	pi.registerCommand("plugin", {
		description: "直接管理当前 Profile 的 Harness 插件：/plugin list|add|remove|update",
		getArgumentCompletions: (prefix) => {
			if (prefix.includes(" ")) return null;
			return ["list", "add", "remove", "update"]
				.filter((operation) => operation.startsWith(prefix.toLowerCase()))
				.map((operation) => ({ value: operation, label: operation }));
		},
		handler: async (args, ctx) => {
			const runtime = runtimeOf(ctx);
			if (!runtime) return ctx.ui.notify("当前 Profile 没有可用的 DSH Runtime。", "error");
			const match = args.trim().match(/^(list|add|remove|update)(?:\s+([\s\S]+))?$/);
			if (!match) return ctx.ui.notify("用法：/plugin list | add <source> | remove <package> | update", "error");
			const [, operation, argument] = match;
			let request: ProfileRuntimePackageRequest;
			let confirmation: { title: string; message: string } | undefined;
			if (operation === "list" && !argument) request = { operation: "list" };
			else if (operation === "add" && argument?.trim()) {
				const source = argument.trim();
				request = { operation: "add", source };
				confirmation = {
					title: "安装 Harness 包",
					message: `通过原生 dsh plugin add 安装 ${source}？该操作可能下载并执行包安装生命周期。`,
				};
			} else if (operation === "remove" && argument?.trim()) {
				const packageName = argument.trim();
				request = { operation: "remove", packageName };
				confirmation = {
					title: "移除 Harness 包",
					message: `通过原生 dsh plugin remove 移除 ${packageName}？`,
				};
			} else if (operation === "update" && !argument) {
				request = { operation: "update" };
				confirmation = {
					title: "更新 Harness 包",
					message: "通过原生 dsh plugin update 更新当前 Profile 的 Harness 依赖？",
				};
			} else {
				return ctx.ui.notify("用法：/plugin list | add <source> | remove <package> | update", "error");
			}
			await executeProfilePackageRequest(ctx, runtime, request, confirmation);
		},
	});

	pi.on("input", async (event, ctx) => {
		if (!runtimeOf(ctx) || selectedFileReferences.size === 0) return { action: "continue" };
		try {
			const expansion = await expandSelectedDshFileReferences({
				text: event.text,
				cwd: ctx.cwd,
				selected: selectedFileReferences,
				existingImages: event.images,
			});
			selectedFileReferences.clear();
			if (expansion.attached.length === 0) return { action: "continue" };
			ctx.ui.notify(`已附加 ${expansion.attached.length} 个 @ 文件引用。`, "info");
			return {
				action: "transform",
				text: expansion.text,
				images: expansion.images,
			};
		} catch (error) {
			const restored = ctx.ui.setEditorDraft({
				text: event.text,
				images: event.images ?? [],
			});
			ctx.ui.notify(
				`${error instanceof Error ? error.message : String(error)}${restored ? "；原草稿已恢复。" : ""}`,
				"error",
			);
			return { action: "handled" };
		}
	});

	pi.on("model_select", async (event, ctx) => {
		if (!activeDshProfile() || ctx.mode !== "tui") return;
		const runtime = runtimeOf(ctx);
		if (!runtime) return;
		piActiveModel = { provider: event.model.provider, id: event.model.id };
		profileModelPreference = piActiveModel;
		const generation = interactionGeneration;
		try {
			const catalog = await runtime.models();
			if (generation !== interactionGeneration) return;
			updateModelBridgeStatus(ctx, catalog);
		} catch (error) {
			if (generation === interactionGeneration) ctx.ui.notify(`DSH 模型状态刷新失败：${String(error)}`, "error");
		}
	});

	pi.on("session_start", (_event, ctx) => {
		if (!activeDshProfile() || ctx.mode !== "tui") return;
		ctx.ui.setStatus("meldra-dsh-0-runtime", ctx.ui.theme.fg("accent", "DSH"));
		const runtime = runtimeOf(ctx);
		if (!runtime) return;
		selectedFileReferences.clear();
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: current.triggerCharacters,
			getSuggestions: current.getSuggestions.bind(current),
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				const result = current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
				const reference = dshFileReferenceFromCompletion(prefix, item.value);
				if (reference) selectedFileReferences.add(reference);
				return result;
			},
			shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
		}));
		activeRuntime = runtime;
		piActiveModel = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
		profileModelPreference = undefined;
		const generation = ++interactionGeneration;
		void runtime
			.models()
			.then(async (catalog) => {
				if (generation !== interactionGeneration) return;
				updateModelBridgeStatus(ctx, catalog);
				const profileModel = piActiveModel;
				if (!profileModel) return;
				const record = isRecord(catalog) ? catalog : {};
				const current = isRecord(record.current) ? record.current : undefined;
				// Harness Session route is authoritative when already present.
				if (current?.provider || current?.model) return;
				const matched = records(record.groups).some((group) => {
					if (group.id !== profileModel.provider) return false;
					return records(group.models).some((model) => model.id === profileModel.id);
				});
				if (!matched) return;
				await runtime.selectModel(profileModel.provider, profileModel.id);
				if (generation !== interactionGeneration) return;
				updateModelBridgeStatus(ctx, await runtime.models());
			})
			.catch((error) => {
				if (generation === interactionGeneration)
					ctx.ui.notify(`Meldra 模型偏好未同步到 Harness：${String(error)}`, "error");
			});
		invalidateCommandCatalog();
		invalidateSkillCatalog();
		clearQueueSurface(ctx);
		unsubscribeEvents?.();
		unsubscribeEvents = runtime.subscribe((event) => {
			const handleEvent = async (): Promise<void> => {
				if (generation !== interactionGeneration) return;
				const payload = event.payload;
				if (payload.type === "meldra/hooks-diagnostic") {
					if (typeof payload.message === "string") ctx.ui.notify(`Meldra Hook：${payload.message}`, "warning");
					return;
				}
				if (payload.type === "host/remote-event" && payload.event === "commands/change") {
					invalidateCommandCatalog();
					return;
				}
				if (
					payload.type === "host/remote-event" &&
					payload.event === "agent-preset/selected" &&
					Array.isArray(payload.args) &&
					payload.args[0] === runtime.sessionId
				) {
					invalidateCommandCatalog();
					invalidateSkillCatalog();
					return;
				}
				if (
					payload.type === "host/session-status" &&
					payload.sessionId === runtime.sessionId &&
					typeof payload.running === "boolean"
				) {
					running = payload.running;
					ctx.ui.setStatus("meldra-dsh-1-status", running ? ctx.ui.theme.fg("warning", "运行中") : undefined);
					return;
				}
				if (
					payload.type === "session/event" &&
					payload.sessionId === runtime.sessionId &&
					payload.event &&
					typeof payload.event === "object"
				) {
					const sessionEvent = payload.event as Record<string, unknown>;
					const data =
						sessionEvent.data && typeof sessionEvent.data === "object"
							? (sessionEvent.data as Record<string, unknown>)
							: undefined;
					const key = data ? stepKey(data) : undefined;
					if (sessionEvent.type === "compaction/start" && data) {
						ctx.ui.setStatus(
							"meldra-dsh-6-compaction",
							ctx.ui.theme.fg(
								"warning",
								`💾 压缩中${typeof data.compactionId === "string" ? ` · ${data.compactionId}` : ""}`,
							),
						);
					}
					if (sessionEvent.type === "compaction/summary" && data) {
						ctx.ui.setStatus(
							"meldra-dsh-6-compaction",
							ctx.ui.theme.fg(
								"success",
								[
									"✓ 已压缩",
									typeof data.shadowedTokenCount === "number"
										? `${data.shadowedTokenCount} tokens`
										: undefined,
									typeof data.provider === "string" && typeof data.model === "string"
										? `${data.provider}/${data.model}`
										: undefined,
								]
									.filter(Boolean)
									.join(" · "),
							),
						);
					}
					if (sessionEvent.type === "compaction/end" && data) {
						ctx.ui.setStatus("meldra-dsh-6-compaction", undefined);
						if (typeof data.error === "string") ctx.ui.notify(`DSH compaction失败：${data.error}`, "error");
					}
					if (sessionEvent.type === "turn/start") stepTimings.clear();
					if (sessionEvent.type === "step/start" && key && typeof sessionEvent.time === "number") {
						stepTimings.set(key, { stepStartTime: sessionEvent.time });
					}
					if (
						sessionEvent.type === "assistant/chunk" &&
						key &&
						data &&
						data.chunk &&
						typeof data.chunk === "object" &&
						isTokenDelta(data.chunk as Record<string, unknown>) &&
						typeof sessionEvent.time === "number"
					) {
						const timing = stepTimings.get(key) ?? {};
						timing.firstTokenTime ??= sessionEvent.time;
						stepTimings.set(key, timing);
					}
					if (sessionEvent.type === "assistant/message" && data) {
						if (
							data.message &&
							typeof data.message === "object" &&
							data.usage &&
							typeof data.usage === "object"
						) {
							const timing = key ? stepTimings.get(key) : undefined;
							const completedTime = typeof sessionEvent.time === "number" ? sessionEvent.time : undefined;
							const ttftMs =
								timing?.stepStartTime !== undefined && timing.firstTokenTime !== undefined
									? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
									: undefined;
							const decodeMs =
								timing?.firstTokenTime !== undefined && completedTime !== undefined
									? Math.max(0, completedTime - timing.firstTokenTime)
									: undefined;
							const outputTokens = metric((data.usage as Record<string, unknown>).outputTokens);
							const timingMetrics =
								ttftMs === undefined
									? undefined
									: {
											ttftMs,
											...(decodeMs !== undefined && decodeMs > 0
												? {
														tokensPerSecond: outputTokens / (decodeMs / 1000),
													}
												: {}),
										};
							metrics =
								formatProjectionMetrics(projections) ??
								formatUsageStatus(
									data.message as Record<string, unknown>,
									data.usage as Record<string, unknown>,
									timingMetrics,
								);
							if (metrics) {
								const parts = metrics.split("  ");
								const formatted = parts
									.map((part) => {
										// Highlight cache hits and key metrics
										if (part.includes("⚡")) return ctx.ui.theme.fg("success", part);
										if (part.includes("▲") || part.includes("▼")) return part;
										return ctx.ui.theme.fg("dim", part);
									})
									.join("  ");
								ctx.ui.setWidget("meldra-dsh-metrics", [formatted], {
									placement: "aboveEditor",
								});
							} else {
								ctx.ui.setWidget("meldra-dsh-metrics", undefined);
							}
						}
					}
				}
				if (payload.type === "approval/requested") {
					if (
						typeof payload.sessionId !== "string" ||
						typeof payload.approvalId !== "string" ||
						typeof payload.toolName !== "string"
					)
						return;
					const allowed = await ctx.ui.confirm(
						`DSH 请求执行 ${payload.toolName}`,
						typeof payload.reason === "string" ? payload.reason : "是否允许本次操作？",
					);
					if (generation !== interactionGeneration) return;
					await runtime.respond({
						type: "client-response",
						rpcId: event.rpcId,
						result: {
							ok: true,
							value: {
								sessionId: payload.sessionId,
								approvalId: payload.approvalId,
								outcome: allowed ? "allowed-once" : "rejected",
							},
						},
					});
					return;
				}
				if (payload.type === "question/requested") {
					if (typeof payload.sessionId !== "string" || !Array.isArray(payload.questions)) return;
					const answers: Array<{
						id: string;
						selected: string[];
						custom?: string;
					}> = [];
					for (const value of payload.questions) {
						if (!value || typeof value !== "object") continue;
						const question = value as Record<string, unknown>;
						if (typeof question.id !== "string" || typeof question.question !== "string") continue;
						const options = records(question.options).flatMap((item) =>
							typeof item.label === "string" ? [item.label] : [],
						);
						if (question.multiSelect === true && options.length > 0) {
							const selected: string[] = [];
							while (true) {
								const choice = await ctx.ui.select(question.question, [
									...options.filter((label) => !selected.includes(label)),
									"完成选择",
								]);
								if (!choice || choice === "完成选择") break;
								selected.push(choice);
							}
							answers.push({ id: question.id, selected });
							continue;
						}
						if (options.length > 0) {
							const selected = await ctx.ui.select(question.question, [...options, "自定义回答"]);
							if (selected && selected !== "自定义回答") {
								answers.push({ id: question.id, selected: [selected] });
								continue;
							}
						}
						const custom = await ctx.ui.input(question.question, "输入回答");
						if (custom) answers.push({ id: question.id, selected: [], custom });
					}
					if (generation !== interactionGeneration) return;
					await runtime.respond({
						type: "client-response",
						rpcId: event.rpcId,
						result: {
							ok: true,
							value: { sessionId: payload.sessionId, answer: { answers } },
						},
					});
					return;
				}
				if (
					payload.type === "session/projection" &&
					payload.sessionId === runtime.sessionId &&
					typeof payload.key === "string"
				) {
					projections = { ...projections, [payload.key]: payload.value };
					updateProjectionStatuses(ctx);
					return;
				}
				if (payload.type === "session/jobs" && payload.sessionId === runtime.sessionId) {
					jobs = records(payload.jobs);
					const activeJobs = jobs.filter((job) => job.status === "running" || job.status === "stopping").length;
					ctx.ui.setStatus(
						"meldra-dsh-3-jobs",
						activeJobs ? ctx.ui.theme.fg("accent", `⚡ ${activeJobs}`) : undefined,
					);
					return;
				}
				if (payload.type === "session/queue" && payload.sessionId === runtime.sessionId) {
					queueItems = records(payload.items);
					updateQueueSurface(ctx);
					return;
				}
			};
			const reportError = (error: unknown): void => {
				if (generation === interactionGeneration) ctx.ui.notify(`DSH 交互失败：${String(error)}`, "error");
			};
			if (event.payload.type === "approval/requested" || event.payload.type === "question/requested") {
				interactionTail = interactionTail.then(handleEvent).catch(reportError);
			} else {
				void handleEvent().catch(reportError);
			}
		});
		void runtime
			.projections()
			.then((baseline) => {
				projections = { ...baseline, ...projections };
				updateProjectionStatuses(ctx);
			})
			.catch((error) => ctx.ui.notify(`DSH projection baseline读取失败：${String(error)}`, "error"));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		selectedFileReferences.clear();
		unsubscribeEvents?.();
		unsubscribeEvents = undefined;
		interactionGeneration += 1;
		activeRuntime = undefined;
		invalidateCommandCatalog();
		invalidateSkillCatalog();
		running = false;
		metrics = undefined;
		jobs = [];
		projections = {};
		stepTimings.clear();
		clearQueueSurface(ctx);
		ctx.ui.setStatus("meldra-dsh-3-jobs", undefined);
		ctx.ui.setStatus("meldra-dsh-4-plan", undefined);
		ctx.ui.setStatus("meldra-dsh-5-todos", undefined);
		ctx.ui.setStatus("meldra-dsh-6-compaction", undefined);
		ctx.ui.setStatus("meldra-dsh-1-status", undefined);
		ctx.ui.setStatus("meldra-dsh-0-runtime", undefined);
		ctx.ui.setWidget("meldra-dsh-metrics", undefined);
	});
}
