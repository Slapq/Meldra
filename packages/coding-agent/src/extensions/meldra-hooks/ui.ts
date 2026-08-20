import { type Component, Container, type SelectItem, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { MeldraHookEventName } from "../../hooks/index.ts";

export type HooksManagerLang = "en" | "zh";
export type HooksEventCategoryId = "session" | "agent" | "turn" | "tool";

export interface HooksEventCategory {
	id: HooksEventCategoryId;
	events: readonly MeldraHookEventName[];
}

export const HOOK_EVENT_CATEGORIES: readonly HooksEventCategory[] = [
	{ id: "session", events: ["SessionStart", "SessionEnd"] },
	{ id: "agent", events: ["AgentStart", "AgentEnd", "Stop"] },
	{ id: "turn", events: ["UserPromptSubmit", "TurnStart", "TurnEnd"] },
	{ id: "tool", events: ["PreToolUse", "PostToolUse", "PostToolUseFailure"] },
];

export interface HooksManagerI18n {
	title: string;
	management: string;
	managementDescription: string;
	profileScope: string;
	projectScope: string;
	effectiveEnabled: string;
	effectiveDisabled: string;
	activeCount: (active: number, total: number) => string;
	handlerCount: (count: number) => string;
	eventCount: (count: number) => string;
	liveReload: string;
	manualReload: string;
	settingsCannotEdit: (scope: string, error: string) => string;
	categoryLabel: Record<HooksEventCategoryId, string>;
	categoryDescription: Record<HooksEventCategoryId, string>;
	eventDescription: Record<MeldraHookEventName, string>;
	eventActions: string;
	eventActionsDescription: string;
	addHandler: string;
	disableEvent: string;
	enableEvent: string;
	handlerActions: string;
	editHandler: string;
	disableHandler: string;
	enableHandler: string;
	deleteHandler: string;
	back: string;
	stateEnabled: string;
	stateDisabled: string;
	stateInherited: string;
	matcher: string;
	condition: string;
	managementActions: string;
	switchScope: string;
	importHooks: string;
	globalState: string;
	shellPath: string;
	editSource: string;
	language: string;
	selectLanguage: string;
	selectNav: string;
	noHandlers: string;
	projectUntrusted: string;
	requiresTui: string;
	settingsUnavailable: string;
	saved: (scope: string) => string;
	reloadPending: string;
	cancel: string;
	deleteTitle: string;
	deleteConfirm: (command: string, scope: string) => string;
	eventToggleTitle: (disable: boolean, event: string) => string;
	eventToggleConfirm: (count: number, scope: string) => string;
	addTitle: (event: string) => string;
	editTitle: (event: string) => string;
	importTitle: string;
	pasteJson: string;
	readJsonFile: string;
	jsonFile: string;
	importNotFile: (path: string) => string;
	importTooLarge: (maxBytes: string) => string;
	merge: string;
	replace: string;
	importMode: string;
	importConfirmTitle: (mode: string, scope: string) => string;
	importConfirmBody: (summary: string) => string;
	ignoredFields: (fields: string) => string;
	sourceEditTitle: (scope: string) => string;
	shellPathTitle: (scope: string) => string;
	globalStateTitle: (scope: string) => string;
	enableAll: string;
	disableAll: string;
	inherit: string;
	diagnostics: string;
	viewDiagnostics: string;
	noDiagnostics: string;
}

const EN: HooksManagerI18n = {
	title: "Meldra Hooks Manager",
	management: "Management actions",
	managementDescription: "Scope, import, global state, shell path, source JSON and language",
	profileScope: "Profile",
	projectScope: "Project",
	effectiveEnabled: "Effective Hooks enabled",
	effectiveDisabled: "Effective Hooks disabled",
	activeCount: (active, total) => `${active}/${total} active`,
	handlerCount: (count) => `${count} handlers`,
	eventCount: (count) => `${count} events`,
	liveReload: "live reload",
	manualReload: "manual reload",
	settingsCannotEdit: (scope, error) => `${scope} settings cannot be edited: ${error}`,
	categoryLabel: { session: "Session events", agent: "Agent events", turn: "Turn events", tool: "Tool events" },
	categoryDescription: {
		session: "Session startup and shutdown",
		agent: "Agent execution and stop lifecycle",
		turn: "Prompt and model-turn lifecycle",
		tool: "Before and after tool execution",
	},
	eventDescription: {
		SessionStart: "Session startup",
		UserPromptSubmit: "User prompt submission",
		PreToolUse: "Before a tool executes",
		PostToolUse: "After a tool succeeds",
		PostToolUseFailure: "After a tool fails",
		AgentStart: "Agent execution starts",
		AgentEnd: "Agent execution ends",
		TurnStart: "Model turn starts",
		TurnEnd: "Model turn ends",
		Stop: "Agent stopping decision",
		SessionEnd: "Session shutdown",
	},
	eventActions: "Event actions",
	eventActionsDescription: "Add a handler or enable/disable this event",
	addHandler: "Add handler",
	disableEvent: "Disable event",
	enableEvent: "Enable event",
	handlerActions: "Handler actions",
	editHandler: "Edit handler",
	disableHandler: "Disable handler",
	enableHandler: "Enable handler",
	deleteHandler: "Delete handler",
	back: "Back",
	stateEnabled: "enabled",
	stateDisabled: "disabled",
	stateInherited: "inherited",
	matcher: "matcher",
	condition: "condition",
	managementActions: "Hook management",
	switchScope: "Switch Profile / Project scope",
	importHooks: "Import Hooks",
	globalState: "Enable / disable all Hooks",
	shellPath: "Hook shell path",
	editSource: "Edit complete Hook JSON",
	language: "Language",
	selectLanguage: "Select language",
	selectNav: "Up/Down navigate · Enter select · Esc back",
	noHandlers: "No handlers configured",
	projectUntrusted: "Project Hooks unavailable until Project Trust succeeds",
	requiresTui: "Meldra Hooks manager requires interactive TUI mode",
	settingsUnavailable: "Meldra Hooks settings management is unavailable",
	saved: (scope) => `${scope} Hook settings saved`,
	reloadPending: "Live reload is pending",
	cancel: "Cancel",
	deleteTitle: "Delete Hook handler?",
	deleteConfirm: (command, scope) => `${command} (${scope})`,
	eventToggleTitle: (disable, event) => `${disable ? "Disable" : "Enable"} ${event}?`,
	eventToggleConfirm: (count, scope) => `${count} ${scope} handlers will be updated.`,
	addTitle: (event) => `Add ${event} handler`,
	editTitle: (event) => `Edit ${event} handler`,
	importTitle: "Import Hooks",
	pasteJson: "Paste JSON",
	readJsonFile: "Read local JSON file",
	jsonFile: "Hook JSON file",
	importNotFile: (path) => `Hook import path is not a file: ${path}`,
	importTooLarge: (maxBytes) => `Hook import exceeds ${maxBytes} bytes`,
	merge: "Merge",
	replace: "Replace",
	importMode: "Import mode",
	importConfirmTitle: (mode, scope) => `${mode} ${scope} Hooks?`,
	importConfirmBody: (summary) => `${summary}. Scripts are referenced only; no files or packages will be copied.`,
	ignoredFields: (fields) => `Ignored unrelated settings fields: ${fields}`,
	sourceEditTitle: (scope) => `Edit ${scope} Hook settings`,
	shellPathTitle: (scope) => `${scope} Hook shell path`,
	globalStateTitle: (scope) => `${scope} Hook state`,
	enableAll: "Enable all",
	disableAll: "Disable all",
	inherit: "Inherit",
	diagnostics: "Diagnostics",
	viewDiagnostics: "View diagnostics",
	noDiagnostics: "No Hook diagnostics",
};

const ZH: HooksManagerI18n = {
	title: "Meldra Hook 管理",
	management: "管理操作",
	managementDescription: "作用域、导入、全局启停、Shell、完整 JSON 和语言",
	profileScope: "Profile",
	projectScope: "项目",
	effectiveEnabled: "当前 Hook 已启用",
	effectiveDisabled: "当前 Hook 已禁用",
	activeCount: (active, total) => `${active}/${total} 个启用`,
	handlerCount: (count) => `${count} 个处理器`,
	eventCount: (count) => `${count} 个事件`,
	liveReload: "实时重载",
	manualReload: "手动重载",
	settingsCannotEdit: (scope, error) => `无法编辑${scope}配置：${error}`,
	categoryLabel: { session: "Session 事件", agent: "Agent 事件", turn: "Turn 事件", tool: "工具事件" },
	categoryDescription: {
		session: "Session 启动与关闭",
		agent: "Agent 执行与停止生命周期",
		turn: "用户提示与模型 Turn 生命周期",
		tool: "工具执行前后",
	},
	eventDescription: {
		SessionStart: "Session 启动",
		UserPromptSubmit: "用户提交提示",
		PreToolUse: "工具执行之前",
		PostToolUse: "工具成功之后",
		PostToolUseFailure: "工具失败之后",
		AgentStart: "Agent 开始执行",
		AgentEnd: "Agent 执行结束",
		TurnStart: "模型 Turn 开始",
		TurnEnd: "模型 Turn 结束",
		Stop: "Agent 停止决策",
		SessionEnd: "Session 关闭",
	},
	eventActions: "事件操作",
	eventActionsDescription: "新增处理器或启用/禁用整个事件",
	addHandler: "新增处理器",
	disableEvent: "禁用该事件",
	enableEvent: "启用该事件",
	handlerActions: "处理器操作",
	editHandler: "编辑处理器",
	disableHandler: "禁用处理器",
	enableHandler: "启用处理器",
	deleteHandler: "删除处理器",
	back: "返回",
	stateEnabled: "已启用",
	stateDisabled: "已禁用",
	stateInherited: "继承",
	matcher: "匹配器",
	condition: "条件",
	managementActions: "Hook 管理操作",
	switchScope: "切换 Profile / 项目作用域",
	importHooks: "导入 Hook",
	globalState: "启用 / 禁用全部 Hook",
	shellPath: "Hook Shell 路径",
	editSource: "编辑完整 Hook JSON",
	language: "语言",
	selectLanguage: "选择语言",
	selectNav: "上下键导航 · Enter 选择 · Esc 返回",
	noHandlers: "尚未配置处理器",
	projectUntrusted: "项目通过 Project Trust 后才能管理项目 Hook",
	requiresTui: "Meldra Hook 管理器仅支持交互式 TUI",
	settingsUnavailable: "Meldra Hook 配置管理不可用",
	saved: (scope) => `${scope} Hook 配置已保存`,
	reloadPending: "正在等待实时重载",
	cancel: "取消",
	deleteTitle: "删除 Hook 处理器？",
	deleteConfirm: (command, scope) => `${command}（${scope}）`,
	eventToggleTitle: (disable, event) => `${disable ? "禁用" : "启用"} ${event}？`,
	eventToggleConfirm: (count, scope) => `将更新 ${scope} 中的 ${count} 个处理器。`,
	addTitle: (event) => `新增 ${event} 处理器`,
	editTitle: (event) => `编辑 ${event} 处理器`,
	importTitle: "导入 Hook",
	pasteJson: "粘贴 JSON",
	readJsonFile: "读取本地 JSON 文件",
	jsonFile: "Hook JSON 文件",
	importNotFile: (path) => `Hook 导入路径不是文件：${path}`,
	importTooLarge: (maxBytes) => `Hook 导入文件超过 ${maxBytes} 字节`,
	merge: "合并",
	replace: "替换",
	importMode: "导入方式",
	importConfirmTitle: (mode, scope) => `${mode}${scope} Hook？`,
	importConfirmBody: (summary) => `${summary}。只引用脚本，不会复制文件或安装 Package。`,
	ignoredFields: (fields) => `已忽略无关 settings 字段：${fields}`,
	sourceEditTitle: (scope) => `编辑${scope} Hook 配置`,
	shellPathTitle: (scope) => `${scope} Hook Shell 路径`,
	globalStateTitle: (scope) => `${scope} Hook 状态`,
	enableAll: "启用全部",
	disableAll: "禁用全部",
	inherit: "继承上层",
	diagnostics: "诊断",
	viewDiagnostics: "查看诊断",
	noDiagnostics: "没有 Hook 诊断",
};

export const HOOKS_MANAGER_LANGS: Record<HooksManagerLang, HooksManagerI18n> = { en: EN, zh: ZH };

export interface HooksPageItem<T extends string> {
	value: T;
	label: string;
	description?: string;
}

export class HooksSelectPageComponent<T extends string> implements Component {
	private readonly container: Container;
	private readonly list: SelectList;
	private readonly requestRender: () => void;

	constructor(
		theme: Theme,
		title: string,
		subtitle: string,
		items: HooksPageItem<T>[],
		help: string,
		done: (value: T | undefined) => void,
		requestRender: () => void,
	) {
		this.requestRender = requestRender;
		this.container = new Container();
		this.container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		this.container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		this.container.addChild(new Text(theme.fg("muted", subtitle), 1, 0));
		this.container.addChild(new Text("", 0, 0));
		const selectItems: SelectItem[] = items.map((item) => ({
			value: item.value,
			label: item.label,
			...(item.description ? { description: item.description } : {}),
		}));
		this.list = new SelectList(selectItems, Math.min(Math.max(1, selectItems.length), 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.list.onSelect = (item) => done(item.value as T);
		this.list.onCancel = () => done(undefined);
		this.container.addChild(this.list);
		this.container.addChild(new Text("", 0, 0));
		this.container.addChild(new Text(theme.fg("dim", help), 1, 0));
		this.container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
		this.requestRender();
	}

	render(width: number): string[] {
		return this.container.render(width).map((line) => truncateToWidth(line, width, ""));
	}

	invalidate(): void {
		this.container.invalidate();
	}
}

export async function selectHooksPage<T extends string>(
	ctx: ExtensionCommandContext,
	title: string,
	subtitle: string,
	items: HooksPageItem<T>[],
	help: string,
): Promise<T | undefined> {
	return await ctx.ui.custom<T | undefined>((tui, theme, _keybindings, done) =>
		new HooksSelectPageComponent(theme, title, subtitle, items, help, done, () => tui.requestRender()),
	);
}
