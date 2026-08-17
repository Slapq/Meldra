import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import scoutExtension from "../starter-profile/extensions/scout.ts";

const agentDir = "C:/tmp/metapi-scout-config-test/agent";
type Handler = (...args: any[]) => any;

function loadScout(config: Record<string, unknown> = {}) {
	const commands = new Map<string, { handler: Handler }>();
	const lifecycle = new Map<string, Handler>();
	const tools = new Map<string, any>();
	let registration: any;
	const pi = {
		events: {
			emit: (name: string, value: any) => {
				if (name === "config:register") registration = value;
				if (name === "config:get") value.callback({ ...(registration?.defaults ?? {}), ...config });
			},
			on: vi.fn(),
		},
		on: (name: string, handler: Handler) => lifecycle.set(name, handler),
		registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
		registerTool: (tool: any) => tools.set(tool.name, tool),
	} as any;
	scoutExtension(pi);
	return { commands, lifecycle, tools, registration };
}

beforeEach(() => {
	process.env.METAPI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(agentDir, "plugin-configs"), { recursive: true });
	writeFileSync(join(agentDir, "plugin-configs", "pi-config.json"), JSON.stringify({ lang: "zh" }), "utf8");
});

afterEach(() => {
	rmSync(dirname(agentDir), { recursive: true, force: true });
	delete process.env.METAPI_CODING_AGENT_DIR;
});

describe("MetaPi Scout Profile Config integration", () => {
	test("registers Scout fields with the shared Config host", () => {
		const { registration, lifecycle, tools } = loadScout();

		expect(registration).toMatchObject({
			id: "scout",
			label: "Scout",
			defaults: { model: "", thinkingLevel: "low", injectGuidelines: true },
		});
		expect(registration.fields.map((field: any) => field.key)).toEqual([
			"model",
			"thinkingLevel",
			"injectGuidelines",
		]);
		expect(registration.fields.map((field: any) => field.label)).toEqual(["模型", "Thinking 等级", "注入编排指南"]);
		expect(lifecycle.has("before_agent_start")).toBe(true);
		expect(tools.has("scout")).toBe(true);
	});

	test("keeps /scout as an alias for /config scout", async () => {
		const { commands } = loadScout();
		const executeCommand = vi.fn(async () => true);
		const notify = vi.fn();

		await commands.get("scout")?.handler("", { hasUI: true, executeCommand, ui: { notify } });

		expect(executeCommand).toHaveBeenCalledWith("/config scout");
		expect(notify).not.toHaveBeenCalled();
	});

	test("reads guideline injection from the Config host", async () => {
		const disabled = loadScout({ injectGuidelines: false });
		expect(await disabled.lifecycle.get("before_agent_start")?.({ systemPrompt: "base" })).toBeUndefined();

		const enabled = loadScout({ injectGuidelines: true });
		const result = await enabled.lifecycle.get("before_agent_start")?.({ systemPrompt: "base" });
		expect(result.systemPrompt).toContain("Scout subagents");
	});

	test("renders result sections in the shared Profile language", () => {
		const { tools } = loadScout();
		const component = tools.get("scout").renderResult(
			{
				content: [{ type: "text", text: "evidence" }],
				details: {
					task: "inspect",
					status: "done",
					trail: [],
					usageLine: "",
					elapsedMs: 1,
				},
			},
			{ expanded: true, isPartial: false },
			{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
			{},
		);

		expect(component.render(100).join("\n")).toContain("任务");
		expect(component.render(100).join("\n")).toContain("报告");
	});
});
