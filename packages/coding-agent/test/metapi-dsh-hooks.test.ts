import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, type MeldraDshHookDiagnostic, type MeldraDshHooksService } from "../src/extensions/dsh/hooks.ts";
import {
	MELDRA_HOOK_CONTINUATION_MESSAGE,
	MELDRA_HOOK_TOOL_BLOCK_MESSAGE,
	type MeldraHooksRuntimeConfig,
	resolveMeldraHooks,
} from "../src/hooks/index.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(
	preDecision: "deny" | "ask" | "updated" | "error" | "lifecycle-block" = "deny",
	disabled = false,
) {
	const cwd = mkdtempSync(join(tmpdir(), "meldra-hooks-dsh-"));
	dirs.push(cwd);
	const script = join(cwd, "hook.mjs");
	writeFileSync(
		script,
		`import { appendFileSync, writeFileSync } from "node:fs";
let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => {
 const input=JSON.parse(data);
 if(input.hook_event_name==="AgentStart" && ${JSON.stringify(preDecision)}==="lifecycle-block"){process.stderr.write("cannot undo start");process.exit(2);}
 if(input.hook_event_name==="PreToolUse"){
  if(${JSON.stringify(preDecision)}==="ask") process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:"ask"}}));
  else if(${JSON.stringify(preDecision)}==="updated") process.stdout.write(JSON.stringify({hookSpecificOutput:{updatedInput:{command:"changed"}}}));
  else if(${JSON.stringify(preDecision)}==="error") {process.stderr.write("DSH hook failed");process.exit(1);}
  else {process.stderr.write("DSH denied");process.exit(2);}
 }
 if(input.hook_event_name==="PostToolUse")process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:"review the result"}}));
 if(input.hook_event_name==="Stop"){process.stderr.write("continue working");process.exit(2);}
 if(input.hook_event_name==="SessionEnd")setTimeout(() => writeFileSync(input.cwd + "/session-end.txt", "done"), 30);
 if(["AgentStart","AgentEnd","TurnStart","TurnEnd"].includes(input.hook_event_name))appendFileSync(input.cwd + "/lifecycle.jsonl", JSON.stringify(input) + "\\n");
});`,
		"utf8",
	);
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const diagnostics: MeldraDshHookDiagnostic[] = [];
	let service: MeldraDshHooksService | undefined;
	const ctx = {
		provide: vi.fn((name: string, value: MeldraDshHooksService) => {
			if (name === "meldraHooks") service = value;
			return vi.fn();
		}),
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return vi.fn();
		}),
	};
	apply(ctx as never);
	const hook = {
		type: "command" as const,
		command: process.execPath,
		args: [script],
		...(disabled ? { disabled: true } : {}),
	};
	const config: MeldraHooksRuntimeConfig = {
		cwd,
		hooks: resolveMeldraHooks([
			{
				source: "profile",
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [hook] }],
					PostToolUse: [{ matcher: "Bash", hooks: [hook] }],
					AgentStart: [{ hooks: [hook] }],
					AgentEnd: [{ hooks: [hook] }],
					TurnStart: [{ hooks: [hook] }],
					TurnEnd: [{ hooks: [hook] }],
					Stop: [{ hooks: [hook] }],
					SessionEnd: [{ hooks: [hook] }],
				},
			},
		]),
	};
	service?.configure(config);
	service?.subscribeDiagnostics((diagnostic) => diagnostics.push(diagnostic));
	const session = {};
	const agent = { id: "session-1", session, steer: vi.fn() };
	if (!service) throw new Error("Meldra Hooks service was not registered");
	return { handlers, agent, session, service, diagnostics, cwd };
}

