import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import { MELDRA_SESSION_WORKSPACE_ENTRY } from "../src/meldra/session-profile.ts";
import workspaceExtension from "../src/meldra/workspace-extension.ts";

function setup(withWorkspace = true) {
	let command: Omit<RegisteredCommand, "name" | "sourceInfo"> | undefined;
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const api = {
		registerCommand(name: string, registered: Omit<RegisteredCommand, "name" | "sourceInfo">) {
			if (name === "workspace") command = registered;
		},
		on(event: string, handler: (...args: any[]) => unknown) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	workspaceExtension(api);
	const ctx = {
		cwd: "C:\\Users\\test\\.meldra\\workspaces\\session-id",
		sessionManager: {
			getEntries: () =>
				withWorkspace
					? [
							{
								type: "custom",
								customType: MELDRA_SESSION_WORKSPACE_ENTRY,
								data: { root: "C:\\Users\\test\\.meldra\\workspaces" },
							},
						]
					: [],
		},
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			theme: { fg: (_name: string, text: string) => text },
		},
	} as unknown as ExtensionContext;
	if (!command) throw new Error("workspace command not registered");
	return { command, handlers, ctx };
}

describe("Meldra WorkSpace extension", () => {
	it("shows the current WorkSpace and its root", async () => {
		const { command, ctx } = setup();
		await command.handler("", ctx as any);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("当前 WorkSpace"), "info");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Profile 资源默认不会写入 WorkSpace"), "info");
	});

	it("uses the canonical WorkSpace status slot", () => {
		const { handlers, ctx } = setup();
		handlers.get("session_start")?.({}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("meldra-workspace", "WorkSpace · /workspace");
	});

	it("injects scope-selection guidance only for WorkSpace sessions", () => {
		const { handlers, ctx } = setup();
		const handler = handlers.get("before_agent_start");
		const result = handler?.({ systemPrompt: "base" }, ctx) as { systemPrompt?: string } | undefined;
		expect(result?.systemPrompt).toContain("Current Profile or Current WorkSpace");
		expect(result?.systemPrompt).toContain("Do not silently create WorkSpace .pi resource files");

		const without = setup(false);
		expect(without.handlers.get("before_agent_start")?.({ systemPrompt: "base" }, without.ctx)).toBeUndefined();
	});
});
