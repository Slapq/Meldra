import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
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

export interface MeldraDshHooksService {
	configure(config: MeldraHooksRuntimeConfig): void;
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
		hooks: hooksForEvent(config.hooks, event, matcher),
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
	const stopHookActive = new WeakSet<Agent>();
	const service: MeldraDshHooksService = {
		configure(value) {
			config = structuredClone(value);
		},
	};
	ctx.provide("meldraHooks", service);

	ctx.on("agent/session-start", ({ agent, source }) => {
		startSources.set(agent, source);
	});

	ctx.on("agent/pre-step", async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
		const active = config;
		if (!active || active.hooks.disabled) return await next();
		const injected: UserMessage[] = [];
		if (!initialized.has(agent)) {
			initialized.add(agent);
			const source = startSources.get(agent) ?? "startup";
			const results = await run(
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
			const results = await run(
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
		const results = await run(
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
		const denied = blockReason(results);
		if (denied) return { kind: "deny", reason: denied };
		const ask = permissionRequest(results);
		if (ask) return { kind: "ask", ...ask };
		for (const result of results) {
			if (specific(result)?.updatedInput !== undefined) {
				console.error(
					"[meldra-hooks] DSH does not support PreToolUse updatedInput; immutable arguments were preserved",
				);
				break;
			}
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
			const results = await run(
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
		const results = await run(
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
		const active = config;
		if (!active || active.hooks.disabled) return;
		void run(active, "SessionEnd", "other", { ...common(active, "SessionEnd", agent), reason: "other" }).catch(
			(error) => console.error("[meldra-hooks] SessionEnd hook failed", error),
		);
	});
}
