import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, RegisteredCommand } from "../src/core/extensions/types.ts";
import { builtInExtensions } from "../src/extensions/index.ts";
import meldraConfig from "../src/extensions/metapi-config/index.ts";
import scoutExtension from "../starter-profile/extensions/scout.ts";

interface ConfigHost {
	commands: Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>;
	emit(channel: string, data: unknown): void;
	pi: ExtensionAPI;
	lifecycle: Map<string, (...args: any[]) => any>;
	registrations: Map<string, any>;
}

const tempDirs: string[] = [];
const originalProfile = process.env.METAPI_PROFILE_NAME;
const originalAgentDir = process.env.METAPI_CODING_AGENT_DIR;

function createHost(profile: string, agentDir: string, loadConfig = true): ConfigHost {
	process.env.METAPI_PROFILE_NAME = profile;
	process.env.METAPI_CODING_AGENT_DIR = agentDir;
	const listeners = new Map<string, Array<(data: unknown) => void>>();
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const registrations = new Map<string, any>();
	const emit = (channel: string, data: unknown): void => {
		if (channel === "config:register") {
			const registration = data as { id?: string };
			if (registration.id) registrations.set(registration.id, registration);
		}
		for (const listener of listeners.get(channel) ?? []) listener(data);
	};
	const lifecycle = new Map<string, (...args: any[]) => any>();
	const pi = {
		registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
			commands.set(name, command);
		},
		events: {
			emit,
			on: (channel: string, listener: (data: unknown) => void) => {
				const channelListeners = listeners.get(channel) ?? [];
				channelListeners.push(listener);
				listeners.set(channel, channelListeners);
				return () => {
					listeners.set(
						channel,
						(listeners.get(channel) ?? []).filter((candidate) => candidate !== listener),
					);
				};
			},
		},
		on: (name: string, handler: (...args: any[]) => any) => {
			lifecycle.set(name, handler);
		},
		registerTool: () => undefined,
	} as unknown as ExtensionAPI;
	if (loadConfig) meldraConfig(pi);
	return { commands, emit, pi, lifecycle, registrations };
}

function tempAgentDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "metapi-config-profile-"));
	tempDirs.push(directory);
	return directory;
}

