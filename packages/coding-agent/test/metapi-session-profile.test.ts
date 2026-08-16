import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	getSessionDiscoveryProfiles,
	getSessionProfile,
	getSessionWorkspaceRoot,
	METAPI_SESSION_PROFILE_ENTRY,
	replaceSessionProfile,
	setSessionProfile,
	setSessionWorkspaceRoot,
} from "../src/metapi/session-profile.ts";

const cleanup: string[] = [];

afterEach(() => {
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("MetaPi session Profile metadata", () => {
	it("isolates Pi compatibility sessions from ordinary MetaPi discovery", () => {
		expect(getSessionDiscoveryProfiles("default")).not.toContain("pi");
		expect(getSessionDiscoveryProfiles("work")).not.toContain("pi");
		expect(getSessionDiscoveryProfiles("pi")).toEqual(["pi"]);
	});

	it("persists the active Profile as an extension entry", () => {
		const cwd = join(tmpdir(), `metapi-session-profile-${Date.now()}`);
		cleanup.push(cwd);
		mkdirSync(cwd, { recursive: true });
		const manager = SessionManager.inMemory(cwd);

		setSessionProfile(manager, "pi");

		expect(getSessionProfile(manager)).toBe("pi");
		expect(manager.getEntries()).toEqual([
			expect.objectContaining({
				type: "custom",
				customType: METAPI_SESSION_PROFILE_ENTRY,
				data: { profile: "pi" },
			}),
		]);
	});

	it("persists the WorkSpace root with the session", () => {
		const manager = SessionManager.inMemory(process.cwd());
		setSessionWorkspaceRoot(manager, "C:/workspaces");
		expect(getSessionWorkspaceRoot(manager)).toContain("workspaces");
	});

	it("uses the latest Profile entry and avoids duplicate initialization writes", () => {
		const manager = SessionManager.inMemory(process.cwd());
		setSessionProfile(manager, "default");
		setSessionProfile(manager, "default");
		replaceSessionProfile(manager, "pi");

		expect(getSessionProfile(manager)).toBe("pi");
		expect(manager.getEntries()).toHaveLength(2);
	});
});
