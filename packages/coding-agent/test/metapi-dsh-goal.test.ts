import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";

interface GoalRuntimeInternals {
	runtime: {
		harness: {
			client: { request(method: string, params?: Record<string, unknown>): Promise<unknown> };
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
	const internals = runtime as unknown as GoalRuntimeInternals;
	internals.runtime = {
		harness: {
			client: {
				request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
					if (method === "metapi/commands.list")
						return [
							{
								name: "compact",
								description: "Compact history",
							},
						];
					if (method === "metapi/plugin-inventory.list")
						return {
							entries: [
								{
									entryId: "session-stats",
									moduleName: "@deepseek-ai/dsh-session-stats",
									enabled: true,
									fiberPhase: "active",
								},
							],
						};
					if (method === "metapi/message-feedback.call")
						return params?.method === "list"
							? { ok: true, value: { items: [] } }
							: {
									ok: true,
									value: { messageId: "message-1", version: "version-1" },
								};
				}),
			},
			close: vi.fn(async () => undefined),
		},
		sessionId: "goal-session",
		eventCursors: new Map(),
		eventTasks: [],
	};
	internals.call = vi.fn(async (method: string) => ({
		result: {
			ok: true,
			value:
				method === "session.history"
					? {
							events: [],
							hasMore: false,
							projections: {
								asOfSeq: 4,
								values: { goal: { goal: { id: "goal-1", revision: 2 } } },
							},
						}
					: method === "skill.list"
						? {
								skills: [
									{
										name: "review",
										description: "Review",
										modelInvocable: true,
									},
								],
							}
						: method === "session.attachment"
							? {
									attachment: {
										attachmentId: "image-1",
										mediaType: "image/png",
									},
									data: "base64",
								}
							: method === "settings.describe"
								? {
										writable: true,
										hasDocument: true,
										namespaces: [{ ns: "agent-spine", revision: 1 }],
									}
								: method === "settings.mutate"
									? { ns: "web-search-deepseek", revision: 2, applies: "live" }
									: method === "credentials.describe"
										? {
												credentials: {
													DEEPSEEK_API_KEY: {
														configured: true,
														writable: true,
													},
												},
											}
										: method === "llm.providers"
											? {
													providers: [
														{
															provider: "deepseek-official",
															settingsNs: "llm-deepseek",
														},
													],
												}
											: method === "session.prompt"
												? {
														accepted: true,
														command: {
															kind: "success",
															text: "Plan mode off.",
														},
													}
												: method === "goal.clear"
													? { cleared: true }
													: { ref: { id: "goal-1", revision: 3 } },
		},
	}));
	return { runtime, call: internals.call };
}

describe("DSH Goal and projection ApiProxy wiring", () => {
	it("reads the tail projection baseline and preserves Goal CAS payloads", async () => {
		const { runtime, call } = createRuntime();
		const ref = { id: "goal-1", revision: 2 };

		expect(await runtime.projections()).toEqual({
			goal: { goal: { id: "goal-1", revision: 2 } },
		});
		expect(await runtime.skills()).toEqual([{ name: "review", description: "Review", modelInvocable: true }]);
		expect(await runtime.commands()).toEqual([{ name: "compact", description: "Compact history" }]);
		expect(await runtime.attachment("image-1")).toEqual({
			attachment: { attachmentId: "image-1", mediaType: "image/png" },
			data: "base64",
		});
		expect(await runtime.plugins()).toEqual([
			{
				entryId: "session-stats",
				moduleName: "@deepseek-ai/dsh-session-stats",
				enabled: true,
				fiberPhase: "active",
			},
		]);
		expect(await runtime.listMessageFeedback()).toEqual({
			ok: true,
			value: { items: [] },
		});
		expect(await runtime.putMessageFeedback("message-1", "positive", "Useful", null)).toEqual({
			ok: true,
			value: { messageId: "message-1", version: "version-1" },
		});
		expect(await runtime.settings()).toEqual({
			writable: true,
			hasDocument: true,
			namespaces: [{ ns: "agent-spine", revision: 1 }],
		});
		expect(
			await runtime.mutateSettings("web-search-deepseek", [{ op: "set", path: ["apiKey"], value: "secret" }], 1),
		).toEqual({ ns: "web-search-deepseek", revision: 2, applies: "live" });
		expect(await runtime.describeCredentials(["DEEPSEEK_API_KEY"])).toEqual({
			DEEPSEEK_API_KEY: { configured: true, writable: true },
		});
		await runtime.setCredential("DEEPSEEK_API_KEY", "secret");
		await runtime.unsetCredential("DEEPSEEK_API_KEY");
		expect(await runtime.providers()).toEqual([{ provider: "deepseek-official", settingsNs: "llm-deepseek" }]);
		expect(await runtime.executeCommand("/plan off")).toEqual({
			accepted: true,
			command: { kind: "success", text: "Plan mode off." },
		});
		await runtime.createGoal("Ship", 12);
		await runtime.createGoal("Use default");
		await runtime.mutateGoal("edit", ref, {
			objective: "Ship well",
			maxGoalRounds: 16,
		});
		await runtime.mutateGoal("pause", ref);
		await runtime.mutateGoal("resume", ref);
		await runtime.mutateGoal("complete", ref);
		await runtime.mutateGoal("clear", ref);

		expect(call.mock.calls).toEqual([
			["session.history", { sessionId: "goal-session", maxMessages: 1 }],
			["skill.list", { sessionId: "goal-session" }],
			["session.attachment", { sessionId: "goal-session", attachmentId: "image-1" }],
			["settings.describe", {}],
			[
				"settings.mutate",
				{
					ns: "web-search-deepseek",
					ops: [{ op: "set", path: ["apiKey"], value: "secret" }],
					expectedRevision: 1,
				},
			],
			["credentials.describe", { refs: ["DEEPSEEK_API_KEY"] }],
			["credentials.set", { ref: "DEEPSEEK_API_KEY", value: "secret" }],
			["credentials.unset", { ref: "DEEPSEEK_API_KEY" }],
			["llm.providers", {}],
			[
				"session.prompt",
				{
					sessionId: "goal-session",
					mode: "queue",
					content: [{ type: "text", text: "/plan off" }],
				},
			],
			["goal.create", { sessionId: "goal-session", objective: "Ship", maxGoalRounds: 12 }],
			["goal.create", { sessionId: "goal-session", objective: "Use default" }],
			[
				"goal.edit",
				{
					sessionId: "goal-session",
					ref,
					objective: "Ship well",
					maxGoalRounds: 16,
				},
			],
			["goal.pause", { sessionId: "goal-session", ref }],
			["goal.resume", { sessionId: "goal-session", ref }],
			["goal.complete", { sessionId: "goal-session", ref }],
			["goal.clear", { sessionId: "goal-session", ref }],
		]);
	});
});
