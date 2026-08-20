import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createMeldraHooksExtension, resolveHooksRuntimeConfig } from "../src/extensions/meldra-hooks/index.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";
import { createTestExtensionsResult } from "./utilities.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function createRunner(source: string) {
	const cwd = mkdtempSync(join(tmpdir(), "meldra-hooks-native-"));
	dirs.push(cwd);
	const script = join(cwd, "hook.mjs");
	writeFileSync(script, source, "utf8");
	const handler = { type: "command" as const, command: process.execPath, args: [script] };
	const config = resolveHooksRuntimeConfig(
		{
			hooks: {
				UserPromptSubmit: [{ hooks: [handler] }],
				PreToolUse: [{ matcher: "Bash", hooks: [handler] }],
			},
		},
		{},
		cwd,
	);
	const result = await createTestExtensionsResult([createMeldraHooksExtension(() => config)], cwd);
	const modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
	return new ExtensionRunner(result.extensions, result.runtime, cwd, SessionManager.inMemory(), modelRegistry);
}

describe("Meldra hooks Native Pi adapter", () => {
	it("blocks user prompts from exit code 2", async () => {
		const runner = await createRunner(`
let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => {
  if (JSON.parse(data).hook_event_name === "UserPromptSubmit") { process.stderr.write("prompt denied"); process.exit(2); }
});`);
		expect(await runner.emitInput("do not run", undefined, "interactive")).toEqual({ action: "handled" });
	});

	it("emits Agent and Turn lifecycle events with portable indexes", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meldra-hooks-native-lifecycle-"));
		dirs.push(cwd);
		const script = join(cwd, "lifecycle.mjs");
		const log = join(cwd, "events.jsonl");
		writeFileSync(
			script,
			`import { appendFileSync } from "node:fs";
let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => appendFileSync(${JSON.stringify(log)}, data + "\\n"));`,
			"utf8",
		);
		const hook = { type: "command" as const, command: process.execPath, args: [script] };
		const config = resolveHooksRuntimeConfig(
			{
				hooks: {
					AgentStart: [{ hooks: [hook] }],
					AgentEnd: [{ hooks: [hook] }],
					TurnStart: [{ hooks: [hook] }],
					TurnEnd: [{ hooks: [hook] }],
				},
			},
			{},
			cwd,
		);
		const result = await createTestExtensionsResult([createMeldraHooksExtension(() => config)], cwd);
		const modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
		const runner = new ExtensionRunner(result.extensions, result.runtime, cwd, SessionManager.inMemory(), modelRegistry);

		await runner.emit({ type: "agent_start" });
		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: 1234 });
		await runner.emit({ type: "turn_end", turnIndex: 0, message: {} as never, toolResults: [] });
		await runner.emit({ type: "agent_end", messages: [] });

		const events = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(events.map((event) => event.hook_event_name)).toEqual([
			"AgentStart",
			"TurnStart",
			"TurnEnd",
			"AgentEnd",
		]);
		expect(events[1]).toMatchObject({ turn_index: 0, timestamp: 1234 });
		expect(events[2]).toMatchObject({ turn_index: 0, timestamp: expect.any(Number) });
	});

	it("applies structured updatedInput before native tool execution", async () => {
		const runner = await createRunner(`
let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => {
  if (JSON.parse(data).hook_event_name === "PreToolUse") process.stdout.write(JSON.stringify({hookSpecificOutput:{updatedInput:{command:"npm test"}}}));
});`);
		const input: Record<string, unknown> = { command: "npm publish" };
		const result = await runner.emitToolCall({
			type: "tool_call",
			toolName: "bash",
			toolCallId: "call-1",
			input,
		});
		expect(result).toBeUndefined();
		expect(input).toEqual({ command: "npm test" });
	});
});
