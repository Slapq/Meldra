import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	getSupportedThinkingLevels,
	type Model,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	type Usage,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../core/model-runtime.ts";
import type {
	ProfileAgentPrompt,
	ProfileAgentRuntime,
	ProfileAgentRuntimeHost,
	ProfileEnvironmentDescriptor,
	ProfileRuntimePackageExecutionOptions,
	ProfileRuntimePackageRequest,
	ProfileToolPresentation,
} from "../core/profile-agent-runtime.ts";
import { collectDshContextEvidence, type DshContextEvidence } from "./dsh-context-evidence.ts";
import { dshProfilePackageManager } from "./dsh-profile-packages.ts";

const EVENT_DRAIN_TIMEOUT_MS = 500;

async function settleBounded(operation: Promise<unknown>, timeoutMs = EVENT_DRAIN_TIMEOUT_MS): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		operation.then(
			() => undefined,
			() => undefined,
		),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
			timer.unref?.();
		}),
	]);
	if (timer) clearTimeout(timer);
}

export const MELDRA_DSH_MESSAGE_ENTRY = "meldra-dsh-message";
export const LEGACY_METAPI_DSH_MESSAGE_ENTRY = "metapi-dsh-message";
/** @deprecated Use MELDRA_DSH_MESSAGE_ENTRY. Retained for source compatibility. */
export const DSH_MESSAGE_ENTRY = MELDRA_DSH_MESSAGE_ENTRY;

interface HarnessClient {
	request(method: string, params?: object): Promise<unknown>;
}
interface Harness {
	readonly client: HarnessClient;
	start(): Promise<void>;
	close(): Promise<void>;
}
interface RuntimeState {
	harness: Harness;
	sessionId: string;
	eventCursors: Map<"mux" | "host", string>;
	eventTasks: Promise<void>[];
}

interface ActiveTurn {
	sessionId: string;
	sawRunning: boolean;
	resolve(): void;
	reject(error: Error): void;
}

interface AssistantProjection {
	message: AssistantMessage;
	blocks: Map<number, TextContent | ThinkingContent | ToolCall>;
	toolArgumentText: Map<string, string>;
}

export type DshQueueAction =
	| { kind: "edit"; content: Array<{ type: "text"; text: string }> }
	| { kind: "remove" }
	| { kind: "steer" };

