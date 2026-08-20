import type { ExtensionAPI, ExtensionContext, InlineExtension } from "../../core/extensions/types.ts";
import type { Settings } from "../../core/settings-manager.ts";
import {
	canonicalHookToolName,
	createMeldraHooksSettingsWatcher,
	hooksForEvent,
	MELDRA_HOOK_CONTINUATION_MESSAGE,
	MELDRA_HOOK_TOOL_BLOCK_MESSAGE,
	meldraHookBlockReason,
	meldraHookContinuationRequested,
	meldraHookPromptOutputDiagnostics,
	meldraHookSpecificOutput,
	type MeldraHookEventName,
	type MeldraHookInput,
	type MeldraHookRunResult,
	type MeldraHooksRuntimeConfig,
	type MeldraHooksSettingsWatcher,
	resolveMeldraHooks,
	runMeldraCommandHooks,
} from "../../hooks/index.ts";
import {
	type MeldraHooksManagementOptions,
	showMeldraHooksManager,
} from "./manager.ts";
import { detectHooksManagerLanguage } from "./language.ts";
import { HOOKS_MANAGER_LANGS } from "./ui.ts";

export type { MeldraHooksManagementOptions } from "./manager.ts";
export { loadHooksManagerLanguage, saveHooksManagerLanguage } from "./language.ts";

interface HooksRuntimeConfig extends MeldraHooksRuntimeConfig {}

interface ConfigurableProfileRuntime {
	configureHooks?(config: HooksRuntimeConfig): void | Promise<void>;
}

export interface MeldraHooksHotReloadResult {
	config?: HooksRuntimeConfig;
	diagnostics?: string[];
}

export interface MeldraHooksHotReloadOptions {
	paths: string[] | (() => string[]);
	load(): MeldraHooksHotReloadResult | Promise<MeldraHooksHotReloadResult>;
	intervalMs?: number;
	debounceMs?: number;
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
		hooks: hooksForEvent(config.hooks, event, matcher, input),
		input,
		cwd: ctx.cwd,
		signal: ctx.signal,
		shellPath: config.shellPath,
	});
	const failures = [...diagnostics(results), ...meldraHookPromptOutputDiagnostics(results)];
	if (failures.length && ctx.hasUI) ctx.ui.notify(failures.join("\n"), "warning");
	return results;
}

