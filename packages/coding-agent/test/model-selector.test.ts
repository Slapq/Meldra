import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

describe("model selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("waits for async selection and does not persist before the session accepts the model", async () => {
		harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
			],
		});
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({ aborted: false, errors: new Map() });
		const persist = vi.spyOn(harness.settingsManager, "setDefaultModelAndProvider");
		let accept!: () => void;
		const onSelect = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					accept = resolve;
				}),
		);
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel("faux-1"),
			harness.settingsManager,
			harness.session.modelRuntime,
			[],
			onSelect,
			() => {},
		);

		selector.handleInput("\x1b[B");
		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Selecting model…");
		expect(persist).not.toHaveBeenCalled();

		selector.handleInput("\r");
		expect(onSelect).toHaveBeenCalledTimes(1);
		accept();
		await vi.waitFor(() => expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("Selecting model…"));
		expect(persist).not.toHaveBeenCalled();
	});

	it("lists every catalog that failed to refresh", async () => {
		harness = await createHarness();
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: new Map([
				["openai", new Error("unavailable")],
				["anthropic", new Error("unavailable")],
			]),
		});

		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel(),
			harness.settingsManager,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		await vi.waitFor(() => {
			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("Could not refresh 2 model catalogs (openai, anthropic); showing cached models.");
		});
	});
});
