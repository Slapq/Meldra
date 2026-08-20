import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	FileSettingsStorage,
	type Settings,
	type SettingsScope,
	type SettingsStorage,
} from "../core/settings-manager.ts";
import { stripJsonComments } from "../utils/json.ts";
import type { ProfileSelection } from "./profile-service.ts";
import { DEFAULT_PROFILE_NAME, getProfileAgentDir } from "./profile-service.ts";
import { MELDRA_HOME } from "./storage-migrations.ts";

export const MELDRA_USER_DIR = join(MELDRA_HOME, "user");
export const MELDRA_USER_AUTH_PATH = join(MELDRA_USER_DIR, "auth.json");
export const MELDRA_USER_MODELS_PATH = join(MELDRA_USER_DIR, "models.json");
export const MELDRA_USER_MODELS_STORE_PATH = join(MELDRA_USER_DIR, "models-store.json");
export const MELDRA_USER_PREFERENCES_PATH = join(MELDRA_USER_DIR, "preferences.json");
export const MELDRA_USER_STATE_PATH = join(MELDRA_USER_DIR, "state.json");

const USER_EXPERIENCE_FIELDS = [
	"theme",
	"terminal",
	"tuiMode",
	"steeringMode",
	"followUpMode",
	"fullscreenScrollbar",
	"showHardwareCursor",
	"editorPaddingX",
	"outputPad",
	"autocompleteMaxVisible",
	"markdown",
	"externalEditor",
	"hideThinkingBlock",
	"showCacheMissNotices",
	"quietStartup",
	"collapseChangelog",
	"doubleEscapeAction",
	"treeFilterMode",
	"warnings",
] as const satisfies readonly (keyof Settings)[];

const DEFAULT_PROFILE_MODEL_FIELDS = [
	"defaultProvider",
	"defaultModel",
	"defaultThinkingLevel",
	"enabledModels",
] as const satisfies readonly (keyof Settings)[];

const USER_EXPERIENCE_FIELD_SET = new Set<keyof Settings>(USER_EXPERIENCE_FIELDS);

function parseSettingsText(content: string | undefined): Settings {
	if (!content) return {};
	const parsed = JSON.parse(content) as unknown;
	if (!isObject(parsed)) throw new Error("Expected settings to be a JSON object");
	return parsed as Settings;
}

function settingsText(settings: Settings): string {
	return JSON.stringify(settings, null, 2);
}

function valuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function applyChangedValue(target: Record<string, unknown>, key: string, before: unknown, after: unknown): void {
	if (valuesEqual(before, after)) return;
	if (isObject(before) && isObject(after)) {
		const nested = isObject(target[key]) ? { ...target[key] } : {};
		for (const nestedKey of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (valuesEqual(before[nestedKey], after[nestedKey])) continue;
			if (after[nestedKey] === undefined) delete nested[nestedKey];
			else nested[nestedKey] = after[nestedKey];
		}
		target[key] = nested;
		return;
	}
	if (after === undefined) delete target[key];
	else target[key] = after;
}

/**
 * Keeps ordinary Profile workflow settings in the Profile while routing shared
 * UI preference writes, including Pi's global Theme setting, to Meldra user
 * storage.
 */
export class MeldraSettingsStorage implements SettingsStorage {
	private readonly profileStorage: FileSettingsStorage;
	private readonly preferencesStorage: FileSettingsStorage;

	constructor(cwd: string, profileAgentDir: string) {
		this.profileStorage = new FileSettingsStorage(cwd, profileAgentDir);
		this.preferencesStorage = new FileSettingsStorage(cwd, MELDRA_USER_DIR, MELDRA_USER_PREFERENCES_PATH);
	}

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		if (scope === "project") {
			this.profileStorage.withLock(scope, fn);
			return;
		}

