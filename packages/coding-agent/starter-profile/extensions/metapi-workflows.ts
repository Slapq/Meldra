import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Api, type Message, type Model, uuidv7 } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	SlashCommandInfo,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
	BorderedLoader,
	CONFIG_DIR_NAME,
	convertToLlm,
	DynamicBorder,
	getAgentDir,
	getSettingsListTheme,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import questionnaireExtension from "./questionnaire.ts";

const CONFIG_ID = "metapi-workflows";
const PRESET_ENTRY = "metapi-workflow-preset";
const TOOLS_ENTRY = "metapi-workflow-tools";
const QUESTIONNAIRE_TOOL = "questionnaire";

interface WorkflowConfig {
	commands: boolean;
	presets: boolean;
	tools: boolean;
	handoff: boolean;
	questionnaire: boolean;
	defaultPreset: string;
}

const DEFAULT_CONFIG: WorkflowConfig = {
	commands: true,
	presets: true,
	tools: true,
	handoff: true,
	questionnaire: false,
	defaultPreset: "",
};

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface Preset {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	instructions?: string;
}

interface PresetsConfig {
	[name: string]: Preset;
}

interface OriginalState {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	tools: string[];
}

interface PresetState {
	name?: string;
}

interface ToolsState {
	enabledTools?: string[];
	reset?: boolean;
}

function mergeConfig(value: unknown): WorkflowConfig {
	if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG };
	const raw = value as Partial<WorkflowConfig>;
	return {
		commands: typeof raw.commands === "boolean" ? raw.commands : DEFAULT_CONFIG.commands,
		presets: typeof raw.presets === "boolean" ? raw.presets : DEFAULT_CONFIG.presets,
		tools: typeof raw.tools === "boolean" ? raw.tools : DEFAULT_CONFIG.tools,
		handoff: typeof raw.handoff === "boolean" ? raw.handoff : DEFAULT_CONFIG.handoff,
		questionnaire: typeof raw.questionnaire === "boolean" ? raw.questionnaire : DEFAULT_CONFIG.questionnaire,
		defaultPreset: typeof raw.defaultPreset === "string" ? raw.defaultPreset.trim() : "",
	};
}

function loadPresets(cwd: string): PresetsConfig {
	const read = (path: string): PresetsConfig => {
		if (!existsSync(path)) return {};
		try {
			const value = JSON.parse(readFileSync(path, "utf8"));
			return value && typeof value === "object" && !Array.isArray(value) ? value : {};
		} catch (error) {
			console.error(`Failed to load presets from ${path}: ${error}`);
			return {};
		}
	};
	return {
		...read(join(getAgentDir(), "presets.json")),
		...read(join(cwd, CONFIG_DIR_NAME, "presets.json")),
	};
}

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let index = branch.length - 1; index >= 0; index--) {
		if (branch[index].type === "compaction") {
			compactionIndex = index;
			break;
		}
	}
	if (compactionIndex < 0) return branch.map(entryToMessage).filter((message) => message !== undefined);

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const entries = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return entries.map(entryToMessage).filter((message) => message !== undefined);
}

const HANDOFF_SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused, self-contained prompt that:

1. Summarizes relevant decisions, approaches, and findings
2. Lists relevant files discussed or modified
3. Clearly states the next task based on the user's goal
4. Preserves unresolved constraints and explicit non-goals

