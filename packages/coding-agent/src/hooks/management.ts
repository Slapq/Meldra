import type { HookSettingsLayer } from "../core/settings-manager.ts";
import { resolveMeldraHooks } from "./config.ts";
import {
	MELDRA_HOOK_EVENTS,
	type MeldraCommandHook,
	type MeldraHookEventName,
	type MeldraHookMatcherGroup,
	type MeldraHookSource,
	type MeldraHooksSettings,
} from "./types.ts";

export interface MeldraHookImportResult {
	layer: HookSettingsLayer;
	ignoredFields: string[];
}

export interface MeldraHookEntry {
	event: MeldraHookEventName;
	groupIndex: number;
	hookIndex: number;
	matcher?: string;
	hook: MeldraCommandHook;
}

export interface MeldraHookDraft {
	matcher?: string;
	hook: MeldraCommandHook;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeHook(value: MeldraCommandHook): MeldraCommandHook {
	return {
		type: "command",
		command: value.command,
		...(value.args === undefined ? {} : { args: [...value.args] }),
		...(value.timeout === undefined ? {} : { timeout: value.timeout }),
		...(value.shell === undefined ? {} : { shell: value.shell }),
		...(value.if === undefined ? {} : { if: value.if }),
		...(value.disabled === undefined ? {} : { disabled: value.disabled }),
	};
}

function normalizeHooksSettings(value: unknown): MeldraHooksSettings {
	const raw = value as Record<string, MeldraHookMatcherGroup[]>;
	const hooks: MeldraHooksSettings = {};
	for (const event of MELDRA_HOOK_EVENTS) {
		const groups = raw[event];
		if (groups === undefined) continue;
		hooks[event] = groups.map((group) => ({
			...(group.matcher === undefined ? {} : { matcher: group.matcher }),
			hooks: group.hooks.map(normalizeHook),
		}));
	}
	return hooks;
}

export function validateMeldraHookSettingsLayer(
	layer: HookSettingsLayer,
	source: MeldraHookSource,
): string[] {
	if (layer.disableAllHooks !== undefined && typeof layer.disableAllHooks !== "boolean") {
		return [`${source} disableAllHooks must be a boolean`];
	}
	if (layer.shellPath !== undefined && (typeof layer.shellPath !== "string" || !layer.shellPath.trim())) {
		return [`${source} shellPath must be a non-empty string`];
	}
	return resolveMeldraHooks([
		{ source, hooks: layer.hooks, disableAllHooks: layer.disableAllHooks },
	]).diagnostics;
}

export function parseMeldraHooksImport(value: unknown, source: MeldraHookSource): MeldraHookImportResult {
	if (!isRecord(value)) throw new Error("Hook import must be a JSON object");
	const isSettingsEnvelope = "hooks" in value || "disableAllHooks" in value || "shellPath" in value;
	const ignoredFields = isSettingsEnvelope
		? Object.keys(value).filter((key) => !["hooks", "disableAllHooks", "shellPath"].includes(key))
		: [];
	const layer: HookSettingsLayer = isSettingsEnvelope
		? {
				...(value.hooks === undefined ? {} : { hooks: value.hooks as MeldraHooksSettings }),
				...(value.disableAllHooks === undefined ? {} : { disableAllHooks: value.disableAllHooks as boolean }),
				...(value.shellPath === undefined ? {} : { shellPath: value.shellPath as string }),
			}
		: { hooks: value as MeldraHooksSettings };
	const diagnostics = validateMeldraHookSettingsLayer(layer, source);
	if (diagnostics.length > 0) throw new Error(diagnostics.join("\n"));
	return {
		layer: {
			...(layer.hooks === undefined ? {} : { hooks: normalizeHooksSettings(layer.hooks) }),
			...(layer.disableAllHooks === undefined ? {} : { disableAllHooks: layer.disableAllHooks }),
			...(layer.shellPath === undefined ? {} : { shellPath: layer.shellPath }),
		},
		ignoredFields,
	};
}

export function parseMeldraHooksImportText(text: string, source: MeldraHookSource): MeldraHookImportResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid Hook JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	return parseMeldraHooksImport(value, source);
}

function hookIdentity(hook: MeldraCommandHook): string {
	return JSON.stringify(normalizeHook(hook));
}

export function mergeMeldraHookSettingsLayers(
	current: HookSettingsLayer,
	incoming: HookSettingsLayer,
): HookSettingsLayer {
	const result = structuredClone(current);
	if (incoming.hooks !== undefined) {
		const hooks = structuredClone(result.hooks ?? {});
		for (const event of MELDRA_HOOK_EVENTS) {
			const importedGroups = incoming.hooks[event];
			if (!importedGroups) continue;
			const groups = (hooks[event] ??= []);
			for (const importedGroup of importedGroups) {
				let target = groups.find((group) => (group.matcher ?? "") === (importedGroup.matcher ?? ""));
				if (!target) {
					target = { ...("matcher" in importedGroup ? { matcher: importedGroup.matcher } : {}), hooks: [] };
					groups.push(target);
				}
				const seen = new Set(target.hooks.map(hookIdentity));
				for (const hook of importedGroup.hooks) {
					const identity = hookIdentity(hook);
					if (seen.has(identity)) continue;
					seen.add(identity);
					target.hooks.push(normalizeHook(hook));
				}
			}
		}
		result.hooks = hooks;
	}
	if (incoming.disableAllHooks !== undefined) result.disableAllHooks = incoming.disableAllHooks;
	if (incoming.shellPath !== undefined) result.shellPath = incoming.shellPath;
	return result;
}

