import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";

interface RuntimeInternals {
	runtime?: {
		harness: {
			client: { request: ReturnType<typeof vi.fn> };
			close: ReturnType<typeof vi.fn>;
		};
		sessionId: string;
		eventCursors: Map<"mux" | "host", string>;
		eventTasks: Promise<void>[];
	};
}

const selectedModel: Model<"openai-completions"> = {
	id: "local-chat",
	name: "Local Chat",
	api: "openai-completions",
	provider: "local-gateway",
	baseUrl: "http://127.0.0.1:11434/v1",
	reasoning: true,
	thinkingLevelMap: { high: "high", xhigh: null },
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 32_768,
	maxTokens: 4_096,
	headers: { "X-Model-Header": "configured" },
	compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true },
};

const responsesModel = {
	...selectedModel,
	id: "gpt-5.6-sol",
	name: "GPT 5.6 Sol",
	api: "openai-responses",
	provider: "CloseAI",
	compat: { thinkingFormat: "openai", supportsReasoningEffort: true },
} as unknown as Model<"openai-responses">;

const anthropicModel = {
	...selectedModel,
	id: "claude-custom",
	name: "Claude Custom",
	api: "anthropic-messages",
	provider: "AnthropicProxy",
	baseUrl: "http://127.0.0.1:3456/v1",
	compat: { thinkingFormat: "anthropic", supportsReasoningEffort: true },
} as unknown as Model<"anthropic-messages">;

function ok(value: unknown): { result: { ok: true; value: unknown } } {
	return { result: { ok: true, value } };
}

