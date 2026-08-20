import { describe, expect, it } from "vitest";
import { canonicalHookToolName, hooksForEvent, matchesMeldraHook, resolveMeldraHooks } from "../src/hooks/index.ts";

describe("Meldra hooks config", () => {
	it("merges profile and project handlers, preserves source, and deduplicates identical hooks", () => {
		const shared = { type: "command", command: "node check.js" };
		const resolved = resolveMeldraHooks([
			{
				source: "profile",
				hooks: { PreToolUse: [{ matcher: "Bash|Write", hooks: [shared] }] },
			},
			{
				source: "project",
				hooks: {
					PreToolUse: [
						{ matcher: "Bash|Write", hooks: [shared] },
						{ matcher: "^mcp__", hooks: [{ type: "command", command: "node audit.js", timeout: 5 }] },
					],
				},
			},
		]);

		expect(resolved.diagnostics).toEqual([]);
		expect(resolved.events.PreToolUse).toHaveLength(2);
		expect(resolved.events.PreToolUse.map((hook) => hook.source)).toEqual(["profile", "project"]);
		expect(hooksForEvent(resolved, "PreToolUse", "Bash")).toHaveLength(1);
		expect(hooksForEvent(resolved, "PreToolUse", "mcp__github__read")).toHaveLength(1);
	});

	it("fails closed per invalid source and honors the highest disableAllHooks value", () => {
		const resolved = resolveMeldraHooks([
			{ source: "profile", hooks: ["legacy.ts"], disableAllHooks: true },
			{
				source: "project",
				disableAllHooks: false,
				hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
			},
		]);
		expect(resolved.disabled).toBe(false);
		expect(resolved.events.Stop).toHaveLength(1);
		expect(resolved.diagnostics).toContain(
			"profile hooks must be an object; legacy hook path arrays are not executable",
		);
	});

	it("reports invalid regular-expression matchers", () => {
		const resolved = resolveMeldraHooks([
			{
				source: "profile",
				hooks: { PreToolUse: [{ matcher: "[", hooks: [{ type: "command", command: "echo bad" }] }] },
			},
		]);
		expect(resolved.events.PreToolUse).toEqual([]);
		expect(resolved.diagnostics).toContain("profile hooks.PreToolUse[0].matcher must be a valid regular expression");
	});

	it("retains disabled handlers for inspection but excludes them from execution", () => {
		const resolved = resolveMeldraHooks([
			{
				source: "profile",
				hooks: {
					AgentEnd: [
						{
							hooks: [
								{ type: "command", command: "enabled" },
								{ type: "command", command: "disabled", disabled: true },
							],
						},
					],
				},
			},
		]);
		expect(resolved.diagnostics).toEqual([]);
		expect(resolved.events.AgentEnd).toHaveLength(2);
		expect(resolved.events.AgentEnd[1]?.disabled).toBe(true);
		expect(hooksForEvent(resolved, "AgentEnd").map((hook) => hook.command)).toEqual(["enabled"]);
	});

	it("rejects a non-boolean disabled field", () => {
		const resolved = resolveMeldraHooks([
			{
				source: "project",
				hooks: { Stop: [{ hooks: [{ type: "command", command: "echo", disabled: "yes" }] }] },
			},
		]);
		expect(resolved.events.Stop).toEqual([]);
		expect(resolved.diagnostics).toContain("project hooks.Stop[0].hooks[0].disabled must be a boolean");
	});

	it("implements exact-list and regex matcher behavior", () => {
		expect(matchesMeldraHook("Edit, Write", "Write")).toBe(true);
		expect(matchesMeldraHook("Edit|Write", "Bash")).toBe(false);
		expect(matchesMeldraHook("^mcp__.*__write", "mcp__db__write_row")).toBe(true);
		expect(matchesMeldraHook("[", "anything")).toBe(false);
		expect(matchesMeldraHook(undefined, "anything")).toBe(true);
	});

	it("maps built-in Pi tool names to Claude-compatible matcher names", () => {
		expect(canonicalHookToolName("bash")).toBe("Bash");
		expect(canonicalHookToolName("find")).toBe("Glob");
		expect(canonicalHookToolName("custom_tool")).toBe("custom_tool");
	});
});
