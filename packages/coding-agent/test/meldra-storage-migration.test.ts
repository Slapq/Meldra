import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const temporaryHome = "C:/tmp/meldra-storage-migration-test";

vi.mock("node:os", async () => ({ homedir: () => temporaryHome }));

const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { LEGACY_METAPI_HOME, MELDRA_HOME, migrateLegacyMeldraStorage } = await import(
	"../src/meldra/storage-migrations.ts"
);

beforeEach(() => {
	rmSync(temporaryHome, { recursive: true, force: true });
});

afterEach(() => {
	rmSync(temporaryHome, { recursive: true, force: true });
});

describe("Meldra storage migration", () => {
	test("moves legacy user storage and project manifest before normal reads", () => {
		mkdirSync(join(LEGACY_METAPI_HOME, "profiles", "default", "agent"), { recursive: true });
		writeFileSync(join(LEGACY_METAPI_HOME, "profiles", "default", "profile.json"), '{"displayName":"Legacy"}');
		mkdirSync(join(temporaryHome, "project", ".pi"), { recursive: true });
		writeFileSync(join(temporaryHome, "project", ".pi", "metapi.json"), '{"schemaVersion":1}');

		expect(migrateLegacyMeldraStorage(join(temporaryHome, "project"))).toEqual({ home: true, projectManifest: true });
		expect(existsSync(LEGACY_METAPI_HOME)).toBe(true);
		expect(readFileSync(join(MELDRA_HOME, "profiles", "default", "profile.json"), "utf8")).toBe(
			'{"displayName":"Legacy"}',
		);
		expect(readFileSync(join(temporaryHome, "project", ".pi", "meldra.json"), "utf8")).toBe('{"schemaVersion":1}');
	});

	test("is idempotent after the legacy paths have moved", () => {
		mkdirSync(join(LEGACY_METAPI_HOME, "user"), { recursive: true });
		writeFileSync(join(LEGACY_METAPI_HOME, "user", "state.json"), "{}");
		const cwd = join(temporaryHome, "project");

		expect(migrateLegacyMeldraStorage(cwd)).toEqual({ home: true, projectManifest: false });
		expect(migrateLegacyMeldraStorage(cwd)).toEqual({ home: false, projectManifest: false });
	});

	test("fails without modifying either side when both storage roots exist", () => {
		mkdirSync(LEGACY_METAPI_HOME, { recursive: true });
		mkdirSync(MELDRA_HOME, { recursive: true });

		expect(() => migrateLegacyMeldraStorage(join(temporaryHome, "project"))).toThrow(
			"both legacy and Meldra paths exist",
		);
		expect(existsSync(LEGACY_METAPI_HOME)).toBe(true);
		expect(existsSync(MELDRA_HOME)).toBe(true);
	});

	test("fails when both project manifests exist", () => {
		const cwd = join(temporaryHome, "project");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "metapi.json"), "legacy");
		writeFileSync(join(cwd, ".pi", "meldra.json"), "current");

		expect(() => migrateLegacyMeldraStorage(cwd)).toThrow("both legacy and Meldra paths exist");
		expect(readFileSync(join(cwd, ".pi", "metapi.json"), "utf8")).toBe("legacy");
		expect(readFileSync(join(cwd, ".pi", "meldra.json"), "utf8")).toBe("current");
	});
});
