import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../src/core/extensions/types.ts";
import type { HookSettingsLayer, HookSettingsSnapshot } from "../src/core/settings-manager.ts";
import { showMeldraHooksManager } from "../src/extensions/meldra-hooks/manager.ts";
import {
	loadHooksManagerLanguage,
	saveHooksManagerLanguage,
} from "../src/extensions/meldra-hooks/language.ts";
import {
	HOOK_EVENT_CATEGORIES,
	HOOKS_MANAGER_LANGS,
	HooksSelectPageComponent,
} from "../src/extensions/meldra-hooks/ui.ts";
import {
	hookEntriesForEvent,
	mergeMeldraHookSettingsLayers,
	parseMeldraHookDraft,
	parseMeldraHooksImport,
	putMeldraHookEntry,
	removeMeldraHookEntry,
	replaceMeldraHookSettingsLayer,
	setMeldraHookEventDisabled,
	toggleMeldraHookEntry,
} from "../src/hooks/index.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function snapshot(profile: HookSettingsLayer = {}, project: HookSettingsLayer = {}): HookSettingsSnapshot {
	return { profile, project, errors: [] };
}

const profileLayer: HookSettingsLayer = {
	hooks: {
		PreToolUse: [
			{
				matcher: "Bash",
				hooks: [{ type: "command", command: "node", args: ["check.mjs"] }],
			},
		],
		AgentEnd: [{ hooks: [{ type: "command", command: "notify" }] }],
	},
};

