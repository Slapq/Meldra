import { describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
	onRequest: vi.fn(),
	flush: vi.fn(async () => undefined),
}));

vi.mock("@deepseek-ai/dsh-sdk-jsonrpc-server", () => ({
	HarnessSdkJsonRpcServer: class {},
}));
vi.mock("@deepseek-ai/dsh-sdk-protocol", () => ({
	JsonRpcLineTransport: class {
		onRequest = transportMocks.onRequest;
		flush = transportMocks.flush;
	},
}));

import { apply, canonicalMeldraDshRpcMethod } from "../src/extensions/dsh/server.ts";

const RPC_METHOD_SUFFIXES = [
	"api.call",
	"api.respond",
	"commands.list",
	"commands.execute",
	"message-feedback.call",
	"plugin-inventory.list",
	"api.events.open",
	"api.events.next",
	"api.events.close",
] as const;

describe("Meldra DSH RPC namespace", () => {
	it.each(RPC_METHOD_SUFFIXES)("keeps meldra/%s canonical", (suffix) => {
		expect(canonicalMeldraDshRpcMethod(`meldra/${suffix}`)).toBe(`meldra/${suffix}`);
	});

	it.each(RPC_METHOD_SUFFIXES)("maps legacy metapi/%s requests to Meldra", (suffix) => {
		expect(canonicalMeldraDshRpcMethod(`metapi/${suffix}`)).toBe(`meldra/${suffix}`);
	});

	it("passes an empty image list to the rc.8 command runtime", async () => {
		transportMocks.onRequest.mockClear();
		const agent = {};
		const execute = vi.fn(async () => ({
			commandId: "command-1",
			result: { kind: "success", text: "Plan mode off." },
		}));
		apply(
			{
				root: { fiber: { dispose: vi.fn(async () => undefined) } },
				effect: vi.fn(),
				apiProxy: {},
				agents: { get: vi.fn(() => agent) },
				commands: { execute },
				messageFeedback: {},
				pluginInventory: {},
			} as never,
			{ exit: vi.fn() },
		);
		const handler = transportMocks.onRequest.mock.calls.at(-1)?.[0];

		await expect(handler?.("meldra/commands.execute", { sessionId: "session-1", line: "/plan off" })).resolves.toEqual(
			{
				accepted: true,
				commandId: "command-1",
				command: { kind: "success", text: "Plan mode off." },
			},
		);
		expect(execute).toHaveBeenCalledWith(agent, "/plan off", [], expect.any(AbortSignal));
	});

	it("leaves Harness-native methods unchanged", () => {
		expect(canonicalMeldraDshRpcMethod("initialize")).toBe("initialize");
		expect(canonicalMeldraDshRpcMethod("session/prompt")).toBe("session/prompt");
		expect(canonicalMeldraDshRpcMethod("shutdown")).toBe("shutdown");
	});
});
