import { existsSync, lstatSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MELDRA_HOME = join(homedir(), ".meldra");
export const LEGACY_METAPI_HOME = join(homedir(), ".metapi");

function isPathAlias(source: string, destination: string): boolean {
	try {
		return lstatSync(source).isSymbolicLink() && realpathSync(source) === realpathSync(destination);
	} catch {
		return false;
	}
}

function assertNoConflict(source: string, destination: string, label: string): void {
	if (existsSync(source) && existsSync(destination) && !isPathAlias(source, destination)) {
		throw new Error(
			`Cannot migrate ${label}: both legacy and Meldra paths exist. Resolve the conflict manually: ${source}`,
		);
	}
}

function migrateDirectory(source: string, destination: string, label: string): boolean {
	if (!existsSync(source) || isPathAlias(source, destination)) return false;
	assertNoConflict(source, destination, label);
	renameSync(source, destination);
	try {
		symlinkSync(destination, source, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		try {
			renameSync(destination, source);
		} catch {
			// Preserve the original migration error if rollback is also unavailable.
		}
		throw new Error(`Cannot create the legacy path bridge for ${label}: ${String(error)}`);
	}
	return true;
}

function projectManifestPaths(cwd: string): { legacyPath: string; currentPath: string } {
	return {
		legacyPath: join(cwd, ".pi", "metapi.json"),
		currentPath: join(cwd, ".pi", "meldra.json"),
	};
}

function migrateProjectManifest(cwd: string): boolean {
	const { legacyPath, currentPath } = projectManifestPaths(cwd);
	if (!existsSync(legacyPath) || isPathAlias(legacyPath, currentPath)) return false;
	assertNoConflict(legacyPath, currentPath, "project manifest");
	renameSync(legacyPath, currentPath);
	return true;
}

/** Migrate legacy MetaPi storage before any Profile or project manifest lookup. */
export function migrateLegacyMeldraStorage(cwd: string): { home: boolean; projectManifest: boolean } {
	const project = projectManifestPaths(cwd);
	assertNoConflict(LEGACY_METAPI_HOME, MELDRA_HOME, "user storage");
	assertNoConflict(project.legacyPath, project.currentPath, "project manifest");
	return {
		home: migrateDirectory(LEGACY_METAPI_HOME, MELDRA_HOME, "user storage"),
		projectManifest: migrateProjectManifest(cwd),
	};
}
