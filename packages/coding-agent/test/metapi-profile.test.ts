import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { normalizePortableProfileManifest } from "../src/metapi/profile-bundle.ts";
import {
	assertProfileName,
	extractProfileArgument,
	getProfileAgentDir,
	removeProfileArguments,
	resolveProfile,
} from "../src/metapi/profile-service.ts";

describe("MetaPi Profile selection", () => {
	test("parses and removes the profile startup option", () => {
		const args = ["--profile", "work", "--model", "gpt", "hello"];
		expect(extractProfileArgument(args)).toBe("work");
		expect(removeProfileArguments(args)).toEqual(["--model", "gpt", "hello"]);
		expect(parseArgs(["--profile", "work"]).profile).toBe("work");
	});

	test("supports equals form", () => {
		const args = ["--profile=review", "--print", "hello"];
		expect(extractProfileArgument(args)).toBe("review");
		expect(removeProfileArguments(args)).toEqual(["--print", "hello"]);
	});

	test("uses the reserved Pi compatibility directory", () => {
		const profile = resolveProfile("C:/project", "pi");
		expect(profile.name).toBe("pi");
		expect(profile.compatibility).toBe(true);
		expect(profile.agentDir).toBe(getProfileAgentDir("pi"));
	});

	test("uses an isolated directory for named Profiles", () => {
		const profile = resolveProfile("C:/project", "work");
		expect(profile.name).toBe("work");
		expect(profile.compatibility).toBe(false);
		expect(profile.agentDir).toContain(".metapi");
		expect(
			profile.agentDir.endsWith("profiles/work/agent") || profile.agentDir.endsWith("profiles\\work\\agent"),
		).toBe(true);
	});

	test("layers local settings above Portable Profile settings", () => {
		const settings = SettingsManager.inMemory(
			{ defaultThinkingLevel: "high", theme: "dark" },
			{
				baseSettings: {
					defaultThinkingLevel: "medium",
					defaultModel: "profile-model",
				},
			},
		);
		expect(settings.getDefaultThinkingLevel()).toBe("high");
		expect(settings.getDefaultModel()).toBe("profile-model");
		expect(settings.getEffectiveGlobalSettings()).toMatchObject({
			defaultThinkingLevel: "high",
			defaultModel: "profile-model",
			theme: "dark",
		});
	});

	test("preserves a portable Profile Runtime declaration without interpreting provider configuration", () => {
		expect(
			normalizePortableProfileManifest({
				profileVersion: 1,
				runtime: {
					provider: " deepseek-harness ",
					config: { plugins: ["npm:@example/dsh-plugin@1.0.0"] },
				},
			}),
		).toMatchObject({
			runtime: {
				provider: "deepseek-harness",
				config: { plugins: ["npm:@example/dsh-plugin@1.0.0"] },
			},
		});
		expect(normalizePortableProfileManifest({ profileVersion: 1, runtime: { provider: " " } })).not.toHaveProperty(
			"runtime",
		);
	});

	test("rejects unsafe Profile names", () => {
		expect(() => assertProfileName("../other")).toThrow("Invalid Profile name");
		expect(() => assertProfileName("work/name")).toThrow("Invalid Profile name");
	});
});
