import { describe, expect, it } from "vitest";
import {
	MELDRA_HOOK_CONTINUATION_MESSAGE,
	MELDRA_HOOK_TOOL_BLOCK_MESSAGE,
	meldraHookBlockReason,
	meldraHookContinuationRequested,
	meldraHookPermissionRequest,
	meldraHookPromptOutputDiagnostics,
	type MeldraHookRunResult,
} from "../src/hooks/index.ts";

function result(values: Partial<MeldraHookRunResult>): MeldraHookRunResult {
	return {
		hook: { type: "command", command: "hook", source: "profile" },
		status: "success",
		code: 0,
		stdout: "",
		stderr: "",
		...values,
	};
}

describe("Meldra Hook decisions", () => {
	it("keeps Handler reasons separate from fixed Runtime control messages", () => {
		const results = [result({ status: "block", code: 2, stderr: "private policy reason" })];
		expect(meldraHookBlockReason(results)).toBe("private policy reason");
		expect(meldraHookContinuationRequested(results)).toBe(true);
		expect(MELDRA_HOOK_TOOL_BLOCK_MESSAGE).not.toContain("private policy reason");
		expect(MELDRA_HOOK_CONTINUATION_MESSAGE).not.toContain("private policy reason");
	});

	it("normalizes structured continue and ask decisions", () => {
		expect(meldraHookContinuationRequested([result({ output: { decision: "continue" } })])).toBe(true);
		expect(
			meldraHookPermissionRequest([
				result({
					output: {
						hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "confirm externally" },
					},
				}),
			]),
		).toEqual({ reason: "confirm externally" });
	});

	it("diagnoses structured attempts to inject model context", () => {
		const diagnostics = meldraHookPromptOutputDiagnostics([
			result({ output: { hookSpecificOutput: { additionalContext: "must not enter Prompt" } } }),
		]);
		expect(diagnostics).toEqual([
			"profile hook: additionalContext ignored; Hook output cannot enter Prompt",
		]);
	});
});