export function replaceMeldraHookSettingsLayer(
	current: HookSettingsLayer,
	incoming: HookSettingsLayer,
): HookSettingsLayer {
	return {
		...structuredClone(current),
		...(incoming.hooks === undefined ? {} : { hooks: structuredClone(incoming.hooks) }),
		...(incoming.disableAllHooks === undefined ? {} : { disableAllHooks: incoming.disableAllHooks }),
		...(incoming.shellPath === undefined ? {} : { shellPath: incoming.shellPath }),
	};
}

export function hookEntriesForEvent(layer: HookSettingsLayer, event: MeldraHookEventName): MeldraHookEntry[] {
	const entries: MeldraHookEntry[] = [];
	const rawHooks = isRecord(layer.hooks) ? layer.hooks : {};
	const groups = rawHooks[event];
	if (!Array.isArray(groups)) return entries;
	for (const [groupIndex, rawGroup] of groups.entries()) {
		if (!isRecord(rawGroup) || !Array.isArray(rawGroup.hooks)) continue;
		for (const [hookIndex, rawHook] of rawGroup.hooks.entries()) {
			if (!isRecord(rawHook) || rawHook.type !== "command" || typeof rawHook.command !== "string") continue;
			entries.push({
				event,
				groupIndex,
				hookIndex,
				...(typeof rawGroup.matcher === "string" ? { matcher: rawGroup.matcher } : {}),
				hook: rawHook as unknown as MeldraCommandHook,
			});
		}
	}
	return entries;
}

export function parseMeldraHookDraft(text: string, event: MeldraHookEventName): MeldraHookDraft {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid Hook JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(value) || !isRecord(value.hook)) {
		throw new Error('Hook draft must contain one { "matcher": "...", "hook": { ... } } object');
	}
	const parsed = parseMeldraHooksImport(
		{
			[event]: [
				{
					...(value.matcher === undefined ? {} : { matcher: value.matcher }),
					hooks: [value.hook],
				},
			],
		},
		"profile",
	);
	const group = parsed.layer.hooks?.[event]?.[0];
	const hook = group?.hooks[0];
	if (!group || !hook) throw new Error("Hook draft did not contain one valid command handler");
	return { matcher: group.matcher, hook };
}

function removeEntry(layer: HookSettingsLayer, entry: MeldraHookEntry): HookSettingsLayer {
	const result = structuredClone(layer);
	const groups = result.hooks?.[entry.event];
	const group = groups?.[entry.groupIndex];
	if (!groups || !group) return result;
	group.hooks.splice(entry.hookIndex, 1);
	if (group.hooks.length === 0) groups.splice(entry.groupIndex, 1);
	if (groups.length === 0) delete result.hooks?.[entry.event];
	return result;
}

export function putMeldraHookEntry(
	layer: HookSettingsLayer,
	event: MeldraHookEventName,
	draft: MeldraHookDraft,
	existing?: MeldraHookEntry,
): HookSettingsLayer {
	const result = existing ? removeEntry(layer, existing) : structuredClone(layer);
	const hooks = (result.hooks ??= {});
	const groups = (hooks[event] ??= []);
	let group = groups.find((candidate) => (candidate.matcher ?? "") === (draft.matcher ?? ""));
	if (!group) {
		group = { ...(draft.matcher === undefined ? {} : { matcher: draft.matcher }), hooks: [] };
		groups.push(group);
	}
	group.hooks.push(normalizeHook(draft.hook));
	return result;
}

export function removeMeldraHookEntry(layer: HookSettingsLayer, entry: MeldraHookEntry): HookSettingsLayer {
	return removeEntry(layer, entry);
}

export function toggleMeldraHookEntry(layer: HookSettingsLayer, entry: MeldraHookEntry): HookSettingsLayer {
	const result = structuredClone(layer);
	const hook = result.hooks?.[entry.event]?.[entry.groupIndex]?.hooks[entry.hookIndex];
	if (!hook) return result;
	hook.disabled = hook.disabled !== true;
	return result;
}

export function setMeldraHookEventDisabled(
	layer: HookSettingsLayer,
	event: MeldraHookEventName,
	disabled: boolean,
): HookSettingsLayer {
	const result = structuredClone(layer);
	const groups = result.hooks?.[event];
	if (!Array.isArray(groups)) return result;
	for (const group of groups) {
		if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
		for (const hook of group.hooks) {
			if (isRecord(hook) && hook.type === "command") hook.disabled = disabled;
		}
	}
	return result;
}

export function countMeldraHookHandlers(layer: HookSettingsLayer): number {
	let count = 0;
	for (const event of MELDRA_HOOK_EVENTS) count += hookEntriesForEvent(layer, event).length;
	return count;
}