describe("Meldra Hooks management", () => {
	it("persists the Provider-style Profile-local language preference", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "meldra-hooks-language-"));
		try {
			const configDir = join(agentDir, "plugin-configs");
			saveHooksManagerLanguage(agentDir, "zh");
			expect(loadHooksManagerLanguage(agentDir)).toBe("zh");
			const path = join(configDir, "meldra-hooks.json");
			writeFileSync(path, JSON.stringify({ feature: true, lang: "zh" }), "utf8");
			saveHooksManagerLanguage(agentDir, "en");
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ feature: true, lang: "en" });
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("imports only Hook settings and reports unrelated envelope fields", () => {
		const parsed = parseMeldraHooksImport(
			{
				hooks: profileLayer.hooks,
				disableAllHooks: false,
				shellPath: "/bin/bash",
				defaultModel: "must-not-import",
			},
			"profile",
		);
		expect(parsed.ignoredFields).toEqual(["defaultModel"]);
		expect(parsed.layer).toMatchObject({ disableAllHooks: false, shellPath: "/bin/bash" });
		expect(parsed.layer.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toBe("node");
	});

	it("merges by event and matcher while deduplicating identical handlers", () => {
		const incoming = parseMeldraHooksImport(
			{
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{ type: "command", command: "node", args: ["check.mjs"] },
							{ type: "command", command: "audit", disabled: true },
						],
					},
				],
			},
			"profile",
		).layer;
		const merged = mergeMeldraHookSettingsLayers(profileLayer, incoming);
		expect(merged.hooks?.PreToolUse).toHaveLength(1);
		expect(merged.hooks?.PreToolUse?.[0]?.hooks.map((hook) => hook.command)).toEqual(["node", "audit"]);
		expect(merged.hooks?.PreToolUse?.[0]?.hooks[1]?.disabled).toBe(true);
	});

	it("replaces provided Hook fields without clearing omitted layer settings", () => {
		const current = { ...profileLayer, disableAllHooks: true, shellPath: "/bin/zsh" };
		const incoming = parseMeldraHooksImport(
			{ AgentStart: [{ hooks: [{ type: "command", command: "start" }] }] },
			"profile",
		).layer;
		const replaced = replaceMeldraHookSettingsLayer(current, incoming);
		expect(replaced.disableAllHooks).toBe(true);
		expect(replaced.shellPath).toBe("/bin/zsh");
		expect(replaced.hooks?.PreToolUse).toBeUndefined();
		expect(replaced.hooks?.AgentStart?.[0]?.hooks[0]?.command).toBe("start");
	});

	it("adds, toggles, disables an event, and removes one handler", () => {
		const draft = parseMeldraHookDraft(
			JSON.stringify({ matcher: "*", hook: { type: "command", command: "new-hook" } }),
			"AgentEnd",
		);
		let layer = putMeldraHookEntry(profileLayer, "AgentEnd", draft);
		let entries = hookEntriesForEvent(layer, "AgentEnd");
		expect(entries.map((entry) => entry.hook.command)).toEqual(["notify", "new-hook"]);
		layer = toggleMeldraHookEntry(layer, entries[1]!);
		expect(hookEntriesForEvent(layer, "AgentEnd")[1]?.hook.disabled).toBe(true);
		layer = setMeldraHookEventDisabled(layer, "AgentEnd", true);
		expect(hookEntriesForEvent(layer, "AgentEnd").every((entry) => entry.hook.disabled)).toBe(true);
		entries = hookEntriesForEvent(layer, "AgentEnd");
		layer = removeMeldraHookEntry(layer, entries[0]!);
		expect(hookEntriesForEvent(layer, "AgentEnd").map((entry) => entry.hook.command)).toEqual(["new-hook"]);
	});

	it.each([60, 80, 120])("renders every localized category-page line within %i columns", (width) => {
		const t = HOOKS_MANAGER_LANGS.zh;
		const component = new HooksSelectPageComponent(
			theme as never,
			t.title,
			`${t.profileScope} · ${t.effectiveEnabled}`,
			HOOK_EVENT_CATEGORIES.map((category) => ({
				value: category.id,
				label: t.categoryLabel[category.id],
				description: t.categoryDescription[category.id],
			})),
			t.selectNav,
			vi.fn(),
			vi.fn(),
		);
		const lines = component.render(width);
		expect(lines.length).toBeGreaterThan(5);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(stripVTControlCharacters(lines.join("\n"))).toContain("Agent 事件");
	});

	it("reads schema-invalid raw settings as an empty event list for JSON recovery", () => {
		const invalid = { hooks: { PreToolUse: [{ matcher: 42, hooks: "bad" }] } } as unknown as HookSettingsLayer;
		expect(hookEntriesForEvent(invalid, "PreToolUse")).toEqual([]);
	});

	it("imports a local JSON file through the localized management page", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meldra-hooks-import-ui-"));
		try {
			const importPath = join(cwd, "hooks.json");
			writeFileSync(
				importPath,
				JSON.stringify({ AgentStart: [{ hooks: [{ type: "command", command: "imported" }] }] }),
				"utf8",
			);
			let profile = structuredClone(profileLayer);
			let customCalls = 0;
			const write = vi.fn(async (_scope: "profile" | "project", layer: HookSettingsLayer) => {
				profile = structuredClone(layer);
			});
			const select = vi
				.fn<(title: string) => Promise<string | undefined>>()
				.mockResolvedValueOnce(HOOKS_MANAGER_LANGS.en.importHooks)
				.mockResolvedValueOnce(HOOKS_MANAGER_LANGS.en.readJsonFile)
				.mockResolvedValueOnce(HOOKS_MANAGER_LANGS.en.merge);
			const ctx = {
				mode: "tui",
				hasUI: true,
				cwd,
				ui: {
					theme,
					notify: vi.fn(),
					select,
					input: vi.fn(async () => importPath),
					confirm: vi.fn(async () => true),
					custom: async (
						factory: (
							tui: unknown,
							themeValue: unknown,
							keybindings: unknown,
							done: (value: string | undefined) => void,
						) => HooksSelectPageComponent<string>,
					) =>
						await new Promise<string | undefined>((resolve) => {
							customCalls++;
							const component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
							component.handleInput(customCalls === 1 ? "\r" : "\u001b");
						}),
				},
			} as unknown as ExtensionCommandContext;

			await showMeldraHooksManager(ctx, {
				management: {
					isProjectTrusted: () => true,
					readEditable: () => snapshot(profile),
					readEffective: () => snapshot(profile),
					write,
					loadLanguage: () => "en",
					saveLanguage: vi.fn(),
				},
				hotReload: true,
				getHotReloadDiagnostics: () => [],
			});

			expect(write).toHaveBeenCalledOnce();
			expect(profile.hooks?.AgentStart?.[0]?.hooks[0]?.command).toBe("imported");
			expect(profile.hooks?.AgentEnd?.[0]?.hooks[0]?.command).toBe("notify");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("uses the localized category -> event -> handler action hierarchy", async () => {
		let profile = structuredClone(profileLayer);
		let customCalls = 0;
		const write = vi.fn(async (_scope: "profile" | "project", layer: HookSettingsLayer) => {
			profile = structuredClone(layer);
		});
		const select = vi.fn(async (title: string) =>
			title === HOOKS_MANAGER_LANGS.zh.handlerActions ? HOOKS_MANAGER_LANGS.zh.disableHandler : undefined,
		);
		const ctx = {
			mode: "tui",
			hasUI: true,
			cwd: process.cwd(),
			ui: {
				theme,
				notify: vi.fn(),
				select,
				custom: async (
					factory: (
						tui: unknown,
						themeValue: unknown,
						keybindings: unknown,
						done: (value: string | undefined) => void,
					) => HooksSelectPageComponent<string>,
				) =>
					await new Promise<string | undefined>((resolve) => {
						customCalls++;
						const component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
						const down = () => component.handleInput("\u001b[B");
						if (customCalls === 1) {
							down();
							down();
							component.handleInput("\r");
						} else if (customCalls === 2 || customCalls === 3) {
							down();
							component.handleInput("\r");
						} else {
							component.handleInput("\u001b");
						}
					}),
			},
		} as unknown as ExtensionCommandContext;

		await showMeldraHooksManager(ctx, {
			management: {
				isProjectTrusted: () => true,
				readEditable: () => snapshot(profile),
				readEffective: () => snapshot(profile),
				write,
				loadLanguage: () => "zh",
				saveLanguage: vi.fn(),
			},
			hotReload: true,
			getHotReloadDiagnostics: () => [],
		});

		expect(select).toHaveBeenCalledWith(HOOKS_MANAGER_LANGS.zh.handlerActions, [
			HOOKS_MANAGER_LANGS.zh.editHandler,
			HOOKS_MANAGER_LANGS.zh.disableHandler,
			HOOKS_MANAGER_LANGS.zh.deleteHandler,
			HOOKS_MANAGER_LANGS.zh.back,
		]);
		expect(write).toHaveBeenCalledOnce();
		expect(profile.hooks?.AgentEnd?.[0]?.hooks[0]?.disabled).toBe(true);
	});
});