export interface DshProfileEvent {
	rpcId: string;
	payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

const DSH_PI_AI_SETTINGS_NAMESPACE = "llm-pi-ai";
const DSH_PI_AI_SUPPORTED_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

function modelCredentialReference(provider: string): string {
	const identity = createHash("sha256").update(provider).digest("hex").slice(0, 16).toUpperCase();
	return `MELDRA_MODEL_${identity}`;
}

function dshModelCompat(model: Model<any>): Record<string, unknown> | undefined {
	if (model.api !== "openai-completions" || !isRecord(model.compat)) return undefined;
	const compat = {
		...(typeof model.compat.thinkingFormat === "string" ? { thinkingFormat: model.compat.thinkingFormat } : {}),
		...(typeof model.compat.supportsReasoningEffort === "boolean"
			? { supportsReasoningEffort: model.compat.supportsReasoningEffort }
			: {}),
	};
	return Object.keys(compat).length > 0 ? compat : undefined;
}

function dshReasoningEfforts(model: Model<any>): false | Record<string, string | null> {
	if (!model.reasoning) return false;
	return Object.fromEntries(
		getSupportedThinkingLevels(model).map((level) => [
			level,
			model.thinkingLevelMap?.[level] ?? (level === "off" ? null : level),
		]),
	);
}

function dshModelProfile(model: Model<any>): Record<string, unknown> {
	const compat = dshModelCompat(model);
	return {
		id: model.id,
		name: model.name,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		input: [...model.input],
		reasoningEfforts: dshReasoningEfforts(model),
		...(compat ? { compat } : {}),
	};
}

function userMessageSnapshot(event: Record<string, unknown>): string | undefined {
	if (!isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== "user") return undefined;
	const content = records(event.data.content);
	const text = content
		.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
		.join("");
	const imageCount = content.filter((block) => block.type === "image").length;
	if (!text && imageCount === 0) return undefined;
	return imageCount ? `${text}${text ? "\n" : ""}[${imageCount} image${imageCount === 1 ? "" : "s"}]` : text;
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function usageFrom(value: unknown): Usage {
	if (!isRecord(value)) return emptyUsage();
	const input = typeof value.inputTokens === "number" ? value.inputTokens : 0;
	const output = typeof value.outputTokens === "number" ? value.outputTokens : 0;
	const cacheRead = typeof value.cacheReadTokens === "number" ? value.cacheReadTokens : 0;
	const cacheWrite = typeof value.cacheWriteTokens === "number" ? value.cacheWriteTokens : 0;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		...(typeof value.reasoningTokens === "number" ? { reasoning: value.reasoningTokens } : {}),
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function parseToolArguments(value: string): Record<string, unknown> {
	if (!value.trim()) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : { input: parsed };
	} catch {
		return { input: value };
	}
}

function resultContent(value: unknown): Array<{ type: "text"; text: string }> {
	if (!Array.isArray(value)) return [];
	return value.map((block) => {
		if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
			return { type: "text" as const, text: block.text };
		}
		return { type: "text" as const, text: JSON.stringify(block, null, 2) };
	});
}

function dshToolView(value: unknown, side: "call" | "result"): Record<string, unknown> | undefined {
	if (!isRecord(value) || value.for !== side || !isRecord(value.view)) return undefined;
	return value.view;
}

function presentationTitle(
	primary: Record<string, unknown> | undefined,
	fallback: Record<string, unknown> | undefined,
): string | undefined {
	return typeof primary?.title === "string"
		? primary.title
		: typeof fallback?.title === "string"
			? fallback.title
			: undefined;
}

function profileToolPresentation(
	call: Record<string, unknown> | undefined,
	result: Record<string, unknown> | undefined,
	isError: boolean,
): ProfileToolPresentation | undefined {
	if (result?.card === "terminal" || (!result && !isError && call?.card === "terminal")) {
		const source = result?.card === "terminal" ? result : call;
		const title = presentationTitle(result, call);
		return {
			kind: "terminal",
			...(title ? { title } : {}),
			...(typeof call?.description === "string" ? { description: call.description } : {}),
			...(typeof call?.cwd === "string" ? { cwd: call.cwd } : {}),
			...(typeof source?.output === "string" ? { output: source.output } : {}),
			...(typeof source?.exitCode === "number" ? { exitCode: source.exitCode } : {}),
			...(typeof source?.signal === "string" ? { signal: source.signal } : {}),
		};
	}
	if (result?.card === "diff" || (!result && !isError && call?.card === "diff")) {
		const source = result?.card === "diff" ? result : call;
		const files = records(source?.diffs).flatMap((diff) =>
			typeof diff.path === "string" &&
			(diff.oldText === null || typeof diff.oldText === "string") &&
			typeof diff.newText === "string"
				? [
						{
							path: diff.path,
							oldText: diff.oldText,
							newText: diff.newText,
						},
					]
				: [],
		);
		if (files.length === 0) return undefined;
		const title = presentationTitle(result, call);
		return { kind: "diff", ...(title ? { title } : {}), files };
	}
	if (result?.card === "read" && typeof result.path === "string") {
		return {
			kind: "read",
			...(typeof result.title === "string" ? { title: result.title } : {}),
			path: result.path,
			offset: typeof result.offset === "number" ? result.offset : 0,
			totalLines: typeof result.totalLines === "number" ? result.totalLines : 0,
			lines: records(result.lines).flatMap((line) =>
				typeof line.number === "number" && typeof line.text === "string"
					? [{ number: line.number, text: line.text }]
					: [],
			),
		};
	}
	if (result?.card === "search") {
		const entries =
			result.shape === "paths"
				? (Array.isArray(result.paths) ? result.paths : []).flatMap((path) =>
						typeof path === "string" ? [{ path }] : [],
					)
				: records(result.files).flatMap((file) =>
						typeof file.path === "string"
							? records(file.matches).flatMap((match) =>
									typeof match.lineNumber === "number" && typeof match.line === "string"
										? [
												{
													path: file.path as string,
													lineNumber: match.lineNumber,
													text: match.line,
												},
											]
										: [],
								)
							: [],
					);
		return {
			kind: "search",
			...(typeof result.title === "string" ? { title: result.title } : {}),
			entries,
			total: typeof result.total === "number" ? result.total : entries.length,
			truncated: result.truncated === true,
		};
	}
	if (result?.card === "web" && result.kind === "search") {
		const sources = records(result.sources).flatMap((source) =>
			typeof source.url === "string"
				? [
						{
							url: source.url,
							...(typeof source.title === "string" ? { title: source.title } : {}),
							...(typeof source.snippet === "string" ? { snippet: source.snippet } : {}),
							...(typeof source.publishedAt === "string" ? { publishedAt: source.publishedAt } : {}),
						},
					]
				: [],
		);
		return {
			kind: "web-search",
			...(typeof result.title === "string" ? { title: result.title } : {}),
			sources,
			...(typeof result.answer === "string" ? { answer: result.answer } : {}),
			truncated: result.truncated === true,
		};
	}
	if (
		result?.card === "web" &&
		result.kind === "fetch" &&
		typeof result.url === "string" &&
		typeof result.statusCode === "number"
	) {
		return {
			kind: "web-fetch",
			...(typeof result.title === "string" ? { title: result.title } : {}),
			url: result.url,
			statusCode: result.statusCode,
			truncated: result.truncated === true,
		};
	}
	return undefined;
}

function apiValue(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value.result)) throw new Error("DSH API 返回了无效响应。");
	if (value.result.ok === true) return value.result.value;
	const error = value.result.error;
	throw new Error(isRecord(error) && typeof error.message === "string" ? error.message : "DSH API 请求失败。");
}

export class DshProfileRuntime implements ProfileAgentRuntime {
	readonly commandSurface = {
		preferredExtensionCommands: ["resume", "new", "fork", "name", "compact", "session", "settings"],
		hiddenBuiltinCommands: ["clone", "tree", "scoped-models", "import", "login", "logout"],
		doubleEscapeExtensionCommand: "rewind",
	} as const;

	private host?: ProfileAgentRuntimeHost;
	private runtime?: RuntimeState;
	private starting?: Promise<RuntimeState>;
	private startingHarness?: Harness;
	private lifecycleVersion = 0;
	private activeTask?: Promise<void>;
	private activeTurn?: ActiveTurn;
	private assistant?: AssistantProjection;
	private lastAssistantText?: string;
	private readonly toolStartedAt = new Map<string, number>();
	private readonly toolCallViews = new Map<string, Record<string, unknown>>();
	private readonly listeners = new Set<(event: DshProfileEvent) => void>();

