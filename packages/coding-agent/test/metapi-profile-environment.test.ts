import { afterEach, describe, expect, it } from "vitest";
import { normalizePortableProfileManifest } from "../src/meldra/profile-bundle.ts";
import { applyProfileEnvironment } from "../src/meldra/profile-environment.ts";
import type { ProfileSelection } from "../src/meldra/profile-service.ts";

const originalEnvironment = { ...process.env };

function restoreEnvironment(): void {
	for (const name of Object.keys(process.env)) delete process.env[name];
	Object.assign(process.env, originalEnvironment);
}

afterEach(restoreEnvironment);

const profile: ProfileSelection = {
	name: "environment-test",
	displayName: "Environment Test",
	agentDir: "C:/profiles/environment-test/agent",
	compatibility: false,
};

describe("Meldra Profile environment declarations", () => {
	it.each([
		[{ inherit: "PATH" }, "environment.inherit"],
		[{ required: [42] }, "environment.required"],
		[{ optional: [""] }, "environment.optional"],
		[{ defaults: [] }, "environment.defaults"],
		[{ defaults: { TOKEN: 42 } }, "environment.defaults"],
	] as const)("rejects an invalid declaration before import", (environment, message) => {
		expect(() =>
			normalizePortableProfileManifest({
				profileVersion: 1,
				environment: environment as never,
			}),
		).toThrow(message);
	});

	it("does not change the process environment when a persisted declaration is invalid", () => {
		process.env.PROFILE_TEST_SECRET = "preserved";
		const before = { ...process.env };

		expect(() =>
			applyProfileEnvironment(
				profile,
				{
					portable: {
						profileVersion: 1,
						environment: { required: "PROFILE_TEST_SECRET" } as never,
					},
				} as never,
				before,
			),
		).toThrow("environment.required");
		expect({ ...process.env }).toEqual(before);
	});

	it("preserves the existing inheritance, default, and required-name behavior", () => {
		const missing = applyProfileEnvironment(
			profile,
			{
				portable: {
					profileVersion: 1,
					environment: {
						inherit: ["PROFILE_TEST_INHERITED"],
						required: ["PROFILE_TEST_INHERITED", "PROFILE_TEST_MISSING"],
						defaults: { PROFILE_TEST_DEFAULT: "default-value" },
					},
				},
			} as never,
			{
				PATH: originalEnvironment.PATH,
				PROFILE_TEST_INHERITED: "inherited-value",
				PROFILE_TEST_FILTERED: "filtered-value",
			},
		);

		expect(process.env.PROFILE_TEST_INHERITED).toBe("inherited-value");
		expect(process.env.PROFILE_TEST_DEFAULT).toBe("default-value");
		expect(process.env.PROFILE_TEST_FILTERED).toBeUndefined();
		expect(missing).toEqual(["PROFILE_TEST_MISSING"]);
	});
});