describe("DSH Meldra model bridge", () => {
	it("registers only the selected model, stores the credential by reference, and selects the route", async () => {
		const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
		const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
			expect(method).toBe("metapi/api.call");
			const callMethod = String(params?.method);
			const payload = (params?.payload ?? {}) as Record<string, unknown>;
			calls.push({ method: callMethod, payload });
			if (callMethod === "settings.describe") {
				return ok({
					writable: true,
					namespaces: [{ ns: "llm-pi-ai", revision: 7 }],
				});
			}
			if (callMethod === "settings.mutate") return ok({ ns: "llm-pi-ai", revision: 8 });
			if (callMethod === "credentials.set") return ok({ configured: true });
			if (callMethod === "session.selectModel") {
				return ok({ selected: { provider: selectedModel.provider, model: selectedModel.id } });
			}
			throw new Error(`Unexpected method: ${callMethod}`);
		});
		const modelRuntime = {
			getAuth: vi.fn(async () => ({
				auth: {
					apiKey: "test-secret-key",
					baseUrl: "http://127.0.0.1:2244/v1",
					headers: { "X-Auth-Header": "resolved" },
				},
			})),
			getCompatibilityRequestConfig: vi.fn(() => ({
				authHeader: true,
				headers: { "X-Model-Header": "configured" },
			})),
			getProvider: vi.fn(() => ({ name: "Local Gateway" })),
		} as unknown as ModelRuntime;
		const runtime = new DshProfileRuntime({ cwd: process.cwd(), agentDir: process.cwd(), modelRuntime });
		(runtime as unknown as RuntimeInternals).runtime = {
			harness: { client: { request }, close: vi.fn(async () => undefined) },
			sessionId: "bridge-session",
			eventCursors: new Map(),
			eventTasks: [],
		};

		await runtime.selectModel(selectedModel);

		expect(calls.map(({ method }) => method)).toEqual([
			"settings.describe",
			"settings.mutate",
			"credentials.set",
			"session.selectModel",
		]);
		const settingsPayload = calls[1].payload;
		expect(settingsPayload).toMatchObject({
			ns: "llm-pi-ai",
			expectedRevision: 7,
			ops: [
				{
					op: "set",
					path: ["providers", "local-gateway"],
					value: {
						displayName: "Local Gateway",
						api: "openai-completions",
						baseURL: "http://127.0.0.1:2244/v1",
						apiKeyEnv: expect.stringMatching(/^METAPI_MODEL_[A-F0-9]{16}$/),
						headers: {
							"X-Model-Header": "configured",
							"X-Auth-Header": "resolved",
						},
						models: [
							{
								id: "local-chat",
								name: "Local Chat",
								contextWindow: 32_768,
								maxTokens: 4_096,
								input: ["text", "image"],
								reasoningEfforts: {
									off: null,
									minimal: "minimal",
									low: "low",
									medium: "medium",
									high: "high",
								},
								compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true },
							},
						],
					},
				},
			],
		});
		expect(JSON.stringify(settingsPayload)).not.toContain("test-secret-key");
		expect(calls[2].payload).toEqual({
			ref: expect.stringMatching(/^METAPI_MODEL_[A-F0-9]{16}$/),
			value: "test-secret-key",
		});
		expect(calls[3].payload).toEqual({
			sessionId: "bridge-session",
			provider: "local-gateway",
			model: "local-chat",
		});
	});

	it.each([
		{ model: responsesModel, api: "openai-responses" },
		{ model: anthropicModel, api: "anthropic-messages" },
	])("omits completion-only reasoning compat when registering $api", async ({ model, api }) => {
		let settingsPayload: Record<string, unknown> | undefined;
		const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
			const callMethod = String(params?.method);
			const payload = (params?.payload ?? {}) as Record<string, unknown>;
			if (callMethod === "settings.describe") {
				return ok({ writable: true, namespaces: [{ ns: "llm-pi-ai", revision: 3 }] });
			}
			if (callMethod === "settings.mutate") {
				settingsPayload = payload;
				return ok({ ns: "llm-pi-ai", revision: 4 });
			}
			if (callMethod === "credentials.set") return ok({ configured: true });
			if (callMethod === "session.selectModel") return ok({ selected: {} });
			throw new Error(`Unexpected method: ${callMethod}`);
		});
		const modelRuntime = {
			getAuth: vi.fn(async () => ({ auth: { apiKey: "response-test-key" } })),
			getCompatibilityRequestConfig: vi.fn(() => ({ authHeader: true })),
			getProvider: vi.fn(() => ({ name: "CloseAI" })),
		} as unknown as ModelRuntime;
		const runtime = new DshProfileRuntime({ cwd: process.cwd(), agentDir: process.cwd(), modelRuntime });
		(runtime as unknown as RuntimeInternals).runtime = {
			harness: { client: { request }, close: vi.fn(async () => undefined) },
			sessionId: "responses-session",
			eventCursors: new Map(),
			eventTasks: [],
		};

		await runtime.selectModel(model);

		const serialized = JSON.stringify(settingsPayload);
		expect(serialized).toContain(`"api":"${api}"`);
		expect(serialized).toContain('"reasoningEfforts"');
		expect(serialized).not.toContain('"compat"');
		expect(serialized).not.toContain("thinkingFormat");
		expect(serialized).not.toContain("supportsReasoningEffort");
	});

	it("rejects an API that rc.7 llm-pi-ai cannot express before reading Harness Settings", async () => {
		const request = vi.fn();
		const runtime = new DshProfileRuntime({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			modelRuntime: {} as ModelRuntime,
		});
		(runtime as unknown as RuntimeInternals).runtime = {
			harness: { client: { request }, close: vi.fn(async () => undefined) },
			sessionId: "unsupported-session",
			eventCursors: new Map(),
			eventTasks: [],
		};
		const unsupported = { ...selectedModel, api: "google-generative-ai" } as Model<any>;

		await expect(runtime.selectModel(unsupported)).rejects.toThrow(
			"当前可桥接：openai-completions、openai-responses、anthropic-messages",
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("fails before any write when Harness settings are read-only", async () => {
		const request = vi.fn(async () => ok({ writable: false, namespaces: [] }));
		const runtime = new DshProfileRuntime({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			modelRuntime: {} as ModelRuntime,
		});
		(runtime as unknown as RuntimeInternals).runtime = {
			harness: { client: { request }, close: vi.fn(async () => undefined) },
			sessionId: "read-only-session",
			eventCursors: new Map(),
			eventTasks: [],
		};

		await expect(runtime.selectModel(selectedModel)).rejects.toThrow("Harness Settings 不可写");
		expect(request).toHaveBeenCalledOnce();
	});
});
