import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("Meldra Profile import", () => {
	it("removes a newly created Profile after failure so the same name can be retried", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-profile-import-"));
		cleanup.push(root);
		const home = join(root, "home");
		const bundle = join(root, "bundle");
		mkdirSync(bundle, { recursive: true });
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		vi.resetModules();

		const { getProfileRecordPath, importProfile } = await import("../src/metapi/profile-bundle.ts");
		const manifestPath = join(bundle, "package.json");
		writeFileSync(
			manifestPath,
			`${JSON.stringify({ name: "retryable-profile", version: "1.0.0", metapi: { profileVersion: 99 } }, null, 2)}\n`,
		);

		await expect(importProfile(bundle, { cwd: root, id: "retryable" })).rejects.toThrow(
			"requires metapi.profileVersion = 1",
		);
		const profileRoot = dirname(getProfileRecordPath("retryable"));
		expect(existsSync(profileRoot)).toBe(false);

		writeFileSync(
			manifestPath,
			`${JSON.stringify({ name: "retryable-profile", version: "1.0.0", metapi: { profileVersion: 1 } }, null, 2)}\n`,
		);
		const record = await importProfile(bundle, { cwd: root, id: "retryable" });

		expect(record.id).toBe("retryable");
		expect(existsSync(getProfileRecordPath("retryable"))).toBe(true);
	});
});
