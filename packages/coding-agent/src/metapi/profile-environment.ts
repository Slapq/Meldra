import { type InstalledProfileRecord, normalizeProfileEnvironmentDeclaration } from "./profile-bundle.ts";
import type { ProfileSelection } from "./profile-service.ts";

const ESSENTIAL_ENVIRONMENT_NAMES = new Set([
	"APPDATA",
	"COLORTERM",
	"COMSPEC",
	"HOME",
	"HOMEDRIVE",
	"HOMEPATH",
	"LANG",
	"LC_ALL",
	"LOCALAPPDATA",
	"NUMBER_OF_PROCESSORS",
	"OS",
	"PATH",
	"PATHEXT",
	"PROCESSOR_ARCHITECTURE",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"SHELL",
	"SYSTEMDRIVE",
	"SYSTEMROOT",
	"TEMP",
	"TERM",
	"TMP",
	"TMPDIR",
	"USER",
	"USERDOMAIN",
	"USERNAME",
	"USERPROFILE",
	"WINDIR",
	"WT_PROFILE_ID",
	"WT_SESSION",
]);

function normalizedName(name: string): string {
	return process.platform === "win32" ? name.toUpperCase() : name;
}

function isRuntimeVariable(name: string): boolean {
	const normalized = normalizedName(name);
	return normalized.startsWith("PI_") || normalized.startsWith("METAPI_") || normalized === "AI_AGENT";
}

export type ProfileEnvironmentSnapshot = NodeJS.ProcessEnv;

export function captureProfileEnvironment(): ProfileEnvironmentSnapshot {
	return { ...process.env };
}

export function applyProfileEnvironment(
	profile: ProfileSelection,
	record: InstalledProfileRecord | undefined,
	baseEnvironment: ProfileEnvironmentSnapshot = process.env,
): string[] {
	const original = { ...baseEnvironment };
	if (profile.compatibility) {
		for (const name of Object.keys(process.env)) delete process.env[name];
		Object.assign(process.env, original);
		return [];
	}
	const declaration = normalizeProfileEnvironmentDeclaration(record?.portable.environment);
	for (const name of Object.keys(process.env)) delete process.env[name];
	Object.assign(process.env, original);
	const inherited = new Set((declaration?.inherit ?? []).map(normalizedName));

	for (const name of Object.keys(process.env)) {
		const normalized = normalizedName(name);
		if (ESSENTIAL_ENVIRONMENT_NAMES.has(normalized) || inherited.has(normalized) || isRuntimeVariable(normalized)) {
			continue;
		}
		delete process.env[name];
	}

	for (const name of declaration?.inherit ?? []) {
		const sourceName = Object.keys(original).find((candidate) => normalizedName(candidate) === normalizedName(name));
		if (sourceName && original[sourceName] !== undefined) process.env[name] = original[sourceName];
	}
	for (const [name, value] of Object.entries(declaration?.defaults ?? {})) {
		if (process.env[name] === undefined) process.env[name] = value;
	}
	return (declaration?.required ?? []).filter((name) => process.env[name] === undefined);
}