async function runNotification(
	config: HooksRuntimeConfig,
	event: "AgentStart" | "AgentEnd" | "TurnStart" | "TurnEnd",
	input: MeldraHookInput,
	ctx: ExtensionContext,
): Promise<void> {
	const results = await run(config, event, "", input, ctx);
	const reason = meldraHookBlockReason(results);
	if (reason && ctx.hasUI) ctx.ui.notify(`${event} is notification-only; block ignored: ${reason}`, "warning");
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

export function createMeldraHooksExtension(
	getConfig: () => HooksRuntimeConfig,
	hotReload?: MeldraHooksHotReloadOptions,
	management?: MeldraHooksManagementOptions,
): InlineExtension {
	return {
		name: "meldra-hooks",
		hidden: true,
		factory: (pi: ExtensionAPI) => {
			let config = getConfig();
			let settingsWatcher: MeldraHooksSettingsWatcher | undefined;
			let hotReloadActive = false;
			let hotReloadDiagnostics: string[] = [];
			let stopHookActive = false;

			pi.registerCommand("hooks", {
				description: "Manage Meldra hooks",
				handler: async (_args, ctx) => {
					if (!management) {
						if (ctx.hasUI) {
							ctx.ui.notify(HOOKS_MANAGER_LANGS[detectHooksManagerLanguage()].settingsUnavailable, "error");
						}
						return;
					}
					await showMeldraHooksManager(ctx, {
						management,
						hotReload: hotReload !== undefined,
						getHotReloadDiagnostics: () => [...hotReloadDiagnostics],
					});
				},
			});

			pi.on("session_start", async (event, ctx) => {
				settingsWatcher?.close();
				settingsWatcher = undefined;
				hotReloadActive = true;
				hotReloadDiagnostics = [];
				config = getConfig();
				const profileRuntime = ctx.profileRuntime as ConfigurableProfileRuntime | undefined;
				if (profileRuntime) await profileRuntime.configureHooks?.(config);
				if (config.hooks.diagnostics.length && ctx.hasUI) {
					ctx.ui.notify(config.hooks.diagnostics.join("\n"), "warning");
				}
				if (hotReload) {
					const reload = async (): Promise<void> => {
						const loaded = await hotReload.load();
						if (!hotReloadActive) return;
						const failures = [
							...(loaded.diagnostics ?? []),
							...(loaded.config?.hooks.diagnostics ?? []),
						];
						if (!loaded.config || failures.length > 0) {
							hotReloadDiagnostics = failures.length > 0 ? failures : ["Hook settings reload returned no config"];
							if (ctx.hasUI) ctx.ui.notify(hotReloadDiagnostics.join("\n"), "warning");
							return;
						}
						if (JSON.stringify(loaded.config) === JSON.stringify(config)) {
							hotReloadDiagnostics = [];
							return;
						}
						try {
							await profileRuntime?.configureHooks?.(loaded.config);
						} catch (error) {
							hotReloadDiagnostics = [`Hook settings reload failed: ${String(error)}`];
							if (ctx.hasUI) ctx.ui.notify(hotReloadDiagnostics[0], "warning");
							return;
						}
						if (!hotReloadActive) return;
						config = loaded.config;
						hotReloadDiagnostics = [];
						if (ctx.hasUI) ctx.ui.notify("Meldra Hooks configuration reloaded", "info");
					};
					settingsWatcher = createMeldraHooksSettingsWatcher({
						paths: typeof hotReload.paths === "function" ? hotReload.paths() : hotReload.paths,
						reload,
						onError(error) {
							if (!hotReloadActive) return;
							hotReloadDiagnostics = [`Hook settings watcher failed: ${String(error)}`];
							if (ctx.hasUI) ctx.ui.notify(hotReloadDiagnostics[0], "warning");
						},
						intervalMs: hotReload.intervalMs,
						debounceMs: hotReload.debounceMs,
					});
				}
				if (profileRuntime) return;
				const source = event.reason === "reload" ? "startup" : event.reason;
				const results = await run(
					config,
					"SessionStart",
					source,
					{ ...commonInput("SessionStart", ctx), source },
					ctx,
				);
				const reason = meldraHookBlockReason(results);
				if (reason && ctx.hasUI) {
					ctx.ui.notify(`SessionStart is notification-only; block ignored: ${reason}`, "warning");
				}
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
				const reason = meldraHookBlockReason(results);
				if (reason) {
					if (ctx.hasUI) ctx.ui.notify(reason, "warning");
					return { action: "handled" as const };
				}
				return { action: "continue" as const };
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
				const reason = meldraHookBlockReason(results);
				if (reason) {
					if (ctx.hasUI) ctx.ui.notify(reason, "warning");
					return { block: true, reason: MELDRA_HOOK_TOOL_BLOCK_MESSAGE };
				}
				for (const result of results) {
					const updated = meldraHookSpecificOutput(result)?.updatedInput;
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
				const reason = meldraHookBlockReason(results);
				if (reason && ctx.hasUI) {
					ctx.ui.notify(`${hookEvent} cannot change a completed tool result; decision ignored: ${reason}`, "warning");
				}
			});

			pi.on("agent_start", async (_event, ctx) => {
				if (ctx.profileRuntime) return;
				await runNotification(config, "AgentStart", commonInput("AgentStart", ctx), ctx);
			});

			pi.on("agent_end", async (_event, ctx) => {
				if (ctx.profileRuntime) return;
				await runNotification(config, "AgentEnd", commonInput("AgentEnd", ctx), ctx);
			});

			pi.on("turn_start", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				await runNotification(
					config,
					"TurnStart",
					{ ...commonInput("TurnStart", ctx), turn_index: event.turnIndex, timestamp: event.timestamp },
					ctx,
				);
			});

			pi.on("turn_end", async (event, ctx) => {
				if (ctx.profileRuntime) return;
				await runNotification(
					config,
					"TurnEnd",
					{ ...commonInput("TurnEnd", ctx), turn_index: event.turnIndex, timestamp: Date.now() },
					ctx,
				);
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
				const reason = meldraHookBlockReason(results);
				const continuation = meldraHookContinuationRequested(results);
				if (continuation && !stopHookActive) {
					stopHookActive = true;
					if (reason && ctx.hasUI) ctx.ui.notify(`Stop Hook requested continuation: ${reason}`, "info");
					pi.sendMessage(
						{ customType: "meldra-hooks-continuation", content: MELDRA_HOOK_CONTINUATION_MESSAGE, display: false },
						{ triggerTurn: true, deliverAs: "followUp" },
					);
				} else {
					stopHookActive = false;
				}
			});

			pi.on("session_shutdown", async (event, ctx) => {
				hotReloadActive = false;
				settingsWatcher?.close();
				settingsWatcher = undefined;
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
