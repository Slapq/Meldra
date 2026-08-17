import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import starterSetup, { __starterSetupInternals as internals } from "../starter-profile/extensions/setup.ts";

const agentDir = "C:/tmp/metapi-starter-wizard-test/agent";
const scoutConfigPath = join(agentDir, "plugin-configs", "scout.json");
const originalLang = process.env.LANG;

type Handler = (...args: any[]) => any;

function context(options: { authenticated?: boolean; activeModel?: boolean } = {}) {
	const model = { provider: "fixture", id: "fixture-model" };
	const state = {
		authenticated: options.authenticated === true,
		activeModel: options.activeModel === true,
	};
	const ctx = {
		mode: "tui",
		modelRegistry: {
			getAvailable: () => [model],
			find: (provider: string, id: string) => (provider === model.provider && id === model.id ? model : undefined),
			hasConfiguredAuth: () => state.authenticated,
		},
		executeCommand: vi.fn(async (command: string) => {
			if (command === "/login") state.authenticated = true;
			if (command === "/model") state.activeModel = true;
			if (command === "/scout") {
				mkdirSync(dirname(scoutConfigPath), { recursive: true });
				writeFileSync(
					scoutConfigPath,
					JSON.stringify({ model: "fixture/fixture-model", thinkingLevel: "low" }),
					"utf8",
				);
			}
			return true;
		}),
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: vi.fn(),
			notify: vi.fn(),
			select: vi.fn(),
		},
	} as any;
	Object.defineProperty(ctx, "model", { get: () => (state.activeModel ? model : undefined) });
	return ctx;
}

function loadExtension() {
	const commands = new Map<string, { handler: Handler }>();
	const events = new Map<string, Handler>();
	starterSetup({
		registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
		on: (name: string, handler: Handler) => events.set(name, handler),
	} as never);
	return { commands, events };
}

beforeEach(() => {
	process.env.LANG = "en";
	process.env.METAPI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	rmSync(dirname(agentDir), { recursive: true, force: true });
	delete process.env.METAPI_CODING_AGENT_DIR;
	if (originalLang === undefined) delete process.env.LANG;
	else process.env.LANG = originalLang;
});

