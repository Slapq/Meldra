import { MELDRA_TOOL_HOOK_EVENTS, matchesHookCondition, validateHookCondition } from "./condition.ts";
import {
	MELDRA_HOOK_EVENTS,
	type MeldraCommandHook,
	type MeldraHookEventName,
	type MeldraHookMatcherGroup,
	type MeldraHookSource,
	type ResolvedMeldraCommandHook,
	type ResolvedMeldraHooks,
} from "./types.ts";

interface HookSettingsSource {
	source: MeldraHookSource;
	hooks: unknown;
	disableAllHooks?: unknown;
}

function emptyEvents(): Record<MeldraHookEventName, ResolvedMeldraCommandHook[]> {
	const events = {} as Record<MeldraHookEventName, ResolvedMeldraCommandHook[]>;
	for (const event of MELDRA_HOOK_EVENTS) events[event] = [];
	return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseHandler(value: unknown, path: string, eventName: MeldraHookEventName): MeldraCommandHook {
	if (!isRecord(value) || value.type !== "command") throw new Error(`${path} must be a command hook`);
	if (typeof value.command !== "string" || !value.command.trim()) throw new Error(`${path}.command must be non-empty`);
	if (
		value.args !== undefined &&
		(!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string"))
	) {
		throw new Error(`${path}.args must be an array of strings`);
	}
	if (
		value.timeout !== undefined &&
		(typeof value.timeout !== "number" || !Number.isFinite(value.timeout) || value.timeout <= 0)
	) {
		throw new Error(`${path}.timeout must be a positive finite number`);
	}
	if (value.shell !== undefined && value.shell !== "bash" && value.shell !== "powershell") {
		throw new Error(`${path}.shell must be bash or powershell`);
	}
	if (value.if !== undefined) {
		if (typeof value.if !== "string" || !validateHookCondition(value.if)) {
			throw new Error(`${path}.if must be one permission rule such as Bash(git *)`);
		}
		if (!MELDRA_TOOL_HOOK_EVENTS.has(eventName)) {
			throw new Error(`${path}.if is only supported on tool Hook events`);
		}
	}
	return {
		type: "command",
		command: value.command,
		...(value.args === undefined ? {} : { args: [...value.args] as string[] }),
		...(value.timeout === undefined ? {} : { timeout: value.timeout }),
		...(value.shell === undefined ? {} : { shell: value.shell }),
		...(value.if === undefined ? {} : { if: value.if }),
	};
}

function parseGroups(value: unknown, path: string, eventName: MeldraHookEventName): MeldraHookMatcherGroup[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((item, groupIndex) => {
		const groupPath = `${path}[${groupIndex}]`;
		if (!isRecord(item)) throw new Error(`${groupPath} must be an object`);
		if (item.matcher !== undefined && typeof item.matcher !== "string") {
			throw new Error(`${groupPath}.matcher must be a string`);
		}
		if (typeof item.matcher === "string" && item.matcher !== "" && item.matcher !== "*") {
			const exact = exactMatcherValues(item.matcher);
			if (!exact) {
				try {
					new RegExp(item.matcher);
				} catch {
					throw new Error(`${groupPath}.matcher must be a valid regular expression`);
				}
			}
		}
		if (!Array.isArray(item.hooks) || item.hooks.length === 0) {
			throw new Error(`${groupPath}.hooks must be a non-empty array`);
		}
		return {
			...(typeof item.matcher === "string" ? { matcher: item.matcher } : {}),
			hooks: item.hooks.map((hook, hookIndex) => parseHandler(hook, `${groupPath}.hooks[${hookIndex}]`, eventName)),
		};
	});
}

export function resolveMeldraHooks(sources: HookSettingsSource[]): ResolvedMeldraHooks {
	const events = emptyEvents();
	const diagnostics: string[] = [];
	const seen = new Set<string>();
	let disabled = false;

	for (const source of sources) {
		if (typeof source.disableAllHooks === "boolean") disabled = source.disableAllHooks;
		if (source.hooks === undefined) continue;
		if (!isRecord(source.hooks)) {
			diagnostics.push(`${source.source} hooks must be an object; legacy hook path arrays are not executable`);
			continue;
		}
		for (const [eventName, rawGroups] of Object.entries(source.hooks)) {
			if (!MELDRA_HOOK_EVENTS.includes(eventName as MeldraHookEventName)) {
				diagnostics.push(`${source.source} hooks.${eventName} is not supported`);
				continue;
			}
			try {
				for (const group of parseGroups(
					rawGroups,
					`${source.source} hooks.${eventName}`,
					eventName as MeldraHookEventName,
				)) {
					for (const hook of group.hooks) {
						const identity = JSON.stringify([eventName, group.matcher ?? "", hook]);
						if (seen.has(identity)) continue;
						seen.add(identity);
						events[eventName as MeldraHookEventName].push({
							...hook,
							source: source.source,
							...(group.matcher === undefined ? {} : { matcher: group.matcher }),
						});
					}
				}
			} catch (error) {
				diagnostics.push(error instanceof Error ? error.message : String(error));
			}
		}
	}
	return { disabled, events, diagnostics };
}

function exactMatcherValues(matcher: string): string[] | undefined {
	return /^[A-Za-z0-9_\- ,|]*$/.test(matcher)
		? matcher
				.split(/[|,]/)
				.map((value) => value.trim())
				.filter(Boolean)
		: undefined;
}

export function matchesMeldraHook(matcher: string | undefined, value: string): boolean {
	if (matcher === undefined || matcher === "" || matcher === "*") return true;
	const exact = exactMatcherValues(matcher);
	if (exact) return exact.includes(value);
	try {
		return new RegExp(matcher).test(value);
	} catch {
		return false;
	}
}

export function hooksForEvent(
	config: ResolvedMeldraHooks,
	event: MeldraHookEventName,
	matcherValue = "",
	input?: import("./types.ts").MeldraHookInput,
): ResolvedMeldraCommandHook[] {
	if (config.disabled) return [];
	return config.events[event].filter(
		(hook) => matchesMeldraHook(hook.matcher, matcherValue) && (!input || matchesHookCondition(hook.if, event, input)),
	);
}

const TOOL_NAMES: Record<string, string> = {
	bash: "Bash",
	pwsh: "PowerShell",
	read: "Read",
	edit: "Edit",
	write: "Write",
	grep: "Grep",
	find: "Glob",
	ls: "LS",
};

export function canonicalHookToolName(name: string): string {
	return TOOL_NAMES[name] ?? name;
}
