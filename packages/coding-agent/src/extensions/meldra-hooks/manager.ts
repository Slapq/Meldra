import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type {
	HookSettingsLayer,
	HookSettingsSnapshot,
	HookSettingsWriteScope,
} from "../../core/settings-manager.ts";
import {
	countMeldraHookHandlers,
	hookEntriesForEvent,
	mergeMeldraHookSettingsLayers,
	parseMeldraHookDraft,
	parseMeldraHooksImportText,
	putMeldraHookEntry,
	removeMeldraHookEntry,
	replaceMeldraHookSettingsLayer,
	resolveMeldraHooks,
	setMeldraHookEventDisabled,
	toggleMeldraHookEntry,
	validateMeldraHookSettingsLayer,
	type MeldraCommandHook,
	type MeldraHookEntry,
	type MeldraHookEventName,
} from "../../hooks/index.ts";
import { detectHooksManagerLanguage } from "./language.ts";
import {
	HOOK_EVENT_CATEGORIES,
	HOOKS_MANAGER_LANGS,
	selectHooksPage,
	type HooksEventCategory,
	type HooksManagerI18n,
	type HooksManagerLang,
	type HooksPageItem,
} from "./ui.ts";

const MAX_HOOK_IMPORT_BYTES = 1_000_000;

export interface MeldraHooksManagementOptions {
	isProjectTrusted(): boolean;
	readEditable(): HookSettingsSnapshot;
	readEffective(): HookSettingsSnapshot;
	write(scope: HookSettingsWriteScope, layer: HookSettingsLayer): Promise<void>;
	loadLanguage(): HooksManagerLang | undefined;
	saveLanguage(lang: HooksManagerLang): void;
}

export interface ShowMeldraHooksManagerOptions {
	management: MeldraHooksManagementOptions;
	hotReload: boolean;
	getHotReloadDiagnostics(): string[];
}

function layerForScope(snapshot: HookSettingsSnapshot, scope: HookSettingsWriteScope): HookSettingsLayer {
	return scope === "profile" ? snapshot.profile : snapshot.project;
}

function scopeLabel(scope: HookSettingsWriteScope, t: HooksManagerI18n): string {
	return scope === "profile" ? t.profileScope : t.projectScope;
}

function readErrorForScope(
	snapshot: HookSettingsSnapshot,
	scope: HookSettingsWriteScope,
	t: HooksManagerI18n,
): string | undefined {
	const storageScope = scope === "profile" ? "global" : "project";
	const error = snapshot.errors.find((entry) => entry.scope === storageScope);
	return error ? t.settingsCannotEdit(scopeLabel(scope, t), error.error.message) : undefined;
}

export function hookCommandPreview(hook: MeldraCommandHook): string {
	if (hook.args === undefined) return hook.command;
	const compactPath = (part: string): string => {
		const separator = Math.max(part.lastIndexOf("/"), part.lastIndexOf("\\"));
		return separator >= 0 ? `…/${part.slice(separator + 1)}` : part;
	};
	return [hook.command, ...hook.args].map(compactPath).join(" ");
}

function hookDraftJson(entry?: MeldraHookEntry): string {
	return JSON.stringify(
		{
			matcher: entry?.matcher ?? "",
			hook: entry?.hook ?? {
				type: "command",
				command: "node",
				args: ["${MELDRA_PROJECT_DIR}/.pi/hooks/example.mjs"],
				timeout: 10,
			},
		},
		null,
		2,
	);
}

function importSummary(layer: HookSettingsLayer, t: HooksManagerI18n): string {
	const events = Object.values(layer.hooks ?? {}).filter((groups) => Array.isArray(groups) && groups.length > 0).length;
	return `${t.eventCount(events)}, ${t.handlerCount(countMeldraHookHandlers(layer))}${
		layer.disableAllHooks === undefined ? "" : `, disableAllHooks=${String(layer.disableAllHooks)}`
	}${layer.shellPath === undefined ? "" : `, shellPath=${layer.shellPath}`}`;
}

function readImportFile(cwd: string, requestedPath: string, t: HooksManagerI18n): string {
	const path = isAbsolute(requestedPath) ? requestedPath : resolve(cwd, requestedPath);
	const stat = statSync(path);
	if (!stat.isFile()) throw new Error(t.importNotFile(path));
	if (stat.size > MAX_HOOK_IMPORT_BYTES) {
		throw new Error(t.importTooLarge(MAX_HOOK_IMPORT_BYTES.toLocaleString()));
	}
	return readFileSync(path, "utf8");
}

