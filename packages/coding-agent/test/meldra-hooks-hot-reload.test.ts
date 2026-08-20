import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	createMeldraHooksExtension,
	resolveHooksRuntimeConfig,
	type MeldraHooksHotReloadResult,
} from "../src/extensions/meldra-hooks/index.ts";
import {
	createMeldraHooksSettingsWatcher,
	type MeldraHooksRuntimeConfig,
	type MeldraHooksSettingsWatcher,
} from "../src/hooks/index.ts";

const dirs: string[] = [];
const watchers: MeldraHooksSettingsWatcher[] = [];

function workspace(prefix: string): string {
	const path = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(path);
	return path;
}

function hookConfig(cwd: string, command: string): MeldraHooksRuntimeConfig {
	return resolveHooksRuntimeConfig(
		{ hooks: { AgentStart: [{ hooks: [{ type: "command", command }] }] } },
		{},
		cwd,
	);
}

afterEach(() => {
	for (const watcher of watchers.splice(0)) watcher.close();
	for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Meldra Hook settings hot reload", () => {
	it("observes creation, atomic replacement, and deletion", async () => {
		const cwd = workspace("meldra-hook-watch-");
		const path = join(cwd, "settings.json");
		const snapshots: Array<string | undefined> = [];
		const watcher = createMeldraHooksSettingsWatcher({
			paths: [path],
			reload: () => {
				snapshots.push(existsSync(path) ? readFileSync(path, "utf8") : undefined);
			},
			onError: (error) => {
				throw error;
			},
			intervalMs: 20,
			debounceMs: 5,
		});
		watchers.push(watcher);

		writeFileSync(path, "one", "utf8");
		await vi.waitFor(() => expect(snapshots).toContain("one"), { timeout: 2000 });
		const replacement = join(cwd, "settings.next.json");
		writeFileSync(replacement, "two", "utf8");
		renameSync(replacement, path);
		await vi.waitFor(() => expect(snapshots).toContain("two"), { timeout: 2000 });
		unlinkSync(path);
		await vi.waitFor(() => expect(snapshots.at(-1)).toBeUndefined(), { timeout: 2000 });
	});

	it("continues watching after one reload failure", async () => {
		const cwd = workspace("meldra-hook-watch-recovery-");
		const path = join(cwd, "settings.json");
		writeFileSync(path, "zero", "utf8");
		let attempts = 0;
		const errors: unknown[] = [];
		const watcher = createMeldraHooksSettingsWatcher({
			paths: [path],
			reload() {
				attempts++;
				if (attempts === 1) throw new Error("transient reload failure");
			},
			onError: (error) => errors.push(error),
			intervalMs: 20,
			debounceMs: 5,
		});
		watchers.push(watcher);

		writeFileSync(path, "first", "utf8");
		await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 2000 });
		writeFileSync(path, "second", "utf8");
		await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 2000 });
	});

	it("reads only Hook settings without mutating cached unrelated settings", () => {
		const cwd = workspace("meldra-hook-snapshot-");
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });
		const profilePath = join(agentDir, "settings.json");
		writeFileSync(
			profilePath,
			JSON.stringify({ theme: "dark", defaultModel: "old-model", hooks: { Stop: [] } }),
			"utf8",
		);
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		writeFileSync(
			profilePath,
			JSON.stringify({
				theme: "light",
				defaultModel: "new-model",
				hooks: { AgentStart: [{ hooks: [{ type: "command", command: "new-hook" }] }] },
			}),
			"utf8",
		);

		const snapshot = manager.readHookSettingsSnapshot();
		expect(snapshot.errors).toEqual([]);
		expect(snapshot.profile.hooks).toEqual({
			AgentStart: [{ hooks: [{ type: "command", command: "new-hook" }] }],
		});
		expect(manager.getEffectiveGlobalSettings()).toMatchObject({ theme: "dark", defaultModel: "old-model" });

		writeFileSync(profilePath, "{ invalid", "utf8");
		expect(manager.readHookSettingsSnapshot().errors[0]?.scope).toBe("global");
		expect(manager.getEffectiveGlobalSettings()).toMatchObject({ theme: "dark", defaultModel: "old-model" });

		unlinkSync(profilePath);
		const removed = manager.readHookSettingsSnapshot();
		expect(removed.errors).toEqual([]);
		expect(removed.profile.hooks).toBeUndefined();
		expect(manager.getEffectiveGlobalSettings()).toMatchObject({ theme: "dark", defaultModel: "old-model" });
	});

	it("keeps inherited Profile defaults out of the editable storage layer", () => {
		const cwd = workspace("meldra-hook-editable-layer-");
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ hooks: { AgentEnd: [{ hooks: [{ type: "command", command: "stored" }] }] } }),
			"utf8",
		);
		const manager = SettingsManager.create(cwd, agentDir, {
			projectTrusted: false,
			baseSettings: {
				hooks: { AgentStart: [{ hooks: [{ type: "command", command: "inherited" }] }] },
			},
		});
		expect(manager.readEditableHookSettingsSnapshot().profile.hooks).toEqual({
			AgentEnd: [{ hooks: [{ type: "command", command: "stored" }] }],
		});
		expect(manager.readHookSettingsSnapshot().profile.hooks).toMatchObject({
			AgentStart: [{ hooks: [{ type: "command", command: "inherited" }] }],
			AgentEnd: [{ hooks: [{ type: "command", command: "stored" }] }],
		});
	});

	it("persists only Hook fields without applying unrelated external settings", async () => {
		const cwd = workspace("meldra-hook-write-layer-");
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });
		const profilePath = join(agentDir, "settings.json");
		writeFileSync(profilePath, JSON.stringify({ theme: "dark", defaultModel: "old-model" }), "utf8");
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		writeFileSync(
			profilePath,
			JSON.stringify({ theme: "light", defaultModel: "new-model", quietStartup: true }),
			"utf8",
		);

		await manager.writeHookSettingsLayer("profile", {
			hooks: { AgentEnd: [{ hooks: [{ type: "command", command: "notify", disabled: true }] }] },
			disableAllHooks: false,
		});

		const persisted = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
		expect(persisted).toMatchObject({
			theme: "light",
			defaultModel: "new-model",
			quietStartup: true,
			disableAllHooks: false,
		});
		expect(persisted.hooks).toBeDefined();
		expect(manager.getEffectiveGlobalSettings()).toMatchObject({ theme: "dark", defaultModel: "old-model" });
		expect(manager.getEffectiveGlobalSettings().quietStartup).toBeUndefined();
	});

	it("refuses untrusted project writes and preserves malformed settings", async () => {
		const cwd = workspace("meldra-hook-write-guard-");
		const agentDir = join(cwd, "agent");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		await expect(manager.writeHookSettingsLayer("project", { hooks: {} })).rejects.toThrow("not trusted");
		expect(existsSync(join(cwd, ".pi", "settings.json"))).toBe(false);

		const profilePath = join(agentDir, "settings.json");
		writeFileSync(profilePath, "{ invalid", "utf8");
		await expect(manager.writeHookSettingsLayer("profile", { hooks: {} })).rejects.toThrow();
		expect(readFileSync(profilePath, "utf8")).toBe("{ invalid");
	});

	it("does not expose project Hook settings before trust", () => {
		const cwd = workspace("meldra-hook-trust-");
		const agentDir = join(cwd, "agent");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "project-hook" }] }] } }),
			"utf8",
		);
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		expect(manager.readHookSettingsSnapshot().project).toEqual({});
		manager.setProjectTrusted(true);
		expect(manager.readHookSettingsSnapshot().project.hooks).toBeDefined();
	});

	it("pushes valid snapshots to DSH, excludes unwatched project settings, and retains last-known-good", async () => {
		const cwd = workspace("meldra-hook-extension-watch-");
		const settingsPath = join(cwd, "settings.json");
		const projectSettingsPath = join(cwd, ".pi", "settings.json");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(settingsPath, "initial", "utf8");
		writeFileSync(projectSettingsPath, "untrusted", "utf8");
		let loaded: MeldraHooksHotReloadResult = { config: hookConfig(cwd, "initial-hook") };
		const watchedPaths = vi.fn(() => [settingsPath]);
		const handlers = new Map<string, (...args: unknown[]) => unknown>();
		const extension = createMeldraHooksExtension(() => hookConfig(cwd, "initial-hook"), {
			paths: watchedPaths,
			load: () => loaded,
			intervalMs: 20,
			debounceMs: 5,
		});
		if (!("factory" in extension)) throw new Error("Expected a Meldra Hooks inline extension");
		await extension.factory({
			on: (event: string, handler: (...args: unknown[]) => unknown) => {
				handlers.set(event, handler);
			},
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI);
		const configureHooks = vi.fn(async (_config: MeldraHooksRuntimeConfig) => undefined);
		const notify = vi.fn();
		const ctx = {
			profileRuntime: { configureHooks },
			hasUI: true,
			ui: { notify },
			sessionManager: {
				getSessionId: () => "hot-session",
				getSessionFile: () => undefined,
			},
			cwd,
		} as unknown as ExtensionContext;

		await handlers.get("session_start")?.({ reason: "startup" }, ctx);
		expect(configureHooks).toHaveBeenCalledTimes(1);
		expect(watchedPaths).toHaveBeenCalledOnce();
		writeFileSync(projectSettingsPath, "untrusted-change", "utf8");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(configureHooks).toHaveBeenCalledTimes(1);

		loaded = { config: hookConfig(cwd, "reloaded-hook") };
		writeFileSync(settingsPath, "valid", "utf8");
		await vi.waitFor(() => expect(configureHooks).toHaveBeenCalledTimes(2), { timeout: 2000 });
		const reloadedConfig = configureHooks.mock.calls[1]?.[0];
		expect(reloadedConfig?.hooks.events.AgentStart[0]?.command).toBe("reloaded-hook");

		loaded = { diagnostics: ["invalid Hook JSON"] };
		writeFileSync(settingsPath, "invalid", "utf8");
		await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("invalid Hook JSON", "warning"), { timeout: 2000 });
		expect(configureHooks).toHaveBeenCalledTimes(2);

		await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
		loaded = { config: hookConfig(cwd, "after-shutdown") };
		writeFileSync(settingsPath, "after", "utf8");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(configureHooks).toHaveBeenCalledTimes(2);
	});
});