describe("Meldra hooks DSH adapter", () => {
	it("denies a tool through tools/pre-execute", async () => {
		const { handlers, agent, diagnostics } = setup();
		const handler = handlers.get("tools/pre-execute")?.[0];
		const decision = await handler?.(
			{
				agent,
				name: "bash",
				arguments: { command: "rm -rf build" },
				callId: "call-1",
				signal: new AbortController().signal,
			},
			async () => ({ kind: "allow" }),
		);
		expect(decision).toEqual({ kind: "deny", reason: MELDRA_HOOK_TOOL_BLOCK_MESSAGE });
		expect(diagnostics).toContainEqual({ message: "PreToolUse blocked: DSH denied" });
	});

	it("does not execute disabled handlers", async () => {
		const { handlers, agent } = setup("deny", true);
		const handler = handlers.get("tools/pre-execute")?.[0];
		const next = vi.fn(async () => ({ kind: "allow" as const }));
		const decision = await handler?.(
			{
				agent,
				name: "bash",
				arguments: { command: "rm -rf build" },
				callId: "call-disabled",
				signal: new AbortController().signal,
			},
			next,
		);
		expect(decision).toEqual({ kind: "allow" });
		expect(next).toHaveBeenCalledOnce();
	});

	it("preserves an ask decision without a reason", async () => {
		const { handlers, agent } = setup("ask");
		const handler = handlers.get("tools/pre-execute")?.[0];
		const next = vi.fn(async () => ({ kind: "allow" }));
		const decision = await handler?.(
			{ agent, name: "bash", arguments: {}, callId: "call-ask", signal: new AbortController().signal },
			next,
		);
		expect(decision).toEqual({ kind: "ask" });
		expect(next).toHaveBeenCalledOnce();
	});

	it("preserves a downstream denial when a Hook asks", async () => {
		const { handlers, agent } = setup("ask");
		const handler = handlers.get("tools/pre-execute")?.[0];
		const decision = await handler?.(
			{ agent, name: "bash", arguments: {}, callId: "call-deny", signal: new AbortController().signal },
			async () => ({ kind: "deny", reason: "runtime policy" }),
		);
		expect(decision).toEqual({ kind: "deny", reason: "runtime policy" });
	});

	it("reports non-blocking errors and unsupported updatedInput", async () => {
		const failed = setup("error");
		const failedHandler = failed.handlers.get("tools/pre-execute")?.[0];
		await failedHandler?.(
			{
				agent: failed.agent,
				name: "bash",
				arguments: {},
				callId: "call-error",
				signal: new AbortController().signal,
			},
			async () => ({ kind: "allow" }),
		);
		expect(failed.diagnostics[0]?.message).toContain("DSH hook failed");

		const updated = setup("updated");
		const updatedHandler = updated.handlers.get("tools/pre-execute")?.[0];
		await updatedHandler?.(
			{
				agent: updated.agent,
				name: "bash",
				arguments: {},
				callId: "call-updated",
				signal: new AbortController().signal,
			},
			async () => ({ kind: "allow" }),
		);
		expect(updated.diagnostics).toContainEqual({
			message: "DSH does not support PreToolUse updatedInput; immutable arguments were preserved",
		});
	});

	it("maps DSH agent status and model steps to ordered lifecycle Hooks", async () => {
		const { handlers, agent, session, service, cwd } = setup();
		handlers.get("agent/session-start")?.[0]?.({ agent, source: "startup" });
		handlers.get("agent/status")?.[0]?.({ agent, status: "running" });
		handlers.get("session/event")?.[0]?.(session, {
			type: "step/start",
			seq: 1,
			time: 1000,
			data: { turn: 3, step: 1 },
		});
		handlers.get("session/event")?.[0]?.(session, {
			type: "step/end",
			seq: 2,
			time: 1200,
			data: { turn: 3, step: 1 },
		});
		handlers.get("agent/status")?.[0]?.({ agent, status: "idle" });
		await service.drain();

		const events = readFileSync(join(cwd, "lifecycle.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(events.map((event) => event.hook_event_name)).toEqual([
			"AgentStart",
			"TurnStart",
			"TurnEnd",
			"AgentEnd",
		]);
		expect(events[1]).toMatchObject({
			turn_index: 0,
			timestamp: 1000,
			runtime_turn: 3,
			runtime_step: 1,
		});
		expect(events[2]).toMatchObject({
			turn_index: 0,
			timestamp: 1200,
			runtime_turn: 3,
			runtime_step: 1,
		});
	});

	it("warns when a notification-only lifecycle Hook tries to block", async () => {
		const { handlers, agent, service, diagnostics } = setup("lifecycle-block");
		handlers.get("agent/status")?.[0]?.({ agent, status: "running" });
		await service.drain();
		expect(diagnostics).toContainEqual({
			message: "AgentStart is notification-only; block ignored: cannot undo start",
		});
	});

	it("starts and drains SessionEnd Hooks before service shutdown", async () => {
		const { handlers, agent, service, cwd } = setup();
		const started = handlers.get("agent/session-start")?.[0];
		started?.({ agent, source: "startup" });
		await service.shutdown();
		await service.drain();
		expect(existsSync(join(cwd, "session-end.txt"))).toBe(true);
	});

	it("keeps post-tool output out of model context and uses a fixed continuation control", async () => {
		const { handlers, agent, diagnostics } = setup();
		const post = handlers.get("tools/post-execute")?.[0];
		const decision = await post?.(
			{
				agent,
				name: "bash",
				arguments: { command: "npm test" },
				callId: "call-2",
				signal: new AbortController().signal,
			},
			{ isError: false, content: [{ type: "text", text: "ok" }], value: null },
			async () => ({ kind: "accept" }),
		);
		expect(decision).toEqual({ kind: "accept" });
		expect(diagnostics).toContainEqual({
			message: expect.stringContaining("additionalContext ignored; Hook output cannot enter Prompt"),
		});

		const stop = handlers.get("agent/turn-stopping")?.[0];
		await stop?.({ agent, turn: 1, signal: new AbortController().signal });
		expect(agent.steer).toHaveBeenCalledOnce();
		const continuation = agent.steer.mock.calls[0]?.[0] as { content?: Array<{ type: string; text?: string }> };
		expect(continuation.content).toEqual([{ type: "text", text: MELDRA_HOOK_CONTINUATION_MESSAGE }]);
		expect(JSON.stringify(continuation)).not.toContain("continue working");
	});
});