	private readonly options: {
		cwd: string;
		agentDir: string;
		modelRuntime?: ModelRuntime;
	};

	constructor(options: {
		cwd: string;
		agentDir: string;
		modelRuntime?: ModelRuntime;
	}) {
		this.options = options;
	}

	get isStreaming(): boolean {
		return this.activeTask !== undefined;
	}

	get sessionId(): string | undefined {
		return this.runtime?.sessionId;
	}

	async listSessions(): Promise<Record<string, unknown>[]> {
		const value = apiValue(await this.call("session.list", {}));
		return isRecord(value) && Array.isArray(value.items) ? value.items.filter(isRecord) : [];
	}

	async newSession(workspaceId?: string): Promise<string> {
		const value = apiValue(
			await this.call("session.create", {
				...(workspaceId ? { workspaceId } : { cwd: this.options.cwd }),
			}),
		);
		if (!isRecord(value) || typeof value.sessionId !== "string") throw new Error("DSH 未返回 Session ID。");
		this.switchSession(value.sessionId);
		return value.sessionId;
	}

	switchSession(sessionId: string): void {
		if (!this.runtime) throw new Error("DSH Runtime 尚未启动。");
		this.runtime.sessionId = sessionId;
		this.assistant = undefined;
		this.lastAssistantText = undefined;
		this.toolStartedAt.clear();
		this.toolCallViews.clear();
	}

	async history(beforeSeq?: number): Promise<unknown> {
		const active = await this.start();
		return apiValue(
			await this.call("session.history", {
				sessionId: active.sessionId,
				...(beforeSeq === undefined ? {} : { beforeSeq }),
			}),
		);
	}

	async contextEvidence(): Promise<DshContextEvidence> {
		const entries = new Map<number, Record<string, unknown>>();
		let beforeSeq: number | undefined;
		let pages = 0;
		let exhausted = false;
		while (pages < 20 && entries.size < 500) {
			const page = await this.history(beforeSeq);
			if (!isRecord(page)) break;
			const pageEntries = records(page.events);
			for (const entry of pageEntries) {
				const event = isRecord(entry.event) ? entry.event : undefined;
				if (typeof event?.seq === "number") entries.set(event.seq, entry);
				if (entries.size === 500) break;
			}
			pages += 1;
			if (page.hasMore !== true) {
				exhausted = true;
				break;
			}
			const seqs = pageEntries.flatMap((entry) => {
				const event = isRecord(entry.event) ? entry.event : undefined;
				return typeof event?.seq === "number" ? [event.seq] : [];
			});
			if (seqs.length === 0) break;
			const nextBeforeSeq = Math.min(...seqs);
			if (nextBeforeSeq === beforeSeq) break;
			beforeSeq = nextBeforeSeq;
		}
		return collectDshContextEvidence([...entries.values()], {
			pages,
			truncated: !exhausted,
		});
	}

	async attachment(attachmentId: string): Promise<Record<string, unknown>> {
		const active = await this.start();
		const value = apiValue(
			await this.call("session.attachment", {
				sessionId: active.sessionId,
				attachmentId,
			}),
		);
		if (!isRecord(value)) throw new Error("Harness 未返回Image Attachment。");
		return value;
	}

	async projections(): Promise<Record<string, unknown>> {
		const active = await this.start();
		const value = apiValue(
			await this.call("session.history", {
				sessionId: active.sessionId,
				maxMessages: 1,
			}),
		);
		if (!isRecord(value) || !isRecord(value.projections)) return {};
		return isRecord(value.projections.values) ? value.projections.values : {};
	}

	async fork(atSeq?: number): Promise<string> {
		const active = await this.start();
		const value = apiValue(
			await this.call("session.fork", {
				sessionId: active.sessionId,
				...(atSeq === undefined ? {} : { atSeq }),
			}),
		);
		if (!isRecord(value) || typeof value.sessionId !== "string") throw new Error("DSH 未返回 fork Session ID。");
		this.switchSession(value.sessionId);
		return value.sessionId;
	}

	async rename(title: string): Promise<void> {
		const active = await this.start();
		apiValue(await this.call("session.rename", { sessionId: active.sessionId, title }));
	}

	async updateQueue(itemId: string, action: DshQueueAction): Promise<void> {
		const active = await this.start();
		apiValue(
			await this.call("session.updateQueue", {
				sessionId: active.sessionId,
				itemId,
				action,
			}),
		);
	}

	async cancel(): Promise<void> {
		const active = await this.start();
		apiValue(await this.call("session.cancel", { sessionId: active.sessionId }));
	}

	async presets(): Promise<Record<string, unknown>[]> {
		const value = apiValue(await this.call("agentPreset.list", {}));
		return isRecord(value) && Array.isArray(value.presets) ? value.presets.filter(isRecord) : [];
	}

	async skills(): Promise<Record<string, unknown>[]> {
		const active = await this.start();
		const value = apiValue(await this.call("skill.list", { sessionId: active.sessionId }));
		return isRecord(value) && Array.isArray(value.skills) ? value.skills.filter(isRecord) : [];
	}

	async commands(): Promise<Record<string, unknown>[]> {
		const active = await this.start();
		const value = await active.harness.client.request("meldra/commands.list", {
			sessionId: active.sessionId,
		});
		return Array.isArray(value) ? value.filter(isRecord) : [];
	}

