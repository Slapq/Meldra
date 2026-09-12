/**
 * Two-level settings entry point for ordinary Meldra Profiles.
 *
 * The first page only offers three categories. Each category opens the existing
 * SettingsSelectorComponent with a filter and a Chinese localization table.
 * `pi` compatibility keeps the original flat, English selector.
 */

import { Container, type SettingItem, SettingsList, type Component } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import {
	SettingsSelectorComponent,
	type SettingsCallbacks,
	type SettingsConfig,
	type SettingsSelectorLocalization,
	type SettingsSelectorOptions,
} from "./settings-selector.ts";

export type MeldraSettingsCategory = "open" | "conversation" | "advanced";

const BOOLEAN_VALUES = { true: "开", false: "关" };

const SETTINGS_ZH: Record<string, SettingsSelectorLocalization> = {
	"launch-policy": {
		label: "打开时进哪个文件夹",
		description: "所有 Profile 共用；只影响下一次输入 meldra",
		values: {
			"ask-dirty": "家、桌面、系统目录 → 先问我",
			"always-new": "每次都用新的空文件夹",
			current: "就用我现在所在的文件夹",
		},
	},
	autocompact: {
		label: "自动压缩",
		description: "上下文过长时自动整理历史",
		values: BOOLEAN_VALUES,
	},
	"steering-mode": {
		label: "打断方式",
		description: "生成过程中输入的文字如何送出：一次一条，或一次全部送出",
		values: { "one-at-a-time": "一次一条", all: "一次全部" },
	},
	"follow-up-mode": {
		label: "追问方式",
		description: "排队中的追问如何送出：一次一条，或一次全部送出",
		values: { "one-at-a-time": "一次一条", all: "一次全部" },
	},
	transport: {
		label: "连接方式",
		description: "支持多种连接方式的服务优先使用哪一种",
	},
	"http-idle-timeout": {
		label: "网络空闲超时",
		description: "等待响应时的最长空闲时间；本地模型可以关掉",
	},
	"hide-thinking": {
		label: "隐藏思考过程",
		description: "不在回复里显示思考内容",
		values: BOOLEAN_VALUES,
	},
	"mermaid-rendering": {
		label: "流程图",
		description: "把 Mermaid 代码块画成图形",
		values: { off: "关闭", final: "只在完成后", streaming: "边写边画" },
	},
	"cache-miss-notices": {
		label: "缓存未命中提示",
		description: "提示明显的缓存未命中",
		values: BOOLEAN_VALUES,
	},
	"collapse-changelog": {
		label: "折叠更新日志",
		description: "更新后只显示简短的更新内容",
		values: BOOLEAN_VALUES,
	},
	"quiet-startup": {
		label: "安静启动",
		description: "启动时不打印详细信息",
		values: BOOLEAN_VALUES,
	},
	"install-telemetry": {
		label: "更新统计",
		description: "检测到更新后发送一条匿名的版本信息",
		values: BOOLEAN_VALUES,
	},
	"default-project-trust": {
		label: "默认项目信任",
		description: "没有其它决定时，是否信任当前项目里的配置",
		values: { ask: "每次询问", always: "始终信任", never: "从不信任" },
	},
	"double-escape-action": {
		label: "连按两次 Esc",
		description: "输入框为空时连按两次 Esc 做什么",
		values: { tree: "打开会话树", fork: "分出新会话", none: "不动作" },
	},
	"tree-filter-mode": {
		label: "会话树默认筛选",
		description: "打开会话树时默认显示哪些内容",
		values: {
			default: "默认",
			"no-tools": "隐藏工具",
			"user-only": "只看我的输入",
			"labeled-only": "只看标记",
			all: "全部",
		},
	},
	warnings: {
		label: "警告",
		description: "分别开关各项警告",
		values: { configure: "设置" },
		submenuTitle: "Anthropic 额外用量",
		submenuDescription: "当 Anthropic 订阅认证可能使用付费额外用量时提醒",
	},
	thinking: {
		label: "思考程度",
		description: "支持思考的模型用多深的推理",
		values: {
			off: "关闭",
			minimal: "极少",
			low: "低",
			medium: "中",
			high: "高",
			xhigh: "极高",
			max: "最大",
		},
		submenuTitle: "思考程度",
		submenuDescription: "选择支持思考的模型使用的推理深度",
	},
	"tui-mode": {
		label: "界面模式",
		description: "常规模式或全屏模式",
		values: { regular: "常规", fullscreen: "全屏" },
	},
	"fullscreen-exit-output": {
		label: "退出全屏时显示",
		description: "退出全屏时输出完整记录，还是只显示继续会话的提示",
		values: { transcript: "完整记录", "resume-hint": "只显示提示" },
	},
	"fullscreen-scrollbar": {
		label: "全屏滚动条",
		description: "全屏模式下的滚动条显示方式",
		values: { auto: "自动", always: "总是显示", hidden: "隐藏" },
	},
	theme: {
		label: "主题",
		description: "界面配色",
		submenuTitle: "主题",
		submenuDescription: "选择界面配色",
	},
	"show-images": {
		label: "显示图片",
		description: "在终端里直接显示图片",
		values: BOOLEAN_VALUES,
	},
	"image-width-cells": {
		label: "图片宽度",
		description: "图片在终端里占多少列",
	},
	"auto-resize-images": {
		label: "自动缩小图片",
		description: "把过大的图片缩到 2000x2000 以内，兼容性更好",
		values: BOOLEAN_VALUES,
	},
	"block-images": {
		label: "不发送图片",
		description: "不把图片发给模型",
		values: BOOLEAN_VALUES,
	},
	"skill-commands": {
		label: "技能命令",
		description: "把技能注册成 /skill:名称 命令",
		values: BOOLEAN_VALUES,
	},
	"show-hardware-cursor": {
		label: "显示光标",
		description: "显示终端光标，同时保留输入法定位",
		values: BOOLEAN_VALUES,
	},
	"editor-padding": {
		label: "输入框边距",
		description: "输入框的左右留白（0-3）",
	},
	"output-padding": {
		label: "对话边距",
		description: "消息内容的左右留白",
	},
	"autocomplete-max-visible": {
		label: "补全最多显示",
		description: "自动补全列表最多显示多少项",
	},
	"clear-on-shrink": {
		label: "内容变短时清屏",
		description: "内容变短时清掉空行，可能出现闪烁",
		values: BOOLEAN_VALUES,
	},
	"terminal-progress": {
		label: "终端进度",
		description: "在终端标签上显示进度",
		values: BOOLEAN_VALUES,
	},
};

