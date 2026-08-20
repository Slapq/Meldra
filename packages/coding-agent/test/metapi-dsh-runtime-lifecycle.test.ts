import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harnessSdk = vi.hoisted(() => ({
	close: vi.fn(async () => undefined),
	request: vi.fn(),
	start: vi.fn(async () => undefined),
}));

vi.mock("@deepseek-ai/dsh-sdk-client", () => ({
	DeepSeekHarness: class {
		readonly client = { request: harnessSdk.request };
		readonly start = harnessSdk.start;
		readonly close = harnessSdk.close;
	},
}));

import {
	AgentSessionRuntime,
	type AgentSessionServices,
	type CreateAgentSessionRuntimeFactory,
} from "../src/core/agent-session-runtime.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { resolveMeldraHooks } from "../src/hooks/config.ts";
import { DSH_MESSAGE_ENTRY, DshProfileRuntime } from "../src/meldra/dsh-profile-runtime.ts";

interface ProbeRuntimeState {
	harness: {
		client: { request: ReturnType<typeof vi.fn> };
		close: ReturnType<typeof vi.fn>;
	};
	sessionId: string;
	eventCursors: Map<"mux" | "host", string>;
	eventTasks: Promise<void>[];
}

interface DshRuntimeInternals {
	runtime?: ProbeRuntimeState;
	activeTask?: Promise<void>;
	activeTurn?: {
		sessionId: string;
		sawRunning: boolean;
		resolve(): void;
		reject(error: Error): void;
	};
	handleRuntimeFrame(active: ProbeRuntimeState, payload: Record<string, unknown>): void;
}

function createRuntime(cwd: string): DshProfileRuntime {
	return new DshProfileRuntime({
		cwd,
		agentDir: cwd,
		modelRuntime: { getAuth: async () => undefined } as unknown as ModelRuntime,
	});
}

function armEarlyCancellation(runtime: DshProfileRuntime): {
	activeTask: Promise<void>;
	cancel: ReturnType<typeof vi.fn>;
} {
	const internals = runtime as unknown as DshRuntimeInternals;
	let resolveTurn!: () => void;
	let rejectTurn!: (error: Error) => void;
	const activeTask = new Promise<void>((resolve, reject) => {
		resolveTurn = resolve;
		rejectTurn = reject;
	});
	const active: ProbeRuntimeState = {
		harness: {
			client: { request: vi.fn(async () => undefined) },
			close: vi.fn(async () => undefined),
		},
		sessionId: "early-cancel-session",
		eventCursors: new Map(),
		eventTasks: [],
	};
	internals.runtime = active;
	internals.activeTask = activeTask;
	internals.activeTurn = {
		sessionId: active.sessionId,
		sawRunning: false,
		resolve: resolveTurn,
		reject: rejectTurn,
	};
	const cancel = vi.fn(async () => {
		internals.handleRuntimeFrame(active, {
			type: "host/session-status",
			sessionId: active.sessionId,
			running: false,
		});
	});
	runtime.cancel = cancel;
	return { activeTask, cancel };
}

function armBusyRuntime(
	runtime: DshProfileRuntime,
	response: unknown = { result: { ok: true, value: { accepted: true } } },
): {
	request: ReturnType<typeof vi.fn>;
	activeTask: Promise<void>;
	activeTurn: NonNullable<DshRuntimeInternals["activeTurn"]>;
} {
	const internals = runtime as unknown as DshRuntimeInternals;
	const request = vi.fn(async () => response);
	const activeTask = Promise.resolve();
	const activeTurn = {
		sessionId: "busy-session",
		sawRunning: true,
		resolve: vi.fn(),
		reject: vi.fn(),
	};
	internals.runtime = {
		harness: {
			client: { request },
			close: vi.fn(async () => undefined),
		},
		sessionId: activeTurn.sessionId,
		eventCursors: new Map(),
		eventTasks: [],
	};
	internals.activeTask = activeTask;
	internals.activeTurn = activeTurn;
	return { request, activeTask, activeTurn };
}