	private async messageFeedback(
		method: "list" | "put" | "delete",
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const active = await this.start();
		const value = await active.harness.client.request("meldra/message-feedback.call", {
			method,
			payload: { sessionId: active.sessionId, ...payload },
		});
		if (!isRecord(value)) throw new Error("Harness 未返回Message Feedback结果。");
		return value;
	}

	async listMessageFeedback(): Promise<Record<string, unknown>> {
		return this.messageFeedback("list", {});
	}

	async putMessageFeedback(
		messageId: string,
		rating: "positive" | "negative",
		note: string | undefined,
		ifVersion: string | null,
	): Promise<Record<string, unknown>> {
		return this.messageFeedback("put", {
			messageId,
			rating,
			...(note ? { note } : {}),
			ifVersion,
		});
	}

	async deleteMessageFeedback(messageId: string, ifVersion: string): Promise<Record<string, unknown>> {
		return this.messageFeedback("delete", { messageId, ifVersion });
	}

	async plugins(): Promise<Record<string, unknown>[]> {
		const active = await this.start();
		const value = await active.harness.client.request("meldra/plugin-inventory.list", {});
		return isRecord(value) && Array.isArray(value.entries) ? value.entries.filter(isRecord) : [];
	}

	async manageProfilePlugins(
		request: ProfileRuntimePackageRequest,
		options?: ProfileRuntimePackageExecutionOptions,
	): Promise<{
		code: number;
		output: string;
	}> {
		const name = process.env.MELDRA_PROFILE_NAME ?? process.env.METAPI_PROFILE_NAME ?? "dsh";
		const profile: ProfileEnvironmentDescriptor = {
			name,
			displayName: name,
			agentDir: this.options.agentDir,
			cwd: this.options.cwd,
			compatibility: false,
			runtime: { provider: "deepseek-harness" },
		};
		return dshProfilePackageManager.execute(profile, request, options);
	}

	async settings(): Promise<Record<string, unknown>> {
		const value = apiValue(await this.call("settings.describe", {}));
		return isRecord(value) ? value : {};
	}

	async mutateSettings(
		ns: string,
		ops: Record<string, unknown>[],
		expectedRevision: number,
	): Promise<Record<string, unknown>> {
		const value = apiValue(await this.call("settings.mutate", { ns, ops, expectedRevision }));
		if (!isRecord(value)) throw new Error("Harness 未返回Settings mutation结果。");
		return value;
	}

	async describeCredentials(refs: string[]): Promise<Record<string, Record<string, unknown>>> {
		const value = apiValue(await this.call("credentials.describe", { refs }));
		if (!isRecord(value) || !isRecord(value.credentials)) throw new Error("Harness 未返回 credential 状态。");
		return Object.fromEntries(
			Object.entries(value.credentials).filter((entry): entry is [string, Record<string, unknown>] =>
				isRecord(entry[1]),
			),
		);
	}

	async setCredential(ref: string, value: string): Promise<void> {
		apiValue(await this.call("credentials.set", { ref, value }));
	}

	async unsetCredential(ref: string): Promise<void> {
		apiValue(await this.call("credentials.unset", { ref }));
	}

	async providers(): Promise<Record<string, unknown>[]> {
		const value = apiValue(await this.call("llm.providers", {}));
		return isRecord(value) && Array.isArray(value.providers) ? value.providers.filter(isRecord) : [];
	}

	async selectPreset(agentPreset: string): Promise<string> {
		const active = await this.start();
		const value = apiValue(
			await this.call("agentPreset.select", {
				sessionId: active.sessionId,
				agentPreset,
			}),
		);
		if (!isRecord(value) || typeof value.agentPreset !== "string") throw new Error("DSH 未返回 Agent Preset。");
		return value.agentPreset;
	}

	async models(): Promise<unknown> {
		const active = await this.start();
		return apiValue(await this.call("session.models", { sessionId: active.sessionId }));
	}

	async subagents(): Promise<{
		entries: Record<string, unknown>[];
		parentAvailable: boolean;
	}> {
		const active = await this.start();
		const value = apiValue(
			await this.call("subagent.list", {
				parentSessionId: active.sessionId,
			}),
		);
		return {
			entries: isRecord(value) && Array.isArray(value.entries) ? value.entries.filter(isRecord) : [],
			parentAvailable: isRecord(value) && value.parentAvailable === true,
		};
	}

	async subagentHistory(
		childSessionId: string,
		mode: "one-shot" | "continuable",
		beforeSeq?: number,
	): Promise<unknown> {
		const active = await this.start();
		return apiValue(
			await this.call("subagent.history", {
				parentSessionId: active.sessionId,
				childSessionId,
				mode,
				...(beforeSeq === undefined ? {} : { beforeSeq }),
			}),
		);
	}

	async promptSubagent(childSessionId: string, text: string): Promise<unknown> {
		const active = await this.start();
		return apiValue(
			await this.call("subagent.prompt", {
				parentSessionId: active.sessionId,
				childSessionId,
				mode: "continuable",
				content: [{ type: "text", text }],
			}),
		);
	}

	async interruptSubagent(childSessionId: string): Promise<void> {
		const active = await this.start();
		apiValue(
			await this.call("subagent.interrupt", {
				parentSessionId: active.sessionId,
				childSessionId,
				mode: "continuable",
			}),
		);
	}

	async workspaces(): Promise<{
		items: Record<string, unknown>[];
		archivedSessionIds: string[];
	}> {
		const value = apiValue(await this.call("workspace.list", {}));
		return {
			items: isRecord(value) && Array.isArray(value.items) ? value.items.filter(isRecord) : [],
			archivedSessionIds:
				isRecord(value) && Array.isArray(value.archivedSessionIds)
					? value.archivedSessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string")
					: [],
		};
	}

