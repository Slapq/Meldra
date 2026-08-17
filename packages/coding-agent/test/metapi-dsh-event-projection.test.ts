import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import type { ProfileAgentRuntimeHost } from "../src/core/profile-agent-runtime.ts";
import { DSH_MESSAGE_ENTRY, DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";

interface RuntimeStateStub {
	sessionId: string;
}

type FrameReceiver = (active: RuntimeStateStub, payload: Record<string, unknown>) => void;

function sessionEvent(event: Record<string, unknown>, view?: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "session/event",
		sessionId: "session-1",
		event,
		...(view ? { view } : {}),
	};
}

function createRuntime() {
	const emitted: AgentSessionEvent[] = [];
	const appended: Array<{
		customType: string;
		data: unknown;
		options?: { notify?: boolean };
	}> = [];
	const runtime = new DshProfileRuntime({
		cwd: "/tmp/dsh-events",
		agentDir: "/tmp/dsh-events/agent",
		modelRuntime: {} as ModelRuntime,
	});
	const host: ProfileAgentRuntimeHost = {
		cwd: "/tmp/dsh-events",
		sessionId: "pi-session",
		appendEntry: (customType, data, options) => appended.push({ customType, data, options }),
		emit: (event) => emitted.push(event),
	};
	runtime.attach(host);
	const receive = (runtime as unknown as { handleRuntimeFrame: FrameReceiver }).handleRuntimeFrame.bind(runtime);
	const active = { sessionId: "session-1" };
	return { runtime, receive, active, emitted, appended };
}

