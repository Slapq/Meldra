import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.ts";
import dshExtension from "../src/extensions/dsh/index.ts";
import { DSH_MESSAGE_ENTRY, type DshProfileEvent, DshProfileRuntime } from "../src/metapi/dsh-profile-runtime.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function fakeRuntime() {
	let listener: ((event: DshProfileEvent) => void) | undefined;
	const runtime = Object.create(DshProfileRuntime.prototype) as DshProfileRuntime;
	Object.defineProperty(runtime, "sessionId", { value: "session-1" });
	Object.assign(runtime, {
		listSessions: vi.fn(async () => [
			{
				sessionId: "session-1",
				running: true,
				blank: false,
				agentPreset: "code",
				cwd: "C:/work",
				updatedAt: Date.UTC(2026, 0, 1, 12, 30),
				projections: { asOfSeq: 8, values: { title: "Fix compiler" } },
			},
			{ sessionId: "session-2", running: false, blank: true },
		]),
		switchSession: vi.fn(),
		presets: vi.fn(async () => [
			{ id: "standard", name: "Standard", trust: "system", isDefault: true },
			{ id: "minimal", name: "Minimal", trust: "system", isDefault: false },
		]),
		selectPreset: vi.fn(async (id: string) => id),
		models: vi.fn(async () => ({
			current: {
				provider: "deepseek-official",
				model: "deepseek-v4-flash",
				reasoningEffort: "high",
			},
			routable: true,
			groups: [
				{
					id: "deepseek-official",
					name: "DeepSeek",
					models: [
						{
							id: "deepseek-v4-flash",
							name: "DeepSeek V4 Flash",
							reasoning: {
								defaultEffort: "high",
								efforts: [
									{ id: "high", name: "High" },
									{ id: "max", name: "Max", description: "More reasoning" },
								],
							},
						},
						{
							id: "deepseek-v4",
							name: "DeepSeek V4",
							reasoning: {
								defaultEffort: "high",
								efforts: [{ id: "high", name: "High" }],
							},
						},
					],
				},
			],
			failures: [],
		})),
		selectModel: vi.fn(async () => ({ selected: true })),
		newSession: vi.fn(async () => "workspace-session"),
		workspaces: vi.fn(async () => ({
			items: [
				{
					workspaceId: "workspace-1",
					title: "Work",
					path: "C:/work",
					sessionIds: ["session-1"],
				},
			],
			archivedSessionIds: [],
		})),
		createWorkspace: vi.fn(async (path: string) => ({
			workspace: { workspaceId: "workspace-2", title: "New", path },
			created: true,
		})),
		fork: vi.fn(async () => "rewound-session"),
		abort: vi.fn(async () => runtime.cancel()),
		rename: vi.fn(async () => undefined),
		cancel: vi.fn(async () => undefined),
		renameWorkspace: vi.fn(async () => undefined),
		deleteWorkspace: vi.fn(async () => undefined),
		moveWorkspace: vi.fn(async () => undefined),
		moveCurrentSession: vi.fn(async () => undefined),
		archiveCurrentSession: vi.fn(async () => undefined),
		subagents: vi.fn(async () => ({
			entries: [
				{
					kind: "child",
					id: "child-session",
					mode: "continuable",
					label: "Research",
					activity: "inactive",
					hasChildren: false,
				},
			],
			parentAvailable: false,
		})),
		subagentHistory: vi.fn(async () => ({ events: [], hasMore: false })),
		promptSubagent: vi.fn(async () => ({ messageId: "message-1" })),
		interruptSubagent: vi.fn(async () => undefined),
		projections: vi.fn(async () => ({})),
		contextEvidence: vi.fn(async () => ({
			scannedPages: 1,
			scannedEvents: 2,
			truncated: false,
			latestRequest: {
				seq: 2,
				config: { provider: "deepseek-official", model: "deepseek-v4-flash" },
				system: "system snapshot",
				tools: [{ name: "read" }],
			},
			contextInjections: [],
		})),
		createGoal: vi.fn(async () => ({ ref: { id: "goal-1", revision: 1 } })),
		mutateGoal: vi.fn(async () => ({ ref: { id: "goal-1", revision: 3 } })),
		history: vi.fn(async () => ({
			events: [
				{
					event: {
						seq: 5,
						time: Date.UTC(2026, 0, 1),
						type: "user/message",
						data: {
							content: [
								{
									type: "image",
									attachment: {
										attachmentId: "image-1",
										mediaType: "image/png",
										bytes: 68,
										width: 1,
										height: 1,
										name: "pixel.png",
									},
								},
							],
						},
					},
				},
				{
					event: {
						seq: 6,
						time: Date.UTC(2026, 0, 1),
						type: "assistant/message",
						data: {
							message: {
								id: "message-1",
								content: [{ type: "text", text: "Completed the task" }],
							},
						},
					},
				},
				{
					event: {
						seq: 7,
						time: Date.UTC(2026, 0, 1),
						type: "tool/result",
						data: { turn: 2, step: 1, callId: "call-1" },
					},
					view: { summary: "done" },
				},
			],
			hasMore: false,
		})),
		listMessageFeedback: vi.fn(async () => ({
			ok: true,
			value: { items: [] },
		})),
		putMessageFeedback: vi.fn(async () => ({
			ok: true,
			value: {
				messageId: "message-1",
				rating: "positive",
				version: "version-1",
			},
		})),
		deleteMessageFeedback: vi.fn(async () => ({
			ok: true,
			value: { absent: true },
		})),
		attachment: vi.fn(async () => ({
			attachment: {
				attachmentId: "image-1",
				mediaType: "image/png",
				bytes: 68,
				width: 1,
				height: 1,
				name: "pixel.png",
			},
			data: "iVBORw0KGgo=",
		})),
		plugins: vi.fn(async () => [
			{
				entryId: "session-stats",
				moduleName: "@deepseek-ai/dsh-session-stats",
				enabled: true,
				fiberPhase: "active",
			},
		]),
		manageProfilePlugins: vi.fn(async () => ({
			code: 0,
			output: "profile packages ok",
		})),
		restart: vi.fn(async () => undefined),
		settings: vi.fn(async () => ({
			writable: true,
			hasDocument: true,
			namespaces: [
				{
					ns: "llm-deepseek",
					applies: "live",
					revision: 3,
					schema: {
						uid: 1,
						refs: {
							1: {
								type: "object",
								dict: {
									baseURL: 2,
									timeoutMs: 3,
									enabled: 4,
									mode: 5,
									nested: 8,
									apiKeyEnv: 9,
									models: 11,
								},
							},
							2: { type: "string" },
							3: { type: "number", meta: { min: 1 } },
							4: { type: "boolean" },
							5: { type: "union", list: [6, 7] },
							6: { type: "const", value: "fast" },
							7: { type: "const", value: "careful" },
							8: { type: "object", dict: { retry: 10 } },
							9: { type: "string", meta: { role: "credential-ref" } },
							10: { type: "number", meta: { min: 0 } },
							11: { type: "array", inner: 12 },
							12: { type: "object", dict: { id: 13 } },
							13: { type: "string", meta: { required: true } },
						},
					},
					value: {
						baseURL: "https://api.deepseek.com",
						timeoutMs: 120000,
						enabled: true,
						mode: "fast",
						nested: { retry: 2 },
						apiKeyEnv: "DEEPSEEK_API_KEY",
						models: [{ id: "deepseek-v4" }],
					},
					user: { baseURL: "https://api.deepseek.com", timeoutMs: 120000 },
					secrets: [{ path: ["apiKey"], set: true }],
				},
			],
		})),
		mutateSettings: vi.fn(async (ns: string) => ({
			ns,
			applies: "live",
			revision: 4,
			secrets: [{ path: ["apiKey"], set: true }],
		})),
		describeCredentials: vi.fn(async () => ({
			DEEPSEEK_API_KEY: { configured: true, source: "file", writable: true },
		})),
		setCredential: vi.fn(async () => undefined),
		unsetCredential: vi.fn(async () => undefined),
		providers: vi.fn(async () => [
			{
				provider: "deepseek-official",
				displayName: "DeepSeek",
				settingsNs: "llm-deepseek",
				settingsPath: [],
				active: true,
				declared: true,
			},
		]),
		commands: vi.fn(async () => [
			{
				name: "goal",
				description: "Manage the active goal",
				input: { hint: "objective" },
			},
		]),
		executeCommand: vi.fn(async (line: string) => ({
			accepted: true,
			command: { kind: "success", text: `${line} applied` },
		})),
		updateQueue: vi.fn(async () => undefined),
		skills: vi.fn(async () => [
			{
				name: "review",
				description: "Review the current change",
				whenToUse: "Optional focus",
				modelInvocable: true,
			},
		]),
		prompt: vi.fn(async () => undefined),
		subscribe: vi.fn((next: (event: DshProfileEvent) => void) => {
			listener = next;
			return () => {
				listener = undefined;
			};
		}),
		respond: vi.fn(async () => ({ accepted: true })),
	});
	return { runtime, emit: (event: DshProfileEvent) => listener?.(event) };
}