afterEach(() => {
	if (originalProfile === undefined) delete process.env.METAPI_PROFILE_NAME;
	else process.env.METAPI_PROFILE_NAME = originalProfile;
	if (originalAgentDir === undefined) delete process.env.METAPI_CODING_AGENT_DIR;
	else process.env.METAPI_CODING_AGENT_DIR = originalAgentDir;
	for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Meldra Profile config extension", () => {
	it("is injected before other built-in Profile extensions", () => {
		expect(builtInExtensions[0]).toMatchObject({ name: "metapi-config", hidden: true });
	});

	it.each(["default", "dsh", "research"])("registers /config for the %s Profile", (profile) => {
		const host = createHost(profile, tempAgentDir());
		expect(host.commands.get("config")?.description).toBe("Plugin configuration manager");
	});

	it("does not register in the Pi compatibility Profile", () => {
		const host = createHost("pi", tempAgentDir());
		expect(host.commands.size).toBe(0);
	});

	it("registers Scout when Scout loads before the Config Host", async () => {
		const host = createHost("default", tempAgentDir(), false);
		scoutExtension(host.pi);
		meldraConfig(host.pi);
		await host.lifecycle.get("session_start")?.({}, {});
		const configCommand = host.commands.get("config") as any;
		expect(configCommand.getArgumentCompletions("")).toEqual(
			expect.arrayContaining([{ value: "scout", label: expect.stringContaining("Scout") }]),
		);
	});

	it("registers Scout in the real Config Host catalog", async () => {
		const host = createHost("default", tempAgentDir());
		scoutExtension(host.pi);
		await host.lifecycle.get("session_start")?.({}, {});
		const configCommand = host.commands.get("config") as any;
		expect(configCommand.getArgumentCompletions("")).toEqual(
			expect.arrayContaining([{ value: "scout", label: expect.stringContaining("Scout") }]),
		);
		let config: unknown;
		host.emit("config:get", {
			id: "scout",
			callback: (value: unknown) => {
				config = value;
			},
		});
		expect(config).toMatchObject({ thinkingLevel: "off", injectGuidelines: true });
		expect(host.commands.has("scout")).toBe(true);
	});

	it("completes Scout models from the current registry while keeping a string field", async () => {
		const host = createHost("default", tempAgentDir());
		scoutExtension(host.pi);
		const modelRegistry = {
			getAll: () => [
				{ provider: "zeta", id: "fast" },
				{ provider: "alpha", id: "small" },
			],
		};
		await host.lifecycle.get("session_start")?.({}, { modelRegistry });

		const registration = host.registrations.get("scout");
		const modelField = registration.fields.find((field: any) => field.key === "model");
		expect(modelField.type).toBe("string");
		expect(modelField.completions()).toEqual(["alpha/small", "zeta/fast"]);

		let component: any;
		await (host.commands.get("config") as any).handler("scout", {
			mode: "tui",
			hasUI: true,
			ui: {
				custom: async (factory: any) => {
					component = factory(
						{ requestRender: () => undefined },
						{
							fg: (_color: string, text: string) => text,
							bg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						() => undefined,
					);
					component.handleInput("\t");
					return null;
				},
				notify: () => undefined,
			},
		});
		expect(component.render(100).join("\n")).toContain("alpha/small");
	});

	it("renders Scout fields using the Config Host language", async () => {
		const agentDir = tempAgentDir();
		const configDir = join(agentDir, "plugin-configs");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(join(configDir, "pi-config.json"), JSON.stringify({ lang: "zh" }), "utf8");
		const host = createHost("default", agentDir);
		scoutExtension(host.pi);
		await host.lifecycle.get("session_start")?.({}, {});
		let component: any;
		await (host.commands.get("config") as any).handler("scout", {
			mode: "tui",
			hasUI: true,
			ui: {
				custom: async (factory: any) => {
					component = factory(
						{ requestRender: () => undefined },
						{
							fg: (_color: string, text: string) => text,
							bg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						() => undefined,
					);
					return null;
				},
				notify: () => undefined,
			},
		});
		expect(component.render(100).join("\n")).toContain("模型");
	});

	it("does not crash when a registered field has a malformed label", async () => {
		const host = createHost("default", tempAgentDir());
		host.emit("config:register", {
			id: "malformed-label",
			label: "Malformed label",
			fields: [{ key: "value", label: null, type: "string" }],
			defaults: { value: "" },
		});
		let component: any;
		await (host.commands.get("config") as any).handler("malformed-label", {
			mode: "tui",
			hasUI: true,
			ui: {
				custom: async (factory: any) => {
					component = factory(
						{ requestRender: () => undefined },
						{
							fg: (_color: string, text: string) => text,
							bg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						() => undefined,
					);
					return null;
				},
				notify: () => undefined,
			},
		});
		expect(() => component.render(100)).not.toThrow();
	});

	it("preserves the config event contract and isolates values by Profile agent directory", () => {
		const firstAgentDir = tempAgentDir();
		const secondAgentDir = tempAgentDir();
		for (const [agentDir, value] of [
			[firstAgentDir, "first"],
			[secondAgentDir, "second"],
		] as const) {
			const configDir = join(agentDir, "plugin-configs");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "sample.json"), JSON.stringify({ value }), "utf8");
		}

		const readValue = (profile: string, agentDir: string): unknown => {
			const host = createHost(profile, agentDir);
			host.emit("config:register", {
				id: "sample",
				label: "Sample",
				fields: [{ key: "value", label: "Value", type: "string" }],
				defaults: { value: "default" },
			});
			let config: unknown;
			host.emit("config:get", {
				id: "sample",
				callback: (value: unknown) => {
					config = value;
				},
			});
			return config;
		};

		expect(readValue("default", firstAgentDir)).toEqual({ value: "first" });
		expect(readValue("dsh", secondAgentDir)).toEqual({ value: "second" });
	});
});
