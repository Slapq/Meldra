import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, RegisteredCommand } from "../src/core/extensions/types.ts";
import { builtInExtensions } from "../src/extensions/index.ts";
import metaPiConfig from "../src/extensions/metapi-config/index.ts";

interface ConfigHost {
	commands: Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>;
	emit(channel: string, data: unknown): void;
}

const tempDirs: string[] = [];
const originalProfile = process.env.METAPI_PROFILE_NAME;
const originalAgentDir = process.env.METAPI_CODING_AGENT_DIR;

function createHost(profile: string, agentDir: string): ConfigHost {
	process.env.METAPI_PROFILE_NAME = profile;
	process.env.METAPI_CODING_AGENT_DIR = agentDir;
	const listeners = new Map<string, Array<(data: unknown) => void>>();
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const emit = (channel: string, data: unknown): void => {
		for (const listener of listeners.get(channel) ?? []) listener(data);
	};
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
	} as unknown as ExtensionAPI;
	metaPiConfig(pi);
	return { commands, emit };
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

describe("MetaPi Profile config extension", () => {
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
