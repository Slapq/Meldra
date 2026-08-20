import { describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
	onRequest: vi.fn(),
	flush: vi.fn(async () => undefined),
	notify: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
	handleRequest: vi.fn(async () => ({ ok: true })),
	shutdown: vi.fn(async () => undefined),
}));

vi.mock("@deepseek-ai/dsh-sdk-jsonrpc-server", () => ({
	HarnessSdkJsonRpcServer: class {
		handleRequest = sdkMocks.handleRequest;
		shutdown = sdkMocks.shutdown;
	},
}));
vi.mock("@deepseek-ai/dsh-sdk-protocol", () => ({
	JsonRpcLineTransport: class {
		onRequest = transportMocks.onRequest;
		flush = transportMocks.flush;
		notify = transportMocks.notify;
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
	"hooks.configure",
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
		const configure = vi.fn();
		let reportDiagnostic: ((diagnostic: { message: string }) => void) | undefined;
		const unsubscribeDiagnostics = vi.fn();
		const shutdown = vi.fn(async () => undefined);
		const drain = vi.fn(async () => undefined);
		apply(
			{
				root: { fiber: { dispose: vi.fn(async () => undefined) } },
				effect: vi.fn(),
				get: vi.fn(() => ({
					configure,
					subscribeDiagnostics: (listener: (diagnostic: { message: string }) => void) => {
						reportDiagnostic = listener;
						return unsubscribeDiagnostics;
					},
					shutdown,
					drain,
				})),
				apiProxy: {},
				agents: { get: vi.fn(() => agent) },
				commands: { execute },
				messageFeedback: {},
				pluginInventory: {},
			} as never,
			{ exit: vi.fn() },
		);
		const handler = transportMocks.onRequest.mock.calls.at(-1)?.[0];

		await expect(
			handler?.("meldra/commands.execute", { sessionId: "session-1", line: "/plan off" }),
		).resolves.toEqual({
			accepted: true,
			commandId: "command-1",
			command: { kind: "success", text: "Plan mode off." },
		});
		expect(execute).toHaveBeenCalledWith(agent, "/plan off", [], expect.any(AbortSignal));
		const config = { cwd: "C:/workspace", hooks: { disabled: false, events: {}, diagnostics: [] } };
		await expect(handler?.("meldra/hooks.configure", { config })).resolves.toEqual({ configured: true });
		expect(configure).toHaveBeenCalledWith(config);
		reportDiagnostic?.({ message: "hook timed out" });
		expect(transportMocks.notify).toHaveBeenCalledWith("meldra/hooks.diagnostic", {
			message: "hook timed out",
		});
	});

	it("drains Hook processes before shutdown exits", async () => {
		transportMocks.onRequest.mockClear();
		const rootDispose = vi.fn(async () => undefined);
		const shutdown = vi.fn(async () => undefined);
		const drain = vi.fn(async () => undefined);
		const exit = vi.fn();
		apply(
			{
				root: { fiber: { dispose: rootDispose } },
				effect: vi.fn(),
				get: vi.fn(() => ({
					configure: vi.fn(),
					subscribeDiagnostics: () => vi.fn(),
					shutdown,
					drain,
				})),
				apiProxy: {},
				agents: { get: vi.fn() },
				commands: {},
				messageFeedback: {},
				pluginInventory: {},
			} as never,
			{ exit },
		);
		const handler = transportMocks.onRequest.mock.calls.at(-1)?.[0];

		await expect(handler?.("shutdown", {})).resolves.toEqual({ ok: true });
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
		expect(shutdown).toHaveBeenCalledOnce();
		expect(rootDispose).toHaveBeenCalledOnce();
		expect(drain).toHaveBeenCalledOnce();
		expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(rootDispose.mock.invocationCallOrder[0]);
		expect(rootDispose.mock.invocationCallOrder[0]).toBeLessThan(drain.mock.invocationCallOrder[0]);
		expect(drain.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
	});

	it("leaves Harness-native methods unchanged", () => {
		expect(canonicalMeldraDshRpcMethod("initialize")).toBe("initialize");
		expect(canonicalMeldraDshRpcMethod("session/prompt")).toBe("session/prompt");
		expect(canonicalMeldraDshRpcMethod("shutdown")).toBe("shutdown");
	});
});
