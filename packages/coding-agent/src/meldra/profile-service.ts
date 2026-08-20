import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";

import { MELDRA_HOME } from "./storage-migrations.ts";

export const MELDRA_PROFILES_DIR = join(MELDRA_HOME, "profiles");
export const MELDRA_WORKSPACES_DIR = join(MELDRA_HOME, "workspaces");
export const MELDRA_BINDINGS_PATH = join(MELDRA_HOME, "project-bindings.json");
export const DEFAULT_PROFILE_NAME = "default";
export const PI_COMPATIBILITY_PROFILE_NAME = "pi";

export interface ProfileSelection {
	name: string;
	displayName: string;
	agentDir: string;
	compatibility: boolean;
	bindingPath?: string;
}

interface DirectoryBindings {
	[canonicalDirectory: string]: string;
}

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertProfileName(name: string): string {
	const normalized = name.trim();
	if (!PROFILE_NAME_PATTERN.test(normalized)) {
		throw new Error(`Invalid Profile name "${name}".`);
	}
	return normalized;
}

export function getProfileAgentDir(name: string): string {
	const normalized = assertProfileName(name);
	if (normalized === PI_COMPATIBILITY_PROFILE_NAME) {
		return join(homedir(), ".pi", "agent");
	}
	return join(MELDRA_PROFILES_DIR, normalized, "agent");
}

function canonicalDirectory(directory: string): string {
	return normalize(resolve(directory));
}

function readBindings(): DirectoryBindings {
	if (!existsSync(MELDRA_BINDINGS_PATH)) return {};
	try {
		const value = JSON.parse(readFileSync(MELDRA_BINDINGS_PATH, "utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

function findNearestBinding(cwd: string): { name: string; path: string } | undefined {
	const bindings = readBindings();
	let current = canonicalDirectory(cwd);
	while (true) {
		const name = bindings[current];
		if (name) return { name: assertProfileName(name), path: current };
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export function listDirectoryBindings(): DirectoryBindings {
	return { ...readBindings() };
}

export function bindDirectory(directory: string, profileName: string): string {
	const name = assertProfileName(profileName);
	if (
		name !== DEFAULT_PROFILE_NAME &&
		name !== PI_COMPATIBILITY_PROFILE_NAME &&
		!listInstalledProfiles().includes(name)
	) {
		throw new Error(`Profile "${name}" is not installed.`);
	}
	const path = canonicalDirectory(directory);
	const bindings = readBindings();
	bindings[path] = name;
	mkdirSync(MELDRA_HOME, { recursive: true });
	writeFileSync(MELDRA_BINDINGS_PATH, `${JSON.stringify(bindings, null, 2)}\n`, "utf8");
	return path;
}

export function unbindDirectory(directory: string): boolean {
	const path = canonicalDirectory(directory);
	const bindings = readBindings();
	if (!(path in bindings)) return false;
	delete bindings[path];
	mkdirSync(MELDRA_HOME, { recursive: true });
	writeFileSync(MELDRA_BINDINGS_PATH, `${JSON.stringify(bindings, null, 2)}\n`, "utf8");
	return true;
}

export function extractProfileArgument(args: string[]): string | undefined {
	let requested: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--profile") {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw new Error("--profile requires a value");
			if (requested !== undefined) throw new Error("--profile may be provided only once");
			requested = value;
			index++;
		} else if (arg.startsWith("--profile=")) {
			const value = arg.slice("--profile=".length);
			if (!value) throw new Error("--profile requires a value");
			if (requested !== undefined) throw new Error("--profile may be provided only once");
			requested = value;
		}
	}
	return requested;
}

export function removeProfileArguments(args: string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--profile") {
			index++;
			continue;
		}
		if (arg.startsWith("--profile=")) continue;
		result.push(arg);
	}
	return result;
}

function readProfileDisplayName(name: string): string | undefined {
	const path = join(MELDRA_PROFILES_DIR, name, "profile.json");
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as {
			displayName?: unknown;
		};
		return typeof value.displayName === "string" && value.displayName.trim() ? value.displayName : undefined;
	} catch {
		return undefined;
	}
}

export function resolveProfile(cwd: string, requestedName?: string): ProfileSelection {
	const explicit = requestedName?.trim();
	const binding = explicit ? undefined : findNearestBinding(cwd);
	const name = assertProfileName(explicit || binding?.name || DEFAULT_PROFILE_NAME);
	const compatibility = name === PI_COMPATIBILITY_PROFILE_NAME;
	const displayName = compatibility
		? "Pi compatibility"
		: name === DEFAULT_PROFILE_NAME
			? "Meldra Starter"
			: (readProfileDisplayName(name) ?? name);
	return {
		name,
		displayName,
		agentDir: getProfileAgentDir(name),
		compatibility,
		...(binding ? { bindingPath: binding.path } : {}),
	};
}

export interface ProjectProfileRecommendation {
	source: string;
	displayName?: string;
}

export function readProjectProfileRecommendation(cwd: string): ProjectProfileRecommendation | undefined {
	const path = join(canonicalDirectory(cwd), ".pi", "meldra.json");
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as {
			profile?: { source?: unknown; displayName?: unknown };
		};
		if (!value.profile || typeof value.profile.source !== "string" || !value.profile.source.trim()) return undefined;
		return {
			source: value.profile.source,
			...(typeof value.profile.displayName === "string" && value.profile.displayName.trim()
				? { displayName: value.profile.displayName }
				: {}),
		};
	} catch {
		return undefined;
	}
}
export function formatProfileStatus(profile: ProfileSelection, cwd: string): string {
	const lines = [
		`Profile: ${profile.name}`,
		`Display: ${profile.displayName}`,
		`Agent directory: ${profile.agentDir}`,
		`Working directory: ${canonicalDirectory(cwd)}`,
		`Compatibility: ${profile.compatibility ? "original Pi state" : "isolated Meldra state"}`,
	];
	if (profile.bindingPath) lines.push(`Directory binding: ${profile.bindingPath}`);
	return lines.join("\n");
}

export function listInstalledProfiles(): string[] {
	const names = new Set<string>([DEFAULT_PROFILE_NAME, PI_COMPATIBILITY_PROFILE_NAME]);
	if (existsSync(MELDRA_PROFILES_DIR)) {
		for (const entry of readdirSafe(MELDRA_PROFILES_DIR)) {
			if (PROFILE_NAME_PATTERN.test(entry)) names.add(entry);
		}
	}
	return [...names].sort();
}

function readdirSafe(directory: string): string[] {
	try {
		// Keep directory discovery deliberately small and synchronous during CLI startup.
		return readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}
