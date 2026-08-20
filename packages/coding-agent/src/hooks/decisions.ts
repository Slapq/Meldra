import type { MeldraHookRunResult } from "./types.ts";

export const MELDRA_HOOK_TOOL_BLOCK_MESSAGE = "Tool execution blocked by a Meldra Hook.";
export const MELDRA_HOOK_CONTINUATION_MESSAGE = "Continue the current task.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function meldraHookSpecificOutput(result: MeldraHookRunResult): Record<string, unknown> | undefined {
	return isRecord(result.output?.hookSpecificOutput) ? result.output.hookSpecificOutput : undefined;
}

export function meldraHookBlockReason(results: MeldraHookRunResult[]): string | undefined {
	for (const result of results) {
		if (result.status === "block") {
			return result.stderr.trim() || result.stdout.trim() || "Blocked by Meldra Hook";
		}
		const output = meldraHookSpecificOutput(result);
		if (output?.permissionDecision === "deny" || result.output?.decision === "block") {
			return String(output?.permissionDecisionReason ?? result.output?.reason ?? "Blocked by Meldra Hook");
		}
	}
	return undefined;
}

export function meldraHookPermissionRequest(results: MeldraHookRunResult[]): { reason?: string } | undefined {
	for (const result of results) {
		const output = meldraHookSpecificOutput(result);
		if (output?.permissionDecision === "ask") {
			return typeof output.permissionDecisionReason === "string" ? { reason: output.permissionDecisionReason } : {};
		}
	}
	return undefined;
}

export function meldraHookContinuationRequested(results: MeldraHookRunResult[]): boolean {
	return results.some(
		(result) =>
			result.status === "block" || result.output?.decision === "block" || result.output?.decision === "continue",
	);
}

export function meldraHookPromptOutputDiagnostics(results: MeldraHookRunResult[]): string[] {
	return results.flatMap((result) => {
		const specific = meldraHookSpecificOutput(result);
		return specific?.additionalContext !== undefined || result.output?.additionalContext !== undefined
			? [`${result.hook.source} ${result.hook.command}: additionalContext ignored; Hook output cannot enter Prompt`]
			: [];
	});
}
