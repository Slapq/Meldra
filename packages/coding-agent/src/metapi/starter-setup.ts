import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPackageDir } from "../config.ts";
import { type PackageSource, SettingsManager } from "../core/settings-manager.ts";
import { DEFAULT_PROFILE_NAME, getProfileAgentDir } from "./profile-service.ts";
import { MeldraSettingsStorage } from "./user-assets.ts";

export const STARTER_PROFILE_PACKAGE_ENTRY = "packages/metapi-starter";

export interface StarterProfileSetupResult {
	source: string;
	target: string;
	bundleAction: "installed" | "restored" | "unchanged";
	packageAdded: boolean;
	packageUpdated: boolean;
	enabledExtensions: string[];
}

function starterSourcePath(): string {
	return join(getPackageDir(), "starter-profile");
}

function starterTargetPath(): string {
	return join(getProfileAgentDir(DEFAULT_PROFILE_NAME), ...STARTER_PROFILE_PACKAGE_ENTRY.split("/"));
}

function readBundleVersion(root: string): string | undefined {
	try {
		const value = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
		return typeof value.version === "string" ? value.version : undefined;
	} catch {
		return undefined;
	}
}

function packageSource(entry: PackageSource): string {
	return typeof entry === "string" ? entry : entry.source;
}

function normalizedSource(entry: PackageSource): string {
	return packageSource(entry).replaceAll("\\", "/").replace(/\/$/, "");
}

function hasPackage(agentDir: string, packages: PackageSource[], name: string): boolean {
	return packages.some((entry) => {
		const source = normalizedSource(entry);
		const matches = source.endsWith(`/packages/${name}`) || source === `packages/${name}`;
		return matches && existsSync(resolve(agentDir, packageSource(entry)));
	});
}

function desiredStarterPackage(
	agentDir: string,
	packages: PackageSource[],
): {
	entry: PackageSource;
	enabledExtensions: string[];
} {
	const providerPresent =
		hasPackage(agentDir, packages, "provider-manager") ||
		existsSync(join(agentDir, "extensions", "provider-manager.ts"));
	const scoutPresent = existsSync(join(agentDir, "extensions", "scout.ts"));
	const workflowsPresent =
		hasPackage(agentDir, packages, "metapi-workflows") ||
		existsSync(join(agentDir, "extensions", "metapi-workflows.ts"));
	const enabledExtensions = [
		...(providerPresent ? [] : ["extensions/provider-manager.ts"]),
		...(scoutPresent ? [] : ["extensions/scout.ts"]),
		...(workflowsPresent ? [] : ["extensions/metapi-workflows.ts"]),
		"extensions/setup.ts",
	];
	return {
		entry:
			enabledExtensions.length === 4
				? STARTER_PROFILE_PACKAGE_ENTRY
				: { source: STARTER_PROFILE_PACKAGE_ENTRY, autoload: false, extensions: enabledExtensions },
		enabledExtensions,
	};
}

export async function setupStarterProfile(
	cwd: string,
	options: { restore?: boolean } = {},
): Promise<StarterProfileSetupResult> {
	const source = starterSourcePath();
	const target = starterTargetPath();
	if (!existsSync(join(source, "package.json"))) {
		throw new Error(`Meldra Starter Bundle is missing from this distribution: ${source}`);
	}

	const targetExists = existsSync(target);
	const versionChanged = readBundleVersion(source) !== readBundleVersion(target);
	let bundleAction: StarterProfileSetupResult["bundleAction"] = "unchanged";
	if (!targetExists || options.restore || versionChanged) {
		rmSync(target, { recursive: true, force: true });
		mkdirSync(target, { recursive: true });
		cpSync(source, target, { recursive: true, force: true });
		bundleAction = targetExists ? "restored" : "installed";
	}

	const agentDir = getProfileAgentDir(DEFAULT_PROFILE_NAME);
	const profileInstructions = join(agentDir, "AGENTS.md");
	const bundledInstructions = join(source, "AGENTS.md");
	if (!existsSync(profileInstructions) && existsSync(bundledInstructions)) {
		mkdirSync(agentDir, { recursive: true });
		cpSync(bundledInstructions, profileInstructions);
	}

	const settingsManager = SettingsManager.fromStorage(new MeldraSettingsStorage(cwd, agentDir), {
		projectTrusted: false,
	});
	const packages = settingsManager.getPackages();
	const desired = desiredStarterPackage(agentDir, packages);
	const existingIndex = packages.findIndex((entry) => normalizedSource(entry) === STARTER_PROFILE_PACKAGE_ENTRY);
	const packageAdded = existingIndex < 0;
	const packageUpdated =
		existingIndex >= 0 && JSON.stringify(packages[existingIndex]) !== JSON.stringify(desired.entry);
	if (packageAdded || packageUpdated) {
		const nextPackages = [...packages];
		if (packageAdded) nextPackages.push(desired.entry);
		else nextPackages[existingIndex] = desired.entry;
		settingsManager.setPackages(nextPackages);
		await settingsManager.flush();
	}

	return {
		source,
		target,
		bundleAction,
		packageAdded,
		packageUpdated,
		enabledExtensions: desired.enabledExtensions,
	};
}
