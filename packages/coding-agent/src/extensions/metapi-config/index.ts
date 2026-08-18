/**
 * Pi Config — Universal Plugin Configuration Manager
 *
 * A framework extension that provides a unified /config command.
 * Other plugins register their config schemas via pi.events, and
 * this extension renders the TUI forms, persists values, and
 * broadcasts changes.
 *
 * ── Public Events API ──────────────────────────────────────────
 *
 * Register a plugin config page:
 *
 *   pi.events.emit("config:register", {
 *     id:       "my-plugin",           // unique id, also used as filename
 *     label:    "My Plugin",           // display name
 *     icon:     "🔌",                  // optional icon
 *     fields:   [ ... ],               // field definitions (see below)
 *     defaults: { key: value, ... },   // default values
 *   })
 *
 * Field types:
 *
 *   { key, label, type: "string",  placeholder?, completions?, hint? }
 *   { key, label, type: "secret",  placeholder?, hint? }       masked input
 *   { key, label, type: "number",  placeholder?, hint?, min?, max?, step? }
 *   { key, label, type: "boolean", hint? }                     toggle
 *   { key, label, type: "select",  options: string[], hint? }  option picker
 *   { key, label, type: "section" }                            visual separator
 *
 * Unregister:
 *
 *   pi.events.emit("config:unregister", "my-plugin")
 *
 * Read config (synchronous, returns current values):
 *
 *   pi.events.emit("config:get", {
 *     id: "my-plugin",
 *     callback: (config) => { ... },
 *   })
 *
 * Listen for changes:
 *
 *   pi.events.on("config:updated:my-plugin", (config) => { ... })
 *
 * ── Storage ────────────────────────────────────────────────────
 *
 *   ~/.pi/agent/plugin-configs/{id}.json
 *
 * ── User Command ───────────────────────────────────────────────
 *
 *   /config              Open the config manager
 *   /config my-plugin    Jump directly to a plugin's config page
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	Container,
	CURSOR_MARKER,
	type Focusable,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════════════════════════════════

type Lang = "en" | "zh";
type LocalizedText = string | Readonly<{ en: string; zh: string }>;

function localize(value: LocalizedText, lang: Lang): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && typeof value[lang] === "string") return value[lang];
	return String(value ?? "");
}

interface I18n {
	title: string;
	noPlugins: string;
	selectNav: string;
	saved: string;
	cancelled: string;
	resetDone: string;
	testConnection: string;
	envOverride: string;

	btnSave: string;
	btnCancel: string;
	btnReset: string;
	formNav: string;
	switchHint: string;

	showSecret: string;
	hideSecret: string;

	langLabel: string;
}

const EN: I18n = {
	title: "⚙ Plugin Configuration",
	noPlugins: "No plugins have registered configuration",
	selectNav: "↑↓ navigate • Enter select • Esc close",
	saved: "Configuration saved",
	cancelled: "Cancelled",
	resetDone: "Reset to defaults",
	testConnection: "⚡ Test Connection",
	envOverride: "ENV",

	btnSave: "✓ Save",
	btnCancel: "✗ Cancel",
	btnReset: "↺ Reset",
	formNav: "↑↓/Tab navigate • Enter confirm/toggle • ←→ switch • Esc cancel",
	switchHint: "← →",

	showSecret: "[Enter to show]",
	hideSecret: "[Enter to hide]",

	langLabel: "🌐 Language",
};

const ZH: I18n = {
	title: "⚙ 插件配置",
	noPlugins: "没有插件注册了配置项",
	selectNav: "↑↓ 导航 • Enter 选择 • Esc 关闭",
	saved: "配置已保存",
	cancelled: "已取消",
	resetDone: "已恢复默认设置",
	testConnection: "⚡ 测试连接",
	envOverride: "环境变量",

	btnSave: "✓ 保存",
	btnCancel: "✗ 取消",
	btnReset: "↺ 重置",
	formNav: "↑↓/Tab 导航 • Enter 确认/切换 • ←→ 切换 • Esc 取消",
	switchHint: "← →",

	showSecret: "[Enter 显示]",
	hideSecret: "[Enter 隐藏]",

	langLabel: "🌐 语言",
};

const LANGS: Record<Lang, I18n> = { en: EN, zh: ZH };

function detectLang(): Lang {
	const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
	if (/^zh/i.test(env)) return "zh";
	// Windows rarely sets LANG; fall back to the system locale
	try {
		if (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale)) return "zh";
	} catch {
		/* ignore */
	}
	return "en";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public types (the API contract for other plugins)
