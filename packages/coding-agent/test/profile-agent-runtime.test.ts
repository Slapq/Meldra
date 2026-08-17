import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import {
	createProfileRuntime,
	type ProfileAgentRuntime,
	type ProfileAgentRuntimeHost,
	type ProfileRuntimeDescriptor,
	type ProfileRuntimeProvider,
} from "../src/core/profile-agent-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { dshProfileRuntimeProvider } from "../src/metapi/dsh-profile-runtime-provider.ts";

class FakeProfileRuntime implements ProfileAgentRuntime {
	isStreaming = false;
	host?: ProfileAgentRuntimeHost;
	prompts: unknown[] = [];
	attach = vi.fn((host: ProfileAgentRuntimeHost) => {
		this.host = host;
	});
	prompt = vi.fn(async (input) => {
		this.prompts.push(input);
		this.host?.appendEntry("profile-runtime-test", { text: input.text });
	});
	abort = vi.fn(async () => undefined);
	waitForIdle = vi.fn(async () => undefined);
	dispose = vi.fn(async () => undefined);
}

function descriptor(name = "default", runtime?: ProfileRuntimeDescriptor["runtime"]): ProfileRuntimeDescriptor {
	return {
		name,
		displayName: name,
		agentDir: `/tmp/${name}/agent`,
		cwd: `/tmp/${name}`,
		compatibility: name === "pi",
		...(runtime ? { runtime } : {}),
		modelRuntime: {} as ModelRuntime,
	};
}

function provider(id: string, matches: boolean, runtime = new FakeProfileRuntime()): ProfileRuntimeProvider {
	return {
		id,
		supports: vi.fn(() => matches),
		create: vi.fn(() => runtime),
	};
}

describe("Profile Runtime providers", () => {
	it("returns undefined when no provider matches", async () => {
		const candidate = provider("candidate", false);
		await expect(createProfileRuntime([candidate], descriptor())).resolves.toBeUndefined();
		expect(candidate.create).not.toHaveBeenCalled();
	});

	it("creates the runtime from the single matching provider", async () => {
		const runtime = new FakeProfileRuntime();
		const ignored = provider("ignored", false);
		const matched = provider("matched", true, runtime);

		await expect(createProfileRuntime([ignored, matched], descriptor("custom"))).resolves.toBe(runtime);
		expect(matched.create).toHaveBeenCalledWith(descriptor("custom"));
	});

	it("keeps DSH matching and command-surface declarations in the DSH provider module", async () => {
		expect(dshProfileRuntimeProvider.supports(descriptor("dsh"))).toBe(true);
		expect(dshProfileRuntimeProvider.supports(descriptor("deepseek-harness"))).toBe(true);
		expect(dshProfileRuntimeProvider.supports(descriptor("default"))).toBe(false);
		expect(dshProfileRuntimeProvider.supports(descriptor("pi"))).toBe(false);
		const runtime = await dshProfileRuntimeProvider.create(descriptor("dsh"));
		expect(runtime.commandSurface?.doubleEscapeExtensionCommand).toBe("rewind");
		expect(runtime.commandSurface?.preferredExtensionCommands).toEqual([
			"resume",
			"new",
			"fork",
			"name",
			"compact",
			"session",
			"settings",
		]);
		expect(runtime.commandSurface?.hiddenBuiltinCommands).toEqual([
			"clone",
			"tree",
			"scoped-models",
			"import",
			"login",
			"logout",
		]);
	});

	it("matches DSH by portable provider identity for any Profile name", () => {
		expect(
			dshProfileRuntimeProvider.supports(
				descriptor("research", { provider: "deepseek-harness", config: { plugins: ["example"] } }),
			),
		).toBe(true);
		expect(dshProfileRuntimeProvider.supports(descriptor("dsh", { provider: "another-runtime" }))).toBe(false);
	});

	it("rejects ambiguous provider matches", async () => {
		await expect(
			createProfileRuntime([provider("first", true), provider("second", true)], descriptor("custom")),
		).rejects.toThrow('Multiple Profile Runtime providers match Profile "custom": first, second');
	});
});

describe("ProfileAgentRuntime", () => {
	it("uses provider-owned finalized assistant text for copy surfaces", async () => {
		class LastTextRuntime extends FakeProfileRuntime {
			getLastAssistantText = () => "provider answer";
		}
		const { session } = await createAgentSession({
			cwd: "/tmp/profile-runtime-copy",
			sessionManager: SessionManager.inMemory("/tmp/profile-runtime-copy"),
			settingsManager: SettingsManager.inMemory(),
			profileRuntime: new LastTextRuntime(),
		});

		expect(session.getLastAssistantText()).toBe("provider answer");
	});

	it("persists a silent transcript entry without emitting entry_appended", async () => {
		class SilentRuntime extends FakeProfileRuntime {
			override prompt = vi.fn(async () => {
				this.host?.appendEntry("profile-runtime-silent", { text: "done" }, { notify: false });
			});
		}
		const profileRuntime = new SilentRuntime();
		const sessionManager = SessionManager.inMemory("/tmp/profile-runtime-silent");
		const { session } = await createAgentSession({
			cwd: "/tmp/profile-runtime-silent",
			sessionManager,
			settingsManager: SettingsManager.inMemory(),
			profileRuntime,
		});
		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);

		await session.prompt("hello", { expandPromptTemplates: false });

		expect(sessionManager.getEntries()).toContainEqual(
			expect.objectContaining({
				type: "custom",
				customType: "profile-runtime-silent",
				data: { text: "done" },
			}),
		);
		expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "entry_appended" }));
		unsubscribe();
	});

	it("is construction-time attached and owns prompt, abort, idle, and transcript entries", async () => {
		const profileRuntime = new FakeProfileRuntime();
		const sessionManager = SessionManager.inMemory("/tmp/profile-runtime");
		const { session } = await createAgentSession({
			cwd: "/tmp/profile-runtime",
			sessionManager,
			settingsManager: SettingsManager.inMemory(),
			profileRuntime,
		});

		await session.prompt("hello", { expandPromptTemplates: false });
		await session.abort();
		await session.waitForIdle();
		await session.disposeProfileRuntime();

		expect(profileRuntime.attach).toHaveBeenCalledTimes(1);
		expect(profileRuntime.prompt).toHaveBeenCalledWith({
			text: "hello",
			images: undefined,
			streamingBehavior: undefined,
		});
		expect(profileRuntime.abort).toHaveBeenCalledTimes(1);
		expect(profileRuntime.waitForIdle).toHaveBeenCalledTimes(1);
		expect(profileRuntime.dispose).toHaveBeenCalledTimes(1);
		expect(session.agent.state.messages).toEqual([]);
		expect(sessionManager.getEntries()).toContainEqual(
			expect.objectContaining({
				type: "custom",
				customType: "profile-runtime-test",
				data: { text: "hello" },
			}),
		);
	});
});
