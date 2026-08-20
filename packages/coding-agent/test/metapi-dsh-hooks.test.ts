import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, type MeldraDshHooksService } from "../src/extensions/dsh/hooks.ts";
import { type MeldraHooksRuntimeConfig, resolveMeldraHooks } from "../src/hooks/index.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(preDecision: "deny" | "ask" = "deny") {
	const cwd = mkdtempSync(join(tmpdir(), "meldra-hooks-dsh-"));
	dirs.push(cwd);
	const script = join(cwd, "hook.mjs");
	writeFileSync(
		script,
		`let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => {
 const input=JSON.parse(data);
 if(input.hook_event_name==="PreToolUse"){
  if(${JSON.stringify(preDecision)}==="ask") process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:"ask"}}));
  else {process.stderr.write("DSH denied");process.exit(2);}
 }
 if(input.hook_event_name==="PostToolUse")process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:"review the result"}}));
 if(input.hook_event_name==="Stop"){process.stderr.write("continue working");process.exit(2);}
});`,
		"utf8",
	);
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
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
	const hook = { type: "command" as const, command: process.execPath, args: [script] };
	const config: MeldraHooksRuntimeConfig = {
		cwd,
		hooks: resolveMeldraHooks([
			{
				source: "profile",
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [hook] }],
					PostToolUse: [{ matcher: "Bash", hooks: [hook] }],
					Stop: [{ hooks: [hook] }],
				},
			},
		]),
	};
	service?.configure(config);
	const agent = { id: "session-1", steer: vi.fn() };
	return { handlers, agent };
}

describe("Meldra hooks DSH adapter", () => {
	it("denies a tool through tools/pre-execute", async () => {
		const { handlers, agent } = setup();
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
		expect(decision).toEqual({ kind: "deny", reason: "DSH denied" });
	});

	it("preserves an ask decision without a reason", async () => {
		const { handlers, agent } = setup("ask");
		const handler = handlers.get("tools/pre-execute")?.[0];
		const decision = await handler?.(
			{ agent, name: "bash", arguments: {}, callId: "call-ask", signal: new AbortController().signal },
			async () => ({ kind: "allow" }),
		);
		expect(decision).toEqual({ kind: "ask" });
	});

	it("adds model context after a successful tool and steers on blocked Stop", async () => {
		const { handlers, agent } = setup();
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
		expect(decision.kind).toBe("accept");
		expect(decision.additionalContexts?.[0].content[0]).toEqual({ type: "text", text: "review the result" });

		const stop = handlers.get("agent/turn-stopping")?.[0];
		await stop?.({ agent, turn: 1, signal: new AbortController().signal });
		expect(agent.steer).toHaveBeenCalledOnce();
	});
});
