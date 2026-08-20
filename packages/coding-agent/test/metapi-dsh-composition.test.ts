import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	MELDRA_DSH_DEFAULT_BUNDLES,
	MELDRA_DSH_PROFILE,
	prepareDshComposition,
} from "../src/extensions/dsh/composition.ts";

const require = createRequire(import.meta.url);
const homes: string[] = [];
const DSH_COMPOSITION_TEST_TIMEOUT_MS = 60_000;

function containsEntryId(value: unknown, id: string): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.id === id || (Array.isArray(record.insert) && record.insert.some((item) => containsEntryId(item, id)));
}

function prepare(home: string) {
	return prepareDshComposition({
		binName: "meldra-dsh-test",
		home,
		installAnchor: require.resolve("@deepseek-ai/dsh/package.json"),
		surfacePath: join(import.meta.dirname, "../src/extensions/dsh/surface.patch.yml"),
		serverPath: pathToFileURL(join(import.meta.dirname, "../src/extensions/dsh/server.ts")).href,
		sandboxEscalationCompatPath: pathToFileURL(
			join(import.meta.dirname, "../src/extensions/dsh/sandbox-escalation-compat.ts"),
		).href,
	});
}

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("DSH Profile composition", () => {
	it(
		"initializes the native Meldra profile with the current bundle roster",
		() => {
			const home = mkdtempSync(join(tmpdir(), "metapi-dsh-profile-"));
			homes.push(home);

			const composition = prepare(home);
			const manifest = JSON.parse(readFileSync(join(composition.profile.dir, "package.json"), "utf8")) as {
				dsh: { profile: { bundles: string[] } };
			};

			expect(composition.profile.name).toBe(MELDRA_DSH_PROFILE);
			expect(manifest.dsh.profile.bundles).toEqual(MELDRA_DSH_DEFAULT_BUNDLES);
			expect(composition.profile.layers.map((layer) => layer.packageName)).toEqual(MELDRA_DSH_DEFAULT_BUNDLES);
			expect(readFileSync(composition.rootPath, "utf8")).toContain("[]");
			expect(composition.patches.some((patch) => containsEntryId(patch, "meldra-directory-picker"))).toBe(true);
			expect(composition.patches.some((patch) => containsEntryId(patch, "meldra-sandbox-escalation-compat"))).toBe(
				true,
			);
			expect(composition.patches.some((patch) => containsEntryId(patch, "meldra-tui-jsonrpc-server"))).toBe(true);
		},
		DSH_COMPOSITION_TEST_TIMEOUT_MS,
	);

	it(
		"preserves installed dependencies and loads the native user patch before the surface",
		() => {
			const home = mkdtempSync(join(tmpdir(), "metapi-dsh-profile-"));
			homes.push(home);
			const first = prepare(home);
			const manifestPath = join(first.profile.dir, "package.json");
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
				dependencies: Record<string, string>;
			};
			manifest.dependencies.example = "1.0.0";
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			writeFileSync(first.profile.patchPath, "- id: metapi-test-user-row\n  disabled: true\n");

			const composition = prepare(home);
			const persisted = JSON.parse(readFileSync(manifestPath, "utf8")) as {
				dependencies: Record<string, string>;
			};
			const userIndex = composition.patches.findIndex((patch) => patch.id === "metapi-test-user-row");
			const surfaceIndex = composition.patches.findIndex((patch) =>
				containsEntryId(patch, "meldra-tui-jsonrpc-server"),
			);

			expect(persisted.dependencies.example).toBe("1.0.0");
			expect(userIndex).toBeGreaterThanOrEqual(0);
			expect(surfaceIndex).toBeGreaterThan(userIndex);
		},
		DSH_COMPOSITION_TEST_TIMEOUT_MS,
	);
});
