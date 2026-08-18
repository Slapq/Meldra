import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APP_NAME,
	ENV_AGENT_DIR,
	ENV_AUTH_PATH,
	ENV_MODELS_PATH,
	ENV_MODELS_STORE_PATH,
	getAgentDir,
	getAuthPath,
	getModelsPath,
	getModelsStorePath,
} from "../src/config.ts";

describe("Meldra brand compatibility", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("uses Meldra for the primary CLI and environment namespace", () => {
		expect(APP_NAME).toBe("meldra");
		expect(ENV_AGENT_DIR).toBe("MELDRA_CODING_AGENT_DIR");
		expect(ENV_AUTH_PATH).toBe("MELDRA_AUTH_PATH");
		expect(ENV_MODELS_PATH).toBe("MELDRA_MODELS_PATH");
		expect(ENV_MODELS_STORE_PATH).toBe("MELDRA_MODELS_STORE_PATH");
	});

	it("continues reading legacy path overrides", () => {
		vi.stubEnv("METAPI_CODING_AGENT_DIR", "C:/legacy/agent");
		vi.stubEnv("METAPI_AUTH_PATH", "C:/legacy/auth.json");
		vi.stubEnv("METAPI_MODELS_PATH", "C:/legacy/models.json");
		vi.stubEnv("METAPI_MODELS_STORE_PATH", "C:/legacy/models-store.json");

		expect(getAgentDir()).toBe("C:/legacy/agent");
		expect(getAuthPath()).toBe("C:/legacy/auth.json");
		expect(getModelsPath()).toBe("C:/legacy/models.json");
		expect(getModelsStorePath()).toBe("C:/legacy/models-store.json");
	});
});
