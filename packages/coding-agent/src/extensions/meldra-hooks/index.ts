import type { ExtensionAPI, ExtensionContext, InlineExtension } from "../../core/extensions/types.ts";
import type { Settings } from "../../core/settings-manager.ts";
import {
	canonicalHookToolName,
	hooksForEvent,
	type MeldraHookEventName,
	type MeldraHookInput,
	type MeldraHookRunResult,
	type MeldraHooksRuntimeConfig,
	resolveMeldraHooks,
	runMeldraCommandHooks,
} from "../../hooks/index.ts";

interface HooksRuntimeConfig extends MeldraHooksRuntimeConfig {}

interface ConfigurableProfileRuntime {
	configureHooks?(config: HooksRuntimeConfig): void | Promise<void>;
}

function hookSpecificOutput(result: MeldraHookRunResult): Record<string, unknown> | undefined {
	const value = result.output?.hookSpecificOutput;
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function blockReason(results: MeldraHookRunResult[]): string | undefined {
	for (const result of results) {
		if (result.status === "block") return result.stderr.trim() || result.stdout.trim() || "Blocked by Meldra hook";
		const specific = hookSpecificOutput(result);
		if (specific?.permissionDecision === "deny" || result.output?.decision === "block") {
			return String(specific?.permissionDecisionReason ?? result.output?.reason ?? "Blocked by Meldra hook");
		}
	}
	return undefined;
}

function additionalContext(results: MeldraHookRunResult[]): string[] {
	const values: string[] = [];
	for (const result of results) {
		if (result.status !== "success") continue;
		const specific = hookSpecificOutput(result);
		const structured = specific?.additionalContext ?? result.output?.additionalContext;
		if (typeof structured === "string" && structured.trim()) values.push(structured.trim());
		else if (!result.output && result.stdout.trim()) values.push(result.stdout.trim());
	}
	return values;
}

function diagnostics(results: MeldraHookRunResult[]): string[] {
	return results.flatMap((result) =>
		result.status === "error" || result.status === "timeout"
			? [`${result.hook.source} ${result.hook.command}: ${result.stderr.trim() || result.status}`]
			: [],
	);
}

function commonInput(event: MeldraHookEventName, ctx: ExtensionContext): MeldraHookInput {
	return {
		session_id: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		hook_event_name: event,
		...(ctx.sessionManager.getSessionFile() ? { transcript_path: ctx.sessionManager.getSessionFile() } : {}),
	};
}

async function run(
	config: HooksRuntimeConfig,
	event: MeldraHookEventName,
	matcher: string,
	input: MeldraHookInput,
	ctx: ExtensionContext,
): Promise<MeldraHookRunResult[]> {
	const results = await runMeldraCommandHooks({
		hooks: hooksForEvent(config.hooks, event, matcher),
		input,
		cwd: ctx.cwd,
		signal: ctx.signal,
		shellPath: config.shellPath,
	});
	const failures = diagnostics(results);
	if (failures.length && ctx.hasUI) ctx.ui.notify(failures.join("\n"), "warning");
	return results;
}

export function resolveHooksRuntimeConfig(
	profile: Settings,
	project: Settings,
	cwd: string,
	shellPath?: string,
): HooksRuntimeConfig {
	return {
		hooks: resolveMeldraHooks([
			{ source: "profile", hooks: profile.hooks, disableAllHooks: profile.disableAllHooks },
			{ source: "project", hooks: project.hooks, disableAllHooks: project.disableAllHooks },
		]),
		cwd,
		shellPath: shellPath ?? project.shellPath ?? profile.shellPath,
	};
}

export function createMeldraHooksExtension(getConfig: () => HooksRuntimeConfig): InlineExtension {
	return {
		name: "meldra-hooks",
		hidden: true,
		factory: (pi: ExtensionAPI) => {
			let config = getConfig();
			let pendingContext: string[] = [];
			let stopHookActive = false;

			pi.registerCommand("hooks", {
				description: "Inspect active Meldra hooks",
				handler: async (_args, ctx) => {
					config = getConfig();
					const events = Object.entries(config.hooks.events).filter(([, hooks]) => hooks.length > 0);
					const labels = [
						`Status: ${config.hooks.disabled ? "disabled" : "enabled"}`,
						...config.hooks.diagnostics.map((message) => `Warning: ${message}`),
						...events.map(([event, hooks]) => `${event} (${hooks.length})`),
					];
					const selected = await ctx.ui.select("Meldra Hooks", labels.length ? labels : ["No hooks configured"]);
					if (!selected) return;
					const eventName = selected.replace(/ \(\d+\)$/, "") as MeldraHookEventName;
					const hooks = config.hooks.events[eventName];
					if (!hooks?.length) return;
					await ctx.ui.select(
						eventName,
						hooks.map((hook) => `[${hook.source}] ${hook.matcher || "*"} -> ${hook.command}`),
					);
				},
			});

			pi.on("session_start", async (event, ctx) => {
				config = getConfig();
				const profileRuntime = ctx.profileRuntime as ConfigurableProfileRuntime | undefined;
				if (profileRuntime) {
					await profileRuntime.configureHooks?.(config);
					return;
				}
				if (config.hooks.diagnostics.length && ctx.hasUI) {
					ctx.ui.notify(config.hooks.diagnostics.join("\n"), "warning");
				}
				const source = event.reason === "reload" ? "startup" : event.reason;
				const results = await run(
					config,
					"SessionStart",
					source,
					{ ...commonInput("SessionStart", ctx), source },
					ctx,
				);
				pendingContext.push(...additionalContext(results));
			});

			pi.on("input", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				const results = await run(
					config,
					"UserPromptSubmit",
					"",
					{ ...commonInput("UserPromptSubmit", ctx), prompt: event.text },
					ctx,
				);
				const reason = blockReason(results);
				if (reason) {
					if (ctx.hasUI) ctx.ui.notify(reason, "warning");
					return { action: "handled" as const };
				}
				pendingContext.push(...additionalContext(results));
				return { action: "continue" as const };
			});

			pi.on("before_agent_start", async (_event, ctx) => {
				if (ctx.profileRuntime || pendingContext.length === 0) return;
				const content = pendingContext.join("\n\n");
				pendingContext = [];
				return { message: { customType: "meldra-hooks", content, display: false } };
			});

			pi.on("tool_call", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				const toolName = canonicalHookToolName(event.toolName);
				const results = await run(
					config,
					"PreToolUse",
					toolName,
					{
						...commonInput("PreToolUse", ctx),
						tool_name: toolName,
						tool_input: event.input,
						tool_use_id: event.toolCallId,
					},
					ctx,
				);
				const reason = blockReason(results);
				if (reason) return { block: true, reason };
				for (const result of results) {
					const updated = hookSpecificOutput(result)?.updatedInput;
					if (!updated || typeof updated !== "object" || Array.isArray(updated)) continue;
					const input = event.input as Record<string, unknown>;
					for (const key of Object.keys(input)) delete input[key];
					Object.assign(input, updated);
				}
			});

			pi.on("tool_result", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				const hookEvent = event.isError ? "PostToolUseFailure" : "PostToolUse";
				const toolName = canonicalHookToolName(event.toolName);
				const results = await run(
					config,
					hookEvent,
					toolName,
					{
						...commonInput(hookEvent, ctx),
						tool_name: toolName,
						tool_input: event.input,
						tool_use_id: event.toolCallId,
						tool_response: event.content,
						...(event.isError ? { error: event.content } : {}),
					},
					ctx,
				);
				const reason = blockReason(results);
				const context = additionalContext(results);
				if (!reason && context.length === 0) return;
				return {
					content: [
						...event.content,
						...(context.length ? [{ type: "text" as const, text: context.join("\n\n") }] : []),
						...(reason ? [{ type: "text" as const, text: reason }] : []),
					],
					...(reason ? { isError: true } : {}),
				};
			});

			pi.on("agent_settled", async (_event, ctx) => {
				if (ctx.profileRuntime) return;
				const results = await run(
					config,
					"Stop",
					"",
					{ ...commonInput("Stop", ctx), stop_hook_active: stopHookActive },
					ctx,
				);
				const reason = blockReason(results);
				if (reason && !stopHookActive) {
					stopHookActive = true;
					pi.sendMessage(
						{ customType: "meldra-hooks", content: reason, display: true },
						{ triggerTurn: true, deliverAs: "followUp" },
					);
				} else {
					stopHookActive = false;
				}
			});

			pi.on("session_shutdown", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				await run(
					config,
					"SessionEnd",
					event.reason,
					{ ...commonInput("SessionEnd", ctx), reason: event.reason },
					ctx,
				);
			});
		},
	};
}