// ═══════════════════════════════════════════════════════════════════════════════

interface FieldBase {
	key: string;
	label: LocalizedText;
	hint?: LocalizedText;
	envVar?: string; // show ENV badge if this env var is set
}

interface StringField extends FieldBase {
	type: "string";
	placeholder?: LocalizedText;
	/** Runtime-only completion values. The function is never persisted. */
	completions?: () => string[];
}
interface SecretField extends FieldBase {
	type: "secret";
	placeholder?: LocalizedText;
}
interface NumberField extends FieldBase {
	type: "number";
	placeholder?: LocalizedText;
	min?: number;
	max?: number;
	step?: number;
}
interface BooleanField extends FieldBase {
	type: "boolean";
}
interface SelectField extends FieldBase {
	type: "select";
	options: string[];
}
interface SectionField {
	type: "section";
	label: LocalizedText;
	key?: undefined;
	hint?: undefined;
	envVar?: undefined;
}

type ConfigField = StringField | SecretField | NumberField | BooleanField | SelectField | SectionField;

interface PluginRegistration {
	id: string;
	label: LocalizedText;
	icon?: string;
	fields: ConfigField[];
	defaults: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config storage
// ═══════════════════════════════════════════════════════════════════════════════

function getConfigDir(): string {
	return join(getAgentDir(), "plugin-configs");
}

function getConfigPath(id: string): string {
	return join(getConfigDir(), `${id}.json`);
}

function loadPluginConfig(id: string, defaults: Record<string, any>): Record<string, any> {
	const p = getConfigPath(id);
	if (!existsSync(p)) return { ...defaults };
	try {
		const data = JSON.parse(readFileSync(p, "utf-8"));
		return { ...defaults, ...data };
	} catch {
		return { ...defaults };
	}
}

function savePluginConfig(id: string, config: Record<string, any>): void {
	const dir = getConfigDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(getConfigPath(id), JSON.stringify(config, null, 2), "utf-8");
}

// ── pi-config's own preferences (language) ──────────────────────────────

function loadOwnPrefs(): { lang?: Lang } {
	try {
		const data = JSON.parse(readFileSync(getConfigPath("pi-config"), "utf-8"));
		return data && typeof data === "object" ? data : {};
	} catch {
		return {};
	}
}

function saveOwnPrefs(prefs: { lang?: Lang }): void {
	try {
		savePluginConfig("pi-config", prefs);
	} catch {
		/* non-fatal */
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline Input (same pattern as provider-manager)
// ═══════════════════════════════════════════════════════════════════════════════

interface Inp {
	text: string;
	cursor: number;
}

function inp(initial = ""): Inp {
	return { text: initial, cursor: initial.length };
}

function inpKey(i: Inp, data: string): boolean {
	if (matchesKey(data, Key.backspace)) {
		if (i.cursor > 0) {
			i.text = i.text.slice(0, i.cursor - 1) + i.text.slice(i.cursor);
			i.cursor--;
		}
		return true;
	}
	if (matchesKey(data, Key.delete)) {
		if (i.cursor < i.text.length) {
			i.text = i.text.slice(0, i.cursor) + i.text.slice(i.cursor + 1);
		}
		return true;
	}
	if (matchesKey(data, Key.left)) {
		i.cursor = Math.max(0, i.cursor - 1);
		return true;
	}
	if (matchesKey(data, Key.right)) {
		i.cursor = Math.min(i.text.length, i.cursor + 1);
		return true;
	}
	if (matchesKey(data, Key.home)) {
		i.cursor = 0;
		return true;
	}
	if (matchesKey(data, Key.end)) {
		i.cursor = i.text.length;
		return true;
	}
	// Handle bracketed paste: \x1b[200~ ... \x1b[201~
	if (data.startsWith("\x1b[200~")) {
		const content = data.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
		if (content.length > 0) {
			let insert = "";
			for (const ch of content) {
				if (ch.charCodeAt(0) >= 32 || ch === "\t") insert += ch;
			}
			if (insert.length > 0) {
				i.text = i.text.slice(0, i.cursor) + insert + i.text.slice(i.cursor);
				i.cursor += insert.length;
				return true;
			}
		}
		return false;
	}
	// Single char or paste (multi-char)
	if (data.length >= 1 && !data.startsWith("\x1b")) {
		let insert = "";
		for (const ch of data) {
			if (ch.charCodeAt(0) >= 32) insert += ch;
		}
		if (insert.length > 0) {
			i.text = i.text.slice(0, i.cursor) + insert + i.text.slice(i.cursor);
			i.cursor += insert.length;
			return true;
		}
	}
	return false;
}

function renderInp(i: Inp, active: boolean, cursorVisible: boolean, th: Theme, maxW: number, placeholder = ""): string {
	if (!active) {
		return truncateToWidth(th.fg(i.text ? "text" : "dim", i.text || placeholder), maxW);
	}
	const before = i.text.slice(0, i.cursor);
	const ch = i.cursor < i.text.length ? i.text[i.cursor]! : " ";
	const after = i.text.slice(i.cursor + 1);
	const marker = cursorVisible ? CURSOR_MARKER : "";
	return truncateToWidth(`${before}${marker}\x1b[7m${ch}\x1b[27m${after}`, maxW);
}

function maskSecret(text: string): string {
	if (!text) return "";
	if (text.length <= 8) return "•".repeat(text.length);
	return text.slice(0, 4) + "•".repeat(Math.min(text.length - 8, 20)) + text.slice(-4);
}

function toggleStr(value: boolean, th: Theme): string {
	return value ? th.fg("success", "● ON") + th.fg("dim", " / OFF") : th.fg("dim", "ON / ") + th.fg("error", "● OFF");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Entry
// ═══════════════════════════════════════════════════════════════════════════════

export default function meldraConfig(pi: ExtensionAPI) {
	if (process.env.METAPI_PROFILE_NAME === "pi") return;

	const savedPrefs = loadOwnPrefs();
	let lang: Lang = savedPrefs.lang === "zh" || savedPrefs.lang === "en" ? savedPrefs.lang : detectLang();
	const registry = new Map<string, PluginRegistration>();

	// ── Events API: register / unregister / get ──────────────────────────

	pi.events.on("config:register", (value) => {
		const reg = value as PluginRegistration;
		if (!reg.id || !reg.fields) return;
		registry.set(reg.id, reg);
	});

	pi.events.on("config:unregister", (value) => {
		registry.delete(value as string);
	});

	pi.events.on("config:get", (value) => {
		const req = value as { id: string; callback: (config: Record<string, any>) => void };
		const reg = registry.get(req.id);
		if (!reg) {
			req.callback({});
			return;
		}
		req.callback(loadPluginConfig(reg.id, reg.defaults));
	});

	// ── Command: /config ─────────────────────────────────────────────────

	pi.registerCommand("config", {
		description: "Plugin configuration manager",
		getArgumentCompletions: (prefix: string) => {
			return [...registry.values()]
				.filter((r) => r.id.startsWith(prefix))
				.map((r) => ({ value: r.id, label: `${r.icon || "⚙"} ${localize(r.label, lang)}` }));
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("Requires interactive mode", "error");
				return;
			}

			// Direct jump: /config my-plugin
			const directId = args?.trim();
			if (directId) {
				if (registry.has(directId)) {
					await openPluginForm(directId, ctx);
					return;
				}
				ctx.ui.notify(
					`Unknown plugin id "${directId}". Registered: ${[...registry.keys()].join(", ") || "(none)"}`,
					"warning",
				);
				// fall through to the menu
			}

			// Plugin select page
			let reopenMenu = true;
			while (reopenMenu) {
				reopenMenu = false;
				const t = LANGS[lang];

				if (registry.size === 0) {
					ctx.ui.notify(t.noPlugins, "info");
					return;
				}

				const plugins = [...registry.values()];

				const action = await ctx.ui.custom<string | "lang" | null>((tui, theme, _kb, done) => {
					const items: SelectItem[] = [
						...plugins.map((p) => {
							const cfg = loadPluginConfig(p.id, p.defaults);
							const fieldCount = p.fields.filter((f) => f.type !== "section").length;
							const configuredCount = p.fields.filter(
								(f) =>
									f.type !== "section" &&
									f.key &&
									cfg[f.key] !== undefined &&
									cfg[f.key] !== "" &&
									cfg[f.key] !== p.defaults[f.key!],
							).length;
							return {
								value: p.id,
								label: `${p.icon || "⚙"} ${localize(p.label, lang)}`,
								description: `${configuredCount}/${fieldCount} configured`,
							};
						}),
						{
							value: "__lang__",
							label: `${t.langLabel}`,
							description: lang === "en" ? "English" : "中文",
						},
					];

					const container = new Container();
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
					container.addChild(new Text(theme.fg("accent", theme.bold(` ${t.title}`)), 0, 0));
					container.addChild(new Text("", 0, 0));

					const sl = new SelectList(items, Math.min(items.length + 1, 15), {
						selectedPrefix: (x) => theme.fg("accent", x),
						selectedText: (x) => theme.fg("accent", x),
						description: (x) => theme.fg("muted", x),
						scrollInfo: (x) => theme.fg("dim", x),
						noMatch: (x) => theme.fg("warning", x),
					});
					sl.onSelect = (item) => {
						if (item.value === "__lang__") done("lang");
						else done(item.value);
					};
					sl.onCancel = () => done(null);
					container.addChild(sl);

					container.addChild(new Text("", 0, 0));
					container.addChild(new Text(theme.fg("dim", ` ${t.selectNav}`), 0, 0));
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

					return {
						render: (w) => container.render(w),
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							sl.handleInput(data);
							tui.requestRender();
						},
					};
				});

				if (action === null) return;
				if (action === "lang") {
					lang = lang === "en" ? "zh" : "en";
					saveOwnPrefs({ ...loadOwnPrefs(), lang });
					reopenMenu = true;
					continue;
				}

				await openPluginForm(action, ctx);
				reopenMenu = true; // return to plugin list after closing form
			}
		},
	});

	// ── Open a plugin's config form ──────────────────────────────────────

	async function openPluginForm(pluginId: string, ctx: ExtensionCommandContext): Promise<void> {
		const reg = registry.get(pluginId);
		if (!reg) return;

		const t = LANGS[lang];
		const currentConfig = loadPluginConfig(reg.id, reg.defaults);

		const result = await ctx.ui.custom<Record<string, any> | null>(
			(tui: any, theme: Theme, _kb: any, done: (r: Record<string, any> | null) => void) =>
				new PluginFormComponent(tui, theme, done, reg, currentConfig, t, lang),
		);

		if (result) {
			savePluginConfig(reg.id, result);
			pi.events.emit(`config:updated:${reg.id}`, result);
			ctx.ui.notify(`${reg.icon || "⚙"} ${localize(reg.label, lang)} — ${t.saved}`, "info");
		} else {
			ctx.ui.notify(t.cancelled, "info");
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dynamic Plugin Form Component
// ═══════════════════════════════════════════════════════════════════════════════

type FormEntry =
	| {
			kind: "field";
			field: ConfigField;
			inputState: Inp;
			selectIdx?: number;
			boolVal?: boolean;
			secretVisible?: boolean;
	  }
	| { kind: "action"; action: "save" | "cancel" | "reset" };

class PluginFormComponent implements Focusable {
	focused = false;

	private th: Theme;
	private tui: { requestRender: () => void };
	private done: (r: Record<string, any> | null) => void;
	private reg: PluginRegistration;
	private t: I18n;
	private lang: Lang;

	private entries: FormEntry[] = [];
	private focusIdx = 0;

	constructor(
		tui: { requestRender: () => void },
		theme: Theme,
		done: (r: Record<string, any> | null) => void,
		reg: PluginRegistration,
		currentConfig: Record<string, any>,
		t: I18n,
		lang: Lang,
	) {
		this.tui = tui;
		this.th = theme;
		this.done = done;
		this.reg = reg;
		this.t = t;
		this.lang = lang;
		this.buildEntries(currentConfig);
	}

	private buildEntries(config: Record<string, any>): void {
		this.entries = [];
		for (const field of this.reg.fields) {
			if (field.type === "section") {
				this.entries.push({ kind: "field", field, inputState: inp() });
				continue;
			}
			const val = config[field.key] ?? this.reg.defaults[field.key] ?? "";
			const entry: FormEntry = { kind: "field", field, inputState: inp(String(val ?? "")) };

			if (field.type === "boolean") {
				entry.boolVal = !!val;
			} else if (field.type === "select") {
				entry.selectIdx = Math.max(0, field.options.indexOf(String(val)));
			} else if (field.type === "secret") {
				entry.secretVisible = false;
			}

			this.entries.push(entry);
		}
		this.entries.push({ kind: "action", action: "save" });
		this.entries.push({ kind: "action", action: "cancel" });
		this.entries.push({ kind: "action", action: "reset" });

		// Move focus to first non-section entry
		this.focusIdx = this.entries.findIndex(
			(e) => e.kind === "action" || (e.kind === "field" && e.field.type !== "section"),
		);
		if (this.focusIdx < 0) this.focusIdx = 0;
	}

	private collectValues(): Record<string, any> {
		const result: Record<string, any> = {};
		for (const entry of this.entries) {
			if (entry.kind !== "field" || entry.field.type === "section" || !entry.field.key) continue;
			const f = entry.field;
			switch (f.type) {
				case "string":
				case "secret":
					result[f.key] = entry.inputState.text;
					break;
				case "number":
					result[f.key] = parseFloat(entry.inputState.text) || 0;
					break;
				case "boolean":
					result[f.key] = entry.boolVal ?? false;
					break;
				case "select":
					result[f.key] = f.options[entry.selectIdx ?? 0] ?? "";
					break;
			}
		}
		return result;
	}

	private completeStringField(entry: FormEntry & { kind: "field" }, field: StringField): boolean {
		const options = [...new Set((field.completions?.() ?? []).filter((value) => value.length > 0))].sort();
		if (options.length === 0) return false;
		const current = entry.inputState.text;
		const matches = options.filter((value) => value.toLowerCase().startsWith(current.toLowerCase()));
		if (matches.length === 0) return false;
		const exact = matches.findIndex((value) => value === current);
		const next = matches[exact >= 0 ? (exact + 1) % matches.length : 0];
		entry.inputState = inp(next);
		return true;
	}
	private refresh(): void {
		this.tui.requestRender();
	}

	// ═════════════════════════════════════════════════════════════════════════
	// Input

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.done(null);
			return;
		}

		// A string field with runtime completions keeps manual editing intact;
		// Tab completes a matching value before it moves focus to the next field.
		const currentEntry = this.entries[this.focusIdx];
		if (
			matchesKey(data, Key.tab) &&
			currentEntry?.kind === "field" &&
			currentEntry.field.type === "string" &&
			this.completeStringField(currentEntry, currentEntry.field)
		) {
			this.refresh();
			return;
		}

		// Navigation — skip sections
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			const prev = this.focusIdx;
			do {
				this.focusIdx = Math.max(0, this.focusIdx - 1);
			} while (this.focusIdx > 0 && this.isSectionEntry(this.focusIdx));
			// If we landed on a leading section (nothing focusable above), stay put
			const landed = this.entries[this.focusIdx];
			if (landed.kind === "field" && landed.field.type === "section") this.focusIdx = prev;
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			do {
				this.focusIdx = Math.min(this.entries.length - 1, this.focusIdx + 1);
			} while (this.focusIdx < this.entries.length - 1 && this.isSectionEntry(this.focusIdx));
			this.refresh();
			return;
		}

		const entry = this.entries[this.focusIdx];

		if (entry.kind === "action") {
			if (matchesKey(data, Key.enter)) {
				switch (entry.action) {
					case "save":
						this.done(this.collectValues());
						return;
					case "cancel":
						this.done(null);
						return;
					case "reset":
						this.buildEntries(this.reg.defaults);
						break;
				}
			}
			this.refresh();
			return;
		}

		// Field input
		const f = entry.field;

		switch (f.type) {
			case "string":
				inpKey(entry.inputState, data);
				break;

			case "secret":
				if (matchesKey(data, Key.enter) && !entry.secretVisible) {
					entry.secretVisible = true;
				} else if (entry.secretVisible) {
					if (matchesKey(data, Key.enter)) {
						entry.secretVisible = false;
					} else {
						inpKey(entry.inputState, data);
					}
				}
				break;

			case "number":
				this.handleNumberInput(entry, f as NumberField, data);
				break;

			case "boolean":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
					entry.boolVal = !entry.boolVal;
				}
				break;

			case "select": {
				const sf = f as SelectField;
				const idx = entry.selectIdx ?? 0;
				if (matchesKey(data, Key.left)) {
					entry.selectIdx = (idx - 1 + sf.options.length) % sf.options.length;
				} else if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
					entry.selectIdx = (idx + 1) % sf.options.length;
				}
				break;
			}
		}

		this.refresh();
	}

