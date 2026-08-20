import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	healProfilesModuleFallback,
	initProfile,
	loadOverlayPatches,
	loadProfile,
	type Profile,
	resolveProfileDir,
} from "@deepseek-ai/dsh-app-boot";

const ROOT_FILENAME = "cordis.yml";
const ROOT_CONTENT = `# Meldra DSH profile root. Bundle and user layers are applied as patches.\n[]\n`;
export const MELDRA_DSH_PROFILE = "meldra";
export const LEGACY_METAPI_DSH_PROFILE = "metapi";
export const MELDRA_DSH_DEFAULT_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] as const;

export interface DshComposition {
	profile: Profile;
	rootPath: string;
	patches: ReturnType<typeof loadOverlayPatches>;
}

const SERVER_PLACEHOLDER = "__MELDRA_DSH_SERVER_PATH__";
const SANDBOX_ESCALATION_COMPAT_PLACEHOLDER = "__MELDRA_DSH_SANDBOX_ESCALATION_COMPAT_PATH__";

function bindModulePaths(value: unknown, paths: ReadonlyMap<string, string>): void {
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (typeof record.name === "string") record.name = paths.get(record.name) ?? record.name;
	if (Array.isArray(record.insert)) for (const child of record.insert) bindModulePaths(child, paths);
}

function migrateLegacyDshProfile(home: string): void {
	const legacyDir = resolveProfileDir(LEGACY_METAPI_DSH_PROFILE, home);
	if (!existsSync(legacyDir)) return;
	const meldraDir = resolveProfileDir(MELDRA_DSH_PROFILE, home);
	if (existsSync(meldraDir)) {
		throw new Error(
			`Cannot migrate DSH Profile: both legacy and Meldra paths exist. Resolve the conflict manually: ${legacyDir}`,
		);
	}
	renameSync(legacyDir, meldraDir);
}

export function prepareDshComposition(options: {
	binName: string;
	home: string;
	installAnchor: string;
	surfacePath: string;
	serverPath: string;
	sandboxEscalationCompatPath: string;
}): DshComposition {
	migrateLegacyDshProfile(options.home);
	const profileDir = resolveProfileDir(MELDRA_DSH_PROFILE, options.home);
	healProfilesModuleFallback(options.installAnchor, options.home);
	if (!existsSync(join(profileDir, "package.json"))) {
		initProfile(profileDir, MELDRA_DSH_DEFAULT_BUNDLES);
	}
	const profile = loadProfile(options.binName, MELDRA_DSH_PROFILE, options.installAnchor, options.home);
	const rootPath = join(profile.dir, ROOT_FILENAME);
	writeFileSync(rootPath, ROOT_CONTENT);
	const surfacePatches = loadOverlayPatches(options.binName, options.surfacePath);
	const modulePaths = new Map([
		[SERVER_PLACEHOLDER, options.serverPath],
		[SANDBOX_ESCALATION_COMPAT_PLACEHOLDER, options.sandboxEscalationCompatPath],
	]);
	for (const patch of surfacePatches) bindModulePaths(patch, modulePaths);
	return {
		profile,
		rootPath,
		patches: [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches, ...surfacePatches],
	};
}
