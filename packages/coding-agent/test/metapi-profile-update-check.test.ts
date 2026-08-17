import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };
const cleanup: string[] = [];

function restoreEnvironment(): void {
	for (const name of Object.keys(process.env)) delete process.env[name];
	Object.assign(process.env, originalEnvironment);
}

afterEach(() => {
	restoreEnvironment();
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
	vi.resetModules();
});

function writeFakeNpm(binDir: string, version: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		writeFileSync(join(binDir, "npm.cmd"), `@echo off\r\necho "${version}"\r\n`, "utf8");
		return;
	}
	const path = join(binDir, "npm");
	writeFileSync(path, `#!/bin/sh\nprintf '"${version}"\\n'\n`, "utf8");
	chmodSync(path, 0o755);
}

describe("MetaPi Profile update checks", () => {
	it("runs npm through the platform process adapter and caches a newer release", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-profile-update-check-"));
		cleanup.push(root);
		const home = join(root, "home");
		const binDir = join(root, "bin");
		writeFakeNpm(binDir, "1.0.0");
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.PATH = [binDir, originalEnvironment.PATH].filter(Boolean).join(delimiter);
		vi.resetModules();

		const { checkProfileUpdate, getProfileRecordPath } = await import("../src/metapi/profile-bundle.ts");
		const recordPath = getProfileRecordPath("release-test");
		mkdirSync(dirname(recordPath), { recursive: true });
		writeFileSync(
			recordPath,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					id: "release-test",
					displayName: "Release Test",
					source: "npm:release-test",
					primaryPackageSource: "npm:release-test",
					installedPackagePath: root,
					packageName: "release-test",
					packageVersion: "1.0.0-beta.1",
					importedAt: new Date(0).toISOString(),
					portable: { profileVersion: 1 },
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		await expect(checkProfileUpdate("release-test")).resolves.toBe("1.0.0");
		const cache = JSON.parse(readFileSync(join(dirname(recordPath), "update-check.json"), "utf8")) as {
			checkedAt?: string;
			availableVersion?: string;
		};
		expect(cache.availableVersion).toBe("1.0.0");
		expect(cache.checkedAt).toBeTypeOf("string");
	});
});