		this.profileStorage.withLock("global", (profileText) => {
			let nextProfileText: string | undefined;
			this.preferencesStorage.withLock("global", (preferencesText) => {
				const profile = parseSettingsText(profileText);
				const preferences = parseSettingsText(preferencesText);
				const current = composeProfileSettings(preferences, profile);
				const nextText = fn(settingsText(current));
				if (nextText === undefined) return undefined;
				const next = parseSettingsText(nextText);

				const nextProfile = { ...profile } as Record<string, unknown>;
				const nextPreferences = { ...preferences } as Record<string, unknown>;
				for (const key of new Set([...Object.keys(current), ...Object.keys(next)]) as Set<keyof Settings>) {
					const target = USER_EXPERIENCE_FIELD_SET.has(key) ? nextPreferences : nextProfile;
					applyChangedValue(target, key, current[key], next[key]);
				}

				if (!valuesEqual(profile, nextProfile)) {
					nextProfileText = settingsText(nextProfile);
				}
				return valuesEqual(preferences, nextPreferences) ? undefined : settingsText(nextPreferences);
			});
			return nextProfileText;
		});
	}
}

export type MeldraMigrationDecision = "migrate" | "start-fresh";

interface MeldraUserState {
	schemaVersion: 1;
	piMigration: MeldraMigrationDecision;
	initializedAt: string;
}

export interface MeldraModelPaths {
	authPath: string;
	modelsPath: string;
	modelsStorePath: string;
}

