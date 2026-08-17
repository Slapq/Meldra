import type { ImageContent } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { EditorDraft } from "../src/core/extensions/types.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
		extensionRunner: { getCommand: ReturnType<typeof vi.fn> };
	};
	handleModelCommand: (searchTerm?: string) => Promise<void>;
	isExtensionCommand: (text: string) => boolean;
	showSelector: (create: (done: () => void) => { component: object; focus: object; dispose?: () => void }) => void;
	disposeActiveSelector: () => void;
	selectorGeneration: number;
	activeSelectorToken?: object;
	activeSelectorDispose?: () => void;
	awaitedCommandOverlay?: { opened: boolean; resolve: () => void };
	editorContainer: { clear: () => void; addChild: (component: object) => void };
	ui: { setFocus: (component: object) => void; requestRender: () => void };
	flushPendingBashComponents: () => void;
	onInputCallback?: (input: EditorDraft) => void;
	pendingUserInputs: EditorDraft[];
	takeEditorDraftImages: () => ImageContent[];
	isProfilePreferredExtensionCommand: (name: string) => boolean;
	isProfileHiddenBuiltinCommand: (name: string) => boolean;
	showWarning: (message: string) => void;
};

type InputContext = {
	onInputCallback?: (input: EditorDraft) => void;
	pendingUserInputs: EditorDraft[];
};

type StartupSubmitContext = {
	editor: { setText: (text: string) => void };
	showStatus: (message: string) => void;
};

type InteractiveModePrivate = {
	handleStartupSubmit(this: StartupSubmitContext, text: string): void;
	setupEditorSubmitHandler(this: SubmitContext): void;
	executeCommandFromExtension(this: SubmitContext, command: string): Promise<boolean>;
	isExtensionCommand(this: SubmitContext, text: string): boolean;
	showSelector(
		this: SubmitContext,
		create: (done: () => void) => { component: object; focus: object; dispose?: () => void },
	): void;
	disposeActiveSelector(this: SubmitContext): void;
	getUserInput(this: InputContext): Promise<EditorDraft>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
			extensionRunner: { getCommand: vi.fn(() => undefined) },
		},
		handleModelCommand: vi.fn(async () => {}),
		showSelector: interactiveModePrototype.showSelector,
		disposeActiveSelector: interactiveModePrototype.disposeActiveSelector,
		selectorGeneration: 0,
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
		ui: { setFocus: vi.fn(), requestRender: vi.fn() },
		flushPendingBashComponents: vi.fn(),
		pendingUserInputs: [],
		takeEditorDraftImages: () => [],
		isProfilePreferredExtensionCommand: () => false,
		isProfileHiddenBuiltinCommand: () => false,
		isExtensionCommand: interactiveModePrototype.isExtensionCommand,
		showWarning: vi.fn(),
	};
}

describe("InteractiveMode startup input", () => {
	it("restores a prompt submitted while managed-tool setup is running", () => {
		const context: StartupSubmitContext = {
			editor: { setText: vi.fn() },
			showStatus: vi.fn(),
		};

		interactiveModePrototype.handleStartupSubmit.call(context, "early prompt");

		expect(context.editor.setText).toHaveBeenCalledWith("early prompt");
		expect(context.showStatus).toHaveBeenCalledWith("Startup is still in progress");
	});

	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual([{ text: "early prompt", images: [] }]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("awaits built-in commands through the existing submit handler", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await expect(interactiveModePrototype.executeCommandFromExtension.call(context, "/model")).resolves.toBe(true);
		expect(context.handleModelCommand).toHaveBeenCalledWith(undefined);
	});

	it("waits until the final selector in a nested built-in command chain closes", async () => {
		const context = createSubmitContext();
		const selectorDone: Array<() => void> = [];
		Object.assign(context, {
			selectorGeneration: 0,
			showSelector: interactiveModePrototype.showSelector,
			disposeActiveSelector: interactiveModePrototype.disposeActiveSelector,
			editorContainer: { clear: vi.fn(), addChild: vi.fn() },
			ui: { setFocus: vi.fn(), requestRender: vi.fn() },
		});
		context.handleModelCommand = vi.fn(async () => {
			context.showSelector((done: () => void) => {
				selectorDone.push(done);
				return { component: {}, focus: {} };
			});
		});
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		let settled = false;
		const execution = interactiveModePrototype.executeCommandFromExtension
			.call(context, "/model")
			.then((result: boolean) => {
				settled = true;
				return result;
			});
		await Promise.resolve();
		expect(settled).toBe(false);

		selectorDone[0]();
		context.showSelector((done: () => void) => {
			selectorDone.push(done);
			return { component: {}, focus: {} };
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		selectorDone[1]();
		await expect(execution).resolves.toBe(true);
	});

	it("awaits extension commands without queuing a model prompt", async () => {
		const context = createSubmitContext();
		context.session.extensionRunner.getCommand.mockReturnValue({ name: "scout" });

		await expect(interactiveModePrototype.executeCommandFromExtension.call(context, "/scout")).resolves.toBe(true);
		expect(context.session.prompt).toHaveBeenCalledWith("/scout");
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("rejects unknown and multiline command input without sending it to the model", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await expect(interactiveModePrototype.executeCommandFromExtension.call(context, "/missing")).resolves.toBe(false);
		await expect(
			interactiveModePrototype.executeCommandFromExtension.call(context, "/model\nmalicious prompt"),
		).resolves.toBe(false);
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("routes a Profile-preferred built-in name through its extension command", async () => {
		const context = createSubmitContext();
		context.isProfilePreferredExtensionCommand = (name) => name === "model";
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/model");

		expect(context.session.prompt).toHaveBeenCalledWith("/model");
		expect(context.editor.setText).toHaveBeenCalledWith("");
		expect(context.editor.addToHistory).toHaveBeenCalledWith("/model");
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("rejects a Profile-hidden built-in without sending it as a prompt", async () => {
		const context = createSubmitContext();
		context.isProfileHiddenBuiltinCommand = (name) => name === "clone";
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/clone");

		expect(context.showWarning).toHaveBeenCalledWith("/clone is not available in the current Profile.");
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("moves draft images into one queued startup submission", async () => {
		const image = {
			type: "image" as const,
			data: "aW1hZ2U=",
			mimeType: "image/png" as const,
		};
		const context = createSubmitContext();
		context.takeEditorDraftImages = vi.fn(() => [image]);
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("inspect image");

		expect(context.pendingUserInputs).toEqual([{ text: "inspect image", images: [image] }]);
		expect(context.takeEditorDraftImages).toHaveBeenCalledTimes(1);
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: [{ text: "queued prompt", images: [] }],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toEqual({
			text: "queued prompt",
			images: [],
		});
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});
});