function effectiveState(options: ShowMeldraHooksManagerOptions) {
	const snapshot = options.management.readEffective();
	const resolved = resolveMeldraHooks([
		{ source: "profile", hooks: snapshot.profile.hooks, disableAllHooks: snapshot.profile.disableAllHooks },
		{ source: "project", hooks: snapshot.project.hooks, disableAllHooks: snapshot.project.disableAllHooks },
	]);
	const total = Object.values(resolved.events).reduce((sum, hooks) => sum + hooks.length, 0);
	const active = resolved.disabled
		? 0
		: Object.values(resolved.events).reduce(
				(sum, hooks) => sum + hooks.filter((hook) => hook.disabled !== true).length,
				0,
			);
	return { snapshot, resolved, total, active };
}

async function writeLayer(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	layer: HookSettingsLayer,
	t: HooksManagerI18n,
): Promise<boolean> {
	const diagnostics = validateMeldraHookSettingsLayer(layer, scope);
	if (diagnostics.length > 0) {
		ctx.ui.notify(diagnostics.join("\n"), "error");
		return false;
	}
	try {
		await options.management.write(scope, layer);
		ctx.ui.notify(`${t.saved(scopeLabel(scope, t))}; ${t.reloadPending}`, "info");
		return true;
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		return false;
	}
}

async function importHooks(
	ctx: ExtensionCommandContext,
	scope: HookSettingsWriteScope,
	current: HookSettingsLayer,
	t: HooksManagerI18n,
): Promise<HookSettingsLayer | undefined> {
	const source = await ctx.ui.select(t.importTitle, [t.pasteJson, t.readJsonFile, t.cancel]);
	if (!source || source === t.cancel) return undefined;
	let text: string | undefined;
	if (source === t.pasteJson) {
		text = await ctx.ui.editor(
			`${t.importTitle} · ${scopeLabel(scope, t)}`,
			'{\n  "hooks": {\n    "AgentEnd": []\n  }\n}',
		);
	} else {
		const requestedPath = await ctx.ui.input(t.jsonFile, "hooks.json");
		if (!requestedPath?.trim()) return undefined;
		text = readImportFile(ctx.cwd, requestedPath.trim(), t);
	}
	if (text === undefined) return undefined;
	const imported = parseMeldraHooksImportText(text, scope);
	if (imported.ignoredFields.length > 0) {
		ctx.ui.notify(t.ignoredFields(imported.ignoredFields.join(", ")), "warning");
	}
	const mode = await ctx.ui.select(t.importMode, [t.merge, t.replace, t.cancel]);
	if (!mode || mode === t.cancel) return undefined;
	const next =
		mode === t.merge
			? mergeMeldraHookSettingsLayers(current, imported.layer)
			: replaceMeldraHookSettingsLayer(current, imported.layer);
	const confirmed = await ctx.ui.confirm(
		t.importConfirmTitle(mode, scopeLabel(scope, t)),
		t.importConfirmBody(importSummary(imported.layer, t)),
	);
	return confirmed ? next : undefined;
}

function rootSubtitle(
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	t: HooksManagerI18n,
): string {
	const effective = effectiveState(options);
	const state = effective.resolved.disabled ? t.effectiveDisabled : t.effectiveEnabled;
	const diagnostics = [
		...effective.resolved.diagnostics,
		...effective.snapshot.errors,
		...options.getHotReloadDiagnostics(),
	].length;
	return `${scopeLabel(scope, t)} · ${state} · ${t.activeCount(effective.active, effective.total)} · ${
		options.hotReload ? t.liveReload : t.manualReload
	}${diagnostics > 0 ? ` · ${t.diagnostics}: ${diagnostics}` : ""}${
		options.management.isProjectTrusted() ? "" : ` · ${t.projectUntrusted}`
	}`;
}

function categoryItems(
	layer: HookSettingsLayer,
	t: HooksManagerI18n,
): HooksPageItem<HooksEventCategory["id"]>[] {
	return HOOK_EVENT_CATEGORIES.map((category) => {
		const count = category.events.reduce(
			(sum, event) => sum + hookEntriesForEvent(layer, event).length,
			0,
		);
		return {
			value: category.id,
			label: t.categoryLabel[category.id],
			description: `${t.categoryDescription[category.id]} · ${t.handlerCount(count)}`,
		};
	});
}

function eventItems(layer: HookSettingsLayer, category: HooksEventCategory, t: HooksManagerI18n) {
	return category.events.map((event) => {
		const entries = hookEntriesForEvent(layer, event);
		const active = entries.filter((entry) => entry.hook.disabled !== true).length;
		return {
			value: event,
			label: event,
			description: `${t.eventDescription[event]} · ${t.activeCount(active, entries.length)}`,
		};
	});
}

