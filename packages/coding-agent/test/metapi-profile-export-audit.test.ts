import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("MetaPi Profile export audit", () => {
	it("reports credential-like literals without copying matched values into the audit", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-profile-export-audit-"));
		cleanup.push(root);
		writeFileSync(
			join(root, "settings.json"),
			JSON.stringify({ apiKey: "synthetic-credential-sk-abcdefghijklmnop", safe: "$" + "{OPENAI_API_KEY}" }, null, 2),
		);
		writeFileSync(join(root, "plugin.yml"), "endpoint: https://test-user:test-value@example.test/api\n");
		writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));

		const { writeProfileExportAudit } = await import("../src/metapi/profile-bundle.ts");
		const audit = writeProfileExportAudit(root);
		const report = readFileSync(audit.reportPath, "utf8");

		expect(audit.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "settings.json", line: 2, kind: "credential-field" }),
				expect.objectContaining({ path: "settings.json", line: 2, kind: "credential-prefix" }),
				expect.objectContaining({ path: "plugin.yml", line: 1, kind: "credential-url" }),
			]),
		);
		expect(audit.findings.some((finding) => finding.line === 3 && finding.path === "settings.json")).toBe(false);
		expect(audit.includedFiles).toContain("METAPI_PROFILE_EXPORT_AUDIT.md");
		expect(report).toContain("settings.json`:");
		expect(report).toContain("managed credentials and authentication stores");
		expect(report).not.toContain("synthetic-credential-sk-abcdefghijklmnop");
		expect(report).not.toContain("test-value");
	});

	it("preserves the string export contract while writing an audit beside the portable manifest", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-profile-export-contract-"));
		cleanup.push(root);
		const home = join(root, "home");
		const installed = join(root, "installed-profile");
		const output = join(root, "shared-profile");
		mkdirSync(installed, { recursive: true });
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		vi.resetModules();

		const profileBundle = await import("../src/metapi/profile-bundle.ts");
		writeFileSync(
			join(installed, "package.json"),
			`${JSON.stringify({ name: "shared-profile", version: "1.0.0", metapi: { profileVersion: 1 } }, null, 2)}\n`,
		);
		writeFileSync(
			join(installed, "config.json"),
			`${JSON.stringify({ apiKey: "$" + "{PROVIDER_API_KEY}" }, null, 2)}\n`,
		);
		const recordPath = profileBundle.getProfileRecordPath("shared");
		mkdirSync(dirname(recordPath), { recursive: true });
		writeFileSync(
			recordPath,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					id: "shared",
					displayName: "Shared Profile",
					source: installed,
					primaryPackageSource: installed,
					installedPackagePath: installed,
					packageName: "shared-profile",
					packageVersion: "1.0.0",
					importedAt: "2026-01-01T00:00:00.000Z",
					portable: { profileVersion: 1 },
				},
				null,
				2,
			)}\n`,
		);

		const exported = await profileBundle.exportProfile("shared", output, root);

		expect(exported).toBe(output);
		expect(existsSync(join(output, "METAPI_PROFILE_EXPORT_AUDIT.md"))).toBe(true);
		expect(JSON.parse(readFileSync(join(output, "package.json"), "utf8"))).toMatchObject({
			metapi: { profileVersion: 1, displayName: "Shared Profile" },
		});
	});
});
