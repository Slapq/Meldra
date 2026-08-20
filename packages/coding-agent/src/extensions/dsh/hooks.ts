import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import {
	canonicalHookToolName,
	hooksForEvent,
	type MeldraHookEventName,
	type MeldraHookInput,
	type MeldraHookRunResult,
	type MeldraHooksRuntimeConfig,
	runMeldraCommandHooks,
} from "../../hooks/index.ts";

export const name = "meldra-command-hooks";
export const inject = ["agents", "tools"];

export interface MeldraDshHookDiagnostic {
	message: string;
}

export interface MeldraDshHooksService {
	configure(config: MeldraHooksRuntimeConfig): void;
	subscribeDiagnostics(listener: (diagnostic: MeldraDshHookDiagnostic) => void): () => void;
	shutdown(): Promise<void>;
	drain(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function specific(result: MeldraHookRunResult): Record<string, unknown> | undefined {
	return isRecord(result.output?.hookSpecificOutput) ? result.output.hookSpecificOutput : undefined;
}

function blockReason(results: MeldraHookRunResult[]): string | undefined {
	for (const result of results) {
		if (result.status === "block") return result.stderr.trim() || result.stdout.trim() || "Blocked by Meldra hook";
		const output = specific(result);
		if (output?.permissionDecision === "deny" || result.output?.decision === "block") {
			return String(output?.permissionDecisionReason ?? result.output?.reason ?? "Blocked by Meldra hook");
		}
	}
	return undefined;
}

function permissionRequest(results: MeldraHookRunResult[]): { reason?: string } | undefined {
	for (const result of results) {
		const output = specific(result);
		if (output?.permissionDecision === "ask") {
			return typeof output.permissionDecisionReason === "string" ? { reason: output.permissionDecisionReason } : {};
		}
	}
	return undefined;
}

function contexts(results: MeldraHookRunResult[]): string[] {
	return results.flatMap((result) => {
		if (result.status !== "success") return [];
		const value = specific(result)?.additionalContext ?? result.output?.additionalContext;
		if (typeof value === "string" && value.trim()) return [value.trim()];
		return !result.output && result.stdout.trim() ? [result.stdout.trim()] : [];
	});
}

function diagnostics(results: MeldraHookRunResult[]): string[] {
	return results.flatMap((result) =>
		result.status === "error" || result.status === "timeout"
			? [`${result.hook.source} ${result.hook.command}: ${result.stderr.trim() || result.status}`]
			: [],
	);
}

function message(text: string, summary: string): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text }],
		source: { kind: "plugin", plugin: name, form: "notice", summary },
	});
}

function textFromMessages(messages: UserMessage[]): string {
	return messages
		.flatMap((entry) => entry.content.flatMap((block) => (block.type === "text" ? [block.text] : [])))
		.join("\n");
}

function common(config: MeldraHooksRuntimeConfig, event: MeldraHookEventName, agent: Agent): MeldraHookInput {
	return { session_id: String(agent.id), cwd: config.cwd, hook_event_name: event };
}

async function run(
	config: MeldraHooksRuntimeConfig,
	event: MeldraHookEventName,
	matcher: string,
	input: MeldraHookInput,
	signal?: AbortSignal,
): Promise<MeldraHookRunResult[]> {
	return await runMeldraCommandHooks({
		hooks: hooksForEvent(config.hooks, event, matcher, input),
		input,
		cwd: config.cwd,
		signal,
		shellPath: config.shellPath,
	});
}