async function manageHandler(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	event: MeldraHookEventName,
	entry: MeldraHookEntry,
	t: HooksManagerI18n,
): Promise<void> {
	const stateAction = entry.hook.disabled === true ? t.enableHandler : t.disableHandler;
	const selected = await ctx.ui.select(t.handlerActions, [t.editHandler, stateAction, t.deleteHandler, t.back]);
	if (!selected || selected === t.back) return;
	const editable = options.management.readEditable();
	const current = layerForScope(editable, scope);
	const readError = readErrorForScope(editable, scope, t);
	if (readError) throw new Error(readError);
	if (selected === t.editHandler) {
		const raw = await ctx.ui.editor(t.editTitle(event), hookDraftJson(entry));
		if (raw === undefined) return;
		const draft = parseMeldraHookDraft(raw, event);
		await writeLayer(ctx, options, scope, putMeldraHookEntry(current, event, draft, entry), t);
		return;
	}
	if (selected === stateAction) {
		await writeLayer(ctx, options, scope, toggleMeldraHookEntry(current, entry), t);
		return;
	}
	if (selected === t.deleteHandler) {
		const confirmed = await ctx.ui.confirm(t.deleteTitle, t.deleteConfirm(hookCommandPreview(entry.hook), scopeLabel(scope, t)));
		if (confirmed) await writeLayer(ctx, options, scope, removeMeldraHookEntry(current, entry), t);
	}
}

async function manageEventActions(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	event: MeldraHookEventName,
	t: HooksManagerI18n,
): Promise<void> {
	const editable = options.management.readEditable();
	const current = layerForScope(editable, scope);
	const readError = readErrorForScope(editable, scope, t);
	if (readError) throw new Error(readError);
	const entries = hookEntriesForEvent(current, event);
	const disable = entries.some((entry) => entry.hook.disabled !== true);
	const toggle = disable ? t.disableEvent : t.enableEvent;
	const selected = await ctx.ui.select(t.eventActions, [t.addHandler, ...(entries.length ? [toggle] : []), t.back]);
	if (!selected || selected === t.back) return;
	if (selected === t.addHandler) {
		const raw = await ctx.ui.editor(t.addTitle(event), hookDraftJson());
		if (raw === undefined) return;
		const draft = parseMeldraHookDraft(raw, event);
		await writeLayer(ctx, options, scope, putMeldraHookEntry(current, event, draft), t);
		return;
	}
	if (selected === toggle) {
		const confirmed = await ctx.ui.confirm(
			t.eventToggleTitle(disable, event),
			t.eventToggleConfirm(entries.length, scopeLabel(scope, t)),
		);
		if (confirmed) await writeLayer(ctx, options, scope, setMeldraHookEventDisabled(current, event, disable), t);
	}
}

