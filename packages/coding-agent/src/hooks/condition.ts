import { minimatch } from "minimatch";
import type { MeldraHookEventName, MeldraHookInput } from "./types.ts";

export const MELDRA_TOOL_HOOK_EVENTS = new Set<MeldraHookEventName>([
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
]);

interface ParsedHookCondition {
	toolPattern: string;
	specifier?: string;
}

const PRIMARY_INPUT_KEYS: Record<string, string[]> = {
	Bash: ["command"],
	PowerShell: ["command"],
	Read: ["path", "file_path"],
	Edit: ["path", "file_path"],
	Write: ["path", "file_path"],
	Grep: ["pattern", "path"],
	Glob: ["pattern", "path"],
	LS: ["path"],
	WebFetch: ["url"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseHookCondition(value: string): ParsedHookCondition | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const open = trimmed.indexOf("(");
	if (open < 0) return /^[A-Za-z0-9_*-]+$/.test(trimmed) ? { toolPattern: trimmed } : undefined;
	if (!trimmed.endsWith(")") || open === 0) return undefined;
	const toolPattern = trimmed.slice(0, open);
	if (!/^[A-Za-z0-9_*-]+$/.test(toolPattern)) return undefined;
	const specifier = trimmed.slice(open + 1, -1);
	if (specifier.includes("(") || specifier.includes(")")) return undefined;
	return { toolPattern, specifier };
}

export function validateHookCondition(value: string): boolean {
	return parseHookCondition(value) !== undefined;
}

function wildcardMatch(value: string, rawPattern: string, nocase = false): boolean {
	let pattern = rawPattern;
	if (pattern.endsWith(":*")) pattern = `${pattern.slice(0, -2)} *`;
	const flags = nocase ? "iu" : "u";
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
	const match = new RegExp(`^${escaped}$`, flags).test(value);
	if (match || !pattern.endsWith(" *")) return match;
	return value === pattern.slice(0, -2);
}

function toolNameMatches(toolName: string, pattern: string): boolean {
	return wildcardMatch(toolName, pattern);
}

const SHELL_WRAPPERS = new Set(["builtin", "command", "nice", "noglob", "nohup", "stdbuf", "time", "timeout", "xargs"]);
const POWERSHELL_ALIASES: Record<string, string> = {
	del: "Remove-Item",
	erase: "Remove-Item",
	rd: "Remove-Item",
	ri: "Remove-Item",
	rm: "Remove-Item",
	rmdir: "Remove-Item",
};

function isComplexShellCommand(command: string): boolean {
	if (/[\r\n;&|`$(){}<>"'\\]/u.test(command)) return true;
	const trimmed = command.trim();
	if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed)) return true;
	return SHELL_WRAPPERS.has(trimmed.split(/\s+/u, 1)[0]?.toLowerCase() ?? "");
}

function normalizePowerShellCommand(command: string): string {
	const match = /^(\S+)(.*)$/u.exec(command.trim());
	if (!match) return command.trim();
	return `${POWERSHELL_ALIASES[match[1].toLowerCase()] ?? match[1]}${match[2]}`;
}

function primaryValue(toolName: string, toolInput: Record<string, unknown>): string | undefined {
	for (const key of PRIMARY_INPUT_KEYS[toolName] ?? []) {
		if (typeof toolInput[key] === "string") return toolInput[key];
	}
	return undefined;
}

function matchPrimary(toolName: string, value: string, pattern: string): boolean {
	if (toolName === "Bash" || toolName === "PowerShell") {
		if (isComplexShellCommand(value)) return true;
		const candidate = toolName === "PowerShell" ? normalizePowerShellCommand(value) : value.trim();
		return wildcardMatch(candidate, pattern.trim(), toolName === "PowerShell");
	}
	if (PRIMARY_INPUT_KEYS[toolName]?.some((key) => key === "path" || key === "file_path")) {
		return minimatch(value.replaceAll("\\", "/"), pattern.replaceAll("\\", "/"), {
			dot: true,
			matchBase: true,
			nocase: process.platform === "win32",
			nocomment: true,
			nonegate: true,
		});
	}
	return wildcardMatch(value, pattern, toolName === "PowerShell");
}

export function matchesHookCondition(
	condition: string | undefined,
	event: MeldraHookEventName,
	input: MeldraHookInput,
): boolean {
	if (condition === undefined) return true;
	if (!MELDRA_TOOL_HOOK_EVENTS.has(event)) return false;
	const parsed = parseHookCondition(condition);
	if (!parsed) return false;
	const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
	if (!toolNameMatches(toolName, parsed.toolPattern)) return false;
	if (parsed.specifier === undefined || parsed.specifier === "" || parsed.specifier === "*") return true;
	const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
	const colon = parsed.specifier.indexOf(":");
	if (colon > 0) {
		const parameter = parsed.specifier.slice(0, colon).trim();
		const expected = parsed.specifier.slice(colon + 1).trim();
		const isWindowsDrivePath = parameter.length === 1 && /^[\\/]/u.test(expected);
		const isUrlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(parsed.specifier);
		if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parameter) && !isWindowsDrivePath && !isUrlPattern) {
			const actual = toolInput[parameter];
			if (typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean") {
				return wildcardMatch(String(actual), expected, toolName === "PowerShell");
			}
			return false;
		}
	}
	const primary = primaryValue(toolName, toolInput);
	if (primary === undefined) return true;
	return matchPrimary(toolName, primary, parsed.specifier);
}