function readJsonObject(path: string, allowComments = false): Record<string, unknown> {
	const content = readFileSync(path, "utf8");
	const parsed = JSON.parse(allowComments ? stripJsonComments(content) : content) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Expected a JSON object: ${path}`);
	}
	return parsed as Record<string, unknown>;
}

function readOptionalJsonObject(path: string, allowComments = false): Record<string, unknown> {
	return existsSync(path) ? readJsonObject(path, allowComments) : {};
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function getOriginalPiAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

export function getEffectiveModelsPath(profile: ProfileSelection): string {
	return join(MELDRA_HOME, "profiles", profile.name, "runtime", "models.json");
}

export function getMeldraModelPaths(profile: ProfileSelection): MeldraModelPaths {
	if (profile.compatibility) {
		const piAgentDir = getOriginalPiAgentDir();
		return {
			authPath: join(piAgentDir, "auth.json"),
			modelsPath: join(piAgentDir, "models.json"),
			modelsStorePath: join(piAgentDir, "models-store.json"),
		};
	}
	return {
		authPath: MELDRA_USER_AUTH_PATH,
		modelsPath: getEffectiveModelsPath(profile),
		modelsStorePath: MELDRA_USER_MODELS_STORE_PATH,
	};
}

export function hasInitializedMeldraUser(): boolean {
	if (!existsSync(MELDRA_USER_STATE_PATH)) return false;
	try {
		const state = readJsonObject(MELDRA_USER_STATE_PATH) as Partial<MeldraUserState>;
		return state.schemaVersion === 1 && (state.piMigration === "migrate" || state.piMigration === "start-fresh");
	} catch {
		return false;
	}
}

export function hasMigratablePiState(): boolean {
	const piAgentDir = getOriginalPiAgentDir();
	return ["auth.json", "models.json", "models-store.json", "settings.json"].some((name) =>
		existsSync(join(piAgentDir, name)),
	);
}

function pickFields(source: Record<string, unknown>, fields: readonly (keyof Settings)[]): Record<string, unknown> {
	return Object.fromEntries(fields.flatMap((field) => (source[field] === undefined ? [] : [[field, source[field]]])));
}

function mergeMissing(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const result = { ...target };
	for (const [key, value] of Object.entries(source)) {
		if (result[key] === undefined) {
			result[key] = value;
		} else if (isObject(result[key]) && isObject(value)) {
			result[key] = mergeMissing(result[key], value);
		}
	}
	return result;
}

function prepareUserDirectory(decision: MeldraMigrationDecision): void {
	mkdirSync(MELDRA_USER_DIR, { recursive: true });

	if (decision === "migrate") {
		const piAgentDir = getOriginalPiAgentDir();
		for (const name of ["auth.json", "models.json", "models-store.json"] as const) {
			const source = join(piAgentDir, name);
			const destination = join(MELDRA_USER_DIR, name);
			if (existsSync(source) && !existsSync(destination)) {
				writeFileSync(destination, readFileSync(source));
			}
		}
		const piSettings = readOptionalJsonObject(join(piAgentDir, "settings.json"));
		const preferences = readOptionalJsonObject(MELDRA_USER_PREFERENCES_PATH);
		writeJson(
			MELDRA_USER_PREFERENCES_PATH,
			mergeMissing(preferences, pickFields(piSettings, USER_EXPERIENCE_FIELDS)),
		);
	} else if (!existsSync(MELDRA_USER_PREFERENCES_PATH)) {
		writeJson(MELDRA_USER_PREFERENCES_PATH, {});
	}
}

export function initializeMeldraUser(decision: MeldraMigrationDecision): void {
	if (hasInitializedMeldraUser()) return;
	prepareUserDirectory(decision);
	if (decision === "migrate") migrateDefaultProfileModelPreferences();
	writeJson(MELDRA_USER_STATE_PATH, {
		schemaVersion: 1,
		piMigration: decision,
		initializedAt: new Date().toISOString(),
	} satisfies MeldraUserState);
}

function migrateDefaultProfileModelPreferences(): void {
	const piSettingsPath = join(getOriginalPiAgentDir(), "settings.json");
	if (!existsSync(piSettingsPath)) return;
	const source = readJsonObject(piSettingsPath);
	const targetPath = join(getProfileAgentDir(DEFAULT_PROFILE_NAME), "settings.json");
	const target = readOptionalJsonObject(targetPath);
	const merged = mergeMissing(target, pickFields(source, DEFAULT_PROFILE_MODEL_FIELDS));
	if (JSON.stringify(merged) !== JSON.stringify(target)) writeJson(targetPath, merged);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = result[key];
		result[key] = isObject(current) && isObject(value) ? mergeObjects(current, value) : value;
	}
	return result;
}

function mergeModelLists(shared: unknown, profile: unknown): unknown {
	if (!Array.isArray(shared)) return profile;
	if (!Array.isArray(profile)) return shared;
	const result = shared.map((entry) => (isObject(entry) ? { ...entry } : entry));
	for (const entry of profile) {
		if (!isObject(entry) || typeof entry.id !== "string") {
			result.push(entry);
			continue;
		}
		const index = result.findIndex((candidate) => isObject(candidate) && candidate.id === entry.id);
		if (index >= 0) result[index] = { ...entry };
		else result.push(entry);
	}
	return result;
}

function mergeProvider(shared: unknown, profile: unknown): unknown {
	if (!isObject(shared)) return profile;
	if (!isObject(profile)) return shared;
	const merged = mergeObjects(shared, profile);
	if (shared.models !== undefined || profile.models !== undefined) {
		merged.models = mergeModelLists(shared.models, profile.models);
	}
	return merged;
}

function composeModels(
	sharedRoot: Record<string, unknown>,
	profileRoot: Record<string, unknown>,
): Record<string, unknown> {
	const sharedProviders = isObject(sharedRoot.providers) ? sharedRoot.providers : {};
	const profileProviders = isObject(profileRoot.providers) ? profileRoot.providers : {};
	const providers: Record<string, unknown> = { ...sharedProviders };
	for (const [providerId, profileProvider] of Object.entries(profileProviders)) {
		providers[providerId] = mergeProvider(sharedProviders[providerId], profileProvider);
	}
	return { providers };
}

export function materializeEffectiveModels(profile: ProfileSelection, profileBundlePath?: string): string {
	if (profile.compatibility) return getMeldraModelPaths(profile).modelsPath;
	const shared = readOptionalJsonObject(MELDRA_USER_MODELS_PATH, true);
	const profilePath = profileBundlePath ? join(profileBundlePath, "models.json") : undefined;
	const profileModels = profilePath && existsSync(profilePath) ? readJsonObject(profilePath, true) : {};
	const output = getEffectiveModelsPath(profile);
	writeJson(output, composeModels(shared, profileModels));
	return output;
}

export function readMeldraUserPreferences(): Settings {
	return readOptionalJsonObject(MELDRA_USER_PREFERENCES_PATH) as Settings;
}

export function composeProfileSettings(sharedPreferences: Settings, profileSettings: Settings): Settings {
	const sharedExperience = pickFields(
		sharedPreferences as Record<string, unknown>,
		USER_EXPERIENCE_FIELDS,
	) as Settings;
	const profileWithoutTheme = { ...profileSettings };
	delete profileWithoutTheme.theme;
	return {
		...profileWithoutTheme,
		...sharedExperience,
	};
}
