import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
	vi.resetModules();
});

describe("MetaPi Session discovery ownership", () => {
	it.skipIf(process.platform === "win32")(
		"filters across physical Profile directories by the latest stored Profile",
		async () => {
			const root = mkdtempSync(join(tmpdir(), "metapi-session-discovery-"));
			cleanup.push(root);
			const home = join(root, "home");
			const cwd = join(root, "workspace");
			mkdirSync(cwd, { recursive: true });
			process.env.HOME = home;
			process.env.USERPROFILE = home;
			vi.resetModules();

			const { SessionManager } = await import("../src/core/session-manager.ts");
			const {
				getProfileSessionDir,
				listSessionsAcrossProfiles,
				listSessionsForCwdAcrossProfiles,
				replaceSessionProfile,
				setSessionProfile,
			} = await import("../src/metapi/session-profile.ts");
			const { getProfileAgentDir } = await import("../src/metapi/profile-service.ts");

			for (const name of ["default", "dsh", "pi"]) mkdirSync(getProfileAgentDir(name), { recursive: true });

			const createSession = (physicalProfile: string, profiles: string[], label: string): string => {
				const manager = SessionManager.create(cwd, getProfileSessionDir(cwd, physicalProfile));
				if (profiles[0]) setSessionProfile(manager, profiles[0]);
				for (const profile of profiles.slice(1)) replaceSessionProfile(manager, profile);
				manager.appendMessage({ role: "user", content: label, timestamp: Date.now() });
				manager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: `reply to ${label}` }],
					api: "anthropic-messages",
					provider: "test",
					model: "test",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				});
				const path = manager.getSessionFile();
				if (!path) throw new Error("Expected a persisted Session path");
				return path;
			};

			const sessions = {
				defaultOnly: createSession("default", ["default"], "default-only"),
				dshOnly: createSession("dsh", ["dsh"], "dsh-only"),
				defaultToDsh: createSession("default", ["default", "dsh"], "default-to-dsh"),
				dshToDefault: createSession("dsh", ["dsh", "default"], "dsh-to-default"),
				legacyDefault: createSession("default", [], "legacy-default"),
				legacyDsh: createSession("dsh", [], "legacy-dsh"),
				legacyPi: createSession("pi", [], "legacy-pi"),
			};

			const paths = async (profile: string): Promise<Set<string>> =>
				new Set((await listSessionsAcrossProfiles(profile)).map((session) => session.path));
			const defaultPaths = await paths("default");
			const dshPaths = await paths("dsh");
			const piPaths = await paths("pi");

			expect(defaultPaths).toEqual(new Set([sessions.defaultOnly, sessions.dshToDefault, sessions.legacyDefault]));
			expect(dshPaths).toEqual(new Set([sessions.dshOnly, sessions.defaultToDsh, sessions.legacyDsh]));
			expect(piPaths).toEqual(new Set([sessions.legacyPi]));

			const dshForCwd = await listSessionsForCwdAcrossProfiles(cwd, "dsh");
			expect(new Set(dshForCwd.map((session) => session.path))).toEqual(dshPaths);
		},
	);
});
