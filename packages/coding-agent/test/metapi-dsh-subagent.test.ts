import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { DshProfileRuntime } from "../src/meldra/dsh-profile-runtime.ts";

interface SubagentRuntimeInternals {
	runtime: {
		harness: {
			client: { request(): Promise<unknown> };
			close(): Promise<void>;
		};
		sessionId: string;
		eventCursors: Map<"mux" | "host", string>;
		eventTasks: Promise<void>[];
	};
	call: ReturnType<typeof vi.fn>;
}

function createRuntime() {
	const runtime = new DshProfileRuntime({
		cwd: "C:/work",
		agentDir: "C:/profile/agent",
		modelRuntime: {} as ModelRuntime,
	});
	const internals = runtime as unknown as SubagentRuntimeInternals;
	internals.runtime = {
		harness: {
			client: { request: vi.fn(async () => undefined) },
			close: vi.fn(async () => undefined),
		},
		sessionId: "parent-session",
		eventCursors: new Map(),
		eventTasks: [],
	};
	internals.call = vi.fn(async (method: string) => ({
		result: {
			ok: true,
			value:
				method === "subagent.list"
					? {
							entries: [
								{
									kind: "child",
									id: "child-session",
									mode: "continuable",
									label: "Research",
									activity: "inactive",
									hasChildren: false,
								},
							],
							parentAvailable: false,
						}
					: method === "subagent.history"
						? { events: [], hasMore: false }
						: method === "subagent.prompt"
							? { messageId: "message-1" }
							: { accepted: true },
		},
	}));
	return { runtime, call: internals.call };
}

describe("DSH Subagent ApiProxy wiring", () => {
	it("preserves native direct-parent addresses and continuable mode", async () => {
		const { runtime, call } = createRuntime();

		expect(await runtime.subagents()).toEqual({
			entries: [
				{
					kind: "child",
					id: "child-session",
					mode: "continuable",
					label: "Research",
					activity: "inactive",
					hasChildren: false,
				},
			],
			parentAvailable: false,
		});
		await runtime.subagentHistory("child-session", "one-shot", 42);
		expect(await runtime.promptSubagent("child-session", "Continue")).toEqual({
			messageId: "message-1",
		});
		await runtime.interruptSubagent("child-session");

		expect(call.mock.calls).toEqual([
			["subagent.list", { parentSessionId: "parent-session" }],
			[
				"subagent.history",
				{
					parentSessionId: "parent-session",
					childSessionId: "child-session",
					mode: "one-shot",
					beforeSeq: 42,
				},
			],
			[
				"subagent.prompt",
				{
					parentSessionId: "parent-session",
					childSessionId: "child-session",
					mode: "continuable",
					content: [{ type: "text", text: "Continue" }],
				},
			],
			[
				"subagent.interrupt",
				{
					parentSessionId: "parent-session",
					childSessionId: "child-session",
					mode: "continuable",
				},
			],
		]);
	});
});
