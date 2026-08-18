import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const temporaryHome = "C:/tmp/metapi-starter-setup-test";
const distributionRoot = `${temporaryHome}/distribution`;

vi.mock("node:os", async () => ({ homedir: () => temporaryHome }));
process.env.PI_PACKAGE_DIR = distributionRoot;

const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const { setupStarterProfile, STARTER_PROFILE_PACKAGE_ENTRY } = await import("../src/metapi/starter-setup.ts");
const { getProfileAgentDir } = await import("../src/metapi/profile-service.ts");

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function writeJson(path: string, value: unknown): void {
	write(path, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
	rmSync(temporaryHome, { recursive: true, force: true });
	writeJson(join(distributionRoot, "starter-profile", "package.json"), {
		name: "@slapq/metapi-starter-profile",
		version: "1.0.0",
		pi: { extensions: ["./extensions/setup.ts"] },
	});
	write(join(distributionRoot, "starter-profile", "extensions", "setup.ts"), "export default () => {};\n");
	write(join(distributionRoot, "starter-profile", "AGENTS.md"), "# Default Profile instructions\n");
});

afterEach(() => {
	rmSync(temporaryHome, { recursive: true, force: true });
});

describe("Meldra Starter Profile setup", () => {
	test("installs the bundled package and preserves existing Profile settings", async () => {
		const agentDir = getProfileAgentDir("default");
		const settingsPath = join(agentDir, "settings.json");
		writeJson(settingsPath, { defaultModel: "existing-model", packages: ["packages/existing"] });
		writeJson(join(temporaryHome, ".metapi", "user", "preferences.json"), { tuiMode: "fullscreen" });

		const result = await setupStarterProfile(join(temporaryHome, "work"));
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

		expect(result).toMatchObject({ bundleAction: "installed", packageAdded: true });
		expect(settings).toEqual({
			defaultModel: "existing-model",
			packages: ["packages/existing", STARTER_PROFILE_PACKAGE_ENTRY],
		});
		expect(JSON.parse(readFileSync(join(result.target, "package.json"), "utf8"))).toMatchObject({ version: "1.0.0" });
		expect(existsSync(join(result.target, "extensions", "setup.ts"))).toBe(true);
		expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# Default Profile instructions\n");
	});

	test("is idempotent and restores only the managed Starter package when requested", async () => {
		const cwd = join(temporaryHome, "work");
		const first = await setupStarterProfile(cwd);
		write(join(first.target, "extensions", "setup.ts"), "modified locally\n");
		write(join(getProfileAgentDir("default"), "AGENTS.md"), "custom Profile instructions\n");
		writeJson(join(getProfileAgentDir("default"), "plugin-configs", "kept.json"), { value: "kept" });

		const unchanged = await setupStarterProfile(cwd);
		expect(unchanged).toMatchObject({ bundleAction: "unchanged", packageAdded: false });
		expect(readFileSync(join(first.target, "extensions", "setup.ts"), "utf8")).toBe("modified locally\n");

		const restored = await setupStarterProfile(cwd, { restore: true });
		expect(restored).toMatchObject({ bundleAction: "restored", packageAdded: false });
		expect(readFileSync(join(first.target, "extensions", "setup.ts"), "utf8")).toBe("export default () => {};\n");
		expect(readFileSync(join(getProfileAgentDir("default"), "AGENTS.md"), "utf8")).toBe(
			"custom Profile instructions\n",
		);
		expect(
			JSON.parse(readFileSync(join(getProfileAgentDir("default"), "plugin-configs", "kept.json"), "utf8")),
		).toEqual({ value: "kept" });
	});

	test("filters Starter extensions that are already supplied by legacy default resources", async () => {
		const agentDir = getProfileAgentDir("default");
		const settingsPath = join(agentDir, "settings.json");
		writeJson(settingsPath, {
			packages: ["packages/provider-manager", "packages/metapi-workflows"],
		});
		writeJson(join(agentDir, "packages", "provider-manager", "package.json"), { name: "provider-manager" });
		writeJson(join(agentDir, "packages", "metapi-workflows", "package.json"), { name: "metapi-workflows" });
		write(join(agentDir, "extensions", "scout.ts"), "export default () => {};\n");

		const result = await setupStarterProfile(join(temporaryHome, "work"));
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

		expect(result.enabledExtensions).toEqual(["extensions/setup.ts"]);
		expect(settings.packages).toEqual([
			"packages/provider-manager",
			"packages/metapi-workflows",
			{
				source: STARTER_PROFILE_PACKAGE_ENTRY,
				autoload: false,
				extensions: ["extensions/setup.ts"],
			},
		]);
	});

	test("does not treat missing legacy package paths as active Starter resources", async () => {
		const agentDir = getProfileAgentDir("default");
		const settingsPath = join(agentDir, "settings.json");
		writeJson(settingsPath, {
			packages: ["packages/provider-manager", "packages/metapi-workflows"],
		});

		const result = await setupStarterProfile(join(temporaryHome, "work"));
		expect(result.enabledExtensions).toHaveLength(4);
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).packages).toEqual([
			"packages/provider-manager",
			"packages/metapi-workflows",
			STARTER_PROFILE_PACKAGE_ENTRY,
		]);
	});

	test("updates the Starter package filter when legacy resources are removed", async () => {
		const agentDir = getProfileAgentDir("default");
		const settingsPath = join(agentDir, "settings.json");
		writeJson(settingsPath, {
			packages: [
				{
					source: STARTER_PROFILE_PACKAGE_ENTRY,
					autoload: false,
					extensions: ["extensions/setup.ts"],
				},
			],
		});

		const result = await setupStarterProfile(join(temporaryHome, "work"));
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

		expect(result).toMatchObject({ packageAdded: false, packageUpdated: true });
		expect(result.enabledExtensions).toHaveLength(4);
		expect(settings.packages).toEqual([STARTER_PROFILE_PACKAGE_ENTRY]);
	});

	test("does not modify Pi compatibility state or managed user assets", async () => {
		const piMarker = join(temporaryHome, ".pi", "agent", "settings.json");
		const authMarker = join(temporaryHome, ".metapi", "user", "auth.json");
		const sessionMarker = join(getProfileAgentDir("default"), "sessions", "kept.jsonl");
		write(piMarker, "pi-state\n");
		write(authMarker, "auth-state\n");
		write(sessionMarker, "session-state\n");

		await setupStarterProfile(join(temporaryHome, "work"));

		expect(readFileSync(piMarker, "utf8")).toBe("pi-state\n");
		expect(readFileSync(authMarker, "utf8")).toBe("auth-state\n");
		expect(readFileSync(sessionMarker, "utf8")).toBe("session-state\n");
	});

	test("fails explicitly when the distribution asset is missing", async () => {
		rmSync(join(distributionRoot, "starter-profile"), { recursive: true, force: true });
		await expect(setupStarterProfile(join(temporaryHome, "work"))).rejects.toThrow(/Starter Bundle is missing/);
		expect(existsSync(getProfileAgentDir("default"))).toBe(false);
	});
});