	async createWorkspace(path: string): Promise<Record<string, unknown>> {
		const value = apiValue(await this.call("workspace.create", { path }));
		if (!isRecord(value) || !isRecord(value.workspace)) throw new Error("DSH 未返回 Workspace。");
		return value;
	}

	async renameWorkspace(workspaceId: string, title: string): Promise<void> {
		apiValue(await this.call("workspace.rename", { workspaceId, title }));
	}

	async deleteWorkspace(workspaceId: string): Promise<void> {
		apiValue(await this.call("workspace.delete", { workspaceId }));
	}

	async moveWorkspace(workspaceId: string, beforeWorkspaceId?: string): Promise<void> {
		apiValue(
			await this.call("workspace.insertBefore", {
				workspaceId,
				...(beforeWorkspaceId ? { beforeWorkspaceId } : {}),
			}),
		);
	}

	async moveCurrentSession(workspaceId: string, beforeSessionId?: string): Promise<void> {
		const active = await this.start();
		apiValue(
			await this.call("workspace.insertSessionBefore", {
				workspaceId,
				sessionId: active.sessionId,
				...(beforeSessionId ? { beforeSessionId } : {}),
			}),
		);
	}

	async archiveCurrentSession(): Promise<void> {
		const active = await this.start();
		apiValue(
			await this.call("workspace.archiveSession", {
				sessionId: active.sessionId,
			}),
		);
	}

	async createGoal(objective: string, maxGoalRounds?: number): Promise<unknown> {
		const active = await this.start();
		return apiValue(
			await this.call("goal.create", {
				sessionId: active.sessionId,
				objective,
				...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
			}),
		);
	}

	async mutateGoal(
		operation: "edit" | "pause" | "resume" | "complete" | "clear",
		ref: { id: string; revision: number },
		changes?: { objective?: string; maxGoalRounds?: number },
	): Promise<unknown> {
		const active = await this.start();
		return apiValue(
			await this.call(`goal.${operation}`, {
				sessionId: active.sessionId,
				ref,
				...(operation === "edit" ? changes : {}),
			}),
		);
	}

	private async selectMeldraModel(model: Model<any>): Promise<void> {
		const modelRuntime = this.options.modelRuntime;
		if (!modelRuntime) throw new Error("当前 DSH Runtime 没有 Meldra 模型目录。");
		if (!DSH_PI_AI_SUPPORTED_APIS.has(model.api)) {
			throw new Error(
				`当前 DSH llm-pi-ai 不支持 Meldra 模型 API“${model.api}”（${model.provider}/${model.id}）。当前可桥接：openai-completions、openai-responses、anthropic-messages。`,
			);
		}
		const settings = await this.settings();
		if (settings.writable !== true) throw new Error("当前 Harness Settings 不可写，无法注册 Meldra 模型。");
		const namespace = records(settings.namespaces).find((entry) => entry.ns === DSH_PI_AI_SETTINGS_NAMESPACE);
		if (!namespace || typeof namespace.revision !== "number") {
			throw new Error("当前 Harness 没有可写的 llm-pi-ai Settings namespace。");
		}

		const auth = await modelRuntime.getAuth(model);
		const credentialRef = auth?.auth.apiKey ? modelCredentialReference(model.provider) : undefined;
		const compatibility = modelRuntime.getCompatibilityRequestConfig(model);
		const headers = {
			...(compatibility.headers ?? {}),
			...(auth?.auth.headers ?? {}),
		};
		const providerProfile = {
			displayName: modelRuntime.getProvider(model.provider)?.name ?? model.provider,
			api: model.api,
			baseURL: auth?.auth.baseUrl ?? model.baseUrl,
			models: [dshModelProfile(model)],
			...(Object.keys(headers).length > 0 ? { headers } : {}),
			...(credentialRef ? { apiKeyEnv: credentialRef } : {}),
		};
		await this.mutateSettings(
			DSH_PI_AI_SETTINGS_NAMESPACE,
			[
				{
					op: "set",
					path: ["providers", model.provider],
					value: providerProfile,
				},
			],
			namespace.revision,
		);
		if (credentialRef && auth?.auth.apiKey) await this.setCredential(credentialRef, auth.auth.apiKey);
		await this.selectModel(model.provider, model.id);
	}

	async selectModel(model: Model<any>): Promise<void>;
	async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<unknown>;
	async selectModel(providerOrModel: string | Model<any>, model?: string, reasoningEffort?: string): Promise<unknown> {
		if (typeof providerOrModel !== "string") return this.selectMeldraModel(providerOrModel);
		if (!model) throw new Error("选择 Harness 模型时缺少 model id。");
		const active = await this.start();
		return apiValue(
			await this.call("session.selectModel", {
				sessionId: active.sessionId,
				provider: providerOrModel,
				model,
				...(reasoningEffort ? { reasoningEffort } : {}),
			}),
		);
	}

	async executeCommand(line: string): Promise<unknown> {
		const active = await this.start();
		const value = await active.harness.client.request("meldra/commands.execute", {
			sessionId: active.sessionId,
			line,
		});
		if (!isRecord(value) || !isRecord(value.command)) throw new Error("Harness 未返回命令执行结果。");
		if (value.command.kind === "error")
			throw new Error(typeof value.command.text === "string" ? value.command.text : "Harness 命令执行失败。");
		return value;
	}

