import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { apply, type MeldraDshHooksService } from "../src/extensions/dsh/hooks.ts";
import { createMeldraHooksExtension, resolveHooksRuntimeConfig } from "../src/extensions/meldra-hooks/index.ts";
import {
	type MeldraHookInput,
	MELDRA_HOOK_TOOL_BLOCK_MESSAGE,
	type ResolvedMeldraCommandHook,
	hooksForEvent,
	resolveMeldraHooks,
	runMeldraCommandHook,
} from "../src/hooks/index.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";
import { createTestExtensionsResult } from "./utilities.ts";

const examplesDir = fileURLToPath(new URL("../examples/hooks/", import.meta.url));
const dirs: string[] = [];

function workspace(): string {
	const cwd = mkdtempSync(join(tmpdir(), "meldra-hook-example-"));
	dirs.push(cwd);
	return cwd;
}

function exampleHook(script: string, args: string[] = []): ResolvedMeldraCommandHook {
	return {
		type: "command",
		command: process.execPath,
		args: [join(examplesDir, script), ...args],
		source: "project",
		timeout: 2,
	};
}

function input(cwd: string, values: Partial<MeldraHookInput>): MeldraHookInput {
	return {
		session_id: "example-session",
		cwd,
		hook_event_name: "PreToolUse",
		...values,
	};
}