describe("MetaPi Starter setup wizard", () => {
	test("registers /setup and reports truthful incomplete status", async () => {
		const { commands, events } = loadExtension();
		const ctx = context();

		expect(commands.has("setup")).toBe(true);
		await events.get("session_start")?.({}, ctx);

		expect(ctx.ui.setStatus).toHaveBeenCalledWith("metapi-starter-setup", "Setup 0/3 · /setup");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/\/setup/), "info");
	});

	test("recognizes configured Provider, active model, and explicit Scout settings", () => {
		mkdirSync(dirname(scoutConfigPath), { recursive: true });
		writeFileSync(scoutConfigPath, JSON.stringify({ model: "fixture/fixture-model", thinkingLevel: "low" }), "utf8");
		const status = internals.inspectStatus(context({ authenticated: true, activeModel: true }));
		expect(status).toEqual({
			providerReady: true,
			modelSelected: true,
			modelReady: true,
			scoutModelConfigured: true,
			scoutModelReady: true,
			scoutThinkingReady: true,
		});
		expect(internals.completedCount(status)).toBe(3);
	});

	test("reads legacy Scout settings as a migration fallback", () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "scout.json"),
			JSON.stringify({ model: "fixture/fixture-model", thinkingLevel: "low" }),
			"utf8",
		);
		const status = internals.inspectStatus(context({ authenticated: true, activeModel: true }));
		expect(status.scoutModelReady).toBe(true);
		expect(status.scoutThinkingReady).toBe(true);
	});

	test("keeps an unavailable configured Scout model incomplete", () => {
		mkdirSync(dirname(scoutConfigPath), { recursive: true });
		writeFileSync(scoutConfigPath, JSON.stringify({ model: "missing/model", thinkingLevel: "low" }), "utf8");
		const status = internals.inspectStatus(context({ authenticated: true, activeModel: true }));
		expect(status.scoutModelConfigured).toBe(true);
		expect(status.scoutModelReady).toBe(false);
		expect(status.scoutThinkingReady).toBe(true);
		expect(internals.completedCount(status)).toBe(2);
	});

	test("classifies selected-but-unavailable model and incomplete Scout settings as partial", () => {
		mkdirSync(dirname(scoutConfigPath), { recursive: true });
		writeFileSync(scoutConfigPath, JSON.stringify({ thinkingLevel: "low" }), "utf8");
		const status = internals.inspectStatus(context({ activeModel: true }));
		expect(internals.configurationState("provider", status)).toBe("unconfigured");
		expect(internals.configurationState("model", status)).toBe("partial");
		expect(internals.configurationState("scout", status)).toBe("partial");
	});

	test("shows all configured steps instead of skipping directly to the summary", async () => {
		mkdirSync(dirname(scoutConfigPath), { recursive: true });
		writeFileSync(scoutConfigPath, JSON.stringify({ model: "fixture/fixture-model", thinkingLevel: "low" }), "utf8");
		const { commands } = loadExtension();
		const ctx = context({ authenticated: true, activeModel: true });
		ctx.ui.select.mockImplementation(async (_title: string, options: string[]) =>
			options.some((option) => option.includes("/login") || option.includes("/model") || option.includes("/scout"))
				? options[0]
				: options.at(-1),
		);

		await commands.get("setup")?.handler("", ctx);

		expect(ctx.executeCommand).not.toHaveBeenCalled();
		const titles = ctx.ui.select.mock.calls.map(([title]: [string]) => title);
		expect(titles).toHaveLength(4);
		for (const title of titles.slice(0, 3)) expect(title).toMatch(/Configured|已配置/);
	});

	test("runs Provider, model, and Scout as one continuous waterfall", async () => {
		const { commands } = loadExtension();
		const ctx = context();
		ctx.ui.select.mockImplementation(
			async (_title: string, options: string[]) =>
				options.find(
					(option) => option.includes("/login") || option.includes("/model") || option.includes("/scout"),
				) ?? options.at(-1),
		);

		await commands.get("setup")?.handler("", ctx);

		expect(ctx.executeCommand.mock.calls.map(([command]: [string]) => command)).toEqual([
			"/login",
			"/model",
			"/scout",
		]);
		const titles = ctx.ui.select.mock.calls.map(([title]: [string]) => title);
		expect(titles).toHaveLength(4);
		expect(titles[0]).toContain("1/3");
		expect(titles[1]).toContain("2/3");
		expect(titles[2]).toContain("3/3");
		expect(titles[3]).toContain("3/3");
	});

	test("keeps an incomplete step in the wizard until the user skips it", async () => {
		const { commands } = loadExtension();
		const ctx = context();
		ctx.executeCommand.mockImplementation(async () => true);
		let providerVisits = 0;
		ctx.ui.select.mockImplementation(async (title: string, options: string[]) => {
			const isStep = options.some(
				(option) => option.includes("/login") || option.includes("/model") || option.includes("/scout"),
			);
			if (title.includes("1/3") && isStep) {
				providerVisits++;
				return providerVisits === 1 ? options[0] : options[1];
			}
			return isStep ? options[1] : options.at(-1);
		});

		await commands.get("setup")?.handler("", ctx);

		expect(providerVisits).toBe(2);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	test("allows every step to be skipped without executing configuration commands", async () => {
		const { commands } = loadExtension();
		const ctx = context();
		ctx.ui.select.mockImplementation(async (_title: string, options: string[]) => {
			const isStep = options.some(
				(option) => option.includes("/login") || option.includes("/model") || option.includes("/scout"),
			);
			return isStep ? options[1] : options.at(-1);
		});

		await commands.get("setup")?.handler("", ctx);

		expect(ctx.executeCommand).not.toHaveBeenCalled();
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("metapi-starter-setup", "Setup 0/3 · /setup");
	});
});