	attach(host: ProfileAgentRuntimeHost): void {
		this.host = host;
	}

	subscribe(listener: (event: DshProfileEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getLastAssistantText(): string | undefined {
		return this.lastAssistantText;
	}

	async respond(response: Record<string, unknown>): Promise<unknown> {
		const active = await this.start();
		return active.harness.client.request("meldra/api.respond", { response });
	}

	private createAssistantProjection(): AssistantProjection {
		const message: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "profile-runtime",
			provider: "profile-runtime",
			model: "external",
			usage: emptyUsage(),
			stopReason: "pending",
			timestamp: Date.now(),
		};
		const projection = {
			message,
			blocks: new Map<number, TextContent | ThinkingContent | ToolCall>(),
			toolArgumentText: new Map<string, string>(),
		};
		this.assistant = projection;
		this.host?.emit({ type: "message_start", message: { ...message } });
		return projection;
	}

	private updateAssistant(projection: AssistantProjection, event: AssistantMessageEvent): void {
		projection.message.content = [...projection.blocks.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, block]) => block);
		this.host?.emit({
			type: "message_update",
			message: { ...projection.message },
			assistantMessageEvent: event,
		});
	}

	private handleAssistantChunk(event: Record<string, unknown>): void {
		if (!isRecord(event.data) || !isRecord(event.data.chunk)) return;
		const chunk = event.data.chunk;
		if (typeof chunk.index !== "number") return;
		const projection = this.assistant ?? this.createAssistantProjection();
		if (chunk.type === "text-delta" && typeof chunk.text === "string") {
			const current = projection.blocks.get(chunk.index);
			const block: TextContent = {
				type: "text",
				text: (current?.type === "text" ? current.text : "") + chunk.text,
			};
			projection.blocks.set(chunk.index, block);
			this.updateAssistant(projection, {
				type: "text_delta",
				contentIndex: chunk.index,
				delta: chunk.text,
				partial: projection.message,
			});
			return;
		}
		if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
			const current = projection.blocks.get(chunk.index);
			const block: ThinkingContent = {
				type: "thinking",
				thinking: (current?.type === "thinking" ? current.thinking : "") + chunk.text,
			};
			projection.blocks.set(chunk.index, block);
			this.updateAssistant(projection, {
				type: "thinking_delta",
				contentIndex: chunk.index,
				delta: chunk.text,
				partial: projection.message,
			});
			return;
		}
		if (chunk.type === "tool-call-delta" && typeof chunk.id === "string") {
			const argumentsDelta = typeof chunk.argumentsDelta === "string" ? chunk.argumentsDelta : "";
			const argumentsText = (projection.toolArgumentText.get(chunk.id) ?? "") + argumentsDelta;
			projection.toolArgumentText.set(chunk.id, argumentsText);
			const current = projection.blocks.get(chunk.index);
			const block: ToolCall = {
				type: "toolCall",
				id: chunk.id,
				name: typeof chunk.name === "string" ? chunk.name : current?.type === "toolCall" ? current.name : "tool",
				arguments: parseToolArguments(argumentsText),
			};
			projection.blocks.set(chunk.index, block);
			this.updateAssistant(projection, {
				type: "toolcall_delta",
				contentIndex: chunk.index,
				delta: argumentsDelta,
				partial: projection.message,
			});
			return;
		}
		if (chunk.type === "usage" && isRecord(chunk.usage)) {
			projection.message.usage = usageFrom(chunk.usage);
		}
	}

	private finishAssistant(event: Record<string, unknown>): void {
		if (!isRecord(event.data) || !isRecord(event.data.message)) return;
		const message = event.data.message;
		const source = isRecord(message.source) ? message.source : undefined;
		const projection = this.assistant ?? this.createAssistantProjection();
		if (Array.isArray(message.content)) {
			projection.blocks.clear();
			for (const [index, value] of message.content.entries()) {
				if (!isRecord(value) || typeof value.type !== "string") continue;
				if (value.type === "text" && typeof value.text === "string") {
					projection.blocks.set(index, { type: "text", text: value.text });
				} else if (value.type === "reasoning" && typeof value.text === "string") {
					projection.blocks.set(index, {
						type: "thinking",
						thinking: value.text,
					});
				} else if (value.type === "tool-call" && typeof value.id === "string" && typeof value.name === "string") {
					projection.blocks.set(index, {
						type: "toolCall",
						id: value.id,
						name: value.name,
						arguments: parseToolArguments(typeof value.arguments === "string" ? value.arguments : ""),
					});
				}
			}
			projection.message.content = [...projection.blocks.entries()]
				.sort(([left], [right]) => left - right)
				.map(([, block]) => block);
		}
		projection.message.provider = typeof source?.provider === "string" ? source.provider : "profile-runtime";
		projection.message.model = typeof source?.model === "string" ? source.model : "external";
		projection.message.usage = usageFrom(event.data.usage);
		projection.message.stopReason = "stop";
		this.host?.emit({
			type: "message_end",
			message: { ...projection.message },
		});
		const text = projection.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
		this.lastAssistantText = text.trim() || undefined;
		if (this.lastAssistantText) this.append("assistant", text, false);
		this.assistant = undefined;
	}

	private handleToolCall(event: Record<string, unknown>, view: unknown): void {
		if (!isRecord(event.data) || typeof event.data.callId !== "string" || typeof event.data.name !== "string") return;
		const argsText = typeof event.data.arguments === "string" ? event.data.arguments : "";
		if (typeof event.time === "number") this.toolStartedAt.set(event.data.callId, event.time);
		const callView = dshToolView(view, "call");
		if (callView) this.toolCallViews.set(event.data.callId, callView);
		this.host?.emit({
			type: "tool_execution_start",
			toolCallId: event.data.callId,
			toolName: event.data.name,
			args: parseToolArguments(argsText),
		});
	}

	private handleToolResult(event: Record<string, unknown>, view: unknown): void {
		if (!isRecord(event.data) || !isRecord(event.data.message) || !isRecord(event.data.message.source)) return;
		const callId = event.data.message.source.callId;
		if (typeof callId !== "string") return;
		const block = Array.isArray(event.data.message.content)
			? event.data.message.content.find((item) => isRecord(item) && item.type === "tool-result")
			: undefined;
		const content = isRecord(block) ? resultContent(block.content) : [];
		const startedAt = this.toolStartedAt.get(callId);
		this.toolStartedAt.delete(callId);
		const callView = this.toolCallViews.get(callId);
		this.toolCallViews.delete(callId);
		const isError = event.data.error !== undefined || (isRecord(block) && block.isError === true);
		const presentation = profileToolPresentation(callView, dshToolView(view, "result"), isError);
		const durationMs =
			startedAt !== undefined && typeof event.time === "number" ? Math.max(0, event.time - startedAt) : undefined;
		const meta = event.data.meta;
		const details =
			presentation === undefined && durationMs === undefined
				? meta
				: {
						...(isRecord(meta) ? meta : meta === undefined ? {} : { meta }),
						...(presentation ? { profilePresentation: presentation } : {}),
						...(durationMs === undefined ? {} : { durationMs }),
					};
		this.host?.emit({
			type: "tool_execution_end",
			toolCallId: callId,
			toolName: "tool",
			result: { content, details },
			isError,
		});
	}

	private handleRuntimeFrame(active: RuntimeState, payload: Record<string, unknown>): void {
		if (payload.sessionId !== active.sessionId) return;
		if (payload.type === "host/session-status" && typeof payload.running === "boolean") {
			const turn = this.activeTurn;
			if (!turn || turn.sessionId !== payload.sessionId) return;
			if (payload.running) turn.sawRunning = true;
			else if (turn.sawRunning) turn.resolve();
			return;
		}
		if (payload.type === "host/agent-error" && typeof payload.message === "string") {
			this.activeTurn?.reject(new Error(payload.message));
			return;
		}
		if (payload.type !== "session/event" || !isRecord(payload.event)) return;
		const event = payload.event;
		if (event.type === "user/message") {
			const snapshot = userMessageSnapshot(event);
			if (snapshot) this.append("user", snapshot);
			return;
		}
		if (event.type === "assistant/chunk") {
			this.handleAssistantChunk(event);
			return;
		}
		if (event.type === "assistant/message") {
			this.finishAssistant(event);
			return;
		}
		if (event.type === "tool/call") {
			this.handleToolCall(event, payload.view);
			return;
		}
		if (event.type === "tool/result") this.handleToolResult(event, payload.view);
	}

	private emitProfileEvent(active: RuntimeState, value: unknown): void {
		if (!isRecord(value) || typeof value.rpcId !== "string" || !isRecord(value.payload)) return;
		this.handleRuntimeFrame(active, value.payload);
		const event = { rpcId: value.rpcId, payload: value.payload };
		for (const listener of this.listeners) listener(event);
	}

	private async startEventPump(active: RuntimeState, stream: "mux" | "host"): Promise<void> {
		const opened = await active.harness.client.request("meldra/api.events.open", { stream });
		if (!isRecord(opened) || typeof opened.cursorId !== "string") throw new Error("DSH 未返回事件 cursor。");
		active.eventCursors.set(stream, opened.cursorId);
		const task = (async () => {
			while ((this.runtime === undefined || this.runtime === active) && active.eventCursors.has(stream)) {
				const cursorId = active.eventCursors.get(stream);
				if (!cursorId) break;
				const next = await active.harness.client.request("meldra/api.events.next", { cursorId });
				if (!isRecord(next) || next.done === true) break;
				this.emitProfileEvent(active, next.value);
			}
		})().catch((error) => {
			if (this.runtime === active) this.append("error", `DSH ${stream} 事件流中断：${String(error)}`);
		});
		active.eventTasks.push(task);
	}

	private append(kind: "user" | "assistant" | "tool" | "error" | "info", text: string, notify = true): void {
		this.host?.appendEntry(MELDRA_DSH_MESSAGE_ENTRY, { kind, text }, { notify });
	}

	private async start(): Promise<RuntimeState> {
		if (this.runtime) return this.runtime;
		if (this.starting) return this.starting;
		const lifecycleVersion = this.lifecycleVersion;
		this.starting = (async () => {
			const auth = await this.options.modelRuntime?.getAuth("deepseek");
			if (lifecycleVersion !== this.lifecycleVersion) throw new Error("DSH Runtime 已关闭。");
			const apiKey = auth?.auth.apiKey;
			const dshHome = join(this.options.agentDir, "dsh-runtime");
			mkdirSync(dshHome, { recursive: true });
			const require = createRequire(import.meta.url);
			const runtimePath = fileURLToPath(new URL("../extensions/dsh/runner.js", import.meta.url));
			const dshPackagePath = require.resolve("@deepseek-ai/dsh/package.json");
			const shippedPresetRoot = join(dshPackagePath, "..", "config", "agent-presets");
			const { DeepSeekHarness } = await import("@deepseek-ai/dsh-sdk-client");
			const harness = new DeepSeekHarness({
				launch: {
					command: process.execPath,
					args: [runtimePath],
					cwd: this.options.cwd,
					env: {
						...process.env,
						...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
						...(auth?.auth.baseUrl ? { DEEPSEEK_BASE_URL: auth.auth.baseUrl } : {}),
						DSH_CWD: this.options.cwd,
						DSH_HOME: dshHome,
						DSH_SHIPPED_PRESET_ROOT: shippedPresetRoot,
					},
				},
				cwd: this.options.cwd,
			}) as Harness;
			const active: RuntimeState = {
				harness,
				sessionId: `meldra-${this.host?.sessionId ?? randomUUID()}`,
				eventCursors: new Map(),
				eventTasks: [],
			};
			this.startingHarness = harness;
			try {
				await harness.start();
				if (lifecycleVersion !== this.lifecycleVersion) throw new Error("DSH Runtime 已关闭。");
				await Promise.all([this.startEventPump(active, "mux"), this.startEventPump(active, "host")]);
				apiValue(
					await harness.client.request("meldra/api.call", {
						method: "session.create",
						payload: { sessionId: active.sessionId, cwd: this.options.cwd },
					}),
				);
				if (lifecycleVersion !== this.lifecycleVersion) throw new Error("DSH Runtime 已关闭。");
				return active;
			} catch (error) {
				await this.disposeRuntimeState(active).catch(() => undefined);
				throw error;
			} finally {
				if (this.startingHarness === harness) this.startingHarness = undefined;
			}
		})();
		try {
			this.runtime = await this.starting;
			return this.runtime;
		} finally {
			this.starting = undefined;
		}
	}

	private async admitPrompt(active: RuntimeState, input: ProfileAgentPrompt): Promise<unknown> {
		const images = input.images ?? [];
		return apiValue(
			await this.call("session.prompt", {
				sessionId: active.sessionId,
				mode: input.streamingBehavior === "steer" ? "steer" : "queue",
				content: [
					...(input.text ? [{ type: "text", text: input.text }] : []),
					...images.map((image) => ({
						type: "image",
						mediaType: image.mimeType,
						data: image.data,
					})),
				],
			}),
		);
	}

	async prompt(input: ProfileAgentPrompt): Promise<void> {
		if (this.activeTask) {
			try {
				const active = await this.start();
				await this.admitPrompt(active, input);
			} catch (error) {
				this.append("error", error instanceof Error ? error.message : String(error));
				throw error;
			}
			return;
		}
		const task = (async () => {
			const active = await this.start();
			let settle!: () => void;
			let fail!: (error: Error) => void;
			const idle = new Promise<void>((resolve, reject) => {
				settle = resolve;
				fail = reject;
			});
			this.activeTurn = {
				sessionId: active.sessionId,
				sawRunning: false,
				resolve: settle,
				reject: fail,
			};
			try {
				const response = await this.admitPrompt(active, input);
				if (isRecord(response) && isRecord(response.command)) return;
				await idle;
			} finally {
				this.activeTurn = undefined;
			}
		})();
		this.activeTask = task;
		try {
			await task;
		} catch (error) {
			this.append("error", error instanceof Error ? error.message : String(error));
			throw error;
		} finally {
			this.activeTask = undefined;
		}
	}

	async abort(): Promise<void> {
		if (!this.runtime || !this.activeTask) return;
		const activeTask = this.activeTask;
		const activeTurn = this.activeTurn;
		await this.cancel();
		// Cancellation can reach idle before the host event pump observes running=true.
		// Settle the local turn explicitly so session replacement cannot wait forever
		// on the sawRunning guard used by normal completion events.
		activeTurn?.resolve();
		await activeTask;
	}

	async waitForIdle(): Promise<void> {
		await this.activeTask;
	}

	private async disposeRuntimeState(current: RuntimeState): Promise<void> {
		await settleBounded(
			Promise.allSettled(
				[...current.eventCursors.values()].map((cursorId) =>
					current.harness.client.request("meldra/api.events.close", {
						cursorId,
					}),
				),
			),
		);
		current.eventCursors.clear();
		await current.harness.close();
		await settleBounded(Promise.allSettled(current.eventTasks));
	}

	private async closeRuntime(clearListeners: boolean): Promise<void> {
		this.lifecycleVersion += 1;
		const starting = this.starting;
		const startingHarness = this.startingHarness;
		if (startingHarness) await startingHarness.close();
		if (starting) await starting.catch(() => undefined);
		const current = this.runtime;
		this.runtime = undefined;
		this.starting = undefined;
		this.activeTurn?.reject(new Error("DSH Runtime 已关闭。"));
		this.activeTurn = undefined;
		this.assistant = undefined;
		this.toolStartedAt.clear();
		this.toolCallViews.clear();
		if (current) await this.disposeRuntimeState(current);
		if (clearListeners) this.listeners.clear();
	}

	async restart(): Promise<void> {
		if (this.activeTask) throw new Error("Harness 正在运行，不能重新加载 Runtime。");
		if (this.starting) await this.starting;
		await this.closeRuntime(false);
		await this.start();
	}

	async dispose(): Promise<void> {
		await this.closeRuntime(true);
	}

	async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
		const active = await this.start();
		return active.harness.client.request("meldra/api.call", {
			method,
			payload,
		});
	}
}