function setup(profile: string, profileRuntime?: DshProfileRuntime, runtimeProvider?: string) {
	vi.stubEnv("METAPI_PROFILE_NAME", profile);
	if (runtimeProvider) vi.stubEnv("METAPI_PROFILE_RUNTIME_PROVIDER", runtimeProvider);
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const renderers = new Map<string, (...args: unknown[]) => unknown>();
	const commands = new Map<
		string,
		{
			handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
			getArgumentCompletions?: (argumentPrefix: string) => Promise<Array<{
				value: string;
				label: string;
				description?: string;
			}> | null>;
		}
	>();
	const api = {
		registerCommand(
			name: string,
			command: {
				handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
				getArgumentCompletions?: (argumentPrefix: string) => Promise<Array<{
					value: string;
					label: string;
					description?: string;
				}> | null>;
			},
		) {
			commands.set(name, command);
		},
		on(event: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(event, handler);
		},
		registerEntryRenderer(type: string, renderer: (...args: unknown[]) => unknown) {
			renderers.set(type, renderer);
		},
	} as unknown as ExtensionAPI;
	dshExtension(api);
	const setStatus = vi.fn<ExtensionContext["ui"]["setStatus"]>();
	const setWidget = vi.fn<ExtensionContext["ui"]["setWidget"]>();
	const setEditorText = vi.fn<ExtensionContext["ui"]["setEditorText"]>();
	const getEditorText = vi.fn<ExtensionContext["ui"]["getEditorText"]>(() => "");
	const setEditorDraft = vi.fn<ExtensionContext["ui"]["setEditorDraft"]>(() => true);
	const getEditorDraft = vi.fn<ExtensionContext["ui"]["getEditorDraft"]>(() => ({ text: "", images: [] }));
	const addAutocompleteProvider = vi.fn<ExtensionContext["ui"]["addAutocompleteProvider"]>();
	const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
	const confirm = vi.fn<ExtensionContext["ui"]["confirm"]>().mockResolvedValue(true);
	const select = vi.fn<ExtensionContext["ui"]["select"]>();
	const input = vi.fn<ExtensionContext["ui"]["input"]>();
	const editor = vi.fn<ExtensionContext["ui"]["editor"]>();
	const secretInput = vi.fn<ExtensionContext["ui"]["secretInput"]>();
	const custom = vi.fn<ExtensionContext["ui"]["custom"]>();
	const ui = {
		setStatus,
		setWidget,
		setEditorText,
		getEditorText,
		setEditorDraft,
		getEditorDraft,
		addAutocompleteProvider,
		notify,
		confirm,
		select,
		input,
		editor,
		secretInput,
		custom,
		theme: { fg: (_name: string, value: string) => value },
	};
	const ctx = {
		mode: "tui",
		cwd: process.cwd(),
		profileRuntime,
		model: undefined,
		setModelPreference: vi.fn(),
		shutdown: vi.fn(),
		ui,
	} as unknown as ExtensionContext & { ui: typeof ui };
	return { handlers, renderers, commands, ctx };
}

function settleNextCustom(state: ReturnType<typeof setup>): void {
	state.ctx.ui.custom.mockImplementationOnce(
		async (factory) =>
			await new Promise((resolve) => {
				void factory(
					{ requestRender: () => {} } as never,
					state.ctx.ui.theme as never,
					{} as never,
					resolve as never,
				);
			}),
	);
}

function selectNextCustom(state: ReturnType<typeof setup>, id: string): void {
	state.ctx.ui.custom.mockImplementationOnce(
		async (factory) =>
			await new Promise((resolve) => {
				Promise.resolve(
					factory(
						{ requestRender: () => {} } as never,
						state.ctx.ui.theme as never,
						{} as never,
						resolve as never,
					),
				).then((component) => {
					const browser = component as unknown as {
						getSessionList?: () => { onSelect?: (value: string) => void };
						getMessageList?: () => { onSelect?: (value: string) => void };
					};
					const list = browser.getSessionList?.() ?? browser.getMessageList?.();
					list?.onSelect?.(id);
				});
			}),
	);
}

