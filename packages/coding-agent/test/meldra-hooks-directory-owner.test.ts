import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectDeprecatedExtensionDirectoryWarnings } from "../src/migrations.ts";

const dirs: string[] = [];

function workspace(): string {
	const path = mkdtempSync(join(tmpdir(), "meldra-hooks-directory-owner-"));
	dirs.push(path);
	return path;
}

afterEach(() => {
	for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Meldra hooks directory ownership", () => {
	it("preserves the original Pi warning for legacy Extension ownership", () => {
		const baseDir = workspace();
		mkdirSync(join(baseDir, "hooks"));
		expect(collectDeprecatedExtensionDirectoryWarnings(baseDir, "Global", "legacy-extensions")).toContain(
			"Global hooks/ directory found. Hooks have been renamed to extensions.",
		);
	});

	it("treats root hooks as Meldra Hook resources for ordinary Meldra Profiles", () => {
		const baseDir = workspace();
		mkdirSync(join(baseDir, "hooks"));
		expect(collectDeprecatedExtensionDirectoryWarnings(baseDir, "Global", "meldra-hooks")).toEqual([]);
	});

	it("keeps unrelated custom-tools migration warnings under Meldra ownership", () => {
		const baseDir = workspace();
		mkdirSync(join(baseDir, "hooks"));
		mkdirSync(join(baseDir, "tools"));
		writeFileSync(join(baseDir, "tools", "custom-tool.mjs"), "", "utf8");
		expect(collectDeprecatedExtensionDirectoryWarnings(baseDir, "Project", "meldra-hooks")).toEqual([
			"Project tools/ directory contains custom tools. Custom tools have been merged into extensions.",
		]);
	});
});