	private isSectionEntry(index: number): boolean {
		const entry = this.entries[index];
		return entry.kind === "field" && entry.field.type === "section";
	}

	private handleNumberInput(entry: FormEntry & { kind: "field" }, field: NumberField, data: string): void {
		const step = field.step ?? this.autoStep(Number.parseInt(entry.inputState.text, 10) || 0);
		if (matchesKey(data, Key.left)) {
			let val = (parseFloat(entry.inputState.text) || 0) - step;
			if (field.min !== undefined) val = Math.max(field.min, val);
			entry.inputState = inp(String(val));
			return;
		}
		if (matchesKey(data, Key.right)) {
			let val = (parseFloat(entry.inputState.text) || 0) + step;
			if (field.max !== undefined) val = Math.min(field.max, val);
			entry.inputState = inp(String(val));
			return;
		}
		if (
			matchesKey(data, Key.backspace) ||
			matchesKey(data, Key.delete) ||
			matchesKey(data, Key.home) ||
			matchesKey(data, Key.end)
		) {
			inpKey(entry.inputState, data);
			return;
		}
		// Strip bracketed paste markers, then filter digits only
		let raw = data;
		if (raw.startsWith("\x1b[200~")) raw = raw.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
		else if (raw.startsWith("\x1b")) return; // ignore other escape sequences
		let digits = "";
		for (const ch of raw) {
			if ((ch >= "0" && ch <= "9") || ch === ".") digits += ch;
		}
		if (digits.length > 0) {
			entry.inputState.text =
				entry.inputState.text.slice(0, entry.inputState.cursor) +
				digits +
				entry.inputState.text.slice(entry.inputState.cursor);
			entry.inputState.cursor += digits.length;
		}
	}

