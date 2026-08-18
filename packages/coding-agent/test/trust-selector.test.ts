import { resolve } from "node:path";
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { TrustSelectorComponent } from "../src/modes/interactive/components/trust-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("TrustSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("marks the saved trusted decision", () => {
		const project = resolve("/project");
		const selector = new TrustSelectorComponent({
			cwd: project,
			savedDecision: { path: project, decision: true },
			projectTrusted: true,
			onSelect: () => {},
			onCancel: () => {},
		});

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toMatch(/Saved decision: trusted \(.+project\)/);
		expect(output).toContain("Current session: trusted");
		expect(output).toContain("Trust ✓");
		expect(output).not.toContain("Do not trust ✓");
	});

	it("selects a trust decision", () => {
		const onSelect = vi.fn();
		const project = resolve("/project");
		const selector = new TrustSelectorComponent({
			cwd: project,
			savedDecision: null,
			projectTrusted: false,
			onSelect,
			onCancel: () => {},
		});

		selector.handleInput("\n");

		expect(onSelect).toHaveBeenCalledWith({
			trusted: true,
			updates: [{ path: resolve("/project"), decision: true }],
		});
	});

	it("labels saved ancestor decisions as inherited", () => {
		const parent = resolve("/parent");
		const project = resolve("/parent/project/nested");
		const selector = new TrustSelectorComponent({
			cwd: project,
			savedDecision: { path: parent, decision: true },
			projectTrusted: true,
			onSelect: () => {},
			onCancel: () => {},
		});

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toMatch(/Saved decision: trusted \(inherited from .+parent\)/);
	});

	it("adds a trust parent option", () => {
		const onSelect = vi.fn();
		const parent = resolve("/parent");
		const project = resolve("/parent/project");
		const selector = new TrustSelectorComponent({
			cwd: project,
			savedDecision: { path: parent, decision: true },
			projectTrusted: true,
			onSelect,
			onCancel: () => {},
		});

		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toMatch(/Saved decision: trusted \(inherited from .+parent\)/);
		expect(output).toMatch(/Trust parent folder \(.+parent\) ✓/);

		selector.handleInput("\n");

		expect(onSelect).toHaveBeenCalledWith({
			trusted: true,
			updates: [
				{ path: resolve("/parent"), decision: true },
				{ path: resolve("/parent/project"), decision: null },
			],
		});
	});
});
