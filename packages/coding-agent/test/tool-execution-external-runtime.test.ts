import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ProfileToolPresentation } from "../src/core/profile-agent-runtime.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function rendered(component: ToolExecutionComponent): string {
	return stripAnsi(component.render(100).join("\n"));
}

describe("generic external tool rendering", () => {
	beforeAll(() => initTheme("dark"));
	it("collapses unknown tool arguments and output, expands with Ctrl+O state, and shows duration", () => {
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const component = new ToolExecutionComponent(
			"pwsh",
			"call-1",
			{
				command: "Get-ChildItem",
				lines: ["one", "two", "three", "four", "five", "six"],
			},
			{},
			undefined,
			ui,
			"C:/work",
		);
		component.markExecutionStarted();
		component.setArgsComplete();
		component.updateResult({
			content: [
				{
					type: "text",
					text: ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6", "line-7"].join("\n"),
				},
			],
			details: { durationMs: 1_250 },
			isError: false,
		});

		const collapsed = rendered(component);
		expect(collapsed).toContain("argument lines");
		expect(collapsed).toContain("output lines");
		expect(collapsed).toContain("to expand");
		expect(collapsed).not.toContain("line-1");
		expect(collapsed).toContain("line-7");
		expect(collapsed).toContain("Completed 1.3s");

		component.setExpanded(true);
		const expanded = rendered(component);
		expect(expanded).toContain("line-1");
		expect(expanded).toContain("line-7");
		expect(expanded).not.toContain("output lines");
		expect(expanded).not.toContain("to expand");
		expect(expanded).toContain("Completed 1.3s");
	});

	it("falls back to raw rendering for malformed Profile presentation data", () => {
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const component = new ToolExecutionComponent(
			"external",
			"call-malformed",
			{ command: "raw-command" },
			{},
			undefined,
			ui,
			"C:/work",
		);
		component.updateResult({
			content: [{ type: "text", text: "raw-output" }],
			details: { profilePresentation: { kind: "diff" } },
			isError: false,
		});

		const output = rendered(component);
		expect(output).toContain("raw-command");
		expect(output).toContain("raw-output");
	});

	it("renders normalized Profile terminal, diff, read, and search presentations", () => {
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const renderPresentation = (presentation: ProfileToolPresentation): string => {
			const component = new ToolExecutionComponent(
				"external",
				`call-${presentation.kind}`,
				{ raw: "hidden when structured" },
				{},
				undefined,
				ui,
				"C:/work",
			);
			component.markExecutionStarted();
			component.updateResult({
				content: [{ type: "text", text: "raw fallback" }],
				details: { profilePresentation: presentation, durationMs: 500 },
				isError: false,
			});
			component.setExpanded(true);
			return rendered(component);
		};

		const terminal = renderPresentation({
			kind: "terminal",
			title: "Get-Location",
			description: "Inspect directory",
			cwd: "C:/work",
			output: "C:/work",
			exitCode: 0,
		});
		expect(terminal).toContain("Get-Location");
		expect(terminal).toContain("Inspect directory");
		expect(terminal).toContain("C:/work");
		expect(terminal).not.toContain("hidden when structured");

		const diff = renderPresentation({
			kind: "diff",
			title: "Edit src/a.ts",
			files: [{ path: "src/a.ts", oldText: "old", newText: "new" }],
		});
		expect(diff).toContain("Edit src/a.ts");
		expect(diff).toContain("- old");
		expect(diff).toContain("+ new");

		const read = renderPresentation({
			kind: "read",
			title: "Read src/a.ts",
			path: "src/a.ts",
			offset: 8,
			totalLines: 20,
			lines: [{ number: 8, text: "const value = 1;" }],
		});
		expect(read).toContain("src/a.ts · 20 lines");
		expect(read).toContain("8: const value = 1;");

		const search = renderPresentation({
			kind: "search",
			title: "Search value",
			entries: [{ path: "src/a.ts", lineNumber: 8, text: "const value = 1;" }],
			total: 12,
			truncated: true,
		});
		expect(search).toContain("src/a.ts:8: const value = 1;");
		expect(search).toContain("12 total");

		const webSearch = renderPresentation({
			kind: "web-search",
			title: "Search web",
			answer: "Harness answer",
			sources: [
				{
					url: "https://example.test/result",
					title: "Example result",
					snippet: "Relevant excerpt",
					publishedAt: "2026-01-01",
				},
			],
			truncated: true,
		});
		expect(webSearch).toContain("Harness answer");
		expect(webSearch).toContain("Example result");
		expect(webSearch).toContain("https://example.test/result");
		expect(webSearch).toContain("results truncated");

		const webFetch = renderPresentation({
			kind: "web-fetch",
			title: "Fetch page",
			url: "https://example.test/page",
			statusCode: 200,
			truncated: false,
		});
		expect(webFetch).toContain("https://example.test/page HTTP 200");
	});
});
