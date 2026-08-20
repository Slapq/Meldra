import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import meldraWorkflows from "../starter-profile/extensions/meldra-workflows.ts";

const cleanup: string[] = [];
const originalAgentDir = process.env.MELDRA_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.MELDRA_CODING_AGENT_DIR;
	else process.env.MELDRA_CODING_AGENT_DIR = originalAgentDir;
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Meldra workflow Session entry compatibility", () => {
	it("reads legacy tool state and writes only the canonical entry", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "meldra-workflow-compat-"));
		cleanup.push(agentDir);
		process.env.MELDRA_CODING_AGENT_DIR = agentDir;
		const handlers = new Map<string, (...args: any[]) => any>();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const appendEntry = vi.fn();
		const setActiveTools = vi.fn();
		const pi = {
			appendEntry,
			events: {
				emit: (channel: string, value: any) => {
					if (channel === "config:get") value.callback({});
				},
				on: () => () => {},
			},
			getActiveTools: () => ["bash"],
			getAllTools: () => [
				{ name: "read", description: "Read" },
				{ name: "bash", description: "Bash" },
			],
			getFlag: () => undefined,
			getThinkingLevel: () => "off",
			on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) =>
				commands.set(name, command),
			registerFlag: () => {},
			registerShortcut: () => {},
			registerTool: () => {},
			setActiveTools,
		} as unknown as ExtensionAPI;
		meldraWorkflows(pi);
		const ctx = {
			cwd: agentDir,
			mode: "tui",
			model: undefined,
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "metapi-workflow-tools",
						data: { enabledTools: ["read"] },
					},
				],
			},
			ui: {
				notify: vi.fn(),
				setStatus: vi.fn(),
				theme: { fg: (_name: string, text: string) => text },
			},
		} as unknown as ExtensionContext;

		await handlers.get("session_start")?.({}, ctx);
		expect(setActiveTools).toHaveBeenLastCalledWith(["read"]);

		await commands.get("tools")?.handler("reset", ctx as any);
		expect(appendEntry).toHaveBeenCalledWith("meldra-workflow-tools", { reset: true });
		expect(appendEntry).not.toHaveBeenCalledWith("metapi-workflow-tools", expect.anything());
	});
});