export function apply(ctx: Context): void {
	let config: MeldraHooksRuntimeConfig | undefined;
	const startSources = new WeakMap<Agent, string>();
	const initialized = new WeakSet<Agent>();
	const liveAgents = new Set<Agent>();
	const endedAgents = new WeakSet<Agent>();
	const sessionAgents = new WeakMap<Session, Agent>();
	const turnIndexes = new WeakMap<Agent, number>();
	const stepIndexes = new WeakMap<Agent, Map<string, number>>();
	const notificationTails = new WeakMap<Agent, Promise<void>>();
	const stopHookActive = new WeakSet<Agent>();
	const diagnosticListeners = new Set<(diagnostic: MeldraDshHookDiagnostic) => void>();
	const pendingRuns = new Set<Promise<unknown>>();
	const report = (message: string): void => {
		for (const listener of diagnosticListeners) {
			try {
				listener({ message });
			} catch {
				// Diagnostics must not change Hook decisions.
			}
		}
	};
	const invoke = (
		active: MeldraHooksRuntimeConfig,
		event: MeldraHookEventName,
		matcher: string,
		input: MeldraHookInput,
		signal?: AbortSignal,
	): Promise<MeldraHookRunResult[]> => {
		const task = run(active, event, matcher, input, signal).then((results) => {
			for (const diagnostic of diagnostics(results)) report(diagnostic);
			return results;
		});
		pendingRuns.add(task);
		void task.then(
			() => pendingRuns.delete(task),
			() => pendingRuns.delete(task),
		);
		return task;
	};
	const scheduleNotification = (
		agent: Agent,
		active: MeldraHooksRuntimeConfig,
		event: MeldraHookEventName,
		input: MeldraHookInput,
	): void => {
		const previous = notificationTails.get(agent) ?? Promise.resolve();
		const task = previous
			.catch(() => undefined)
			.then(async () => {
				const results = await invoke(active, event, "", input);
				const reason = blockReason(results);
				if (reason) report(`${event} is notification-only; block ignored: ${reason}`);
			})
			.catch((error) => report(`${event} hook failed: ${String(error)}`));
		notificationTails.set(agent, task);
		pendingRuns.add(task);
		void task.finally(() => pendingRuns.delete(task));
	};
	const endAgent = async (agent: Agent): Promise<void> => {
		if (endedAgents.has(agent)) return;
		endedAgents.add(agent);
		liveAgents.delete(agent);
		const active = config;
		if (!active || active.hooks.disabled) return;
		try {
			await notificationTails.get(agent);
			await invoke(active, "SessionEnd", "other", {
				...common(active, "SessionEnd", agent),
				reason: "other",
			});
		} catch (error) {
			report(`SessionEnd hook failed: ${String(error)}`);
		}
	};
	let shutdownTask: Promise<void> | undefined;
	const service: MeldraDshHooksService = {
		configure(value) {
			config = structuredClone(value);
			for (const diagnostic of config.hooks.diagnostics) report(diagnostic);
		},
		subscribeDiagnostics(listener) {
			diagnosticListeners.add(listener);
			return () => diagnosticListeners.delete(listener);
		},
		shutdown() {
			shutdownTask ??= Promise.allSettled([...liveAgents].map(endAgent)).then(() => undefined);
			return shutdownTask;
		},
		async drain() {
			while (pendingRuns.size > 0) await Promise.allSettled([...pendingRuns]);
		},
	};
	ctx.provide("meldraHooks", service);

	ctx.on("agent/session-start", ({ agent, source }) => {
		liveAgents.add(agent);
		sessionAgents.set(agent.session, agent);
		startSources.set(agent, source);
	});

	ctx.on("agent/status", ({ agent, status }) => {
		if (status === "running") {
			turnIndexes.set(agent, 0);
			stepIndexes.set(agent, new Map());
		}
		const active = config;
		if (!active || active.hooks.disabled) return;
		const event = status === "running" ? "AgentStart" : "AgentEnd";
		scheduleNotification(agent, active, event, common(active, event, agent));
	});

	ctx.on("session/event", (session: Session, event: SessionEvent) => {
		if (event.type !== "step/start" && event.type !== "step/end") return;
		const agent = sessionAgents.get(session);
		const active = config;
		if (!agent || !active || active.hooks.disabled) return;
		const key = `${event.data.turn}:${event.data.step}`;
		let turnIndex: number;
		if (event.type === "step/start") {
			turnIndex = turnIndexes.get(agent) ?? 0;
			turnIndexes.set(agent, turnIndex + 1);
			const indexes = stepIndexes.get(agent) ?? new Map<string, number>();
			indexes.set(key, turnIndex);
			stepIndexes.set(agent, indexes);
		} else {
			turnIndex = stepIndexes.get(agent)?.get(key) ?? Math.max(0, (turnIndexes.get(agent) ?? 1) - 1);
			stepIndexes.get(agent)?.delete(key);
		}
		const hookEvent = event.type === "step/start" ? "TurnStart" : "TurnEnd";
		scheduleNotification(agent, active, hookEvent, {
			...common(active, hookEvent, agent),
			turn_index: turnIndex,
			timestamp: event.time,
			runtime_turn: event.data.turn,
			runtime_step: event.data.step,
		});
	});

	ctx.on("agent/pre-step", async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
		const active = config;
		if (!active || active.hooks.disabled) return await next();
		const injected: UserMessage[] = [];
		if (!initialized.has(agent)) {
			initialized.add(agent);
			const source = startSources.get(agent) ?? "startup";
			const results = await invoke(
				active,
				"SessionStart",
				source,
				{ ...common(active, "SessionStart", agent), source },
				signal,
			);
			injected.push(...contexts(results).map((value) => message(value, "SessionStart hook context")));
		}
		const userMessages = messages.filter((entry) => entry.source.kind === "user");
		if (userMessages.length > 0) {
			const results = await invoke(
				active,
				"UserPromptSubmit",
				"",
				{ ...common(active, "UserPromptSubmit", agent), prompt: textFromMessages(userMessages) },
				signal,
			);
			if (blockReason(results)) return { kind: "reject" };
			injected.push(...contexts(results).map((value) => message(value, "UserPromptSubmit hook context")));
		}
		const decision = await next();
		if (decision.kind === "reject" || injected.length === 0) return decision;
		return { kind: "enter", messages: [...decision.messages, ...injected] };
	});

	ctx.on("tools/pre-execute", async (exec: ToolExecution, next): Promise<PreToolDecision> => {
		const active = config;
		if (!active || !exec.agent || active.hooks.disabled) return await next();
		const toolName = canonicalHookToolName(exec.name);
		const results = await invoke(
			active,
			"PreToolUse",
			toolName,
			{
				...common(active, "PreToolUse", exec.agent),
				tool_name: toolName,
				tool_input: exec.arguments,
				tool_use_id: String(exec.callId),
			},
			exec.signal,
		);
		for (const result of results) {
			if (specific(result)?.updatedInput !== undefined) {
				report("DSH does not support PreToolUse updatedInput; immutable arguments were preserved");
				break;
			}
		}
		const denied = blockReason(results);
		if (denied) return { kind: "deny", reason: denied };
		const ask = permissionRequest(results);
		if (ask) {
			const downstream = await next();
			return downstream.kind === "allow" ? { kind: "ask", ...ask } : downstream;
		}
		return await next();
	});

	ctx.on(
		"tools/post-execute",
		async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next): Promise<PostToolDecision> => {
			const downstream = await next();
			const active = config;
			if (!active || !exec.agent || active.hooks.disabled) return downstream;
			const event = result.isError ? "PostToolUseFailure" : "PostToolUse";
			const toolName = canonicalHookToolName(exec.name);
			const results = await invoke(
				active,
				event,
				toolName,
				{
					...common(active, event, exec.agent),
					tool_name: toolName,
					tool_input: exec.arguments,
					tool_use_id: String(exec.callId),
					tool_response: result.content,
					...(result.isError ? { error: result.content } : {}),
				},
				exec.signal,
			);
			const reason = blockReason(results);
			const additionalContexts = contexts(results).map((value) => message(value, `${event} hook context`));
			if (reason) return { kind: "block", feedback: [{ type: "text", text: reason }], additionalContexts };
			if (additionalContexts.length === 0) return downstream;
			return {
				...downstream,
				additionalContexts: [...(downstream.additionalContexts ?? []), ...additionalContexts],
			};
		},
	);

	ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
		const active = config;
		if (!active || active.hooks.disabled) return;
		const wasActive = stopHookActive.has(agent);
		const results = await invoke(
			active,
			"Stop",
			"",
			{ ...common(active, "Stop", agent), stop_hook_active: wasActive },
			signal,
		);
		const reason = blockReason(results);
		if (reason && !wasActive) {
			stopHookActive.add(agent);
			agent.steer(message(reason, "Stop hook requested continuation"));
		} else {
			stopHookActive.delete(agent);
		}
	});

	ctx.on("agent/disposed", ({ agent }) => {
		void endAgent(agent);
	});
}