async function showEvent(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	event: MeldraHookEventName,
	t: HooksManagerI18n,
): Promise<void> {
	while (true) {
		const editable = options.management.readEditable();
		const layer = layerForScope(editable, scope);
		const entries = hookEntriesForEvent(layer, event);
		const items: HooksPageItem<string>[] = [
			{ value: "__actions__", label: t.eventActions, description: t.eventActionsDescription },
			...entries.map((entry, index) => ({
				value: `handler:${index}`,
				label: hookCommandPreview(entry.hook),
				description: `${entry.hook.disabled === true ? t.stateDisabled : t.stateEnabled} · ${t.matcher}: ${entry.matcher || "*"}${
					entry.hook.if ? ` · ${t.condition}: ${entry.hook.if}` : ""
				}`,
			})),
		];
		if (entries.length === 0) items[0]!.description = `${t.eventActionsDescription} · ${t.noHandlers}`;
		const selected = await selectHooksPage(
			ctx,
			event,
			`${scopeLabel(scope, t)} · ${t.eventDescription[event]}`,
			items,
			t.selectNav,
		);
		if (!selected) return;
		try {
			if (selected === "__actions__") await manageEventActions(ctx, options, scope, event, t);
			else {
				const index = Number.parseInt(selected.slice("handler:".length), 10);
				const entry = entries[index];
				if (entry) await manageHandler(ctx, options, scope, event, entry, t);
			}
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}
}

async function showCategory(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	category: HooksEventCategory,
	t: HooksManagerI18n,
): Promise<void> {
	while (true) {
		const layer = layerForScope(options.management.readEditable(), scope);
		const selected = await selectHooksPage(
			ctx,
			t.categoryLabel[category.id],
			`${scopeLabel(scope, t)} · ${t.categoryDescription[category.id]}`,
			eventItems(layer, category, t),
			t.selectNav,
		);
		if (!selected) return;
		await showEvent(ctx, options, scope, selected, t);
	}
}

async function showManagement(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
	scope: HookSettingsWriteScope,
	lang: HooksManagerLang,
): Promise<{ scope: HookSettingsWriteScope; lang: HooksManagerLang }> {
	const t = HOOKS_MANAGER_LANGS[lang];
	const selected = await ctx.ui.select(t.managementActions, [
		t.switchScope,
		t.importHooks,
		t.globalState,
		t.shellPath,
		t.editSource,
		t.viewDiagnostics,
		`${t.language} · ${lang === "en" ? "English" : "中文"}`,
		t.back,
	]);
	if (!selected || selected === t.back) return { scope, lang };
	if (selected === t.switchScope) {
		const choices = [t.profileScope, ...(options.management.isProjectTrusted() ? [t.projectScope] : [])];
		const picked = await ctx.ui.select(t.switchScope, choices);
		if (picked === t.profileScope) scope = "profile";
		else if (picked === t.projectScope) scope = "project";
		return { scope, lang };
	}
	if (selected === t.viewDiagnostics) {
		const effective = effectiveState(options);
		const messages = [
			...effective.resolved.diagnostics,
			...effective.snapshot.errors.map(({ scope: errorScope, error }) => `${errorScope}: ${error.message}`),
			...options.getHotReloadDiagnostics(),
		];
		await ctx.ui.select(t.diagnostics, messages.length > 0 ? messages : [t.noDiagnostics]);
		return { scope, lang };
	}
	if (selected.startsWith(t.language)) {
		const picked = await ctx.ui.select(t.selectLanguage, ["English", "中文"]);
		if (picked === "English") lang = "en";
		else if (picked === "中文") lang = "zh";
		if (picked) options.management.saveLanguage(lang);
		return { scope, lang };
	}

	const editable = options.management.readEditable();
	const readError = readErrorForScope(editable, scope, t);
	if (readError) throw new Error(readError);
	const current = layerForScope(editable, scope);
	if (selected === t.importHooks) {
		const next = await importHooks(ctx, scope, current, t);
		if (next) await writeLayer(ctx, options, scope, next, t);
	} else if (selected === t.globalState) {
		const choice = await ctx.ui.select(t.globalStateTitle(scopeLabel(scope, t)), [
			t.enableAll,
			t.disableAll,
			t.inherit,
			t.cancel,
		]);
		if (choice && choice !== t.cancel) {
			const next = structuredClone(current);
			if (choice === t.inherit) delete next.disableAllHooks;
			else next.disableAllHooks = choice === t.disableAll;
			await writeLayer(ctx, options, scope, next, t);
		}
	} else if (selected === t.shellPath) {
		const raw = await ctx.ui.input(t.shellPathTitle(scopeLabel(scope, t)), current.shellPath ?? "");
		if (raw !== undefined) {
			const next = structuredClone(current);
			if (raw.trim()) next.shellPath = raw.trim();
			else delete next.shellPath;
			await writeLayer(ctx, options, scope, next, t);
		}
	} else if (selected === t.editSource) {
		const raw = await ctx.ui.editor(t.sourceEditTitle(scopeLabel(scope, t)), JSON.stringify(current, null, 2));
		if (raw !== undefined) {
			const parsed = parseMeldraHooksImportText(raw, scope);
			if (parsed.ignoredFields.length > 0) {
				ctx.ui.notify(t.ignoredFields(parsed.ignoredFields.join(", ")), "warning");
			}
			await writeLayer(ctx, options, scope, parsed.layer, t);
		}
	}
	return { scope, lang };
}

export async function showMeldraHooksManager(
	ctx: ExtensionCommandContext,
	options: ShowMeldraHooksManagerOptions,
): Promise<void> {
	let lang = options.management.loadLanguage() ?? detectHooksManagerLanguage();
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify(HOOKS_MANAGER_LANGS[lang].requiresTui, "error");
		return;
	}
	let scope: HookSettingsWriteScope = "profile";
	while (true) {
		const t = HOOKS_MANAGER_LANGS[lang];
		const editable = options.management.readEditable();
		const layer = layerForScope(editable, scope);
		const rootItems: HooksPageItem<string>[] = [
			{ value: "__management__", label: t.management, description: t.managementDescription },
			...categoryItems(layer, t),
		];
		const selected = await selectHooksPage(
			ctx,
			t.title,
			rootSubtitle(options, scope, t),
			rootItems,
			t.selectNav,
		);
		if (!selected) return;
		try {
			if (selected === "__management__") {
				const next = await showManagement(ctx, options, scope, lang);
				scope = next.scope;
				lang = next.lang;
				continue;
			}
			const category = HOOK_EVENT_CATEGORIES.find((item) => item.id === selected);
			if (category) await showCategory(ctx, options, scope, category, t);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}
}
