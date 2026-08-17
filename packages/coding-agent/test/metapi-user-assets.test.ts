import { afterEach, describe, expect, test, vi } from "vitest";

const temporaryHome = "C:/tmp/metapi-user-assets-test";

vi.mock("node:os", async () => ({ homedir: () => temporaryHome }));

const {
	composeProfileSettings,
	getEffectiveModelsPath,
	getMetaPiModelPaths,
	hasInitializedMetaPiUser,
	initializeMetaPiUser,
	materializeEffectiveModels,
	MetaPiSettingsStorage,
	METAPI_USER_AUTH_PATH,
	METAPI_USER_MODELS_PATH,
	METAPI_USER_MODELS_STORE_PATH,
	METAPI_USER_PREFERENCES_PATH,
	METAPI_USER_STATE_PATH,
} = await import("../src/metapi/user-assets.ts");
const { resolveProfile, getProfileAgentDir } = await import("../src/metapi/profile-service.ts");
const { SettingsManager } = await import("../src/core/settings-manager.ts");
const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");

afterEach(() => {
	rmSync(temporaryHome, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

describe("MetaPi user assets", () => {
	test("shares MetaPi model assets across ordinary Profiles but preserves pi compatibility", () => {
		const first = getMetaPiModelPaths(resolveProfile("C:/work", "first"));
		const second = getMetaPiModelPaths(resolveProfile("C:/work", "second"));
		const pi = getMetaPiModelPaths(resolveProfile("C:/work", "pi"));

		expect(first.authPath).toBe(second.authPath);
		expect(first.modelsStorePath).toBe(second.modelsStorePath);
		expect(first.modelsPath).not.toBe(second.modelsPath);
		expect(pi.authPath).toBe(join(temporaryHome, ".pi", "agent", "auth.json"));
	});

	test("migrates Pi assets once and fills only missing default Profile model preferences", () => {
		const piAgent = join(temporaryHome, ".pi", "agent");
		writeJson(join(piAgent, "auth.json"), {
			provider: { type: "api_key", key: "fixture-key" },
		});
		writeJson(join(piAgent, "models.json"), {
			providers: { custom: { baseUrl: "http://local" } },
		});
		writeJson(join(piAgent, "models-store.json"), {
			providers: { custom: { models: [{ id: "catalog-model" }] } },
		});
		writeJson(join(piAgent, "settings.json"), {
			defaultProvider: "custom",
			defaultModel: "pi-model",
			defaultThinkingLevel: "high",
			theme: "pi-theme",
			packages: ["do-not-migrate"],
		});
		const defaultSettings = join(temporaryHome, ".metapi", "profiles", "default", "agent", "settings.json");
		writeJson(defaultSettings, { defaultModel: "metapi-model" });

		initializeMetaPiUser("migrate");

		expect(hasInitializedMetaPiUser()).toBe(true);
		expect(JSON.parse(readFileSync(METAPI_USER_STATE_PATH, "utf8"))).toMatchObject({ piMigration: "migrate" });
		expect(JSON.parse(readFileSync(METAPI_USER_PREFERENCES_PATH, "utf8"))).toEqual({ theme: "pi-theme" });
		expect(JSON.parse(readFileSync(METAPI_USER_AUTH_PATH, "utf8"))).toEqual({
			provider: { type: "api_key", key: "fixture-key" },
		});
		expect(JSON.parse(readFileSync(METAPI_USER_MODELS_PATH, "utf8"))).toEqual({
			providers: { custom: { baseUrl: "http://local" } },
		});
		expect(JSON.parse(readFileSync(METAPI_USER_MODELS_STORE_PATH, "utf8"))).toEqual({
			providers: { custom: { models: [{ id: "catalog-model" }] } },
		});
		expect(JSON.parse(readFileSync(join(piAgent, "auth.json"), "utf8"))).toEqual({
			provider: { type: "api_key", key: "fixture-key" },
		});
		expect(JSON.parse(readFileSync(defaultSettings, "utf8"))).toMatchObject({
			defaultProvider: "custom",
			defaultModel: "metapi-model",
			defaultThinkingLevel: "high",
		});
	});

	test("does not overwrite existing MetaPi user assets during accepted migration", () => {
		const piAgent = join(temporaryHome, ".pi", "agent");
		writeJson(join(piAgent, "auth.json"), { pi: "source" });
		writeJson(join(piAgent, "models.json"), { providers: { pi: {} } });
		writeJson(METAPI_USER_AUTH_PATH, { metapi: "existing" });
		writeJson(METAPI_USER_MODELS_PATH, { providers: { metapi: {} } });
		writeJson(METAPI_USER_PREFERENCES_PATH, {
			tuiMode: "fullscreen",
			terminal: { showImages: false },
		});
		writeJson(join(piAgent, "settings.json"), {
			tuiMode: "regular",
			terminal: { showImages: true, imageWidthCells: 72 },
		});

		initializeMetaPiUser("migrate");

		expect(JSON.parse(readFileSync(METAPI_USER_AUTH_PATH, "utf8"))).toEqual({
			metapi: "existing",
		});
		expect(JSON.parse(readFileSync(METAPI_USER_MODELS_PATH, "utf8"))).toEqual({
			providers: { metapi: {} },
		});
		expect(JSON.parse(readFileSync(METAPI_USER_PREFERENCES_PATH, "utf8"))).toEqual({
			tuiMode: "fullscreen",
			terminal: { showImages: false, imageWidthCells: 72 },
		});
	});

	test("records start-fresh without copying Pi state", () => {
		writeJson(join(temporaryHome, ".pi", "agent", "models.json"), {
			providers: { pi: {} },
		});
		initializeMetaPiUser("start-fresh");
		expect(hasInitializedMetaPiUser()).toBe(true);
		expect(JSON.parse(readFileSync(METAPI_USER_PREFERENCES_PATH, "utf8"))).toEqual({});
		expect(() => readFileSync(METAPI_USER_AUTH_PATH, "utf8")).toThrow();
		expect(() => readFileSync(METAPI_USER_MODELS_PATH, "utf8")).toThrow();
		expect(() => readFileSync(METAPI_USER_MODELS_STORE_PATH, "utf8")).toThrow();
	});

	test("keeps the first migration decision on later initialization attempts", () => {
		initializeMetaPiUser("start-fresh");
		writeJson(join(temporaryHome, ".pi", "agent", "models.json"), {
			providers: { pi: {} },
		});

		initializeMetaPiUser("migrate");

		expect(JSON.parse(readFileSync(METAPI_USER_STATE_PATH, "utf8"))).toMatchObject({ piMigration: "start-fresh" });
		expect(() => readFileSync(METAPI_USER_MODELS_PATH, "utf8")).toThrow();
	});

	test("composes Profile model definitions above shared definitions", () => {
		writeJson(METAPI_USER_MODELS_PATH, {
			providers: {
				shared: {
					baseUrl: "https://shared",
					api: "openai-completions",
					models: [{ id: "same", name: "Shared" }, { id: "shared-only" }],
				},
			},
		});
		const bundle = join(temporaryHome, "bundle");
		writeJson(join(bundle, "models.json"), {
			providers: {
				shared: {
					baseUrl: "https://profile",
					models: [{ id: "same", name: "Profile" }, { id: "profile-only" }],
				},
			},
		});
		const profile = resolveProfile("C:/work", "review");
		const output = materializeEffectiveModels(profile, bundle);
		const value = JSON.parse(readFileSync(output, "utf8"));
		expect(output).toBe(getEffectiveModelsPath(profile));
		expect(value.providers.shared.baseUrl).toBe("https://profile");
		expect(value.providers.shared.models).toEqual([
			{ id: "same", name: "Profile" },
			{ id: "shared-only" },
			{ id: "profile-only" },
		]);
	});

	test("replaces an entire shared model when the Profile defines the same id", () => {
		writeJson(METAPI_USER_MODELS_PATH, {
			providers: {
				shared: {
					models: [{ id: "same", reasoning: true, contextWindow: 200000 }],
				},
			},
		});
		const bundle = join(temporaryHome, "replacement-bundle");
		writeJson(join(bundle, "models.json"), {
			providers: { shared: { models: [{ id: "same", name: "Profile" }] } },
		});
		const output = materializeEffectiveModels(resolveProfile("C:/work", "replacement"), bundle);
		expect(JSON.parse(readFileSync(output, "utf8")).providers.shared.models).toEqual([
			{ id: "same", name: "Profile" },
		]);
	});

	test("routes shared UX changes to user preferences and workflow changes to the Profile", async () => {
		const profile = resolveProfile("C:/work", "settings-routing");
		const manager = SettingsManager.fromStorage(new MetaPiSettingsStorage("C:/work", profile.agentDir));
		manager.setTuiMode("fullscreen");
		manager.setDefaultModel("workflow-model");
		manager.setTheme("global-theme");
		await manager.flush();

		expect(JSON.parse(readFileSync(METAPI_USER_PREFERENCES_PATH, "utf8"))).toEqual({
			tuiMode: "fullscreen",
			theme: "global-theme",
		});
		expect(JSON.parse(readFileSync(join(getProfileAgentDir("settings-routing"), "settings.json"), "utf8"))).toEqual({
			defaultModel: "workflow-model",
		});

		const otherManager = SettingsManager.fromStorage(
			new MetaPiSettingsStorage("C:/work", getProfileAgentDir("other-profile")),
		);
		expect(otherManager.getTuiMode()).toBe("fullscreen");
		expect(otherManager.getThemeSetting()).toBe("global-theme");
		expect(otherManager.getDefaultModel()).toBeUndefined();
	});

	test("keeps Pi project Theme overrides above the shared global Theme", () => {
		const cwd = join(temporaryHome, "work");
		const profile = resolveProfile(cwd, "project-theme");
		writeJson(METAPI_USER_PREFERENCES_PATH, { theme: "light" });
		writeJson(join(cwd, ".pi", "settings.json"), { theme: "dark" });
		const manager = SettingsManager.fromStorage(new MetaPiSettingsStorage(cwd, profile.agentDir));
		expect(manager.getThemeSetting()).toBe("dark");
	});

	test("ignores a Profile theme when no global MetaPi theme is selected", () => {
		expect(composeProfileSettings({}, { theme: "profile-theme" })).toEqual({});
	});

	test("keeps Profile workflow settings while applying only shared UX defaults", () => {
		expect(
			composeProfileSettings(
				{
					theme: "user-theme",
					tuiMode: "fullscreen",
					defaultModel: "must-not-be-shared",
				},
				{
					theme: "profile-theme",
					tuiMode: "regular",
					defaultModel: "profile-model",
				},
			),
		).toMatchObject({
			theme: "user-theme",
			tuiMode: "fullscreen",
			defaultModel: "profile-model",
		});
	});
});