describe("DSH Profile TUI renderer", () => {
	it("does not register DSH surfaces outside a DSH Profile", () => {
		const state = setup("default");
		expect(state.renderers.has(DSH_MESSAGE_ENTRY)).toBe(false);
		expect(state.commands.size).toBe(0);
		expect(state.handlers.size).toBe(0);
		vi.unstubAllEnvs();
	});

	it("registers the DSH transcript renderer in a DSH Profile", () => {
		const state = setup("dsh");
		expect(state.renderers.has(DSH_MESSAGE_ENTRY)).toBe(true);
		vi.unstubAllEnvs();
	});

	it("registers DSH surfaces for any Profile selecting the DSH Runtime provider", () => {
		const state = setup("research", undefined, "deepseek-harness");
		expect(state.renderers.has(DSH_MESSAGE_ENTRY)).toBe(true);
		expect(state.commands.has("dsh")).toBe(true);
		vi.unstubAllEnvs();
	});

	it("does not let a legacy DSH name override an explicit different Runtime provider", () => {
		const state = setup("dsh", undefined, "another-runtime");
		expect(state.renderers.has(DSH_MESSAGE_ENTRY)).toBe(false);
		expect(state.commands.size).toBe(0);
		vi.unstubAllEnvs();
	});

	it("renders DSH user, assistant, and error snapshots through the registered entry renderer", () => {
		initTheme("dark");
		const state = setup("dsh");
		const renderer = state.renderers.get(DSH_MESSAGE_ENTRY);
		if (!renderer) throw new Error("Missing DSH entry renderer");
		const render = (kind: "user" | "assistant" | "error", text: string): string[] => {
			const component = renderer(
				{
					type: "custom",
					id: `${kind}-id`,
					parentId: null,
					timestamp: new Date(0).toISOString(),
					customType: DSH_MESSAGE_ENTRY,
					data: { kind, text },
				},
				{ expanded: true },
				state.ctx.ui.theme,
			) as Component;
			return component.render(100).map((line) => stripAnsi(line).trim());
		};

		expect(render("user", "question <one>")).toEqual(expect.arrayContaining(["You", "question <one>"]));
		expect(render("assistant", "**answer** & more").join("\n")).toContain("DeepSeek Harness");
		expect(render("assistant", "**answer** & more").join("\n")).toContain("answer & more");
		expect(render("error", "request failed")).toEqual(expect.arrayContaining(["❌ 错误", "request failed"]));
		vi.unstubAllEnvs();
	});

	it("shows Profile Runtime status only for the DSH Profile", () => {
		const state = setup("dsh");
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-0-runtime", expect.stringContaining("DSH"));
		vi.unstubAllEnvs();
	});

	it("shows the authoritative Harness model route without a Profile preference", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);

		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
				"metapi-dsh-0-model",
				"Harness native deepseek-official/deepseek-v4-flash",
			),
		);
		vi.unstubAllEnvs();
	});

	it("shows when the Harness route matches the active Pi model", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		(state.ctx as unknown as { model: { provider: string; id: string } }).model = {
			provider: "deepseek-official",
			id: "deepseek-v4-flash",
		};

		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
				"metapi-dsh-0-model",
				"Harness native deepseek-official/deepseek-v4-flash · Pi active matched",
			),
		);
		expect(fake.runtime.selectModel).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("refreshes the Harness model status after a Pi model selection", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		await vi.waitFor(() => expect(fake.runtime.models).toHaveBeenCalledTimes(1));
		vi.mocked(fake.runtime.models).mockResolvedValueOnce({
			current: { provider: "CloseAI", model: "gpt-5.6-sol" },
			groups: [{ id: "CloseAI", models: [{ id: "gpt-5.6-sol" }] }],
		} as never);

		await state.handlers.get("model_select")?.(
			{
				type: "model_select",
				model: { provider: "CloseAI", id: "gpt-5.6-sol" },
				previousModel: undefined,
				source: "set",
			},
			state.ctx,
		);

		expect(state.ctx.ui.setStatus).toHaveBeenLastCalledWith(
			"metapi-dsh-0-model",
			"Harness native CloseAI/gpt-5.6-sol · Pi active matched",
		);
		vi.unstubAllEnvs();
	});

	it("distinguishes a different native route from an active Pi model", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		(state.ctx as unknown as { model: { provider: string; id: string } }).model = {
			provider: "deepseek-official",
			id: "deepseek-v4",
		};

		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
				"metapi-dsh-0-model",
				"Harness native deepseek-official/deepseek-v4-flash · Pi active deepseek-official/deepseek-v4 · native differs",
			),
		);
		expect(fake.runtime.selectModel).not.toHaveBeenCalled();

		(state.ctx as unknown as { model: { provider: string; id: string } }).model = {
			provider: "missing-provider",
			id: "missing-model",
		};
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
				"metapi-dsh-0-model",
				"Harness native deepseek-official/deepseek-v4-flash · Pi active missing-provider/missing-model · not in Harness catalog",
			),
		);
		vi.unstubAllEnvs();
	});

	it("expands a completion-selected @ file through the input transform", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "metapi-dsh-extension-ref-"));
		try {
			await writeFile(join(cwd, "context.txt"), "native context", "utf8");
			const fake = fakeRuntime();
			const state = setup("dsh", fake.runtime);
			(state.ctx as unknown as { cwd: string }).cwd = cwd;
			state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
			const factory = vi.mocked(state.ctx.ui.addAutocompleteProvider).mock.calls[0]?.[0];
			const provider = factory?.({
				getSuggestions: vi.fn(async () => null),
				applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
					lines,
					cursorLine,
					cursorCol,
				})),
			});
			provider?.applyCompletion(["review @con"], 0, 11, { value: "@context.txt", label: "context.txt" }, "@con");

			const result = await state.handlers.get("input")?.(
				{
					type: "input",
					text: "review @context.txt",
					source: "interactive",
				},
				state.ctx,
			);

			expect(result).toMatchObject({
				action: "transform",
				images: [],
			});
			expect((result as { text: string }).text).toContain(
				'<attached-file path="context.txt">\nnative context\n</attached-file>',
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
			vi.unstubAllEnvs();
		}
	});

	it("restores the draft and handles an unreadable selected @ reference", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		const factory = vi.mocked(state.ctx.ui.addAutocompleteProvider).mock.calls[0]?.[0];
		const provider = factory?.({
			getSuggestions: vi.fn(async () => null),
			applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
				lines,
				cursorLine,
				cursorCol,
			})),
		});
		provider?.applyCompletion(
			["review @missing"],
			0,
			15,
			{ value: "@missing.txt", label: "missing.txt" },
			"@missing",
		);

		const result = await state.handlers.get("input")?.(
			{
				type: "input",
				text: "review @missing.txt",
				images: [{ type: "image", data: "draft", mimeType: "image/png" }],
				source: "interactive",
			},
			state.ctx,
		);

		expect(result).toEqual({ action: "handled" });
		expect(state.ctx.ui.setEditorDraft).toHaveBeenCalledWith({
			text: "review @missing.txt",
			images: [{ type: "image", data: "draft", mimeType: "image/png" }],
		});
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("原草稿已恢复"), "error");
		vi.unstubAllEnvs();
	});

	it("rewinds through the previous completed Harness turn and refills the editor", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi.fn(async () => ({
			events: [
				{ event: { seq: 0, type: "turn/start", data: {} } },
				{
					event: {
						seq: 1,
						type: "user/message",
						data: { content: [{ type: "text", text: "first request" }] },
					},
				},
				{ event: { seq: 2, type: "assistant/message", data: {} } },
				{ event: { seq: 3, type: "turn/end", data: {} } },
				{ event: { seq: 4, type: "turn/start", data: {} } },
				{
					event: {
						seq: 5,
						type: "user/message",
						data: { content: [{ type: "text", text: "rewrite this request" }] },
					},
				},
				{ event: { seq: 6, type: "assistant/message", data: {} } },
				{ event: { seq: 7, type: "turn/end", data: {} } },
			],
			hasMore: false,
		}));
		const state = setup("dsh", fake.runtime);
		selectNextCustom(state, "5");

		await state.commands.get("dsh")?.handler("rewind", state.ctx);

		expect(fake.runtime.fork).toHaveBeenCalledWith(3);
		expect(state.ctx.ui.setEditorDraft).toHaveBeenCalledWith({
			text: "rewrite this request",
			images: [],
		});
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("rewound-session"), "info");
		vi.unstubAllEnvs();
	});

	it("restores text and native images as one rewind draft", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi.fn(async () => ({
			events: [
				{ event: { seq: 0, type: "turn/start", data: {} } },
				{
					event: {
						seq: 1,
						type: "user/message",
						data: { content: [{ type: "text", text: "first" }] },
					},
				},
				{ event: { seq: 2, type: "turn/end", data: {} } },
				{ event: { seq: 3, type: "turn/start", data: {} } },
				{
					event: {
						seq: 4,
						type: "user/message",
						data: {
							content: [
								{ type: "text", text: "inspect this image" },
								{ type: "image", attachment: { attachmentId: "image-1" } },
							],
						},
					},
				},
				{ event: { seq: 5, type: "turn/end", data: {} } },
			],
			hasMore: false,
		}));
		const state = setup("dsh", fake.runtime);
		selectNextCustom(state, "4");

		await state.commands.get("dsh")?.handler("rewind", state.ctx);

		expect(fake.runtime.attachment).toHaveBeenCalledWith("image-1");
		expect(fake.runtime.fork).toHaveBeenCalledWith(2);
		expect(state.ctx.ui.setEditorDraft).toHaveBeenCalledWith({
			text: "inspect this image",
			images: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
		});
		vi.unstubAllEnvs();
	});

	it("cancels and settles a running Harness turn before rewinding", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi.fn(async () => ({
			events: [
				{ event: { seq: 0, type: "turn/start", data: {} } },
				{
					event: {
						seq: 1,
						type: "user/message",
						data: { content: [{ type: "text", text: "first" }] },
					},
				},
				{ event: { seq: 2, type: "turn/end", data: {} } },
				{ event: { seq: 3, type: "turn/start", data: {} } },
				{
					event: {
						seq: 4,
						type: "user/message",
						data: { content: [{ type: "text", text: "running request" }] },
					},
				},
			],
			hasMore: false,
		}));
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		fake.emit({
			rpcId: "running",
			payload: {
				type: "host/session-status",
				sessionId: "session-1",
				running: true,
			},
		});
		fake.runtime.cancel = vi.fn(async () => {
			fake.emit({
				rpcId: "idle",
				payload: {
					type: "host/session-status",
					sessionId: "session-1",
					running: false,
				},
			});
		});
		selectNextCustom(state, "4");

		await state.commands.get("dsh")?.handler("rewind", state.ctx);

		expect(fake.runtime.abort).toHaveBeenCalledTimes(1);
		expect(fake.runtime.cancel).toHaveBeenCalledTimes(1);
		expect(fake.runtime.fork).toHaveBeenCalledWith(2);
		vi.unstubAllEnvs();
	});

	it("does not offer lossy rewind for first-turn or unsupported content order", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi.fn(async () => ({
			events: [
				{ event: { seq: 0, type: "turn/start", data: {} } },
				{
					event: {
						seq: 1,
						type: "user/message",
						data: { content: [{ type: "text", text: "first request" }] },
					},
				},
				{ event: { seq: 2, type: "turn/end", data: {} } },
				{ event: { seq: 3, type: "turn/start", data: {} } },
				{
					event: {
						seq: 4,
						type: "user/message",
						data: {
							content: [
								{ type: "image", attachment: { attachmentId: "image-1" } },
								{ type: "text", text: "look at this" },
							],
						},
					},
				},
				{ event: { seq: 5, type: "turn/end", data: {} } },
			],
			hasMore: false,
		}));
		const state = setup("dsh", fake.runtime);

		await state.commands.get("dsh")?.handler("rewind", state.ctx);

		expect(fake.runtime.fork).not.toHaveBeenCalled();
		expect(state.ctx.ui.setEditorDraft).not.toHaveBeenCalled();
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("没有可无损回填"), "info");
		vi.unstubAllEnvs();
	});

	it("opens the two-level Chinese management menu for bare /dsh", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.custom.mockResolvedValueOnce("session").mockResolvedValueOnce("sessions");
		selectNextCustom(state, "session-1");

		await state.commands.get("dsh")?.handler("", state.ctx);

		expect(state.ctx.ui.custom).toHaveBeenCalledTimes(3);
		expect(fake.runtime.listSessions).toHaveBeenCalledTimes(1);
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("DSH 可用操作"), "info");
		vi.unstubAllEnvs();
	});

	it("registers common Harness actions as direct commands", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);

		expect([...state.commands.keys()]).toEqual(
			expect.arrayContaining([
				"dsh",
				"resume",
				"sessions",
				"history",
				"rewind",
				"fork",
				"name",
				"compact",
				"session",
				"settings",
				"preset",
				"plan",
				"goal",
				"queue",
				"cancel",
			]),
		);
		await state.commands.get("new")?.handler("", state.ctx);
		await state.commands.get("fork")?.handler("", state.ctx);
		await state.commands.get("name")?.handler("Example", state.ctx);
		await state.commands.get("compact")?.handler("", state.ctx);
		await state.commands.get("session")?.handler("", state.ctx);

		expect(fake.runtime.newSession).toHaveBeenCalledTimes(1);
		expect(fake.runtime.fork).toHaveBeenCalledTimes(1);
		expect(fake.runtime.rename).toHaveBeenCalledWith("Example");
		expect(fake.runtime.executeCommand).toHaveBeenCalledWith("/compact");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("已创建 DSH Session：workspace-session", "info");
		vi.unstubAllEnvs();
	});

	it("returns from a capability page to the management groups", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.custom
			.mockResolvedValueOnce("agent")
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("diagnostics")
			.mockResolvedValueOnce("trajectory");

		await state.commands.get("dsh")?.handler("", state.ctx);

		expect(state.ctx.ui.custom).toHaveBeenCalledTimes(4);
		expect(fake.runtime.history).toHaveBeenCalledWith(undefined);
		vi.unstubAllEnvs();
	});

	it("describes static DSH actions in Chinese completions", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);

		const completions = await state.commands.get("dsh")?.getArgumentCompletions?.("sess");

		expect(completions).toEqual([
			{
				value: "sessions",
				label: "sessions · 会话列表",
				description: "查看并切换 Harness 会话",
			},
		]);
		vi.unstubAllEnvs();
	});

	it("exits through Pi's graceful shutdown lifecycle", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);

		await state.commands.get("dsh")?.handler("exit", state.ctx);

		expect(state.ctx.shutdown).toHaveBeenCalledTimes(1);
		expect(fake.runtime.executeCommand).not.toHaveBeenCalled();
		expect(fake.runtime.prompt).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("renders DSH Session titles and short state badges through the Pi browser", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		Object.assign(state.ctx, { cwd: "C:/work" });
		let screen = "";
		state.ctx.ui.custom.mockImplementationOnce(async (factory) => {
			const component = await factory(
				{ requestRender: () => {} } as never,
				state.ctx.ui.theme as never,
				{} as never,
				(() => {}) as never,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			screen = stripAnsi(component.render(100).join("\n"));
			return undefined as never;
		});

		await state.commands.get("sessions")?.handler("", state.ctx);

		expect(screen).toContain("Fix compiler");
		expect(screen).toContain("current running code");
		expect(screen).not.toContain("session-1 · current");
		expect(state.ctx.ui.select).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("uses the same native browser for /resume as /sessions", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		selectNextCustom(state, "session-2");

		await state.commands.get("resume")?.handler("", state.ctx);

		expect(fake.runtime.listSessions).toHaveBeenCalledTimes(1);
		expect(fake.runtime.switchSession).toHaveBeenCalledWith("session-2");
		expect(fake.runtime.projections).toHaveBeenCalledTimes(1);
		vi.unstubAllEnvs();
	});

	it("shows authoritative Session facts and switches by mapped id", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		selectNextCustom(state, "session-2");

		await state.commands.get("dsh")?.handler("sessions", state.ctx);

		expect(fake.runtime.switchSession).toHaveBeenCalledWith("session-2");
		vi.unstubAllEnvs();
	});

	it("completes and executes native commands inside the DSH namespace", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		const command = state.commands.get("dsh");

		const first = await command?.getArgumentCompletions?.("run /go");
		expect(first).toContainEqual({
			value: "run /goal",
			label: "run /goal",
			description: "Manage the active goal",
		});
		await command?.getArgumentCompletions?.("run /g");
		expect(fake.runtime.commands).toHaveBeenCalledTimes(1);

		await command?.handler("run /goal ship it", state.ctx);
		expect(fake.runtime.executeCommand).toHaveBeenCalledWith("/goal ship it");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("/goal ship it applied", "info");

		(fake.runtime.commands as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("directory unavailable"));
		fake.emit({
			rpcId: "commands-change-rpc",
			payload: {
				type: "host/remote-event",
				event: "commands/change",
				args: [],
			},
		});
		const unavailable = await command?.getArgumentCompletions?.("run /go");
		expect(unavailable).toBeNull();
		expect(fake.runtime.commands).toHaveBeenCalledTimes(2);
		const refreshed = await command?.getArgumentCompletions?.("run /go");
		expect(refreshed).toContainEqual(expect.objectContaining({ value: "run /goal" }));
		expect(fake.runtime.commands).toHaveBeenCalledTimes(3);
		vi.unstubAllEnvs();
	});

	it("completes and invokes native Skills inside the DSH namespace", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		const command = state.commands.get("dsh");

		const first = await command?.getArgumentCompletions?.("invoke /rev");
		expect(first).toContainEqual({
			value: "invoke /review",
			label: "invoke /review",
			description: "Review the current change",
		});
		await command?.getArgumentCompletions?.("invoke /r");
		expect(fake.runtime.skills).toHaveBeenCalledTimes(1);

		await command?.handler("invoke /review focus on lifecycle", state.ctx);
		expect(fake.runtime.prompt).toHaveBeenCalledWith({
			text: "/review focus on lifecycle",
		});

		fake.emit({
			rpcId: "preset-selected-rpc",
			payload: {
				type: "host/remote-event",
				event: "agent-preset/selected",
				args: ["session-1", "code"],
			},
		});
		await command?.getArgumentCompletions?.("invoke /rev");
		expect(fake.runtime.skills).toHaveBeenCalledTimes(2);
		vi.unstubAllEnvs();
	});

	it("selects an Agent Preset through the Harness Runtime", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		(state.ctx.ui.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("Minimal · minimal · system");

		await state.commands.get("dsh")?.handler("preset", state.ctx);

		expect(fake.runtime.presets).toHaveBeenCalledTimes(1);
		expect(fake.runtime.selectPreset).toHaveBeenCalledWith("minimal");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("已选择 DSH Agent Preset：minimal", "info");
		vi.unstubAllEnvs();
	});

	it("shows native running and usage metrics in compact status", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		fake.emit({
			rpcId: "status-rpc",
			payload: {
				type: "host/session-status",
				sessionId: "session-1",
				running: true,
			},
		});
		fake.emit({
			rpcId: "step-rpc",
			payload: {
				type: "session/event",
				sessionId: "session-1",
				event: {
					type: "step/start",
					time: 1_000,
					data: { turn: 1, step: 1 },
				},
			},
		});
		fake.emit({
			rpcId: "chunk-rpc",
			payload: {
				type: "session/event",
				sessionId: "session-1",
				event: {
					type: "assistant/chunk",
					time: 1_250,
					data: {
						turn: 1,
						step: 1,
						chunk: { type: "text-delta", text: "Hello", index: 0 },
					},
				},
			},
		});
		fake.emit({
			rpcId: "message-rpc",
			payload: {
				type: "session/event",
				sessionId: "session-1",
				event: {
					type: "assistant/message",
					time: 1_650,
					data: {
						turn: 1,
						step: 1,
						message: { source: { model: "deepseek-v4-flash" } },
						usage: {
							inputTokens: 30,
							outputTokens: 8,
							cacheReadTokens: 70,
							cacheWriteTokens: 10,
						},
					},
				},
			},
		});

		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-1-status", expect.stringContaining("运行中")),
		);
		await vi.waitFor(() =>
			expect(state.ctx.ui.setWidget).toHaveBeenCalledWith(
				"metapi-dsh-metrics",
				expect.arrayContaining([expect.stringContaining("deepseek-v4-flash")]),
				expect.objectContaining({ placement: "aboveEditor" }),
			),
		);
		state.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, state.ctx);
		expect(state.ctx.ui.setWidget).toHaveBeenCalledWith("metapi-dsh-metrics", undefined);
		vi.unstubAllEnvs();
	});

	it("projects only the active Session's user-visible Harness queue", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		fake.emit({
			rpcId: "other-queue-rpc",
			payload: {
				type: "session/queue",
				sessionId: "session-2",
				items: [
					{
						id: "other",
						placement: "queued",
						message: { content: [{ type: "text", text: "other" }] },
					},
				],
			},
		});
		fake.emit({
			rpcId: "queue-rpc",
			payload: {
				type: "session/queue",
				sessionId: "session-1",
				items: [
					{
						id: "queued-1",
						placement: "queued",
						message: { content: [{ type: "text", text: "after this turn" }] },
					},
					{
						id: "steering-1",
						placement: "steering",
						message: { content: [{ type: "text", text: "adjust now" }] },
					},
					{
						id: "context-1",
						placement: "context",
						message: { content: [{ type: "text", text: "hidden context" }] },
					},
				],
			},
		});

		await vi.waitFor(() =>
			expect(state.ctx.ui.setWidget).toHaveBeenCalledWith("metapi-dsh-2-queue", [
				"· after this turn",
				"→ adjust now",
			]),
		);
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-2-queue", "队列 2");
		expect(state.ctx.ui.setWidget).not.toHaveBeenCalledWith(
			"metapi-dsh-2-queue",
			expect.arrayContaining([expect.stringContaining("hidden context")]),
		);
		state.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, state.ctx);
		expect(state.ctx.ui.setWidget).toHaveBeenCalledWith("metapi-dsh-2-queue", undefined);
		expect(state.ctx.ui.setWidget).toHaveBeenLastCalledWith("metapi-dsh-metrics", undefined);
		vi.unstubAllEnvs();
	});

	it("edits, removes, and strictly steers through native queue mutations", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		fake.emit({
			rpcId: "running-rpc",
			payload: {
				type: "host/session-status",
				sessionId: "session-1",
				running: true,
			},
		});
		fake.emit({
			rpcId: "queue-rpc",
			payload: {
				type: "session/queue",
				sessionId: "session-1",
				items: [
					{
						id: "queued-123456",
						placement: "queued",
						message: { content: [{ type: "text", text: "original" }] },
					},
				],
			},
		});
		await vi.waitFor(() => expect(state.ctx.ui.setWidget).toHaveBeenCalledWith("metapi-dsh-2-queue", ["· original"]));
		const label = "#1 · 后续消息 · original · queued-123456";

		state.ctx.ui.select.mockResolvedValueOnce(label).mockResolvedValueOnce("编辑");
		state.ctx.ui.editor.mockResolvedValueOnce("edited");
		await state.commands.get("dsh")?.handler("queue", state.ctx);
		expect(fake.runtime.updateQueue).toHaveBeenNthCalledWith(1, "queued-123456", {
			kind: "edit",
			content: [{ type: "text", text: "edited" }],
		});

		state.ctx.ui.select.mockResolvedValueOnce(label).mockResolvedValueOnce("撤回");
		await state.commands.get("dsh")?.handler("queue", state.ctx);
		expect(fake.runtime.updateQueue).toHaveBeenNthCalledWith(2, "queued-123456", {
			kind: "remove",
		});

		state.ctx.ui.select.mockResolvedValueOnce(label).mockResolvedValueOnce("立即引导当前回合");
		await state.commands.get("dsh")?.handler("queue", state.ctx);
		expect(fake.runtime.updateQueue).toHaveBeenNthCalledWith(3, "queued-123456", {
			kind: "steer",
		});
		fake.emit({
			rpcId: "queue-update-rpc",
			payload: {
				type: "session/queue",
				sessionId: "session-1",
				items: [
					{
						id: "queued-123456",
						placement: "steering",
						message: { content: [{ type: "text", text: "original" }] },
					},
				],
			},
		});
		await vi.waitFor(() => expect(state.ctx.ui.setWidget).toHaveBeenCalledWith("metapi-dsh-2-queue", ["→ original"]));

		const steerLabel = "#1 · 立即引导 · original · queued-123456";
		state.ctx.ui.select.mockResolvedValueOnce(steerLabel).mockResolvedValueOnce("取回到输入框");
		await state.commands.get("dsh")?.handler("queue", state.ctx);
		expect(fake.runtime.updateQueue).toHaveBeenNthCalledWith(4, "queued-123456", { kind: "remove" });
		expect(state.ctx.ui.setEditorText).toHaveBeenCalledWith("original");
		vi.unstubAllEnvs();
	});

	it("creates a native Workspace from an existing directory", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("采用已有目录作为 Workspace");
		state.ctx.ui.input.mockResolvedValueOnce("C:/new-work");

		await state.commands.get("dsh")?.handler("workspace", state.ctx);

		expect(fake.runtime.createWorkspace).toHaveBeenCalledWith("C:/new-work");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("已创建 DSH Workspace：New", "info");
		vi.unstubAllEnvs();
	});

	it("creates and switches a Session inside the selected Workspace", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("Work · C:/work · workspace-1")
			.mockResolvedValueOnce("在此 Workspace 新建并切换 Session");

		await state.commands.get("dsh")?.handler("workspace", state.ctx);

		expect(fake.runtime.newSession).toHaveBeenCalledWith("workspace-1");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("已创建并切换到 DSH Session：workspace-session", "info");
		vi.unstubAllEnvs();
	});

	it("removes only the selected Workspace registration after confirmation", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("Work · C:/work · workspace-1")
			.mockResolvedValueOnce("移除 Workspace 注册");
		state.ctx.ui.confirm.mockResolvedValueOnce(true);

		await state.commands.get("dsh")?.handler("workspace", state.ctx);

		expect(state.ctx.ui.confirm).toHaveBeenCalledWith(
			"移除 DSH Workspace 注册",
			"只移除 Workspace 注册；目录、文件和 Session 日志不会删除。是否继续？",
		);
		expect(fake.runtime.deleteWorkspace).toHaveBeenCalledWith("workspace-1");
		vi.unstubAllEnvs();
	});

	it("sends a follow-up to a continuable native Subagent even when the parent hint is unavailable", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("Research · continuable · inactive · child-session")
			.mockResolvedValueOnce("发送后续消息");
		state.ctx.ui.input.mockResolvedValueOnce("Continue the research");

		await state.commands.get("dsh")?.handler("subagents", state.ctx);

		expect(fake.runtime.promptSubagent).toHaveBeenCalledWith("child-session", "Continue the research");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("Subagent 已接受后续消息：message-1", "info");
		vi.unstubAllEnvs();
	});

	it("tracks native background Job snapshots and exposes read-only details", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		fake.emit({
			rpcId: "jobs-rpc",
			payload: {
				type: "session/jobs",
				sessionId: "session-1",
				jobs: [
					{
						id: "pwsh-1",
						kind: "pwsh",
						label: "Long command",
						status: "running",
						startedAt: 1_000,
					},
					{
						id: "pwsh-2",
						kind: "pwsh",
						label: "Completed command",
						status: "completed",
						detail: "exit code: 0",
						startedAt: 2_000,
						finishedAt: 3_500,
					},
				],
			},
		});
		await vi.waitFor(() => expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-3-jobs", "⚡ 1"));
		state.ctx.ui.select.mockImplementationOnce(async (_title: string, options: string[]) =>
			options.find((option) => option.includes("pwsh-2")),
		);

		await state.commands.get("dsh")?.handler("jobs", state.ctx);

		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"detail": "exit code: 0"'), "info");
		state.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, state.ctx);
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-3-jobs", undefined);
		vi.unstubAllEnvs();
	});

	it("mutates the current projected Goal with its exact CAS ref", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		fake.emit({
			rpcId: "goal-projection-rpc",
			payload: {
				type: "session/projection",
				sessionId: "session-1",
				key: "goal",
				seq: 12,
				value: {
					goal: {
						id: "goal-1",
						revision: 2,
						objective: "Ship the integration",
						phase: "active",
						maxGoalRounds: 8,
					},
					roundsStarted: 3,
				},
			},
		});
		state.ctx.ui.select.mockResolvedValueOnce("暂停");

		await state.commands.get("dsh")?.handler("goal", state.ctx);

		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"Ship the integration · active · 3/8 轮",
			expect.arrayContaining(["编辑目标", "编辑最大轮数", "暂停"]),
		);
		expect(fake.runtime.mutateGoal).toHaveBeenCalledWith("pause", {
			id: "goal-1",
			revision: 2,
		});
		vi.unstubAllEnvs();
	});

	it("executes native Plan commands and renders Todo projections read-only", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		for (const [key, value, seq] of [
			["plan", { active: true, pending: false }, 20],
			[
				"todos",
				[
					{ content: "Inspect events", status: "completed" },
					{ content: "Build TUI", status: "in_progress" },
				],
				21,
			],
			[
				"sessionStats",
				{
					turns: 2,
					steps: 3,
					llmMs: 1_200,
					toolMs: 800,
					ttftMs: 600,
					ttftSteps: 3,
					decodeMs: 2_000,
					decodeTokens: 20,
				},
				22,
			],
			[
				"tokenUsage",
				{
					uncachedInputTokens: 100,
					outputTokens: 40,
					cacheReadTokens: 300,
					cacheWriteTokens: 100,
				},
				23,
			],
			[
				"contextPressure",
				{
					pressureTokens: 3_000,
					projectedTokens: 4_000,
					contextWindow: 10_000,
				},
				24,
			],
			["contextBreakdown", { systemTokens: 100, toolsTokens: 200, messageTokens: 300 }, 25],
		] as const) {
			fake.emit({
				rpcId: `${key}-projection-rpc`,
				payload: {
					type: "session/projection",
					sessionId: "session-1",
					key,
					value,
					seq,
				},
			});
		}
		state.ctx.ui.select.mockResolvedValueOnce("关闭 Plan Mode");

		await state.commands.get("dsh")?.handler("plan", state.ctx);

		expect(fake.runtime.executeCommand).toHaveBeenCalledWith("/plan off");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("/plan off applied", "info");
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-4-plan", "📝 计划");
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-5-todos", "✓ 1/2");
		expect(state.ctx.ui.setWidget).toHaveBeenCalledWith(
			"metapi-dsh-metrics",
			["2 turns · 3 steps  |  LLM 1.2s · tools 0.8s · 0.2s TTFT · 10.0 tok/s  |  ▲ 500  ▼ 40  ⚡ 60%  |  📊 40%"],
			{ placement: "aboveEditor" },
		);
		state.ctx.ui.select.mockResolvedValueOnce("● Build TUI");

		await state.commands.get("dsh")?.handler("todo", state.ctx);

		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"status": "in_progress"'), "info");

		await state.commands.get("dsh")?.handler("context", state.ctx);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("启发式上下文构成"), "info");
		vi.unstubAllEnvs();
	});

	it("writes per-message feedback with native CAS semantics", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("Completed the task · 未评价").mockResolvedValueOnce("正向");
		state.ctx.ui.input.mockResolvedValueOnce("Useful answer");

		await state.commands.get("dsh")?.handler("feedback", state.ctx);

		expect(fake.runtime.putMessageFeedback).toHaveBeenCalledWith("message-1", "positive", "Useful answer", null);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"version": "version-1"'), "info");
		vi.unstubAllEnvs();
	});

	it("pages restored history by the native beforeSeq cursor", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi
			.fn()
			.mockResolvedValueOnce({
				events: [
					{
						event: {
							seq: 10,
							type: "assistant/message",
							data: {
								message: { content: [{ type: "text", text: "latest" }] },
							},
						},
					},
				],
				hasMore: true,
			})
			.mockResolvedValueOnce({
				events: [
					{
						event: {
							seq: 5,
							type: "assistant/message",
							data: {
								message: { content: [{ type: "text", text: "older" }] },
							},
						},
					},
				],
				hasMore: false,
			});
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("加载更早消息").mockResolvedValueOnce("#5 · assistant/message · older");

		await state.commands.get("dsh")?.handler("history", state.ctx);

		expect(fake.runtime.history).toHaveBeenNthCalledWith(1, undefined);
		expect(fake.runtime.history).toHaveBeenNthCalledWith(2, 10);
		expect(state.ctx.ui.custom).toHaveBeenCalledTimes(1);
		vi.unstubAllEnvs();
	});

	it("renders restored message images inline without persisting attachment bytes", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("#5 · user/message · [图片]");

		await state.commands.get("dsh")?.handler("history", state.ctx);

		expect(fake.runtime.attachment).toHaveBeenCalledWith("image-1");
		expect(state.ctx.ui.custom).toHaveBeenCalledTimes(1);
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("iVBORw0KGgo="), "info");
		vi.unstubAllEnvs();
	});

	it("retrieves referenced history images into a temporary Pi image surface", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("pixel.png · 1×1 · 68 bytes · #5");

		await state.commands.get("dsh")?.handler("attachments", state.ctx);

		expect(fake.runtime.attachment).toHaveBeenCalledWith("image-1");
		expect(state.ctx.ui.custom).toHaveBeenCalledTimes(1);
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("iVBORw0KGgo="), "info");
		vi.unstubAllEnvs();
	});

	it("inspects the native raw Trajectory ledger", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockImplementationOnce(async (_title: string, choices: string[]) =>
			choices.find((choice) => choice.includes("tool/result")),
		);

		await state.commands.get("dsh")?.handler("trajectory", state.ctx);

		expect(fake.runtime.history).toHaveBeenCalledWith(undefined);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"type": "tool/result"'), "info");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"summary": "done"'), "info");
		vi.unstubAllEnvs();
	});

	it("searches bounded native Trajectory pages without indexing the Pi transcript", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("搜索历史")
			.mockImplementationOnce(async (_title: string, choices: string[]) =>
				choices.find((choice) => choice.includes("done")),
			);
		state.ctx.ui.input.mockResolvedValueOnce("done");

		await state.commands.get("dsh")?.handler("trajectory", state.ctx);

		expect(fake.runtime.history).toHaveBeenCalledTimes(2);
		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"DSH Trajectory matches 1",
			expect.arrayContaining([expect.stringContaining("done")]),
		);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"summary": "done"'), "info");
		vi.unstubAllEnvs();
	});

	it("folds the current native Trajectory page by event type", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("按事件类型折叠")
			.mockResolvedValueOnce("tool/result · 1")
			.mockImplementationOnce(async (_title: string, choices: string[]) =>
				choices.find((choice) => choice.includes("tool/result")),
			);

		await state.commands.get("dsh")?.handler("trajectory", state.ctx);

		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"DSH Trajectory 事件类型",
			expect.arrayContaining(["tool/result · 1"]),
		);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"type": "tool/result"'), "info");
		vi.unstubAllEnvs();
	});

	it("builds a native timestamp and callId Tool waterfall for the current page", async () => {
		const fake = fakeRuntime();
		fake.runtime.history = vi.fn(async () => ({
			events: [
				{
					event: {
						seq: 20,
						time: Date.UTC(2026, 0, 1, 0, 0, 1),
						type: "tool/call",
						data: {
							turn: 2,
							step: 1,
							callId: "call-waterfall",
							toolName: "pwsh",
						},
					},
				},
				{
					event: {
						seq: 21,
						time: Date.UTC(2026, 0, 1, 0, 0, 2, 500),
						type: "tool/result",
						data: { turn: 2, step: 1, callId: "call-waterfall" },
					},
				},
			],
			hasMore: false,
		}));
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("当前页时间线 / Waterfall")
			.mockImplementationOnce(async (_title: string, choices: string[]) =>
				choices.find((choice) => choice.includes("1500ms")),
			);

		await state.commands.get("dsh")?.handler("trajectory", state.ctx);

		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"DSH Trajectory 时间线 / Waterfall",
			expect.arrayContaining([
				expect.stringContaining("tool/call"),
				expect.stringContaining("tool/result · turn 2 · step 1 · 1500ms"),
			]),
		);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"callId": "call-waterfall"'), "info");
		vi.unstubAllEnvs();
	});

	it("pairs Tool spans across bounded native Trajectory pages", async () => {
		const fake = fakeRuntime();
		const resultPage = {
			events: [
				{
					event: {
						seq: 21,
						time: Date.UTC(2026, 0, 1, 0, 0, 2, 500),
						type: "tool/result",
						data: { turn: 2, step: 1, callId: "cross-page" },
					},
				},
			],
			hasMore: true,
		};
		fake.runtime.history = vi
			.fn()
			.mockResolvedValueOnce(resultPage)
			.mockResolvedValueOnce(resultPage)
			.mockResolvedValueOnce({
				events: [
					{
						event: {
							seq: 20,
							time: Date.UTC(2026, 0, 1, 0, 0, 1),
							type: "tool/call",
							data: { turn: 2, step: 1, callId: "cross-page" },
						},
					},
				],
				hasMore: false,
			});
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("跨页时间线 / Waterfall")
			.mockImplementationOnce(async (_title: string, choices: string[]) =>
				choices.find((choice) => choice.includes("1500ms")),
			);

		await state.commands.get("dsh")?.handler("trajectory", state.ctx);

		expect(fake.runtime.history).toHaveBeenNthCalledWith(3, 21);
		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"DSH Trajectory 时间线 2",
			expect.arrayContaining([expect.stringContaining("1500ms")]),
		);
		vi.unstubAllEnvs();
	});

	it("shows the native Harness Plugin Inventory", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("@deepseek-ai/dsh-session-stats · active · session-stats");

		await state.commands.get("dsh")?.handler("plugins", state.ctx);

		expect(fake.runtime.plugins).toHaveBeenCalledTimes(1);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"fiberPhase": "active"'), "info");
		vi.unstubAllEnvs();
	});

	it("exposes direct Profile plugin commands in a DSH Runtime", () => {
		const state = setup("dsh", fakeRuntime().runtime);
		expect(state.commands.has("plugins")).toBe(true);
		expect(state.commands.has("plugin")).toBe(true);
		vi.unstubAllEnvs();
	});

	it("runs a direct Profile package request through the shared DSH adapter", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		settleNextCustom(state);
		state.ctx.ui.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		await state.commands.get("plugin")?.handler("add github:example/dsh-plugin", state.ctx);

		expect(fake.runtime.manageProfilePlugins).toHaveBeenCalledWith(
			{
				operation: "add",
				source: "github:example/dsh-plugin",
			},
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(fake.runtime.restart).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("runs native Profile package management and reloads only after success", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		settleNextCustom(state);
		state.ctx.ui.select.mockResolvedValueOnce("管理 Profile 包").mockResolvedValueOnce("安装包");
		state.ctx.ui.input.mockResolvedValueOnce("@example/dsh-bundle@1.0.0");
		state.ctx.ui.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

		await state.commands.get("dsh")?.handler("plugins", state.ctx);

		expect(fake.runtime.manageProfilePlugins).toHaveBeenCalledWith(
			{
				operation: "add",
				source: "@example/dsh-bundle@1.0.0",
			},
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(fake.runtime.restart).toHaveBeenCalledTimes(1);
		vi.unstubAllEnvs();
	});

	it("keeps a failed native package operation explicit and does not reload", async () => {
		const fake = fakeRuntime();
		fake.runtime.manageProfilePlugins = vi.fn(async () => ({
			code: 1,
			output: "pnpm refused the package",
		}));
		const state = setup("dsh", fake.runtime);
		settleNextCustom(state);
		state.ctx.ui.select.mockResolvedValueOnce("管理 Profile 包").mockResolvedValueOnce("更新全部");
		state.ctx.ui.confirm.mockResolvedValueOnce(true);

		await state.commands.get("dsh")?.handler("plugins", state.ctx);

		expect(state.ctx.ui.notify).toHaveBeenCalledWith("pnpm refused the package", "error");
		expect(fake.runtime.restart).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("shows redacted Settings namespaces and Provider directory", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("设置命名空间")
			.mockResolvedValueOnce("llm-deepseek · 实时生效 · rev 3");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"configured": true'), "info");
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("apiKey-value"), "info");

		state.ctx.ui.select
			.mockResolvedValueOnce("Provider 目录")
			.mockResolvedValueOnce("DeepSeek · deepseek-official · 已启用");
		await state.commands.get("dsh")?.handler("settings", state.ctx);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"settingsNs": "llm-deepseek"'), "info");

		state.ctx.ui.select
			.mockResolvedValueOnce("Secret 字段")
			.mockResolvedValueOnce("llm-deepseek.apiKey · 已配置")
			.mockResolvedValueOnce("设置");
		state.ctx.ui.secretInput.mockResolvedValueOnce("new-secret-value");
		await state.commands.get("dsh")?.handler("settings", state.ctx);
		expect(fake.runtime.mutateSettings).toHaveBeenCalledWith(
			"llm-deepseek",
			[{ op: "set", path: ["apiKey"], value: "new-secret-value" }],
			3,
		);
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("new-secret-value"), "info");
		vi.unstubAllEnvs();
	});

	it("manages only Settings-discovered writable credential references", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("凭据引用")
			.mockResolvedValueOnce("DEEPSEEK_API_KEY · 已配置 · 可写 · file · llm-deepseek.apiKeyEnv")
			.mockResolvedValueOnce("设置");
		state.ctx.ui.secretInput.mockResolvedValueOnce("rotated-credential");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(fake.runtime.describeCredentials).toHaveBeenCalledWith(["DEEPSEEK_API_KEY"]);
		expect(fake.runtime.setCredential).toHaveBeenCalledWith("DEEPSEEK_API_KEY", "rotated-credential");
		expect(state.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("rotated-credential"), "info");
		vi.unstubAllEnvs();
	});

	it("keeps environment-shadowed credentials read-only", async () => {
		const fake = fakeRuntime();
		fake.runtime.describeCredentials = vi.fn(async () => ({
			DEEPSEEK_API_KEY: {
				configured: true,
				source: "env",
				writable: false,
			},
		}));
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("凭据引用")
			.mockResolvedValueOnce("DEEPSEEK_API_KEY · 已配置 · 只读 · env · llm-deepseek.apiKeyEnv");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(fake.runtime.setCredential).not.toHaveBeenCalled();
		expect(fake.runtime.unsetCredential).not.toHaveBeenCalled();
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("DEEPSEEK_API_KEY 为只读（env）。", "info");
		vi.unstubAllEnvs();
	});

	it("edits schema-declared scalar Settings with revision CAS", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("可编辑字段")
			.mockResolvedValueOnce("llm-deepseek.timeoutMs · 120000 · 用户覆盖")
			.mockResolvedValueOnce("写入");
		state.ctx.ui.input.mockResolvedValueOnce("240000");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			"DSH Settings 字段",
			expect.arrayContaining([
				'llm-deepseek.baseURL · "https://api.deepseek.com" · 用户覆盖',
				"llm-deepseek.timeoutMs · 120000 · 用户覆盖",
				"llm-deepseek.enabled · true · 继承值",
				'llm-deepseek.mode · "fast" · 继承值',
				"llm-deepseek.nested.retry · 2 · 继承值",
			]),
		);
		expect(fake.runtime.mutateSettings).toHaveBeenCalledWith(
			"llm-deepseek",
			[{ op: "set", path: ["timeoutMs"], value: 240000 }],
			3,
		);
		vi.unstubAllEnvs();
	});

	it("writes nested scalar Settings as exact path operations", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("可编辑字段")
			.mockResolvedValueOnce("llm-deepseek.nested.retry · 2 · 继承值")
			.mockResolvedValueOnce("写入");
		state.ctx.ui.input.mockResolvedValueOnce("4");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(state.ctx.ui.input).toHaveBeenCalledWith("写入 llm-deepseek.nested.retry", "2");
		expect(fake.runtime.mutateSettings).toHaveBeenCalledWith(
			"llm-deepseek",
			[{ op: "set", path: ["nested", "retry"], value: 4 }],
			3,
		);
		vi.unstubAllEnvs();
	});

	it("validates and writes schema-declared model arrays as one path operation", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("JSON 数组字段")
			.mockResolvedValueOnce("llm-deepseek.models · 1 项 · 继承值")
			.mockResolvedValueOnce("编辑 JSON");
		state.ctx.ui.editor.mockResolvedValueOnce(JSON.stringify([{ id: "deepseek-v4" }, { id: "deepseek-v4-fast" }]));

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(state.ctx.ui.editor).toHaveBeenCalledWith(
			"编辑 llm-deepseek.models",
			JSON.stringify([{ id: "deepseek-v4" }], null, 2),
		);
		expect(fake.runtime.mutateSettings).toHaveBeenCalledWith(
			"llm-deepseek",
			[
				{
					op: "set",
					path: ["models"],
					value: [{ id: "deepseek-v4" }, { id: "deepseek-v4-fast" }],
				},
			],
			3,
		);
		vi.unstubAllEnvs();
	});

	it("rejects invalid model-array JSON before native mutation", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("JSON 数组字段")
			.mockResolvedValueOnce("llm-deepseek.models · 1 项 · 继承值")
			.mockResolvedValueOnce("编辑 JSON");
		state.ctx.ui.editor.mockResolvedValueOnce("not-json");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(fake.runtime.mutateSettings).not.toHaveBeenCalled();
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unexpected token"), "error");
		vi.unstubAllEnvs();
	});

	it("resets scalar overrides without reconstructing redacted Settings", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select
			.mockResolvedValueOnce("可编辑字段")
			.mockResolvedValueOnce('llm-deepseek.baseURL · "https://api.deepseek.com" · 用户覆盖')
			.mockResolvedValueOnce("恢复继承值");

		await state.commands.get("dsh")?.handler("settings", state.ctx);

		expect(fake.runtime.mutateSettings).toHaveBeenCalledWith("llm-deepseek", [{ op: "unset", path: ["baseURL"] }], 3);
		vi.unstubAllEnvs();
	});

	it("opens Harness reasoning effort from the top-level settings command", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("推理等级").mockResolvedValueOnce("Max · max · More reasoning");

		await state.commands.get("settings")?.handler("", state.ctx);

		expect(state.ctx.ui.select).toHaveBeenNthCalledWith(1, "DSH 设置", [
			"模型",
			"推理等级",
			"Harness Settings、Provider 与凭据",
		]);
		expect(fake.runtime.selectModel).toHaveBeenCalledWith("deepseek-official", "deepseek-v4-flash", "max");
		vi.unstubAllEnvs();
	});

	it("selects adapter-declared Harness reasoning effort", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("Max · max · More reasoning");

		await state.commands.get("dsh")?.handler("effort", state.ctx);

		expect(fake.runtime.selectModel).toHaveBeenCalledWith("deepseek-official", "deepseek-v4-flash", "max");
		vi.unstubAllEnvs();
	});

	it("restores the adapter or Provider reasoning default by omitting effort", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("Provider 默认 · high");

		await state.commands.get("dsh")?.handler("effort", state.ctx);

		expect(fake.runtime.selectModel).toHaveBeenCalledWith("deepseek-official", "deepseek-v4-flash", undefined);
		vi.unstubAllEnvs();
	});

	it("uses the target model's declared default effort when switching routes", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("DeepSeek V4 · deepseek-official · effort high");

		await state.commands.get("dsh")?.handler("model", state.ctx);

		expect(fake.runtime.selectModel).toHaveBeenCalledWith("deepseek-official", "deepseek-v4", "high");
		expect(state.ctx.setModelPreference).toHaveBeenCalledWith("deepseek-official", "deepseek-v4");
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
			"metapi-dsh-0-model",
			"Harness native deepseek-official/deepseek-v4-flash · Profile preference deepseek-official/deepseek-v4",
		);
		vi.unstubAllEnvs();
	});

	it("shows bounded native request and context evidence", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);

		await state.commands.get("dsh")?.handler("evidence", state.ctx);

		expect(fake.runtime.contextEvidence).toHaveBeenCalledTimes(1);
		expect(state.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('"system": "system snapshot"'), "info");
		vi.unstubAllEnvs();
	});

	it("runs native compaction and Skill paths without reproducing their business logic", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		state.ctx.ui.confirm.mockResolvedValueOnce(true);

		await state.commands.get("dsh")?.handler("compact", state.ctx);

		expect(fake.runtime.executeCommand).toHaveBeenCalledWith("/compact");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("/compact applied", "info");
		for (const event of [
			{
				type: "compaction/start",
				data: { compactionId: "compact-1", turn: null },
			},
			{
				type: "compaction/summary",
				data: {
					compactionId: "compact-1",
					shadowedTokenCount: 1_200,
					provider: "deepseek-official",
					model: "deepseek-v4-flash",
				},
			},
			{
				type: "compaction/end",
				data: { compactionId: "compact-1", turn: null },
			},
		]) {
			fake.emit({
				rpcId: `${event.type}-rpc`,
				payload: { type: "session/event", sessionId: "session-1", event },
			});
		}
		await vi.waitFor(() =>
			expect(state.ctx.ui.setStatus).toHaveBeenCalledWith(
				"metapi-dsh-6-compaction",
				expect.stringContaining("已压缩"),
			),
		);
		expect(state.ctx.ui.setStatus).toHaveBeenCalledWith("metapi-dsh-6-compaction", undefined);

		state.ctx.ui.select.mockResolvedValueOnce("/goal · Manage the active goal");
		state.ctx.ui.input.mockResolvedValueOnce("ship command directory");
		await state.commands.get("dsh")?.handler("commands", state.ctx);
		expect(fake.runtime.executeCommand).toHaveBeenLastCalledWith("/goal ship command directory");
		expect(state.ctx.ui.notify).toHaveBeenCalledWith("/goal ship command directory applied", "info");

		state.ctx.ui.select.mockResolvedValueOnce("/review · Review the current change");
		state.ctx.ui.input.mockResolvedValueOnce("focus on lifecycle");
		await state.commands.get("dsh")?.handler("skills", state.ctx);
		expect(fake.runtime.prompt).toHaveBeenCalledWith({
			text: "/review focus on lifecycle",
		});
		vi.unstubAllEnvs();
	});

	it("answers approval requests through the Profile Runtime", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		fake.emit({
			rpcId: "approval-rpc",
			payload: {
				type: "approval/requested",
				sessionId: "session-1",
				approvalId: "approval-1",
				toolName: "pwsh",
			},
		});
		await vi.waitFor(() => expect(fake.runtime.respond).toHaveBeenCalledTimes(1));
		expect(fake.runtime.respond).toHaveBeenCalledWith({
			type: "client-response",
			rpcId: "approval-rpc",
			result: {
				ok: true,
				value: {
					sessionId: "session-1",
					approvalId: "approval-1",
					outcome: "allowed-once",
				},
			},
		});
		vi.unstubAllEnvs();
	});

	it("answers structured DSH questions through the Profile Runtime", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		state.ctx.ui.select.mockResolvedValueOnce("B");
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		fake.emit({
			rpcId: "question-rpc",
			payload: {
				type: "question/requested",
				sessionId: "session-2",
				questions: [
					{
						id: "choice",
						question: "Choose",
						options: [{ label: "A" }, { label: "B" }],
					},
				],
			},
		});
		await vi.waitFor(() => expect(fake.runtime.respond).toHaveBeenCalledTimes(1));
		expect(fake.runtime.respond).toHaveBeenCalledWith({
			type: "client-response",
			rpcId: "question-rpc",
			result: {
				ok: true,
				value: {
					sessionId: "session-2",
					answer: { answers: [{ id: "choice", selected: ["B"] }] },
				},
			},
		});
		vi.unstubAllEnvs();
	});

	it("serializes concurrent Harness interaction requests", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		let resolveApproval!: (value: boolean) => void;
		state.ctx.ui.confirm.mockImplementationOnce(
			async () =>
				new Promise<boolean>((resolve) => {
					resolveApproval = resolve;
				}),
		);
		state.ctx.ui.select.mockResolvedValueOnce("B");
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);

		fake.emit({
			rpcId: "approval-rpc",
			payload: {
				type: "approval/requested",
				sessionId: "session-1",
				approvalId: "approval-1",
				toolName: "pwsh",
			},
		});
		fake.emit({
			rpcId: "question-rpc",
			payload: {
				type: "question/requested",
				sessionId: "child-session",
				questions: [
					{
						id: "choice",
						question: "Choose",
						options: [{ label: "A" }, { label: "B" }],
					},
				],
			},
		});

		await vi.waitFor(() => expect(state.ctx.ui.confirm).toHaveBeenCalledTimes(1));
		expect(state.ctx.ui.select).not.toHaveBeenCalled();
		resolveApproval(true);
		await vi.waitFor(() => expect(fake.runtime.respond).toHaveBeenCalledTimes(2));
		const responses = fake.runtime.respond as ReturnType<typeof vi.fn>;
		expect(responses.mock.calls.map((call) => call[0].rpcId)).toEqual(["approval-rpc", "question-rpc"]);
		vi.unstubAllEnvs();
	});

	it("does not answer a stale dialog after Profile shutdown", async () => {
		const fake = fakeRuntime();
		const state = setup("dsh", fake.runtime);
		let resolveApproval!: (value: boolean) => void;
		state.ctx.ui.confirm.mockImplementationOnce(
			async () =>
				new Promise<boolean>((resolve) => {
					resolveApproval = resolve;
				}),
		);
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		fake.emit({
			rpcId: "approval-rpc",
			payload: {
				type: "approval/requested",
				sessionId: "session-1",
				approvalId: "approval-1",
				toolName: "pwsh",
			},
		});
		await vi.waitFor(() => expect(state.ctx.ui.confirm).toHaveBeenCalledTimes(1));
		state.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, state.ctx);
		resolveApproval(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(fake.runtime.respond).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});

	it("does not alter ordinary Profile status", () => {
		const state = setup("default");
		state.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, state.ctx);
		expect(state.ctx.ui.setStatus).not.toHaveBeenCalled();
		vi.unstubAllEnvs();
	});
});