afterEach(() => {
	for (const cwd of dirs.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("Meldra Hook examples", () => {
	it("provides a valid configuration for every supported event", () => {
		const settings = JSON.parse(readFileSync(join(examplesDir, "settings.example.json"), "utf8")) as {
			hooks: unknown;
		};
		const resolved = resolveMeldraHooks([{ source: "project", hooks: settings.hooks }]);
		expect(resolved.diagnostics).toEqual([]);
		expect(Object.values(resolved.events).every((handlers) => handlers.length > 0)).toBe(true);
		const npmInput = input(process.cwd(), {
			tool_name: "Bash",
			tool_input: { command: "npm test" },
		});
		expect(hooksForEvent(resolved, "PreToolUse", "Bash", npmInput).map((hook) => hook.command)).toEqual([
			"node",
		]);
		const envInput = input(process.cwd(), { tool_name: "Write", tool_input: { path: "config/.env.local" } });
		expect(hooksForEvent(resolved, "PreToolUse", "Write", envInput)).toHaveLength(2);
	});

	it("uses updated script contents on the next invocation", async () => {
		const cwd = workspace();
		const scriptPath = join(cwd, "hot-hook.mjs");
		const hook: ResolvedMeldraCommandHook = {
			type: "command",
			command: process.execPath,
			args: [scriptPath],
			source: "project",
			timeout: 2,
		};
		const hookInput = input(cwd, { hook_event_name: "SessionStart", source: "startup" });
		writeFileSync(scriptPath, 'process.stdout.write(JSON.stringify({ version: "v1" }));', "utf8");
		expect((await runMeldraCommandHook({ hook, cwd, input: hookInput })).output).toEqual({ version: "v1" });

		writeFileSync(scriptPath, 'process.stdout.write(JSON.stringify({ version: "v2" }));', "utf8");
		expect((await runMeldraCommandHook({ hook, cwd, input: hookInput })).output).toEqual({ version: "v2" });
	});

	it("blocks through the Native Pi tool adapter", async () => {
		const cwd = workspace();
		const handler = {
			type: "command" as const,
			command: process.execPath,
			args: [join(examplesDir, "block-destructive-commands.mjs")],
		};
		const config = resolveHooksRuntimeConfig(
			{ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler] }] } },
			{},
			cwd,
		);
		const extensions = await createTestExtensionsResult([createMeldraHooksExtension(() => config)], cwd);
		const modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
		const runner = new ExtensionRunner(
			extensions.extensions,
			extensions.runtime,
			cwd,
			SessionManager.inMemory(),
			modelRegistry,
		);

		const result = await runner.emitToolCall({
			type: "tool_call",
			toolName: "bash",
			toolCallId: "native-example",
			input: { command: "git reset --hard HEAD~1" },
		});
		expect(result).toMatchObject({ block: true, reason: MELDRA_HOOK_TOOL_BLOCK_MESSAGE });
	});

	it("denies through the DSH tools/pre-execute adapter", async () => {
		const cwd = workspace();
		const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
		let service: MeldraDshHooksService | undefined;
		apply({
			provide: vi.fn((name: string, value: MeldraDshHooksService) => {
				if (name === "meldraHooks") service = value;
				return vi.fn();
			}),
			on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
				handlers.set(event, [...(handlers.get(event) ?? []), listener]);
				return vi.fn();
			}),
		} as never);
		if (!service) throw new Error("Meldra Hooks service was not registered");
		service.configure({
			cwd,
			hooks: resolveMeldraHooks([
				{
					source: "project",
					hooks: {
						PreToolUse: [
							{
								matcher: "Bash",
								hooks: [
									{
										type: "command",
										command: process.execPath,
										args: [join(examplesDir, "block-destructive-commands.mjs")],
									},
								],
							},
						],
					},
				},
			]),
		});
		const toolHandler = handlers.get("tools/pre-execute")?.[0];
		const decision = await toolHandler?.(
			{
				agent: { id: "dsh-example" },
				name: "bash",
				arguments: { command: "rm -rf build" },
				callId: "dsh-call",
				signal: new AbortController().signal,
			},
			async () => ({ kind: "allow" }),
		);
		expect(decision).toEqual({ kind: "deny", reason: MELDRA_HOOK_TOOL_BLOCK_MESSAGE });
	});

	it.each([
		"rm -rf build",
		"git reset --hard HEAD~1",
		"git clean -fdx",
		"git push origin main --force",
		"Remove-Item build -Recurse -Force",
	])("blocks a destructive shell command: %s", async (command) => {
		const cwd = workspace();
		const result = await runMeldraCommandHook({
			hook: exampleHook("block-destructive-commands.mjs"),
			cwd,
			input: input(cwd, { tool_name: "Bash", tool_input: { command }, tool_use_id: "shell-1" }),
		});
		expect(result.status).toBe("block");
		expect(result.stderr).toContain("Blocked by example Hook");
	});

	it("allows an ordinary shell command", async () => {
		const cwd = workspace();
		const result = await runMeldraCommandHook({
			hook: exampleHook("block-destructive-commands.mjs"),
			cwd,
			input: input(cwd, {
				tool_name: "Bash",
				tool_input: { command: "npm test" },
				tool_use_id: "shell-safe",
			}),
		});
		expect(result.status).toBe("success");
	});

	it.each([".env", ".env.local", ".git/config"])("blocks a protected write path: %s", async (path) => {
		const cwd = workspace();
		const result = await runMeldraCommandHook({
			hook: exampleHook("protect-sensitive-paths.mjs"),
			cwd,
			input: input(cwd, { tool_name: "Write", tool_input: { path }, tool_use_id: "write-1" }),
		});
		expect(result.status).toBe("block");
	});

	it.each(["src/index.ts", ".env.example"])("allows an ordinary write path: %s", async (path) => {
		const cwd = workspace();
		const result = await runMeldraCommandHook({
			hook: exampleHook("protect-sensitive-paths.mjs"),
			cwd,
			input: input(cwd, { tool_name: "Write", tool_input: { path }, tool_use_id: "write-safe" }),
		});
		expect(result.status).toBe("success");
	});

	it("previews the opt-in Rickroll Hook without opening a browser", async () => {
		const cwd = workspace();
		const settings = JSON.parse(readFileSync(join(examplesDir, "rickroll.settings.example.json"), "utf8")) as {
			hooks: unknown;
		};
		const resolved = resolveMeldraHooks([{ source: "project", hooks: settings.hooks }]);
		expect(resolved.diagnostics).toEqual([]);
		expect(resolved.events.AgentEnd).toHaveLength(1);

		const result = await runMeldraCommandHook({
			hook: exampleHook("rickroll-on-agent-end.mjs", ["--dry-run"]),
			cwd,
			input: input(cwd, { hook_event_name: "AgentEnd" }),
		});
		expect(result.status).toBe("success");
		expect(result.output).toEqual({
			url: "https://www.bilibili.com/video/BV1UT42167xb/?autoplay=1",
			autoplayMayBeBlocked: true,
		});
	});

	it("writes a minimal audit row without payload bodies", async () => {
		const cwd = workspace();
		const logPath = join(cwd, ".pi", "hooks", "events.jsonl");
		const result = await runMeldraCommandHook({
			hook: exampleHook("audit-hook-events.mjs", ["${MELDRA_PROJECT_DIR}/.pi/hooks/events.jsonl"]),
			cwd,
			input: input(cwd, {
				hook_event_name: "PostToolUse",
				tool_name: "Bash",
				tool_input: { command: "echo secret-input" },
				tool_use_id: "call-7",
				tool_response: [{ type: "text", text: "secret-output" }],
			}),
		});
		expect(result.status).toBe("success");
		const raw = readFileSync(logPath, "utf8");
		expect(raw).not.toContain("secret-input");
		expect(raw).not.toContain("secret-output");
		expect(JSON.parse(raw)).toMatchObject({
			hook_event_name: "PostToolUse",
			session_id: "example-session",
			cwd,
			tool_name: "Bash",
			tool_use_id: "call-7",
		});
	});
});