	private autoStep(current: number): number {
		if (current >= 10000) return 5000;
		if (current >= 1000) return 1000;
		if (current >= 100) return 100;
		if (current >= 10) return 10;
		return 1;
	}

	// ═════════════════════════════════════════════════════════════════════════
	// Rendering
	// ═════════════════════════════════════════════════════════════════════════

	render(width: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const PAD = 20;
		const fieldW = width - PAD - 6;

		// Top
		this.hr(lines, width);
		lines.push(th.fg("accent", th.bold(` ${this.reg.icon || "⚙"} ${localize(this.reg.label, this.lang)}`)));
		lines.push("");

		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			const active = i === this.focusIdx;

			if (entry.kind === "action") {
				// Render action buttons on a single line (collect consecutive actions)
				if (entry.action === "save") {
					const saveActive = i === this.focusIdx;
					const cancelActive = i + 1 === this.focusIdx;
					const resetActive = i + 2 === this.focusIdx;
					lines.push(
						"   " +
							this.btn(t.btnSave, saveActive, "success") +
							"   " +
							this.btn(t.btnCancel, cancelActive, cancelActive ? "error" : "muted") +
							"   " +
							this.btn(t.btnReset, resetActive, "warning"),
					);
					i += 2; // skip cancel + reset entries
				}
				continue;
			}

			const f = entry.field;
			const label = localize(f.label, this.lang);
			const hint = f.hint ? localize(f.hint, this.lang) : undefined;

			// Section header
			if (f.type === "section") {
				lines.push("");
				lines.push("  " + th.fg("accent", th.bold(`◆ ${label}`)));
				lines.push("");
				continue;
			}

			// Field row
			const pfx = active ? th.fg("accent", " ▶ ") : "   ";
			const lbl = active ? th.fg("accent", label.padEnd(PAD)) : th.fg("text", label.padEnd(PAD));

			// Env var badge
			const envActive = f.envVar && process.env[f.envVar];
			const envBadge = envActive ? " " + th.bg("toolPendingBg", th.fg("warning", ` ${t.envOverride} `)) : "";

			switch (f.type) {
				case "string": {
					const placeholder = f.placeholder ? localize(f.placeholder, this.lang) : "";
					lines.push(truncateToWidth(pfx + lbl, width));
					if (active) {
						lines.push("     " + renderInp(entry.inputState, true, this.focused, th, fieldW, placeholder));
						if (hint) lines.push("     " + th.fg("dim", hint));
					} else {
						lines.push(
							"     " +
								truncateToWidth(th.fg("text", entry.inputState.text || th.fg("dim", placeholder)), fieldW) +
								envBadge,
						);
					}
					lines.push("");
					break;
				}

				case "secret": {
					const placeholder = f.placeholder ? localize(f.placeholder, this.lang) : "";
					lines.push(truncateToWidth(pfx + lbl, width));
					if (active) {
						if (entry.secretVisible) {
							lines.push("     " + renderInp(entry.inputState, true, this.focused, th, fieldW, placeholder));
							lines.push("     " + th.fg("dim", t.hideSecret));
						} else {
							const masked = entry.inputState.text
								? maskSecret(entry.inputState.text)
								: th.fg("dim", "(not set)");
							lines.push("     " + masked + "  " + th.fg("accent", t.showSecret));
						}
						if (hint) lines.push("     " + th.fg("dim", hint));
					} else {
						const indicator = entry.inputState.text
							? th.fg("success", "● ") + th.fg("text", maskSecret(entry.inputState.text))
							: th.fg("error", "○ ") + th.fg("dim", "(not set)");
						lines.push("     " + indicator + envBadge);
					}
					lines.push("");
					break;
				}

				case "number": {
					const placeholder = f.placeholder ? localize(f.placeholder, this.lang) : "0";
					lines.push(truncateToWidth(pfx + lbl, width));
					if (active) {
						lines.push(
							"     " +
								renderInp(entry.inputState, true, this.focused, th, fieldW, placeholder) +
								"  " +
								th.fg("dim", t.switchHint),
						);
						if (hint) lines.push("     " + th.fg("dim", hint));
					} else {
						lines.push("     " + th.fg("text", entry.inputState.text || "0") + envBadge);
					}
					lines.push("");
					break;
				}

				case "boolean": {
					lines.push(truncateToWidth(pfx + lbl + toggleStr(entry.boolVal ?? false, th) + envBadge, width));
					if (active && hint) lines.push("     " + th.fg("dim", hint));
					lines.push("");
					break;
				}

				case "select": {
					const sf = f as SelectField;
					const idx = entry.selectIdx ?? 0;
					lines.push(truncateToWidth(pfx + lbl, width));
					if (active) {
						const optDisp = sf.options
							.map((o, oi) =>
								oi === idx ? th.bg("selectedBg", th.fg("accent", ` ${o} `)) : th.fg("dim", ` ${o} `),
							)
							.join(th.fg("dim", "│"));
						lines.push("     " + truncateToWidth(optDisp, fieldW));
						if (hint) lines.push("     " + th.fg("dim", hint));
					} else {
						lines.push("     " + th.fg("text", sf.options[idx] || "") + envBadge);
					}
					lines.push("");
					break;
				}
			}
		}

		// Footer
		lines.push("");
		lines.push(th.fg("dim", ` ${t.formNav}`));
		this.hr(lines, width);

		return lines.map((l) => truncateToWidth(l, width));
	}

	invalidate(): void {}

	// ── Helpers ──────────────────────────────────────────────────────────

	private hr(lines: string[], w: number): void {
		lines.push(this.th.fg("accent", "─".repeat(w)));
	}

	private btn(label: string, active: boolean, color: "success" | "error" | "accent" | "muted" | "warning"): string {
		return active ? this.th.bg("selectedBg", this.th.fg(color, ` ${label} `)) : this.th.fg(color, ` ${label} `);
	}
}
