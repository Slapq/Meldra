import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APP_NAME,
	ENV_AGENT_DIR,
	ENV_AUTH_PATH,
	ENV_MODELS_PATH,
	ENV_MODELS_STORE_PATH,
	ENV_SESSION_DIR,
	getAgentDir,
	getAuthPath,
	getModelsPath,
	getModelsStorePath,
	getSessionDirOverride,
} from "../src/config.ts";

describe("Meldra brand compatibility", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("uses Meldra for the primary CLI and environment namespace", () => {
		expect(APP_NAME).toBe("meldra");
		expect(ENV_AGENT_DIR).toBe("MELDRA_CODING_AGENT_DIR");
		expect(ENV_AUTH_PATH).toBe("MELDRA_AUTH_PATH");
		expect(ENV_MODELS_PATH).toBe("MELDRA_MODELS_PATH");
		expect(ENV_MODELS_STORE_PATH).toBe("MELDRA_MODELS_STORE_PATH");
		expect(ENV_SESSION_DIR).toBe("MELDRA_CODING_AGENT_SESSION_DIR");
	});

	it("prefers canonical Meldra path overrides", () => {
		vi.stubEnv("MELDRA_CODING_AGENT_DIR", "C:/meldra/agent");
		vi.stubEnv("METAPI_CODING_AGENT_DIR", "C:/legacy/agent");
		vi.stubEnv("MELDRA_CODING_AGENT_SESSION_DIR", "C:/meldra/sessions");
		vi.stubEnv("METAPI_CODING_AGENT_SESSION_DIR", "C:/legacy/sessions");

		expect(getAgentDir()).toBe("C:/meldra/agent");
		expect(getSessionDirOverride()).toBe("C:/meldra/sessions");
	});

	it("continues reading legacy path overrides", () => {
		vi.stubEnv("MELDRA_CODING_AGENT_DIR", undefined);
		vi.stubEnv("MELDRA_AUTH_PATH", undefined);
		vi.stubEnv("MELDRA_MODELS_PATH", undefined);
		vi.stubEnv("MELDRA_MODELS_STORE_PATH", undefined);
		vi.stubEnv("MELDRA_CODING_AGENT_SESSION_DIR", undefined);
		vi.stubEnv("METAPI_CODING_AGENT_DIR", "C:/legacy/agent");
		vi.stubEnv("METAPI_AUTH_PATH", "C:/legacy/auth.json");
		vi.stubEnv("METAPI_MODELS_PATH", "C:/legacy/models.json");
		vi.stubEnv("METAPI_MODELS_STORE_PATH", "C:/legacy/models-store.json");
		vi.stubEnv("METAPI_CODING_AGENT_SESSION_DIR", "C:/legacy/sessions");

		expect(getAgentDir()).toBe("C:/legacy/agent");
		expect(getAuthPath()).toBe("C:/legacy/auth.json");
		expect(getModelsPath()).toBe("C:/legacy/models.json");
		expect(getModelsStorePath()).toBe("C:/legacy/models-store.json");
		expect(getSessionDirOverride()).toBe("C:/legacy/sessions");
	});
});
