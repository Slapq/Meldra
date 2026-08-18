import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import {
	getProfileSessionDir,
	getSessionProfile,
	replaceSessionProfile,
	setSessionProfile,
} from "../src/metapi/session-profile.ts";
import { copyWorkspace, createEmptyWorkspace } from "../src/metapi/workspace-service.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("Meldra runtime WorkSpace lifecycle", () => {
	it("creates empty /new workspaces and copies fork workspaces", async () => {
		const root = join(tmpdir(), `metapi-runtime-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const workspaceRoot = join(root, "workspaces");
		const source = join(workspaceRoot, "source-session");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "marker.txt"), "source", "utf8");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("one")]);
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(root, "models.json"),
		});
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: join(root, "agent"),
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
		const manager = SessionManager.inMemory(source);
		setSessionProfile(manager, "default");
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: source,
			agentDir: join(root, "agent"),
			sessionManager: manager,
			profileName: "default",
			metapiLifecycle: {
				getProfileName: getSessionProfile,
				setProfileName: replaceSessionProfile,
				getWorkspaceRoot: () => workspaceRoot,
				setWorkspaceRoot: () => {},
				getSessionDir: getProfileSessionDir,
				createEmptyWorkspace: (targetRoot, id) => createEmptyWorkspace(targetRoot, id).cwd,
				copyWorkspace: (cwd, targetRoot, id) => copyWorkspace(cwd, targetRoot, id).cwd,
			},
		});
		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		});

		await runtime.newSession();
		const emptyWorkspace = runtime.cwd;
		expect(emptyWorkspace).not.toBe(source);
		expect(existsSync(join(emptyWorkspace, "marker.txt"))).toBe(false);

		writeFileSync(join(emptyWorkspace, "fork.txt"), "copied", "utf8");
		runtime.session.sessionManager.appendMessage({ role: "user", content: "fork", timestamp: Date.now() });
		const user = runtime.session.getUserMessagesForForking()[0];
		await runtime.fork(user.entryId);

		expect(runtime.cwd).not.toBe(emptyWorkspace);
		expect(readFileSync(join(runtime.cwd, "fork.txt"), "utf8")).toBe("copied");

		const forkWorkspace = runtime.cwd;
		await runtime.switchProfile("work");
		expect(runtime.cwd).toBe(forkWorkspace);
		expect(readFileSync(join(runtime.cwd, "fork.txt"), "utf8")).toBe("copied");
		expect(getSessionProfile(runtime.session.sessionManager)).toBe("work");
		expect(runtime.session.sessionManager.buildSessionContext().messages).toEqual([]);
	});
});
