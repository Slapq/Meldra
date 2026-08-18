import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { getSessionProfile, replaceSessionProfile, setSessionProfile } from "../src/metapi/session-profile.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	while (cleanup.length > 0) await cleanup.pop()?.();
});

describe("Meldra runtime Profile switching", () => {
	it.each([
		{ kind: "persisted", persisted: true },
		{ kind: "in-memory", persisted: false },
	])("starts a fresh $kind session owned by the selected Profile", async ({ persisted }) => {
		const root = join(tmpdir(), `metapi-profile-switch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwd = join(root, "workspace");
		mkdirSync(cwd, { recursive: true });
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ok")]);
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(root, "models.json"),
		});
		const createdProfiles: string[] = [];
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
			profileName,
		}) => {
			createdProfiles.push(profileName ?? "missing");
			const services = await createAgentSessionServices({
				cwd,
				agentDir: join(root, profileName ?? "missing"),
				modelRuntime,
				resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const manager = persisted
			? SessionManager.create(cwd, join(root, "default-sessions"))
			: SessionManager.inMemory(cwd);
		setSessionProfile(manager, "default");
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir: join(root, "default"),
			sessionManager: manager,
			profileName: "default",
			metapiLifecycle: {
				getProfileName: getSessionProfile,
				setProfileName: replaceSessionProfile,
				getWorkspaceRoot: () => undefined,
				setWorkspaceRoot: () => {},
				getSessionDir: (_cwd, profileName) => join(root, `${profileName}-sessions`),
				createEmptyWorkspace: () => cwd,
				copyWorkspace: () => cwd,
			},
		});
		cleanup.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		});

		const previousManager = runtime.session.sessionManager;
		previousManager.appendMessage({ role: "user", content: "before switch", timestamp: Date.now() });
		const previousSessionId = previousManager.getSessionId();
		const previousSessionFile = runtime.session.sessionFile;
		await runtime.switchProfile("work");

		expect(runtime.session.sessionManager).not.toBe(previousManager);
		expect(runtime.session.sessionManager.getSessionId()).not.toBe(previousSessionId);
		if (persisted) {
			expect(runtime.session.sessionFile).not.toBe(previousSessionFile);
			expect(runtime.session.sessionManager.getSessionDir()).toBe(join(root, "work-sessions"));
		} else {
			expect(previousSessionFile).toBeUndefined();
			expect(runtime.session.sessionFile).toBeUndefined();
		}
		expect(runtime.session.sessionManager.buildSessionContext().messages).toEqual([]);
		expect(getSessionProfile(previousManager)).toBe("default");
		expect(previousManager.buildSessionContext().messages).toHaveLength(1);
		expect(getSessionProfile(runtime.session.sessionManager)).toBe("work");
		expect(runtime.cwd).toBe(cwd);
		expect(createdProfiles).toEqual(["default", "work"]);
	});
});