Return only the prompt for the new thread, without a preamble.`;

export default function meldraWorkflows(pi: ExtensionAPI) {
	let config = { ...DEFAULT_CONFIG };
	let presets: PresetsConfig = {};
	let activePresetName: string | undefined;
	let activePreset: Preset | undefined;
	let originalState: OriginalState | undefined;
	let modeToolBaseline: string[] = [];
	let manualToolOverride: string[] | undefined;

	// Register the official questionnaire implementation, then keep it inactive
	// unless Config or an explicitly selected preset enables it.
	questionnaireExtension(pi);

	pi.events.emit("config:register", {
		id: CONFIG_ID,
		label: "Meldra 工作流",
		icon: "◆",
		fields: [
			{ type: "section", label: "用户命令" },
			{ key: "commands", label: "功能列表 /commands", type: "boolean" },
			{ key: "presets", label: "工作模式 /preset", type: "boolean" },
			{ key: "tools", label: "当前会话工具 /tools", type: "boolean" },
			{ key: "handoff", label: "新会话交接 /handoff", type: "boolean" },
			{ type: "section", label: "模型能力" },
			{
				key: "questionnaire",
				label: "结构化问询工具",
				type: "boolean",
				hint: "默认关闭；开启后模型可主动发起结构化多问题问询",
			},
			{ type: "section", label: "启动默认值" },
			{
				key: "defaultPreset",
				label: "默认工作模式",
				type: "string",
				placeholder: "留空表示不自动应用",
				hint: "名称来自 agent/presets.json 或项目 .pi/presets.json；下次会话生效",
			},
		],
		defaults: DEFAULT_CONFIG,
	});

	const readConfig = () => {
		let value: unknown;
		pi.events.emit("config:get", {
			id: CONFIG_ID,
			callback: (next: unknown) => {
				value = next;
			},
		});
		config = mergeConfig(value);
	};
	readConfig();

	function availableToolNames(): Set<string> {
		return new Set(pi.getAllTools().map((tool) => tool.name));
	}

	function normalizeTools(names: string[]): string[] {
		const available = availableToolNames();
		return [...new Set(names.filter((name) => available.has(name)))];
	}

	function withQuestionnaireDefault(names: string[]): string[] {
		const next = names.filter((name) => name !== QUESTIONNAIRE_TOOL);
		if (config.questionnaire) next.push(QUESTIONNAIRE_TOOL);
		return normalizeTools(next);
	}

	function presetToolBaseline(preset: Preset | undefined, fallback: string[]): string[] {
		if (preset?.tools && preset.tools.length > 0) {
			// An explicit preset may enable questionnaire even when its global default is off.
			return normalizeTools(preset.tools);
		}
		return withQuestionnaireDefault(fallback);
	}

	function applyCurrentTools() {
		pi.setActiveTools(normalizeTools(manualToolOverride ?? modeToolBaseline));
	}

	function updatePresetStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus(
			"metapi-workflow-preset",
			activePresetName ? ctx.ui.theme.fg("accent", `模式:${activePresetName}`) : undefined,
		);
	}

	function featureEnabled(enabled: boolean, name: string, ctx: ExtensionContext): boolean {
		if (enabled) return true;
		ctx.ui.notify(`${name} 已在 /config → Meldra 工作流中关闭`, "info");
		return false;
	}

	async function applyPreset(
		name: string,
		preset: Preset,
		ctx: ExtensionContext,
		options: { restoreOnly?: boolean; persist?: boolean } = {},
	): Promise<void> {
		if (!originalState) {
			originalState = {
				model: ctx.model,
				thinkingLevel: pi.getThinkingLevel(),
				tools: withQuestionnaireDefault(pi.getActiveTools()),
			};
		}

		if (!options.restoreOnly) {
			if (preset.provider && preset.model) {
				const model = ctx.modelRegistry.find(preset.provider, preset.model);
				if (!model) {
					ctx.ui.notify(`工作模式“${name}”找不到模型 ${preset.provider}/${preset.model}`, "warning");
				} else if (!(await pi.setModel(model))) {
					ctx.ui.notify(`工作模式“${name}”的模型尚未配置凭据`, "warning");
				}
			}
			if (preset.thinkingLevel) pi.setThinkingLevel(preset.thinkingLevel);
		}

		activePresetName = name;
		activePreset = preset;
		modeToolBaseline = presetToolBaseline(preset, originalState.tools);
		manualToolOverride = undefined;
		applyCurrentTools();
		updatePresetStatus(ctx);
		if (options.persist !== false) pi.appendEntry<PresetState>(PRESET_ENTRY, { name });
	}

	async function clearPreset(ctx: ExtensionContext, persist = true): Promise<void> {
		activePresetName = undefined;
		activePreset = undefined;
		manualToolOverride = undefined;
		if (originalState) {
			if (originalState.model) await pi.setModel(originalState.model);
			pi.setThinkingLevel(originalState.thinkingLevel);
			modeToolBaseline = withQuestionnaireDefault(originalState.tools);
		} else {
			modeToolBaseline = withQuestionnaireDefault(["read", "bash", "edit", "write"]);
		}
		applyCurrentTools();
		updatePresetStatus(ctx);
		if (persist) pi.appendEntry<PresetState>(PRESET_ENTRY, {});
	}

	function presetDescription(preset: Preset): string {
		const parts: string[] = [];
		if (preset.provider && preset.model) parts.push(`${preset.provider}/${preset.model}`);
		if (preset.thinkingLevel) parts.push(`thinking:${preset.thinkingLevel}`);
		if (preset.tools) parts.push(`tools:${preset.tools.join(",")}`);
		if (preset.instructions) {
			parts.push(preset.instructions.length > 34 ? `${preset.instructions.slice(0, 31)}...` : preset.instructions);
		}
		return parts.join(" | ");
	}

	async function selectPreset(ctx: ExtensionContext): Promise<void> {
		const names = Object.keys(presets).sort();
		if (names.length === 0) {
			ctx.ui.notify(
				`尚未定义工作模式。请编辑 ${join(getAgentDir(), "presets.json")} 或 ${join(ctx.cwd, CONFIG_DIR_NAME, "presets.json")}`,
				"info",
			);
			return;
		}
		const items: SelectItem[] = names.map((name) => ({
			value: name,
			label: name === activePresetName ? `${name}（当前）` : name,
			description: presetDescription(presets[name]),
		}));
		items.push({ value: "", label: "不使用工作模式", description: "恢复进入当前会话时的模型、思考和工具基线" });

		const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold("选择当前会话的工作模式")), 1, 0));
			const list = new SelectList(items, Math.min(items.length, 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
			container.addChild(list);
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					list.handleInput(data);
					tui.requestRender();
				},
			};
		});
		if (selected === null) return;
		if (!selected) await clearPreset(ctx);
		else await applyPreset(selected, presets[selected], ctx);
	}

	pi.registerFlag("preset", {
		description: "Meldra workflow preset to use",
		type: "string",
	});

	pi.registerShortcut(Key.ctrlShift("u"), {
		description: "Cycle Meldra workflow modes",
		handler: async (ctx) => {
			if (!featureEnabled(config.presets, "工作模式", ctx)) return;
			const names = Object.keys(presets).sort();
			if (names.length === 0) return selectPreset(ctx);
			const cycle = ["", ...names];
			const current = activePresetName ?? "";
			const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
			if (!next) await clearPreset(ctx);
			else await applyPreset(next, presets[next], ctx);
		},
	});

	pi.registerCommand("commands", {
		description: "查看当前可用功能",
		getArgumentCompletions: (prefix) => {
			const sources = ["extension", "prompt", "skill"].filter((source) => source.startsWith(prefix));
			return sources.length ? sources.map((source) => ({ value: source, label: source })) : null;
		},
		handler: async (args, ctx) => {
			if (!featureEnabled(config.commands, "功能列表", ctx)) return;
			const source = args.trim() as "extension" | "prompt" | "skill" | "";
			const commands = pi.getCommands();
			const filtered = source ? commands.filter((command) => command.source === source) : commands;
			if (!filtered.length) {
				ctx.ui.notify("没有符合条件的功能", "info");
				return;
			}
			const format = (command: SlashCommandInfo) =>
				`/${command.name}${command.description ? ` — ${command.description}` : ""}`;
			const items: string[] = [];
			for (const group of [
				{ source: "extension", label: "扩展功能" },
				{ source: "prompt", label: "提示模板" },
				{ source: "skill", label: "按需能力" },
			] as const) {
				const groupCommands = filtered.filter((command) => command.source === group.source);
				if (groupCommands.length) items.push(`── ${group.label} ──`, ...groupCommands.map(format));
			}
			const selected = await ctx.ui.select("当前可用功能", items);
			if (!selected || selected.startsWith("──")) return;
			const name = selected.split(" — ")[0].slice(1);
			const command = commands.find((candidate) => candidate.name === name);
			if (command?.sourceInfo.path && (await ctx.ui.confirm(command.name, `查看来源？\n${command.sourceInfo.path}`))) {
				ctx.ui.notify(command.sourceInfo.path, "info");
			}
		},
	});

	pi.registerCommand("preset", {
		description: "选择当前会话的工作模式",
		getArgumentCompletions: (prefix) => {
			const names = Object.keys(presets).filter((name) => name.startsWith(prefix));
			return names.length ? names.map((name) => ({ value: name, label: name })) : null;
		},
		handler: async (args, ctx) => {
			if (!featureEnabled(config.presets, "工作模式", ctx)) return;
			const name = args.trim();
			if (!name) return selectPreset(ctx);
			if (name === "none" || name === "off") return clearPreset(ctx);
			const preset = presets[name];
			if (!preset) {
				ctx.ui.notify(`未知工作模式“${name}”`, "error");
				return;
			}
			await applyPreset(name, preset, ctx);
			ctx.ui.notify(`已使用工作模式“${name}”`, "info");
		},
	});

	pi.registerCommand("tools", {
		description: "设置当前会话可用工具；使用 /tools reset 恢复工作模式基线",
		handler: async (args, ctx) => {
			if (!featureEnabled(config.tools, "会话工具设置", ctx)) return;
			if (args.trim() === "reset") {
				manualToolOverride = undefined;
				applyCurrentTools();
				pi.appendEntry<ToolsState>(TOOLS_ENTRY, { reset: true });
				ctx.ui.notify("已恢复当前工作模式的工具基线", "info");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tools 需要交互界面", "error");
				return;
			}
			const allTools: ToolInfo[] = pi.getAllTools();
			const selected = new Set(manualToolOverride ?? pi.getActiveTools());
			await ctx.ui.custom((tui, theme, _kb, done) => {
				const items: SettingItem[] = allTools.map((tool) => ({
					id: tool.name,
					label: tool.name,
					currentValue: selected.has(tool.name) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
				}));
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("当前会话可用工具")), 1, 1));
				const list = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, value) => {
						if (value === "enabled") selected.add(id);
						else selected.delete(id);
						manualToolOverride = Array.from(selected);
						applyCurrentTools();
						pi.appendEntry<ToolsState>(TOOLS_ENTRY, { enabledTools: manualToolOverride });
					},
					() => done(undefined),
					{ enableSearch: true },
				);
				container.addChild(list);
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						list.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});

	pi.registerCommand("handoff", {
		description: "把必要上下文整理到一个新的专注会话",
		handler: async (args, ctx) => {
			if (!featureEnabled(config.handoff, "会话交接", ctx)) return;
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/handoff 需要交互界面", "error");
				return;
			}
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("尚未选择模型", "error");
				return;
			}
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("用法：/handoff <新会话目标>", "error");
				return;
			}
			const messages = getHandoffMessages(ctx.sessionManager.getBranch());
			if (!messages.length) {
				ctx.ui.notify("当前没有可交接的会话内容", "error");
				return;
			}
			const conversation = serializeConversation(convertToLlm(messages));
			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const draft = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, "正在整理交接内容...");
				loader.onAbort = () => done(null);
				const userMessage: Message = {
					role: "user",
					content: [
						{ type: "text", text: `## Conversation History\n\n${conversation}\n\n## New Session Goal\n\n${goal}` },
					],
					timestamp: Date.now(),
				};
				ctx.modelRegistry
					.complete(
						model,
						{ systemPrompt: HANDOFF_SYSTEM_PROMPT, messages: [userMessage] },
						{
							signal: loader.signal,
							cacheRetention: "none",
							sessionId: uuidv7(),
						},
					)
					.then((response) => {
						if (response.stopReason === "aborted") return done(null);
						done(
							response.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join("\n"),
						);
					})
					.catch((error) => {
						console.error("Handoff generation failed:", error);
						done(null);
					});
				return loader;
			});
			if (draft === null) {
				ctx.ui.notify("已取消", "info");
				return;
			}
			const edited = await ctx.ui.editor("编辑交接内容", draft);
			if (edited === undefined) return;
			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					replacementCtx.ui.setEditorText(edited);
					replacementCtx.ui.notify("交接内容已放入编辑器，确认后发送", "info");
				},
			});
			if (result.cancelled) ctx.ui.notify("新会话已取消", "info");
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (config.presets && activePreset?.instructions) {
			return { systemPrompt: `${event.systemPrompt}\n\n${activePreset.instructions}` };
		}
	});

	function restoreWorkflowState(ctx: ExtensionContext) {
		const branch = ctx.sessionManager.getBranch();
		let lastPreset: { index: number; state: PresetState } | undefined;
		let lastTools: { index: number; state: ToolsState } | undefined;
		for (let index = 0; index < branch.length; index++) {
			const entry = branch[index];
			if (entry.type !== "custom") continue;
			if (entry.customType === PRESET_ENTRY) lastPreset = { index, state: (entry.data ?? {}) as PresetState };
			if (entry.customType === TOOLS_ENTRY) lastTools = { index, state: (entry.data ?? {}) as ToolsState };
		}

		activePresetName = lastPreset?.state.name;
		activePreset = activePresetName ? presets[activePresetName] : undefined;
		modeToolBaseline = presetToolBaseline(activePreset, originalState?.tools ?? pi.getActiveTools());
		manualToolOverride =
			lastTools && (!lastPreset || lastTools.index > lastPreset.index) && !lastTools.state.reset
				? normalizeTools(lastTools.state.enabledTools ?? [])
				: undefined;
		applyCurrentTools();
		updatePresetStatus(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		readConfig();
		presets = loadPresets(ctx.cwd);
		originalState = {
			model: ctx.model,
			thinkingLevel: pi.getThinkingLevel(),
			tools: withQuestionnaireDefault(pi.getActiveTools()),
		};
		modeToolBaseline = originalState.tools;
		manualToolOverride = undefined;

		const presetFlag = pi.getFlag("preset");
		if (config.presets && typeof presetFlag === "string" && presetFlag && presets[presetFlag]) {
			await applyPreset(presetFlag, presets[presetFlag], ctx, { persist: false });
			return;
		}

		const hasWorkflowState = ctx.sessionManager
			.getBranch()
			.some(
				(entry) => entry.type === "custom" && (entry.customType === PRESET_ENTRY || entry.customType === TOOLS_ENTRY),
			);
		if (hasWorkflowState) {
			restoreWorkflowState(ctx);
			return;
		}

		if (config.presets && config.defaultPreset && presets[config.defaultPreset]) {
			await applyPreset(config.defaultPreset, presets[config.defaultPreset], ctx, { persist: false });
		} else {
			applyCurrentTools();
			updatePresetStatus(ctx);
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreWorkflowState(ctx);
	});

	pi.events.on(`config:updated:${CONFIG_ID}`, (value: unknown) => {
		const previousQuestionnaire = config.questionnaire;
		config = mergeConfig(value);
		if (previousQuestionnaire !== config.questionnaire && manualToolOverride === undefined) {
			modeToolBaseline = presetToolBaseline(activePreset, originalState?.tools ?? modeToolBaseline);
			applyCurrentTools();
		}
	});
}
