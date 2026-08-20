import { createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { getDefaultSessionDir, type SessionEntry, type SessionInfo, SessionManager } from "../core/session-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import {
	assertProfileName,
	getProfileAgentDir,
	listInstalledProfiles,
	PI_COMPATIBILITY_PROFILE_NAME,
} from "./profile-service.ts";

export const MELDRA_SESSION_PROFILE_ENTRY = "meldra-session-profile";
export const LEGACY_METAPI_SESSION_PROFILE_ENTRY = "metapi-session-profile";
export const MELDRA_SESSION_WORKSPACE_ENTRY = "meldra-session-workspace";
export const LEGACY_METAPI_SESSION_WORKSPACE_ENTRY = "metapi-session-workspace";
/** @deprecated Use MELDRA_SESSION_PROFILE_ENTRY. Retained for source compatibility. */
export const METAPI_SESSION_PROFILE_ENTRY = LEGACY_METAPI_SESSION_PROFILE_ENTRY;
/** @deprecated Use MELDRA_SESSION_WORKSPACE_ENTRY. Retained for source compatibility. */
export const METAPI_SESSION_WORKSPACE_ENTRY = LEGACY_METAPI_SESSION_WORKSPACE_ENTRY;

const MAX_CONCURRENT_SESSION_PROFILE_READS = 10;

interface SessionProfileData {
	profile: string;
}

interface SessionWorkspaceData {
	root: string;
}

function readProfileFromEntries(entries: readonly SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (
			entry.type !== "custom" ||
			(entry.customType !== MELDRA_SESSION_PROFILE_ENTRY && entry.customType !== LEGACY_METAPI_SESSION_PROFILE_ENTRY)
		)
			continue;
		const data = entry.data as Partial<SessionProfileData> | undefined;
		if (typeof data?.profile === "string" && data.profile.trim()) return data.profile;
	}
	return undefined;
}

export function getSessionProfile(sessionManager: Pick<SessionManager, "getEntries">): string | undefined {
	return readProfileFromEntries(sessionManager.getEntries());
}

export function getSessionWorkspaceRoot(sessionManager: Pick<SessionManager, "getEntries">): string | undefined {
	const entries = sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (
			entry.type !== "custom" ||
			(entry.customType !== MELDRA_SESSION_WORKSPACE_ENTRY &&
				entry.customType !== LEGACY_METAPI_SESSION_WORKSPACE_ENTRY)
		)
			continue;
		const data = entry.data as Partial<SessionWorkspaceData> | undefined;
		if (typeof data?.root === "string" && data.root.trim()) return resolvePath(data.root);
	}
	return undefined;
}

export function setSessionProfile(
	sessionManager: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
	profile: string,
): void {
	if (getSessionProfile(sessionManager) === profile) return;
	sessionManager.appendCustomEntry(MELDRA_SESSION_PROFILE_ENTRY, { profile } satisfies SessionProfileData);
}

export function replaceSessionProfile(
	sessionManager: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
	profile: string,
): void {
	sessionManager.appendCustomEntry(MELDRA_SESSION_PROFILE_ENTRY, { profile } satisfies SessionProfileData);
}

export function setSessionWorkspaceRoot(
	sessionManager: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
	root: string,
): void {
	const resolvedRoot = resolvePath(root);
	if (getSessionWorkspaceRoot(sessionManager) === resolvedRoot) return;
	sessionManager.appendCustomEntry(MELDRA_SESSION_WORKSPACE_ENTRY, {
		root: resolvedRoot,
	} satisfies SessionWorkspaceData);
}

export function getSessionDiscoveryProfiles(activeProfileName: string): string[] {
	const profileName = assertProfileName(activeProfileName);
	if (profileName === PI_COMPATIBILITY_PROFILE_NAME) return [PI_COMPATIBILITY_PROFILE_NAME];
	return listInstalledProfiles().filter((name) => name !== PI_COMPATIBILITY_PROFILE_NAME);
}

export async function listSessionsForCwdAcrossProfiles(
	cwd: string,
	activeProfileName: string,
	onProgress?: (loaded: number, total: number) => void,
): Promise<SessionInfo[]> {
	const all = await listSessionsAcrossProfiles(activeProfileName, onProgress);
	const resolved = resolvePath(cwd);
	return all.filter((session) => resolvePath(session.cwd) === resolved);
}

export function isOrphanedTempSession(session: Pick<SessionInfo, "cwd">): boolean {
	const cwd = resolvePath(session.cwd);
	const temp = resolvePath(tmpdir());
	const tempRelative = relative(temp, cwd);
	const isInsideTemp =
		tempRelative !== "" && tempRelative !== ".." && !tempRelative.startsWith(`..${sep}`) && !isAbsolute(tempRelative);
	if (!isInsideTemp) return false;
	if (!existsSync(cwd)) return true;
	const tempRootName = tempRelative.split(sep, 1)[0] ?? "";
	return /^(?:pi|metapi|session-test|coding-agent-test)-/i.test(tempRootName);
}

async function readStoredSessionProfile(path: string): Promise<string | undefined> {
	let profile: string | undefined;
	try {
		const lines = createInterface({
			input: createReadStream(path, { encoding: "utf8" }),
			crlfDelay: Infinity,
		});
		for await (const line of lines) {
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (!entry || typeof entry !== "object") continue;
			const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
			if (
				candidate.type !== "custom" ||
				(candidate.customType !== MELDRA_SESSION_PROFILE_ENTRY &&
					candidate.customType !== LEGACY_METAPI_SESSION_PROFILE_ENTRY)
			)
				continue;
			if (!candidate.data || typeof candidate.data !== "object") continue;
			const value = (candidate.data as Partial<SessionProfileData>).profile;
			if (typeof value === "string" && value.trim()) profile = value;
		}
	} catch {
		return undefined;
	}
	return profile;
}

async function filterSessionsByActiveProfile(
	sessions: SessionInfo[],
	physicalProfileName: string,
	activeProfileName: string,
): Promise<SessionInfo[]> {
	const included = new Array<boolean>(sessions.length).fill(false);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < sessions.length) {
			const index = nextIndex++;
			const session = sessions[index];
			if (!session) continue;
			const storedProfile = await readStoredSessionProfile(session.path);
			included[index] = (storedProfile ?? physicalProfileName) === activeProfileName;
		}
	};
	const workerCount = Math.min(MAX_CONCURRENT_SESSION_PROFILE_READS, sessions.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return sessions.filter((_session, index) => included[index]);
}

export async function listSessionsAcrossProfiles(
	activeProfileName: string,
	onProgress?: (loaded: number, total: number) => void,
): Promise<SessionInfo[]> {
	const profileName = assertProfileName(activeProfileName);
	const names = getSessionDiscoveryProfiles(profileName);
	const collections: SessionInfo[][] = [];
	let loadedProfiles = 0;
	for (const name of names) {
		const sessions = (await SessionManager.listAllInAgentDir(getProfileAgentDir(name))).filter(
			(session) => !isOrphanedTempSession(session),
		);
		collections.push(await filterSessionsByActiveProfile(sessions, name, profileName));
		loadedProfiles++;
		onProgress?.(loadedProfiles, names.length);
	}
	const byPath = new Map<string, SessionInfo>();
	for (const session of collections.flat()) byPath.set(session.path, session);
	return [...byPath.values()].sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

export function getProfileSessionDir(cwd: string, profile: string): string {
	return getDefaultSessionDir(cwd, getProfileAgentDir(profile));
}