describe("DSH event projection", () => {
	it("persists only authoritative human user messages", () => {
		const state = createRuntime();
		state.receive(
			state.active,
			sessionEvent({
				type: "user/message",
				data: {
					id: "user-1",
					source: { kind: "user", rpcId: "prompt-1" },
					content: [
						{ type: "text", text: "Inspect this image" },
						{ type: "image", attachment: { attachmentId: "image-1" } },
					],
				},
			}),
		);
		for (const [kind, id] of [
			["agent-instructions", "context-1"],
			["plugin", "context-2"],
		] as const) {
			state.receive(
				state.active,
				sessionEvent({
					type: "user/message",
					data: {
						id,
						source: { kind },
						content: [{ type: "text", text: "internal context" }],
					},
				}),
			);
		}

		expect(state.appended).toEqual([
			{
				customType: DSH_MESSAGE_ENTRY,
				data: { kind: "user", text: "Inspect this image\n[1 image]" },
				options: { notify: true },
			},
		]);
		expect(JSON.stringify(state.appended)).not.toContain("internal context");
	});

	it("projects streaming text, reasoning, tools, results, provenance, and usage into Pi UI events", () => {
		const state = createRuntime();
		state.receive(
			state.active,
			sessionEvent({
				type: "assistant/chunk",
				data: { chunk: { type: "text-delta", index: 0, text: "Hello" } },
			}),
		);
		state.receive(
			state.active,
			sessionEvent({
				type: "assistant/chunk",
				data: {
					chunk: { type: "reasoning-delta", index: 1, text: "Check context" },
				},
			}),
		);
		state.receive(
			state.active,
			sessionEvent({
				type: "assistant/chunk",
				data: {
					chunk: {
						type: "tool-call-delta",
						index: 2,
						id: "call-1",
						name: "pwsh",
						argumentsDelta: '{"command":"Get-',
					},
				},
			}),
		);
		state.receive(
			state.active,
			sessionEvent({
				type: "assistant/chunk",
				data: {
					chunk: {
						type: "tool-call-delta",
						index: 2,
						id: "call-1",
						argumentsDelta: 'Location"}',
					},
				},
			}),
		);
		state.receive(
			state.active,
			sessionEvent(
				{
					type: "tool/call",
					time: 2_000,
					data: {
						callId: "call-1",
						name: "pwsh",
						arguments: '{"command":"Get-Location"}',
					},
				},
				{
					for: "call",
					view: {
						card: "terminal",
						title: "Get-Location",
						description: "Inspect current directory",
						cwd: "C:/work",
					},
				},
			),
		);
		state.receive(
			state.active,
			sessionEvent(
				{
					type: "tool/result",
					time: 2_042,
					data: {
						message: {
							source: { kind: "tool", callId: "call-1" },
							content: [
								{
									type: "tool-result",
									toolCallId: "call-1",
									content: [{ type: "text", text: "C:/work" }],
								},
							],
						},
						meta: { exitCode: 0 },
					},
				},
				{
					for: "result",
					view: { card: "terminal", output: "C:/work", exitCode: 0 },
				},
			),
		);
		state.receive(
			state.active,
			sessionEvent({
				type: "assistant/message",
				data: {
					message: {
						role: "assistant",
						source: {
							kind: "model",
							provider: "deepseek-official",
							model: "deepseek-v4-flash",
						},
						content: [
							{ type: "text", text: "Hello from Harness" },
							{ type: "reasoning", text: "Check context" },
						],
					},
					usage: {
						inputTokens: 10,
						outputTokens: 4,
						cacheReadTokens: 6,
						reasoningTokens: 2,
					},
				},
			}),
		);

		expect(state.emitted.map((event) => event.type)).toEqual([
			"message_start",
			"message_update",
			"message_update",
			"message_update",
			"message_update",
			"tool_execution_start",
			"tool_execution_end",
			"message_end",
		]);
		const lastUpdate = [...state.emitted]
			.reverse()
			.find(
				(event): event is Extract<AgentSessionEvent, { type: "message_update" }> => event.type === "message_update",
			);
		expect(lastUpdate?.message.role === "assistant" ? lastUpdate.message.content : []).toContainEqual({
			type: "toolCall",
			id: "call-1",
			name: "pwsh",
			arguments: { command: "Get-Location" },
		});
		const toolStart = state.emitted.find((event) => event.type === "tool_execution_start");
		expect(toolStart).toMatchObject({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "pwsh",
			args: { command: "Get-Location" },
		});
		const toolEnd = state.emitted.find((event) => event.type === "tool_execution_end");
		expect(toolEnd).toMatchObject({
			type: "tool_execution_end",
			result: {
				content: [{ type: "text", text: "C:/work" }],
				details: {
					durationMs: 42,
					exitCode: 0,
					profilePresentation: {
						kind: "terminal",
						title: "Get-Location",
						description: "Inspect current directory",
						cwd: "C:/work",
						output: "C:/work",
						exitCode: 0,
					},
				},
			},
			isError: false,
		});
		const messageEnd = state.emitted.at(-1);
		expect(messageEnd?.type === "message_end" ? messageEnd.message : undefined).toMatchObject({
			provider: "deepseek-official",
			model: "deepseek-v4-flash",
			content: [
				{ type: "text", text: "Hello from Harness" },
				{ type: "thinking", thinking: "Check context" },
			],
			usage: {
				input: 10,
				output: 4,
				cacheRead: 6,
				reasoning: 2,
				totalTokens: 20,
			},
			stopReason: "stop",
		});
		expect(state.appended).toEqual([
			{
				customType: DSH_MESSAGE_ENTRY,
				data: { kind: "assistant", text: "Hello from Harness" },
				options: { notify: false },
			},
		]);
		expect(state.runtime.getLastAssistantText()).toBe("Hello from Harness");
	});

	it("normalizes native web search and fetch result views", () => {
		const state = createRuntime();
		for (const [callId, name, view] of [
			[
				"web-search-1",
				"web_search",
				{
					card: "web",
					kind: "search",
					title: "Search web",
					answer: "Native answer",
					sources: [
						{
							url: "https://example.test/result",
							title: "Example",
							snippet: "Excerpt",
						},
					],
					truncated: true,
				},
			],
			[
				"web-fetch-1",
				"web_fetch",
				{
					card: "web",
					kind: "fetch",
					title: "Fetch page",
					url: "https://example.test/page",
					statusCode: 200,
					truncated: false,
				},
			],
		] as const) {
			state.receive(
				state.active,
				sessionEvent({
					type: "tool/call",
					time: 1_000,
					data: { callId, name, arguments: "{}" },
				}),
			);
			state.receive(
				state.active,
				sessionEvent(
					{
						type: "tool/result",
						time: 1_100,
						data: {
							message: {
								source: { kind: "tool", callId },
								content: [],
							},
						},
					},
					{ for: "result", view },
				),
			);
		}

		const ends = state.emitted.filter((event) => event.type === "tool_execution_end");
		expect(ends[0]).toMatchObject({
			result: {
				details: {
					profilePresentation: {
						kind: "web-search",
						answer: "Native answer",
						sources: [{ url: "https://example.test/result" }],
						truncated: true,
					},
				},
			},
		});
		expect(ends[1]).toMatchObject({
			result: {
				details: {
					profilePresentation: {
						kind: "web-fetch",
						url: "https://example.test/page",
						statusCode: 200,
						truncated: false,
					},
				},
			},
		});
	});

	it("keeps raw error output when no result presentation is available", () => {
		const state = createRuntime();
		state.receive(
			state.active,
			sessionEvent(
				{
					type: "tool/call",
					time: 1_000,
					data: {
						callId: "call-error",
						name: "edit",
						arguments: "{}",
					},
				},
				{
					for: "call",
					view: {
						card: "diff",
						title: "Edit file",
						diffs: [{ path: "a.ts", oldText: "old", newText: "new" }],
					},
				},
			),
		);
		state.receive(
			state.active,
			sessionEvent({
				type: "tool/result",
				time: 1_010,
				data: {
					message: {
						source: { kind: "tool", callId: "call-error" },
						content: [
							{
								type: "tool-result",
								isError: true,
								content: [{ type: "text", text: "edit failed" }],
							},
						],
					},
				},
			}),
		);

		const toolEnd = state.emitted.find((event) => event.type === "tool_execution_end");
		expect(toolEnd).toMatchObject({
			type: "tool_execution_end",
			result: {
				content: [{ type: "text", text: "edit failed" }],
				details: { durationMs: 10 },
			},
			isError: true,
		});
	});

	it("ignores frames for another DSH Session", () => {
		const state = createRuntime();
		state.receive(state.active, {
			...sessionEvent({
				type: "assistant/chunk",
				data: { chunk: { type: "text-delta", index: 0, text: "x" } },
			}),
			sessionId: "other",
		});
		expect(state.emitted).toEqual([]);
		expect(state.appended).toEqual([]);
	});
});
