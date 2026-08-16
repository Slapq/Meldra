import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";

interface WorkspaceRuntimeInternals {
	runtime: {
		harness: {
			client: { request(): Promise<unknown> };
			close(): Promise<void>;
		};
		sessionId: string;
		eventCursors: Map<"mux" | "host", string>;
		eventTasks: Promise<void>[];
	};
	call: ReturnType<typeof vi.fn>;
}

function createRuntime() {
	const runtime = new DshProfileRuntime({
		cwd: "C:/work",
		agentDir: "C:/profile/agent",
		modelRuntime: {} as ModelRuntime,
	});
	const internals = runtime as unknown as WorkspaceRuntimeInternals;
	internals.runtime = {
		harness: {
			client: { request: vi.fn(async () => undefined) },
			close: vi.fn(async () => undefined),
		},
		sessionId: "dsh-session",
		eventCursors: new Map(),
		eventTasks: [],
	};
	internals.call = vi.fn(async (method: string) => ({
		result: {
			ok: true,
			value:
				method === "session.create"
					? { sessionId: "new-session" }
					: method === "workspace.list"
						? {
								items: [
									{
										workspaceId: "workspace-1",
										title: "Work",
										path: "C:/work",
									},
								],
								archivedSessionIds: ["archived-session"],
							}
						: method === "workspace.create"
							? {
									workspace: {
										workspaceId: "workspace-1",
										title: "Work",
										path: "C:/work",
									},
									created: true,
								}
							: {},
		},
	}));
	return { runtime, call: internals.call };
}

describe("DSH Workspace ApiProxy wiring", () => {
	it("preserves native workspace method names and payload semantics", async () => {
		const { runtime, call } = createRuntime();

		expect(await runtime.newSession("workspace-1")).toBe("new-session");
		expect(runtime.sessionId).toBe("new-session");
		expect(await runtime.newSession()).toBe("new-session");
		expect(await runtime.workspaces()).toEqual({
			items: [{ workspaceId: "workspace-1", title: "Work", path: "C:/work" }],
			archivedSessionIds: ["archived-session"],
		});
		expect(await runtime.createWorkspace("C:/work")).toMatchObject({
			created: true,
		});
		await runtime.renameWorkspace("workspace-1", "Renamed");
		await runtime.deleteWorkspace("workspace-1");
		await runtime.moveWorkspace("workspace-1", "workspace-2");
		await runtime.moveWorkspace("workspace-1");
		await runtime.moveCurrentSession("workspace-1", "session-2");
		await runtime.moveCurrentSession("workspace-1");
		await runtime.archiveCurrentSession();

		expect(call.mock.calls).toEqual([
			["session.create", { workspaceId: "workspace-1" }],
			["session.create", { cwd: "C:/work" }],
			["workspace.list", {}],
			["workspace.create", { path: "C:/work" }],
			["workspace.rename", { workspaceId: "workspace-1", title: "Renamed" }],
			["workspace.delete", { workspaceId: "workspace-1" }],
			["workspace.insertBefore", { workspaceId: "workspace-1", beforeWorkspaceId: "workspace-2" }],
			["workspace.insertBefore", { workspaceId: "workspace-1" }],
			[
				"workspace.insertSessionBefore",
				{
					workspaceId: "workspace-1",
					sessionId: "new-session",
					beforeSessionId: "session-2",
				},
			],
			["workspace.insertSessionBefore", { workspaceId: "workspace-1", sessionId: "new-session" }],
			["workspace.archiveSession", { sessionId: "new-session" }],
		]);
	});
});
