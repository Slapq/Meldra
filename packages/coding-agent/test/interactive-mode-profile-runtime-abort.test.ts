import { describe, expect, it, vi } from "vitest";
import { KEYBINDINGS } from "../src/core/keybindings.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

describe("InteractiveMode Profile Runtime abort delegation", () => {
	it("restores queued text and aborts through AgentSession", () => {
		const abort = vi.fn(async () => undefined);
		const setText = vi.fn();
		const mode = Object.create(InteractiveMode.prototype) as unknown as Record<string, unknown>;
		Object.assign(mode, {
			runtimeHost: {
				session: {
					clearQueue: () => ({ steering: ["queued steer"], followUp: [] }),
					abort,
				},
			},
			compactionQueuedMessages: [],
			editor: { getText: () => "current draft", setText },
			updatePendingMessagesDisplay: vi.fn(),
			showError: vi.fn(),
		});
		const restore = mode.restoreQueuedMessagesToEditor as (options: { abort: boolean }) => number;

		const restored = restore.call(mode, { abort: true });

		expect(restored).toBe(1);
		expect(setText).toHaveBeenCalledWith("queued steer\n\ncurrent draft");
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("runs interrupt-and-send through AgentSession in order", async () => {
		const order: string[] = [];
		const abort = vi.fn(async () => {
			order.push("abort");
		});
		const prompt = vi.fn(async (text: string) => {
			order.push(`prompt:${text}`);
		});
		const setText = vi.fn();
		const mode = Object.create(InteractiveMode.prototype) as unknown as Record<string, unknown>;
		Object.assign(mode, {
			runtimeHost: {
				session: { isStreaming: true, abort, prompt },
			},
			editorDraftImages: [],
			editor: {
				getText: () => "replace the current turn",
				setText,
				addToHistory: vi.fn(),
			},
			updatePendingMessagesDisplay: vi.fn(),
			ui: { requestRender: vi.fn() },
			showError: vi.fn(),
		});
		const interruptAndSend = mode.handleInterruptAndSend as () => Promise<void>;

		await interruptAndSend.call(mode);

		expect(order).toEqual(["abort", "prompt:replace the current turn"]);
		expect(setText).toHaveBeenCalledWith("");
	});

	it("atomically replaces and reads a multimodal editor draft", () => {
		const setText = vi.fn();
		const mode = Object.create(InteractiveMode.prototype) as unknown as Record<string, unknown>;
		Object.assign(mode, {
			editor: { getText: () => "restored text", setText },
			editorDraftImages: [],
		});
		const createUI = mode.createExtensionUIContext as () => {
			setEditorDraft(draft: {
				text: string;
				images: Array<{ type: "image"; data: string; mimeType: string }>;
			}): boolean;
			getEditorDraft(): {
				text: string;
				images: Array<{ type: "image"; data: string; mimeType: string }>;
			};
		};
		const ui = createUI.call(mode);
		const image = {
			type: "image" as const,
			data: "aW1hZ2U=",
			mimeType: "image/png",
		};

		expect(ui.setEditorDraft({ text: "restored text", images: [image] })).toBe(true);
		expect(ui.getEditorDraft()).toEqual({
			text: "restored text",
			images: [image],
		});
		expect(setText).toHaveBeenCalledWith("restored text");
	});

	it("routes the Profile double-Escape command through the extension surface", () => {
		const prompt = vi.fn(async () => undefined);
		const mode = Object.create(InteractiveMode.prototype) as unknown as Record<string, unknown>;
		Object.assign(mode, {
			runtimeHost: { session: { prompt } },
			showError: vi.fn(),
		});

		const run = mode.runProfileDoubleEscapeCommand as (name: string) => void;
		run.call(mode, "rewind");

		expect(prompt).toHaveBeenCalledWith("/rewind");
	});

	it("uses a non-newline default key for interrupt-and-send", () => {
		expect(KEYBINDINGS["app.message.interruptSend"].defaultKeys).toBe(
			process.platform === "win32" ? "ctrl+shift+enter" : "ctrl+enter",
		);
	});
});
