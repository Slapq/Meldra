import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import type { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { ApiProxy, ClientResponse } from "@deepseek-ai/dsh-host-apiproxy";
import { RpcId } from "@deepseek-ai/dsh-host-apiproxy";
import type { PluginInventoryGateway } from "@deepseek-ai/dsh-host-plugin-inventory";
import type { MessageFeedbackService } from "@deepseek-ai/dsh-message-feedback";
import { HarnessSdkJsonRpcServer } from "@deepseek-ai/dsh-sdk-jsonrpc-server";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
import Schema from "@deepseek-ai/schemastery";
import type { MeldraHooksRuntimeConfig } from "../../hooks/types.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import type { MeldraDshHookDiagnostic, MeldraDshHooksService } from "./hooks.ts";

const LEGACY_METAPI_RPC_PREFIX = "metapi/";
const MELDRA_RPC_PREFIX = "meldra/";

export function canonicalMeldraDshRpcMethod(method: string): string {
	return method.startsWith(LEGACY_METAPI_RPC_PREFIX)
		? `${MELDRA_RPC_PREFIX}${method.slice(LEGACY_METAPI_RPC_PREFIX.length)}`
		: method;
}

const API_METHODS = new Map<string, [keyof ApiProxy, string]>([
	...[
		"list",
		"search",
		"create",
		"history",
		"models",
		"selectModel",
		"rename",
		"fork",
		"prompt",
		"attachment",
		"updateQueue",
		"cancel",
	].map((name) => [`session.${name}`, ["sessions", name]] as [string, [keyof ApiProxy, string]]),
	...["list", "history", "prompt", "interrupt"].map(
		(name) => [`subagent.${name}`, ["subagents", name]] as [string, [keyof ApiProxy, string]],
	),
	...["describe", "pickDirectory", "listDirectory", "createDirectory", "openPath"].map(
		(name) => [`host.${name}`, ["host", name]] as [string, [keyof ApiProxy, string]],
	),
	...["list", "create", "rename", "delete", "insertBefore", "insertSessionBefore", "archiveSession"].map(
		(name) => [`workspace.${name}`, ["workspace", name]] as [string, [keyof ApiProxy, string]],
	),
	["skill.list", ["skills", "list"]],
	...["list", "select", "read", "copy", "openDocument", "remove"].map(
		(name) => [`agentPreset.${name}`, ["agentPresets", name]] as [string, [keyof ApiProxy, string]],
	),
	...["create", "edit", "pause", "resume", "complete", "clear"].map(
		(name) => [`goal.${name}`, ["goals", name]] as [string, [keyof ApiProxy, string]],
	),
	...["describe", "openDocument", "update", "replace", "mutate"].map(
		(name) => [`settings.${name}`, ["settings", name]] as [string, [keyof ApiProxy, string]],
	),
	...["describe", "set", "unset"].map(
		(name) => [`credentials.${name}`, ["credentials", name]] as [string, [keyof ApiProxy, string]],
	),
	...["providers", "models", "discoverModels"].map(
		(name) => [`llm.${name}`, ["llm", name]] as [string, [keyof ApiProxy, string]],
	),
]);

interface BridgeConfig {
	maxTokensAsSuccess?: boolean;
	input?: Readable;
	output?: Writable;
	exit?: (code: number) => void;
}

interface EventCursor {
	controller: AbortController;
	iterator: AsyncIterator<unknown>;
}

export const name = "meldra-tui-jsonrpc-server";
export const inject = ["apiProxy", "agents", "commands", "meldraHooks", "messageFeedback", "pluginInventory"];
export const Config = Schema.object({
	maxTokensAsSuccess: Schema.boolean().default(false),
});

export function apply(ctx: Context, config: BridgeConfig): void {
	const rootFiber = ctx.root.fiber;
	const input = config.input ?? process.stdin;
	const output = config.output ?? process.stdout;
	const exit = config.exit ?? ((code: number): void => process.exit(code));
	const transport = new JsonRpcLineTransport(input, output);
	const sdk = new HarnessSdkJsonRpcServer(ctx, transport, {
		maxTokensAsSuccess: config.maxTokensAsSuccess,
	});
	const api = ctx.apiProxy;
	const meldraHooks = ctx.get("meldraHooks") as MeldraDshHooksService;
	const cursors = new Map<string, EventCursor>();
	let exitTask: Promise<void> | undefined;
	const unsubscribeHookDiagnostics = meldraHooks.subscribeDiagnostics((diagnostic: MeldraDshHookDiagnostic) => {
		transport.notify("meldra/hooks.diagnostic", diagnostic);
	});

	const closeCursor = async (id: string): Promise<boolean> => {
		const cursor = cursors.get(id);
		if (!cursor) return false;
		cursors.delete(id);
		cursor.controller.abort();
		await cursor.iterator.return?.();
		return true;
	};
	const closeCursors = async (): Promise<void> => {
		await Promise.allSettled([...cursors.keys()].map(closeCursor));
	};
	const disposeAndExit = (): Promise<void> => {
		exitTask ??= (async () => {
			try {
				await Promise.allSettled([transport.flush()]);
				await Promise.allSettled([meldraHooks.shutdown()]);
				await Promise.allSettled([transport.flush()]);
				await Promise.allSettled([rootFiber.dispose()]);
				await Promise.allSettled([meldraHooks.drain()]);
			} finally {
				killTrackedDetachedChildren();
				exit(0);
			}
		})();
		return exitTask;
	};

	const apiCall = async (params: Record<string, unknown> | undefined): Promise<unknown> => {
		const method = params?.method;
		const payload = params?.payload;
		if (typeof method !== "string" || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
			throw new TypeError("meldra/api.call requires method and object payload");
		}
		const target = API_METHODS.get(method);
		if (!target) throw new Error(`unsupported Meldra DSH API method: ${method}`);
		const domain = api[target[0]] as unknown as Record<string, unknown>;
		const fn = domain[target[1]];
		if (typeof fn !== "function") throw new Error(`unavailable Meldra DSH API method: ${method}`);
		return fn({ type: "client-request", rpcId: RpcId(randomUUID()), payload });
	};

	const commandList = (params: Record<string, unknown> | undefined): unknown => {
		const sessionId = params?.sessionId;
		if (typeof sessionId !== "string") throw new TypeError("meldra/commands.list requires sessionId");
		const agent = ctx.agents.get(sessionId as Parameters<typeof ctx.agents.get>[0]);
		if (!agent) throw new Error(`unknown DSH Session Agent: ${sessionId}`);
		const commands: CommandRuntime = ctx.commands;
		return commands.list(agent);
	};

	const commandExecute = async (params: Record<string, unknown> | undefined): Promise<unknown> => {
		const sessionId = params?.sessionId;
		const line = params?.line;
		if (typeof sessionId !== "string" || typeof line !== "string")
			throw new TypeError("meldra/commands.execute requires sessionId and line");
		const agent = ctx.agents.get(sessionId as Parameters<typeof ctx.agents.get>[0]);
		if (!agent) throw new Error(`unknown DSH Session Agent: ${sessionId}`);
		const commands: CommandRuntime = ctx.commands;
		const result = await commands.execute(agent, line, [], new AbortController().signal);
		if (!result) throw new Error(`unknown DSH command: ${line}`);
		return { accepted: true, commandId: result.commandId, command: result.result };
	};

	const messageFeedbackCall = async (params: Record<string, unknown> | undefined): Promise<unknown> => {
		const method = params?.method;
		const payload = params?.payload;
		if (
			(method !== "list" && method !== "put" && method !== "delete") ||
			!payload ||
			typeof payload !== "object" ||
			Array.isArray(payload)
		)
			throw new TypeError("meldra/message-feedback.call requires list/put/delete and object payload");
		const feedback: MessageFeedbackService = ctx.messageFeedback;
		return feedback[method](payload as never);
	};

	const openEvents = (params: Record<string, unknown> | undefined): { cursorId: string } => {
		const stream = params?.stream;
		if (stream !== "mux" && stream !== "host") throw new TypeError("event stream must be mux or host");
		const controller = new AbortController();
		const rpcId = RpcId(randomUUID());
		const source = api.events[stream]({ rpcId, payload: {} }, controller.signal);
		const cursorId = randomUUID();
		cursors.set(cursorId, {
			controller,
			iterator: source[Symbol.asyncIterator](),
		});
		return { cursorId };
	};

	transport.onRequest(async (method, params) => {
		const rpcMethod = canonicalMeldraDshRpcMethod(method);
		switch (rpcMethod) {
			case "meldra/hooks.configure": {
				const config = params?.config;
				if (!config || typeof config !== "object" || Array.isArray(config)) {
					throw new TypeError("meldra/hooks.configure requires an object config");
				}
				meldraHooks.configure(config as unknown as MeldraHooksRuntimeConfig);
				return { configured: true };
			}
			case "meldra/api.call":
				return apiCall(params);
			case "meldra/api.respond":
				return api.respond(params?.response as ClientResponse);
			case "meldra/commands.list":
				return commandList(params);
			case "meldra/commands.execute":
				return commandExecute(params);
			case "meldra/message-feedback.call":
				return messageFeedbackCall(params);
			case "meldra/plugin-inventory.list": {
				const inventory = (ctx as Context & { pluginInventory: PluginInventoryGateway }).pluginInventory;
				return inventory.list();
			}
			case "meldra/api.events.open":
				return openEvents(params);
			case "meldra/api.events.next": {
				const cursorId = params?.cursorId;
				if (typeof cursorId !== "string") throw new TypeError("cursorId is required");
				const cursor = cursors.get(cursorId);
				if (!cursor) throw new Error(`unknown event cursor: ${cursorId}`);
				const result = await cursor.iterator.next();
				if (result.done) await closeCursor(cursorId);
				return { done: Boolean(result.done), value: result.value };
			}
			case "meldra/api.events.close": {
				const cursorId = params?.cursorId;
				if (typeof cursorId !== "string") throw new TypeError("cursorId is required");
				return { closed: await closeCursor(cursorId) };
			}
			default: {
				const result = await sdk.handleRequest(method, params);
				if (method === "shutdown") setImmediate(() => void disposeAndExit());
				return result;
			}
		}
	});

	ctx.effect(() => {
		transport.start();
		return async () => {
			await closeCursors();
			await sdk.shutdown();
			unsubscribeHookDiagnostics();
			transport.close();
		};
	}, "meldra.tui-jsonrpc.serve");
}