async function expectPromptCompletion(operation: Promise<unknown>): Promise<unknown> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = new Promise<"timeout">((resolve) => {
		timeout = setTimeout(() => resolve("timeout"), 250);
	});
	const result = await Promise.race([operation, timeoutResult]);
	if (timeout) clearTimeout(timeout);
	expect(result).not.toBe("timeout");
	return result;
}

describe("DSH Profile Runtime cancellation lifecycle", () => {
	const cleanupPaths: string[] = [];

	afterEach(() => {
		while (cleanupPaths.length > 0) {
			const cleanupPath = cleanupPaths.pop();
			if (cleanupPath) {
				rmSync(cleanupPath, { recursive: true, force: true });
			}
		}
		harnessSdk.close.mockReset();
		harnessSdk.close.mockResolvedValue(undefined);
		harnessSdk.request.mockReset();
		harnessSdk.start.mockReset();
		harnessSdk.start.mockResolvedValue(undefined);
	});

	it.each([
		{ streamingBehavior: "steer" as const, mode: "steer" },
		{ streamingBehavior: "followUp" as const, mode: "queue" },
	])(
		"admits busy $streamingBehavior input without replacing the foreground turn",
		async ({ streamingBehavior, mode }) => {
			const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-busy-"));
			cleanupPaths.push(cwd);
			const runtime = createRuntime(cwd);
			const appended: Array<{ customType: string; data: unknown }> = [];
			runtime.attach({
				cwd,
				sessionId: "pi-session",
				appendEntry: (customType, data) => appended.push({ customType, data }),
				emit: () => {},
			});
			const { request, activeTask, activeTurn } = armBusyRuntime(runtime);

			await runtime.prompt({ text: "next instruction", streamingBehavior });
			expect(appended).toEqual([]);

			expect(request).toHaveBeenCalledWith("meldra/api.call", {
				method: "session.prompt",
				payload: {
					sessionId: "busy-session",
					mode,
					content: [{ type: "text", text: "next instruction" }],
				},
			});
			const internals = runtime as unknown as DshRuntimeInternals;
			internals.handleRuntimeFrame(internals.runtime!, {
				type: "session/event",
				sessionId: "busy-session",
				event: {
					type: "user/message",
					data: {
						id: "message-1",
						source: { kind: "user", rpcId: "prompt-1" },
						content: [{ type: "text", text: "next instruction" }],
					},
				},
			});
			expect(appended).toEqual([
				{
					customType: DSH_MESSAGE_ENTRY,
					data: { kind: "user", text: "next instruction" },
				},
			]);
			expect(internals.activeTask).toBe(activeTask);
			expect(internals.activeTurn).toBe(activeTurn);
			await runtime.dispose();
		},
	);

	it("propagates busy prompt admission failures without replacing the foreground turn", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-busy-error-"));
		cleanupPaths.push(cwd);
		const runtime = createRuntime(cwd);
		const appended: Array<{ customType: string; data: unknown }> = [];
		runtime.attach({
			cwd,
			sessionId: "pi-session",
			appendEntry: (customType, data) => appended.push({ customType, data }),
			emit: () => {},
		});
		const { activeTask, activeTurn } = armBusyRuntime(runtime, {
			result: {
				ok: false,
				error: { code: "agent-busy", message: "prompt rejected" },
			},
		});

		await expect(
			runtime.prompt({
				text: "rejected instruction",
				streamingBehavior: "steer",
			}),
		).rejects.toThrow("prompt rejected");

		expect(JSON.stringify(appended)).not.toContain("rejected instruction");
		expect(appended).toEqual([
			{
				customType: DSH_MESSAGE_ENTRY,
				data: { kind: "error", text: "prompt rejected" },
			},
		]);
		const internals = runtime as unknown as DshRuntimeInternals;
		expect(internals.activeTask).toBe(activeTask);
		expect(internals.activeTurn).toBe(activeTurn);
		await runtime.dispose();
	});

	it("forwards queue mutations to the active Harness Session", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-queue-"));
		cleanupPaths.push(cwd);
		const runtime = createRuntime(cwd);
		const { request } = armBusyRuntime(runtime);

		await runtime.updateQueue("message-1", {
			kind: "edit",
			content: [{ type: "text", text: "updated" }],
		});

		expect(request).toHaveBeenCalledWith("meldra/api.call", {
			method: "session.updateQueue",
			payload: {
				sessionId: "busy-session",
				itemId: "message-1",
				action: {
					kind: "edit",
					content: [{ type: "text", text: "updated" }],
				},
			},
		});
		await runtime.dispose();
	});

	it("creates new Harness Sessions with the Meldra-prefixed host Session ID", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meldra-dsh-session-id-"));
		cleanupPaths.push(cwd);
		harnessSdk.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "meldra/api.events.open") return { cursorId: `${String(params?.stream)}-cursor` };
			if (method === "meldra/api.events.next") return { done: true };
			if (method === "meldra/api.events.close") return {};
			if (method === "meldra/api.call") return { result: { ok: true, value: {} } };
			if (method === "meldra/plugin-inventory.list") return { entries: [] };
			throw new Error(`unexpected request: ${method}`);
		});
		const runtime = createRuntime(cwd);
		runtime.attach({
			cwd,
			sessionId: "pi-session",
			appendEntry: () => {},
			emit: () => {},
		});

		await expect(runtime.plugins()).resolves.toEqual([]);
		expect(harnessSdk.request).toHaveBeenCalledWith("meldra/api.call", {
			method: "session.create",
			payload: { sessionId: "meldra-pi-session", cwd },
		});
		await runtime.dispose();
	});

	it("configures command hooks before creating the Harness Session", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meldra-dsh-hooks-config-"));
		cleanupPaths.push(cwd);
		harnessSdk.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "meldra/hooks.configure") return { configured: true };
			if (method === "meldra/api.events.open") return { cursorId: `${String(params?.stream)}-cursor` };
			if (method === "meldra/api.events.next") return { done: true };
			if (method === "meldra/api.events.close") return {};
			if (method === "meldra/api.call") return { result: { ok: true, value: {} } };
			if (method === "meldra/plugin-inventory.list") return { entries: [] };
			throw new Error(`unexpected request: ${method}`);
		});
		const runtime = createRuntime(cwd);
		const config = { cwd, hooks: resolveMeldraHooks([]) };
		await runtime.configureHooks(config);

		await expect(runtime.plugins()).resolves.toEqual([]);
		const methods = harnessSdk.request.mock.calls.map(([method]) => method);
		expect(methods.indexOf("meldra/hooks.configure")).toBeGreaterThanOrEqual(0);
		expect(methods.indexOf("meldra/hooks.configure")).toBeLessThan(methods.indexOf("meldra/api.call"));
		expect(harnessSdk.request).toHaveBeenCalledWith("meldra/hooks.configure", { config });
		await runtime.dispose();
	});

	it("creates standalone Harness Sessions with a Meldra UUID", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meldra-dsh-standalone-session-id-"));
		cleanupPaths.push(cwd);
		harnessSdk.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
			if (method === "meldra/api.events.open") return { cursorId: `${String(params?.stream)}-cursor` };
			if (method === "meldra/api.events.next") return { done: true };
			if (method === "meldra/api.events.close") return {};
			if (method === "meldra/api.call") return { result: { ok: true, value: {} } };
			if (method === "meldra/plugin-inventory.list") return { entries: [] };
			throw new Error(`unexpected request: ${method}`);
		});
		const runtime = createRuntime(cwd);

		await expect(runtime.plugins()).resolves.toEqual([]);
		const createCall = harnessSdk.request.mock.calls.find(
			([method, params]) => method === "meldra/api.call" && params?.method === "session.create",
		);
		expect(createCall?.[1]).toMatchObject({
			payload: { sessionId: expect.stringMatching(/^meldra-[0-9a-f-]{36}$/), cwd },
		});
		await runtime.dispose();
	});

	it("closes a started Harness when event cursor initialization fails", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-start-failure-"));
		cleanupPaths.push(cwd);
		harnessSdk.request.mockImplementation(async (method: string, params?: { stream?: string }) => {
			if (method === "meldra/api.events.open" && params?.stream === "mux") return { cursorId: "mux-cursor" };
			if (method === "meldra/api.events.open" && params?.stream === "host") throw new Error("host cursor failed");
			if (method === "meldra/api.events.next") return { done: true };
			if (method === "meldra/api.events.close") return {};
			throw new Error(`unexpected request: ${method}`);
		});
		const runtime = createRuntime(cwd);

		await expect(runtime.plugins()).rejects.toThrow("host cursor failed");
		await runtime.dispose();

		expect(harnessSdk.start).toHaveBeenCalledOnce();
		expect(harnessSdk.close).toHaveBeenCalledOnce();
	});

	it("closes and settles a Harness when dispose overlaps startup", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-start-dispose-"));
		cleanupPaths.push(cwd);
		let rejectStart!: (error: Error) => void;
		harnessSdk.start.mockImplementation(
			() =>
				new Promise<undefined>((_resolve, reject) => {
					rejectStart = reject;
				}),
		);
		harnessSdk.close.mockImplementation(async () => {
			rejectStart(new Error("Harness closed during startup"));
			return undefined;
		});
		const runtime = createRuntime(cwd);
		const startup = runtime.plugins().then(
			() => undefined,
			(error: unknown) => error,
		);
		await vi.waitFor(() => expect(harnessSdk.start).toHaveBeenCalledOnce());

		await runtime.dispose();
		const startupError = await startup;

		expect(startupError).toBeInstanceOf(Error);
		expect(String(startupError)).toContain("Harness closed during startup");
		expect(harnessSdk.close).toHaveBeenCalled();
	});

	it("bounds cursor and event-task draining while preserving Harness close", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-dispose-"));
		cleanupPaths.push(cwd);
		const runtime = createRuntime(cwd);
		const never = new Promise<void>(() => undefined);
		const request = vi.fn(() => never);
		const close = vi.fn(async () => undefined);
		const internals = runtime as unknown as DshRuntimeInternals;
		internals.runtime = {
			harness: { client: { request }, close },
			sessionId: "dispose-session",
			eventCursors: new Map([["mux", "cursor-1"]]),
			eventTasks: [never],
		};

		const result = await Promise.race([
			runtime.dispose().then(() => "disposed"),
			new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 1_500)),
		]);

		expect(result).toBe("disposed");
		expect(request).toHaveBeenCalledWith("meldra/api.events.close", {
			cursorId: "cursor-1",
		});
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("settles abort when cancellation reaches idle before running was observed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-abort-"));
		cleanupPaths.push(cwd);
		const runtime = createRuntime(cwd);
		const { activeTask, cancel } = armEarlyCancellation(runtime);

		await expectPromptCompletion(runtime.abort());
		await activeTask;

		expect(cancel).toHaveBeenCalledTimes(1);
		await runtime.dispose();
	});

	it("allows session replacement to finish after the same early cancellation", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metapi-dsh-resume-"));
		cleanupPaths.push(cwd);
		const profileRuntime = createRuntime(cwd);
		const { cancel } = armEarlyCancellation(profileRuntime);
		const sourceManager = SessionManager.create(cwd);
		const source = await createAgentSession({
			cwd,
			sessionManager: sourceManager,
			settingsManager: SettingsManager.inMemory(),
			profileRuntime,
		});
		const destinationManager = SessionManager.create(cwd);
		destinationManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "destination" }],
			timestamp: Date.now(),
		});
		const destinationPath = destinationManager.getSessionFile();
		if (!destinationPath) throw new Error("destination session was not persisted");
		const services = { cwd, agentDir: cwd } as AgentSessionServices;
		const createReplacement: CreateAgentSessionRuntimeFactory = async (options) => {
			const result = await createAgentSession({
				cwd: options.cwd,
				sessionManager: options.sessionManager,
				settingsManager: SettingsManager.inMemory(),
				sessionStartEvent: options.sessionStartEvent,
			});
			return {
				...result,
				services: { cwd: options.cwd, agentDir: cwd } as AgentSessionServices,
				diagnostics: [],
			};
		};
		const runtimeHost = new AgentSessionRuntime(source.session, services, createReplacement);

		const result = await expectPromptCompletion(runtimeHost.switchSession(destinationPath));

		expect(result).toEqual({ cancelled: false });
		expect(runtimeHost.session.sessionFile).toBe(destinationPath);
		expect(cancel).toHaveBeenCalledTimes(1);
		await runtimeHost.dispose();
	});
});
