import { existsSync, writeFileSync } from "node:fs";
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
const ROOT_CONTENT = `# MetaPi DSH profile root. Bundle and user layers are applied as patches.\n[]\n`;
export const METAPI_DSH_PROFILE = "metapi";
export const METAPI_DSH_DEFAULT_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] as const;

export interface DshComposition {
	profile: Profile;
	rootPath: string;
	patches: ReturnType<typeof loadOverlayPatches>;
}

const SERVER_PLACEHOLDER = "__METAPI_DSH_SERVER_PATH__";

function bindServerPath(value: unknown, serverPath: string): void {
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (record.name === SERVER_PLACEHOLDER) record.name = serverPath;
	if (Array.isArray(record.insert)) for (const child of record.insert) bindServerPath(child, serverPath);
}

export function prepareDshComposition(options: {
	binName: string;
	home: string;
	installAnchor: string;
	surfacePath: string;
	serverPath: string;
}): DshComposition {
	const profileDir = resolveProfileDir(METAPI_DSH_PROFILE, options.home);
	healProfilesModuleFallback(options.installAnchor, options.home);
	if (!existsSync(join(profileDir, "package.json"))) {
		initProfile(profileDir, METAPI_DSH_DEFAULT_BUNDLES);
	}
	const profile = loadProfile(options.binName, METAPI_DSH_PROFILE, options.installAnchor, options.home);
	const rootPath = join(profile.dir, ROOT_FILENAME);
	writeFileSync(rootPath, ROOT_CONTENT);
	const surfacePatches = loadOverlayPatches(options.binName, options.surfacePath);
	for (const patch of surfacePatches) bindServerPath(patch, options.serverPath);
	return {
		profile,
		rootPath,
		patches: [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches, ...surfacePatches],
	};
}
