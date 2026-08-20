import { describe, expect, it } from "vitest";
import {
	hooksForEvent,
	matchesHookCondition,
	resolveMeldraHooks,
	type MeldraHookInput,
} from "../src/hooks/index.ts";

function toolInput(toolName: string, input: Record<string, unknown>): MeldraHookInput {
	return {
		session_id: "condition-session",
		cwd: process.cwd(),
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: input,
	};
}

describe("Meldra Hook conditions", () => {
	it("parses and retains one permission-rule condition", () => {
		const resolved = resolveMeldraHooks([
			{
				source: "profile",
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", if: "Bash(git *)", command: "node check.mjs" }],
						},
					],
				},
			},
		]);
		expect(resolved.diagnostics).toEqual([]);
		expect(resolved.events.PreToolUse[0]?.if).toBe("Bash(git *)");
	});

	it("rejects malformed rules and conditions on non-tool events", () => {
		const malformed = resolveMeldraHooks([
			{
				source: "profile",
				hooks: { PreToolUse: [{ hooks: [{ type: "command", if: "Bash((git)", command: "bad" }] }] },
			},
		]);
		expect(malformed.events.PreToolUse).toEqual([]);
		expect(malformed.diagnostics[0]).toContain("must be one permission rule");

		const wrongEvent = resolveMeldraHooks([
			{
				source: "profile",
				hooks: { Stop: [{ hooks: [{ type: "command", if: "Bash(*)", command: "bad" }] }] },
			},
		]);
		expect(wrongEvent.events.Stop).toEqual([]);
		expect(wrongEvent.diagnostics[0]).toContain("only supported on tool Hook events");
	});

	it("matches tool names, simple shell commands, and trailing word wildcards", () => {
		expect(matchesHookCondition("Bash(git *)", "PreToolUse", toolInput("Bash", { command: "git status" }))).toBe(
			true,
		);
		expect(matchesHookCondition("Bash(git *)", "PreToolUse", toolInput("Bash", { command: "git" }))).toBe(true);
		expect(matchesHookCondition("Bash(git *)", "PreToolUse", toolInput("Bash", { command: "npm test" }))).toBe(
			false,
		);
		expect(matchesHookCondition("Power*", "PreToolUse", toolInput("PowerShell", { command: "Get-Date" }))).toBe(
			true,
		);
	});

	it("fails open for complex shell syntax", () => {
		expect(
			matchesHookCondition(
				"Bash(git *)",
				"PreToolUse",
				toolInput("Bash", { command: "npm test && echo done" }),
			),
		).toBe(true);
		expect(
			matchesHookCondition("Bash(rm *)", "PreToolUse", toolInput("Bash", { command: "echo $(rm -rf build)" })),
		).toBe(true);
		expect(
			matchesHookCondition("Bash(git *)", "PreToolUse", toolInput("Bash", { command: "FOO=1 git push" })),
		).toBe(true);
		expect(
			matchesHookCondition("Bash(git *)", "PreToolUse", toolInput("Bash", { command: "timeout 30 git push" })),
		).toBe(true);
		expect(
			matchesHookCondition(
				"PowerShell(Remove-Item *)",
				"PreToolUse",
				toolInput("PowerShell", { command: "ri build -Recurse" }),
			),
		).toBe(true);
	});

	it("matches file globs and top-level scalar parameters", () => {
		expect(matchesHookCondition("Edit(src/**)", "PreToolUse", toolInput("Edit", { path: "src/app.ts" }))).toBe(
			true,
		);
		expect(matchesHookCondition("Edit(src/**)", "PreToolUse", toolInput("Edit", { path: "test/app.ts" }))).toBe(
			false,
		);
		expect(
			matchesHookCondition("Glob(**/*.ts)", "PreToolUse", toolInput("Glob", { pattern: "src/**/*.ts", path: "." })),
		).toBe(true);
		expect(
			matchesHookCondition(
				"custom_tool(mode:strict*)",
				"PostToolUse",
				toolInput("custom_tool", { mode: "strict-review" }),
			),
		).toBe(true);
		expect(
			matchesHookCondition("custom_tool(mode:strict*)", "PostToolUse", toolInput("custom_tool", {})),
		).toBe(false);
		expect(
			matchesHookCondition(
				"WebFetch(https://example.com/*)",
				"PreToolUse",
				toolInput("WebFetch", { url: "https://example.com/docs" }),
			),
		).toBe(true);
	});

	it("filters resolved handlers before they spawn", () => {
		const resolved = resolveMeldraHooks([
			{
				source: "project",
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{ type: "command", if: "Bash(git *)", command: "git-hook" },
								{ type: "command", if: "Bash(npm *)", command: "npm-hook" },
							],
						},
					],
				},
			},
		]);
		const input = toolInput("Bash", { command: "npm test" });
		expect(hooksForEvent(resolved, "PreToolUse", "Bash", input).map((hook) => hook.command)).toEqual([
			"npm-hook",
		]);
	});
});