const CATEGORY_FILTERS: Record<MeldraSettingsCategory, (id: string) => boolean> = {
	open: (id) => id === "launch-policy" || id === "quiet-startup",
	conversation: (id) =>
		[
			"autocompact",
			"steering-mode",
			"follow-up-mode",
			"transport",
			"http-idle-timeout",
			"hide-thinking",
			"mermaid-rendering",
			"cache-miss-notices",
			"thinking",
			"skill-commands",
		].includes(id),
	advanced: (id) =>
		[
			"collapse-changelog",
			"install-telemetry",
			"default-project-trust",
			"double-escape-action",
			"tree-filter-mode",
			"warnings",
			"tui-mode",
			"fullscreen-exit-output",
			"fullscreen-scrollbar",
			"theme",
			"show-images",
			"image-width-cells",
			"auto-resize-images",
			"block-images",
			"show-hardware-cursor",
			"editor-padding",
			"output-padding",
			"autocomplete-max-visible",
			"clear-on-shrink",
			"terminal-progress",
		].includes(id),
};

const CATEGORY_ITEMS: SettingItem[] = [
	{
		id: "open",
		label: "打开和交接",
		description: "打开时进哪个文件夹、窗口和交接行为",
		currentValue: "进入",
		values: ["进入"],
	},
	{
		id: "conversation",
		label: "对话和显示",
		description: "模型、对话和界面显示",
		currentValue: "进入",
		values: ["进入"],
	},
	{
		id: "advanced",
		label: "高级设置",
		description: "不常改的项目",
		currentValue: "进入",
		values: ["进入"],
	},
];

export class MeldraSettingsSelectorComponent extends Container {
	private readonly categories: SettingsList;
	private detail: SettingsSelectorComponent | undefined;
	private readonly config: SettingsConfig;
	private readonly callbacks: SettingsCallbacks;

	constructor(config: SettingsConfig, callbacks: SettingsCallbacks) {
		super();
		this.config = config;
		this.callbacks = callbacks;
		this.categories = new SettingsList(
			CATEGORY_ITEMS,
			5,
			getSettingsListTheme(),
			(id) => this.openCategory(id as MeldraSettingsCategory),
			callbacks.onCancel,
			{ enableSearch: false },
		);
		this.addChild(new DynamicBorder());
		this.addChild(this.categories);
		this.addChild(new DynamicBorder());
	}

	private openCategory(category: MeldraSettingsCategory): void {
		const filter = CATEGORY_FILTERS[category];
		if (!filter) return;
		const options: SettingsSelectorOptions = { filter, localize: SETTINGS_ZH };
		// Esc inside a category returns to the category list instead of closing settings.
		const backCallbacks: SettingsCallbacks = {
			...this.callbacks,
			onCancel: () => this.showCategories(),
		};
		this.detail = new SettingsSelectorComponent(this.config, backCallbacks, options);
		this.clear();
		this.addChild(this.detail);
	}

	private showCategories(): void {
		this.detail = undefined;
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(this.categories);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (this.detail) this.detail.handleInput(data);
		else this.categories.handleInput(data);
	}

	getSettingsList(): SettingsList {
		return this.detail?.getSettingsList() ?? this.categories;
	}

	/** Focus target: this component delegates input to the active list. */
	getFocusComponent(): Component {
		return this;
	}
}
