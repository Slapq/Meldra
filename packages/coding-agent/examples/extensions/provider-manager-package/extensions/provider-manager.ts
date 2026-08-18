/**
 * Provider Manager Extension
 *
 * A TUI-based provider configuration tool for Pi Agent.
 * Register custom providers with models via an interactive form.
 *
 * Usage:
 *   /provider          - Open provider configuration UI
 *
 * Features:
 *   - Select API type from predefined options
 *   - Configure Base URL, API Key, Headers
 *   - Add/Edit/Delete models with full configuration
 *   - Per-model advanced options: cost, compat settings
 *   - Multi-language support (English, Chinese)
 *   - Persists provider definitions to MetaPi's shared user models.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	Container,
	CURSOR_MARKER,
	type Focusable,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════════════════════════════════

type Lang = "en" | "zh";

interface I18n {
	// Provider select page
	providerManager: string;
	managementActions: string;
	managementActionsDesc: string;
	createNew: string;
	createNewDesc: string;
	models: (n: number) => string;
	delProvider: string;
	confirmDeleteProvider: (name: string) => string;
	providerDeleted: (name: string) => string;
	cancelled: string;
	selectNav: string;
	copyProvider: (name: string) => string;
	importProvider: string;
	importProviderDesc: string;
	importTitle: string;
	importInvalid: string;
	importPick: string;

	// Main form
	newProvider: string;
	editProvider: string;
	fieldName: string;
	fieldApiType: string;
	fieldBaseUrl: string;
	baseUrlHint: string;
	fieldApiKey: string;
	fieldHeaders: string;
	addPiHeaders: string;
	addPiHeadersHint: string;
	piHeadersAdded: string;
	fieldAuthHeader: string;
	fieldModels: string;
	fetchModels: string;
	fetchModelsHint: string;
	fetchingModels: string;
	fetchModelsDone: (added: number, updated: number, total: number, rich: number, idOnly: number) => string;
	fetchModelsError: (message: string) => string;
	fetchUnsupported: string;
	addNewModel: string;
	noModels: string;
	noModelsYet: string;
	delToRemove: string;
	btnSave: string;
	btnCancel: string;
	mainNav: string;
	switchHint: string;
	connectionSettings: string;
	connectionSettingsDesc: string;
	modelsSettings: string;
	modelsSettingsDesc: string;
	backToOverview: string;
	modelSearchHint: string;
	providerSearchHint: string;
	modelPosition: (current: number, total: number) => string;
	modelDetails: string;
	fetchCancelled: string;

	// Validation
	nameRequired: string;
	baseUrlRequired: string;
	providerSaved: (name: string, count: number) => string;

	// Model edit
	addModel: string;
	editModel: string;
	modelId: string;
	modelName: string;
	modelReasoning: string;
	modelInput: string;
	modelContextWindow: string;
	modelMaxTokens: string;
	modelAdvanced: string;
	modelNav: string;
	defaultsToId: string;
	enterToOpen: string;
	modelApi: string;
	inherit: string;
	modelEnrich: string;
	modelEnrichDone: string;
	modelEnrichMiss: string;

	// Advanced (per-model)
	advancedTitle: string;
	costSection: string;
	costInput: string;
	costOutput: string;
	costCacheRead: string;
	costCacheWrite: string;
	compatSection: string;
	compatDeveloperRole: string;
	compatReasoningEffort: string;
	compatMaxTokensField: string;
	compatThinkingFormat: string;
	compatCacheControl: string;
	backAndSave: string;
	advancedNav: string;
	thinkingSection: string;
	thinkingMapLabel: string;
	thinkingMapHint: string;

	// Provider advanced
	provAdvanced: string;
	provAdvTitle: string;
	provCompatHint: string;

	// Thinking budgets (settings.json)
	budgetsMenu: string;
	budgetsMenuDesc: string;
	budgetsSaved: string;
	budgetsPrompt: (level: string, cur: string) => string;

	// Language
	langSelect: string;
	langSelectTitle: string;
}

const EN: I18n = {
	providerManager: "Provider Manager",
	managementActions: "Provider actions",
	managementActionsDesc: "Create, import, thinking budgets and language",
	createNew: "+ Create New Provider",
	createNewDesc: "Configure a new custom provider",
	models: (n) => `${n} model(s)`,
	delProvider: "Delete Provider",
	confirmDeleteProvider: (name) => `Are you sure you want to delete provider "${name}"?`,
	providerDeleted: (name) => `Provider "${name}" deleted`,
	cancelled: "Cancelled",
	selectNav: "↑↓ navigate • Enter select • C copy • Del delete • Esc cancel",
	copyProvider: (name) => `Copy of ${name}`,
	importProvider: "⇩ Import Provider JSON",
	importProviderDesc: "Paste a provider, providers map, or complete models.json",
	importTitle: "Paste provider JSON",
	importInvalid: "Could not find a valid provider configuration in that JSON",
	importPick: "Select provider to import",

	newProvider: "New Provider",
	editProvider: "Edit Provider",
	fieldName: "Name:",
	fieldApiType: "API Type:",
	fieldBaseUrl: "Base URL:",
	baseUrlHint:
		"Enter the API root (for example https://host/v1). Discovery also tries origin/v1/models automatically.",
	fieldApiKey: "API Key:",
	fieldHeaders: "Headers:",
	addPiHeaders: "+ Add Pi Agent Headers",
	addPiHeadersHint: "Adds Pi/OpenRouter attribution headers without removing existing headers.",
	piHeadersAdded: "Pi Agent request headers added",
	fieldAuthHeader: "Auth Header:",
	fieldModels: "Models",
	fetchModels: "↻ Fetch Models from API",
	fetchModelsHint: "Uses the current Base URL, API Key and headers; existing IDs are enriched, not removed.",
	fetchingModels: "Fetching model list…",
	fetchModelsDone: (added, updated, total, rich, idOnly) =>
		`Model discovery complete: ${added} added, ${updated} enriched (${total} returned · ${rich} rich · ${idOnly} ID-only)`,
	fetchModelsError: (message) => `Could not fetch models: ${message}`,
	fetchUnsupported: "This API type does not expose a standard model-list endpoint",
	addNewModel: "+ Add New Model",
	noModels: "No models configured",
	noModelsYet: "No models yet",
	delToRemove: "[Del to remove]",
	btnSave: "✓ Save",
	btnCancel: "✗ Cancel",
	mainNav: "↑↓ navigate • Enter open/select • Esc cancel",
	switchHint: "← → to switch",
	connectionSettings: "Connection & authentication",
	connectionSettingsDesc: "Provider ID, API type, endpoint, credential and headers",
	modelsSettings: "Models",
	modelsSettingsDesc: "Search, inspect, discover and edit the provider model catalog",
	backToOverview: "← Back to provider overview",
	modelSearchHint: "Type to search by model ID or name",
	providerSearchHint: "Type to search providers",
	modelPosition: (current, total) => `${current}/${total}`,
	modelDetails: "Selected model",
	fetchCancelled: "Model discovery cancelled",

	nameRequired: "Provider name is required",
	baseUrlRequired: "Base URL is required",
	providerSaved: (name, count) => `Provider "${name}" saved (${count} model(s))`,

	addModel: "Add Model",
	editModel: "Edit Model",
	modelId: "ID:",
	modelName: "Name:",
	modelReasoning: "Reasoning:",
	modelInput: "Input:",
	modelContextWindow: "Context Window:",
	modelMaxTokens: "Max Tokens:",
	modelAdvanced: "⚙ Advanced Options",
	modelNav: "↑↓/Tab navigate • Enter toggle/confirm • ←→ switch • Esc back",
	defaultsToId: "(defaults to ID)",
	enterToOpen: "[Enter to open]",
	modelApi: "API Override:",
	inherit: "(inherit)",
	modelEnrich: "✦ Fill Metadata",
	modelEnrichDone: "Metadata filled from Pi catalog / provider response",
	modelEnrichMiss: "No catalog metadata found for this model ID",

	advancedTitle: "⚙ Model Advanced Options",
	costSection: "Cost ($/M tokens):",
	costInput: "  Input:",
	costOutput: "  Output:",
	costCacheRead: "  Cache Read:",
	costCacheWrite: "  Cache Write:",
	compatSection: "Compatibility:",
	compatDeveloperRole: "  Developer Role:",
	compatReasoningEffort: "  Reasoning Effort:",
	compatMaxTokensField: "  Max Tokens Field:",
	compatThinkingFormat: "  Thinking Format:",
	compatCacheControl: "  Cache Control:",
	backAndSave: "← Back & Save",
	advancedNav: "↑↓/Tab navigate • Enter toggle • ←→ switch • Esc back & save",
	thinkingSection: "Thinking:",
	thinkingMapLabel: "  Level Map (JSON):",
	thinkingMapHint: 'pi level → provider value; null hides a level. e.g. {"high":"high","xhigh":null,"max":"max"}',

	provAdvanced: "⚙ Advanced (provider-wide compat)",
	provAdvTitle: "⚙ Provider Advanced Options",
	provCompatHint: "Applies to all models of this provider; per-model compat overrides these.",

	budgetsMenu: "🧠 Thinking Budgets",
	budgetsMenuDesc: "Global token budgets per thinking level (settings.json)",
	budgetsSaved: "Thinking budgets saved to settings.json",
	budgetsPrompt: (level, cur) => `Token budget for "${level}" — current: ${cur} (empty = keep, 0 = reset to default)`,

	langSelect: "🌐 Language",
	langSelectTitle: "Select Language",
};

const ZH: I18n = {
	providerManager: "提供商管理",
	managementActions: "管理操作",
	managementActionsDesc: "创建、导入、思考预算和语言",
	createNew: "+ 创建新提供商",
	createNewDesc: "配置一个新的自定义提供商",
	models: (n) => `${n} 个模型`,
	delProvider: "删除提供商",
	confirmDeleteProvider: (name) => `确定要删除提供商 "${name}" 吗？`,
	providerDeleted: (name) => `提供商 "${name}" 已删除`,
	cancelled: "已取消",
	selectNav: "↑↓ 导航 • Enter 选择 • C 复制 • Del 删除 • Esc 取消",
	copyProvider: (name) => `${name} 的副本`,
	importProvider: "⇩ 导入提供商 JSON",
	importProviderDesc: "粘贴单个提供商、providers 映射或完整 models.json",
	importTitle: "粘贴提供商 JSON",
	importInvalid: "JSON 中未找到有效的提供商配置",
	importPick: "选择要导入的提供商",

	newProvider: "新建提供商",
	editProvider: "编辑提供商",
	fieldName: "名称：",
	fieldApiType: "API 类型：",
	fieldBaseUrl: "接口地址：",
	baseUrlHint: "填写 API 根地址（例如 https://host/v1）；获取模型时也会自动尝试 origin/v1/models。",
	fieldApiKey: "API 密钥：",
	fieldHeaders: "请求头：",
	addPiHeaders: "+ 添加 Pi Agent 请求头",
	addPiHeadersHint: "添加 Pi/OpenRouter 标识请求头，不会覆盖其他已有请求头。",
	piHeadersAdded: "已添加 Pi Agent 请求头",
	fieldAuthHeader: "Auth 头：",
	fieldModels: "模型",
	fetchModels: "↻ 从 API 获取模型",
	fetchModelsHint: "使用当前接口地址、API 密钥和请求头；只新增或补全模型，不会删除现有模型。",
	fetchingModels: "正在获取模型列表…",
	fetchModelsDone: (added, updated, total, rich, idOnly) =>
		`模型发现完成：新增 ${added} 个，补全 ${updated} 个（接口返回 ${total} 个 · 完整元信息 ${rich} 个 · 仅 ID ${idOnly} 个）`,
	fetchModelsError: (message) => `获取模型失败：${message}`,
	fetchUnsupported: "此 API 类型没有标准的模型列表接口",
	addNewModel: "+ 添加新模型",
	noModels: "暂无模型",
	noModelsYet: "尚未添加模型",
	delToRemove: "[Del 删除]",
	btnSave: "✓ 保存",
	btnCancel: "✗ 取消",
	mainNav: "↑↓ 导航 • Enter 打开/选择 • Esc 取消",
	switchHint: "← → 切换",
	connectionSettings: "连接与认证",
	connectionSettingsDesc: "提供商 ID、API 类型、接口地址、凭据和请求头",
	modelsSettings: "模型目录",
	modelsSettingsDesc: "搜索、查看、获取和编辑该提供商的模型",
	backToOverview: "← 返回提供商概览",
	modelSearchHint: "输入模型 ID 或名称进行搜索",
	providerSearchHint: "输入提供商名称进行搜索",
	modelPosition: (current, total) => `${current}/${total}`,
	modelDetails: "选中模型",
	fetchCancelled: "已取消模型发现",

	nameRequired: "提供商名称不能为空",
	baseUrlRequired: "接口地址不能为空",
	providerSaved: (name, count) => `提供商 "${name}" 已保存（${count} 个模型）`,

	addModel: "添加模型",
	editModel: "编辑模型",
	modelId: "ID：",
	modelName: "名称：",
	modelReasoning: "推理模式：",
	modelInput: "输入类型：",
	modelContextWindow: "上下文窗口：",
	modelMaxTokens: "最大令牌数：",
	modelAdvanced: "⚙ 高级选项",
	modelNav: "↑↓/Tab 导航 • Enter 切换/确认 • ←→ 切换 • Esc 返回",
	defaultsToId: "（默认使用 ID）",
	enterToOpen: "[Enter 打开]",
	modelApi: "API 覆盖：",
	inherit: "（继承提供商）",
	modelEnrich: "✦ 补全模型参数",
	modelEnrichDone: "已从 Pi 模型目录或接口响应补全参数",
	modelEnrichMiss: "未找到该模型 ID 的目录元数据",

	advancedTitle: "⚙ 模型高级选项",
	costSection: "费用（$/百万令牌）：",
	costInput: "  输入：",
	costOutput: "  输出：",
	costCacheRead: "  缓存读取：",
	costCacheWrite: "  缓存写入：",
	compatSection: "兼容性：",
	compatDeveloperRole: "  Developer 角色：",
	compatReasoningEffort: "  推理强度：",
	compatMaxTokensField: "  令牌上限字段：",
	compatThinkingFormat: "  思考格式：",
	compatCacheControl: "  缓存控制：",
	backAndSave: "← 返回并保存",
	advancedNav: "↑↓/Tab 导航 • Enter 切换 • ←→ 切换 • Esc 返回并保存",
	thinkingSection: "思考配置：",
	thinkingMapLabel: "  等级映射 (JSON)：",
	thinkingMapHint: 'pi 思考等级 → 提供商取值；null 表示隐藏该等级。例：{"high":"high","xhigh":null,"max":"max"}',

	provAdvanced: "⚙ 高级选项（提供商级 compat）",
	provAdvTitle: "⚙ 提供商高级选项",
	provCompatHint: "对该提供商下所有模型生效；模型级 compat 优先。",

	budgetsMenu: "🧠 思考预算",
	budgetsMenuDesc: "全局思考等级 token 预算（settings.json）",
	budgetsSaved: "思考预算已写入 settings.json",
	budgetsPrompt: (level, cur) => `「${level}」的 token 预算 — 当前：${cur}（留空 = 保持，0 = 恢复默认）`,

	langSelect: "🌐 语言",
	langSelectTitle: "选择语言",
};

const LANGS: Record<Lang, I18n> = { en: EN, zh: ZH };

function langPrefPath(): string {
	return join(getAgentDir(), "plugin-configs", "provider-manager.json");
}

function loadLangPref(): Lang | null {
	try {
		const data = JSON.parse(readFileSync(langPrefPath(), "utf-8"));
		return data.lang === "zh" || data.lang === "en" ? data.lang : null;
	} catch {
		return null;
	}
}

function saveLangPref(lang: Lang): void {
	try {
		const dir = join(getAgentDir(), "plugin-configs");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(langPrefPath(), JSON.stringify({ lang }, null, 2), "utf-8");
	} catch {
		/* non-fatal */
	}
}

function detectLang(): Lang {
	const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
	if (/^zh/i.test(env)) return "zh";
	// Windows rarely sets LANG; fall back to the system locale
	try {
		if (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale)) return "zh";
	} catch {
		/* ignore */
	}
	return "en";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface ModelConfig {
	id: string;
	name: string;
	api: string; // "" = inherit provider api
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	compat: Record<string, any>;
	thinkingLevelMap: Record<string, string | null>;
}

interface ProviderConfig {
	baseUrl: string;
	api: string;
	apiKey: string;
	models: ModelConfig[];
	headers: Record<string, string>;
	authHeader: boolean;
	compat: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const API_TYPES = [
	"openai-completions",
	"anthropic-messages",
	"openai-responses",
	"openai-codex-responses",
	"azure-openai-responses",
	"google-generative-ai",
	"google-vertex",
	"bedrock-converse-stream",
	"mistral-conversations",
	"pi-messages",
];

// "" = inherit provider api
const MODEL_API_TYPES = ["", ...API_TYPES];

const COMPAT_THINKING_FORMATS = ["(none)", "openai", "deepseek", "zai", "qwen", "qwen-chat-template"];
const COMPAT_CACHE_FORMATS = ["(none)", "anthropic"];
const COMPAT_MAX_TOKENS_FIELDS = ["max_completion_tokens", "max_tokens"];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function modelsJsonPath(): string {
	// Ordinary MetaPi Profiles share the user model catalog. Keep Pi compatibility
	// behavior unchanged if this package is reused from the reserved `pi` Profile.
	if (process.env.METAPI_PROFILE_NAME && process.env.METAPI_PROFILE_NAME !== "pi") {
		return resolve(getAgentDir(), "../../../user/models.json");
	}
	return join(getAgentDir(), "models.json");
}

function loadModelsJson(): Record<string, any> {
	const p = modelsJsonPath();
	if (!existsSync(p)) return { providers: {} };
	try {
		return JSON.parse(readFileSync(p, "utf-8"));
	} catch {
		return { providers: {} };
	}
}

// ── settings.json (global) — for thinkingBudgets ────────────────────────

function settingsJsonPath(): string {
	return join(getAgentDir(), "settings.json");
}

function loadSettingsJson(): Record<string, any> {
	try {
		return JSON.parse(readFileSync(settingsJsonPath(), "utf-8"));
	} catch {
		return {};
	}
}

function saveSettingsJson(data: Record<string, any>): void {
	const dir = getAgentDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(settingsJsonPath(), JSON.stringify(data, null, 2), "utf-8");
}

function saveModelsJson(data: Record<string, any>): void {
	const p = modelsJsonPath();
	const dir = resolve(p, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function defaultModel(): ModelConfig {
	return {
		id: "",
		name: "",
		api: "",
		reasoning: false,
		input: ["text"],
		contextWindow: 1000000,
		maxTokens: 32000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: {},
		thinkingLevelMap: {},
	};
}

function defaultProvider(): ProviderConfig {
	return {
		baseUrl: "",
		api: "openai-completions",
		apiKey: "",
		models: [],
		headers: {},
		authHeader: false,
		compat: {},
	};
}

interface DiscoveredModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: Partial<ModelConfig["cost"]>;
	rich: boolean;
}

let builtinModelIndex: Map<string, any> | null = null;
let builtinModelEntries: Array<{ id: string; normalized: string; model: any }> | null = null;

function normalizeModelIdForMatch(id: string): string {
	return id
		.toLowerCase()
		.replace(/^models\//, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function getBuiltinModelIndex(): Map<string, any> {
	if (builtinModelIndex) return builtinModelIndex;
	const exact = new Map<string, any>();
	const aliases = new Map<string, any | null>();
	const entries: Array<{ id: string; normalized: string; model: any }> = [];
	for (const provider of getBuiltinProviders()) {
		for (const model of getBuiltinModels(provider as any) as any[]) {
			const id = String(model.id || "");
			if (!id) continue;
			exact.set(id.toLowerCase(), model);
			entries.push({ id: id.toLowerCase(), normalized: normalizeModelIdForMatch(id), model });
			const short = id.split("/").pop()!.toLowerCase();
			if (!aliases.has(short)) aliases.set(short, model);
			else aliases.set(short, null); // ambiguous aliases are unsafe
		}
	}
	for (const [id, model] of aliases) if (model && !exact.has(id)) exact.set(id, model);
	builtinModelIndex = exact;
	builtinModelEntries = entries;
	return exact;
}

function findBuiltinModel(modelId: string): any | undefined {
	const index = getBuiltinModelIndex();
	const lower = modelId.toLowerCase().replace(/^models\//, "");
	const exact = index.get(lower);
	if (exact) return exact;
	const normalized = normalizeModelIdForMatch(lower);
	if (!normalized) return undefined;
	let best: { score: number; model: any } | undefined;
	for (const entry of builtinModelEntries || []) {
		const short = entry.id.split("/").pop()!;
		const shortNorm = normalizeModelIdForMatch(short);
		const contained =
			lower.includes(entry.id) ||
			lower.includes(short) ||
			normalized.includes(entry.normalized) ||
			normalized.includes(shortNorm);
		if (!contained) continue;
		// Prefer the longest known identifier, preventing a short family name from winning.
		const score = Math.max(entry.id.length, entry.normalized.length, short.length, shortNorm.length);
		if (!best || score > best.score) best = { score, model: entry.model };
	}
	return best?.model;
}

function positiveNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		const n = typeof value === "string" ? Number(value) : value;
		if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
	}
	return undefined;
}

function normalizeInput(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const mapped = value
		.map((x) => String(x).toLowerCase())
		.map((x) => {
			if (x === "vision") return "image";
			if (x === "document" || x === "file") return "text";
			return x;
		})
		.filter((x) => x === "text" || x === "image");
	return mapped.length > 0 ? [...new Set(mapped)] : undefined;
}

function metadataFromRaw(raw: any): DiscoveredModel | null {
	const rawId = raw?.id ?? raw?.modelId ?? raw?.model_id ?? raw?.name;
	if (typeof rawId !== "string" || !rawId.trim()) return null;
	const id = rawId.replace(/^models\//, "").trim();
	const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters.map(String) : [];
	const capabilities = Array.isArray(raw.capabilities)
		? raw.capabilities.map((x: any) => String(x).toLowerCase())
		: [];
	const input = normalizeInput(
		raw.input ?? raw.input_modalities ?? raw.inputModalities ?? raw.architecture?.input_modalities,
	);
	const prompt = positiveNumber(raw.pricing?.prompt);
	const completion = positiveNumber(raw.pricing?.completion);
	const cacheRead = positiveNumber(raw.pricing?.input_cache_read);
	const cacheWrite = positiveNumber(raw.pricing?.input_cache_write);
	return {
		id,
		name:
			typeof raw.displayName === "string"
				? raw.displayName
				: typeof raw.name === "string" && raw.name !== rawId
					? raw.name
					: undefined,
		reasoning:
			raw.reasoning === true ||
			(raw.reasoning && typeof raw.reasoning === "object") ||
			supported.some((x: string) => x.includes("reasoning")) ||
			capabilities.includes("reasoning"),
		input,
		contextWindow: positiveNumber(
			raw.contextWindow,
			raw.context_window,
			raw.context_length,
			raw.top_provider?.context_length,
		),
		maxTokens: positiveNumber(
			raw.maxTokens,
			raw.max_output_tokens,
			raw.maxOutputTokens,
			raw.max_output_length,
			raw.top_provider?.max_completion_tokens,
			raw.per_request_limits?.completion_tokens,
		),
		cost:
			prompt || completion || cacheRead || cacheWrite
				? {
						input: (prompt || 0) * 1_000_000,
						output: (completion || 0) * 1_000_000,
						cacheRead: (cacheRead || 0) * 1_000_000,
						cacheWrite: (cacheWrite || 0) * 1_000_000,
					}
				: undefined,
		rich: Boolean(
			raw.displayName ||
				input ||
				raw.reasoning ||
				supported.length ||
				capabilities.length ||
				positiveNumber(
					raw.contextWindow,
					raw.context_window,
					raw.context_length,
					raw.top_provider?.context_length,
				) ||
				positiveNumber(raw.maxTokens, raw.max_output_tokens, raw.maxOutputTokens, raw.max_output_length) ||
				prompt ||
				completion ||
				cacheRead ||
				cacheWrite,
		),
	};
}

function enrichModel(model: ModelConfig, discovered?: DiscoveredModel): { model: ModelConfig; matched: boolean } {
	const builtin = findBuiltinModel(model.id);
	const source: any = builtin || discovered;
	if (!source) return { model, matched: false };
	const input = normalizeInput(source.input) || discovered?.input || model.input;
	return {
		matched: true,
		model: {
			...model,
			// Never replace model.id: broad matching only supplies metadata.
			id: model.id,
			name: source.name || discovered?.name || model.name || model.id,
			api: model.api || (source.api && API_TYPES.includes(source.api) ? source.api : ""),
			reasoning: source.reasoning === true || discovered?.reasoning === true || model.reasoning,
			input,
			contextWindow: positiveNumber(source.contextWindow, discovered?.contextWindow) || model.contextWindow,
			maxTokens: positiveNumber(source.maxTokens, discovered?.maxTokens) || model.maxTokens,
			cost: {
				input: positiveNumber(source.cost?.input, discovered?.cost?.input) || model.cost.input,
				output: positiveNumber(source.cost?.output, discovered?.cost?.output) || model.cost.output,
				cacheRead: positiveNumber(source.cost?.cacheRead, discovered?.cost?.cacheRead) || model.cost.cacheRead,
				cacheWrite: positiveNumber(source.cost?.cacheWrite, discovered?.cost?.cacheWrite) || model.cost.cacheWrite,
			},
		},
	};
}

function modelListCandidates(baseUrl: string, api: string, apiKey: string): string[] {
	if (api === "bedrock-converse-stream" || api === "google-vertex" || api === "pi-messages") return [];
	let parsed: URL;
	try {
		parsed = new URL(baseUrl.trim());
	} catch {
		throw new Error("Base URL must be a complete http(s) URL");
	}
	parsed.hash = "";
	parsed.search = "";
	parsed.pathname = parsed.pathname.replace(/\/+$/, "");
	const paths: string[] = [];
	const add = (pathname: string) => {
		const u = new URL(parsed.toString());
		u.pathname = pathname.replace(/\/{2,}/g, "/");
		if (api === "google-generative-ai" && apiKey) u.searchParams.set("key", apiKey);
		const value = u.toString();
		if (!paths.includes(value)) paths.push(value);
	};
	const stripped = parsed.pathname.replace(/\/(chat\/completions|responses|messages|completions)$/i, "");
	// If a request endpoint was pasted, try its API root first.
	if (stripped !== parsed.pathname) add(`${stripped}/models`);
	else if (/\/models$/i.test(parsed.pathname)) add(parsed.pathname);
	else add(`${parsed.pathname}/models`);

	// Also try the origin-level convention. This handles Base URLs that contain
	// gateway/provider routing prefixes while model discovery remains at /v1/models.
	const originVersion = api === "google-generative-ai" ? "v1beta" : "v1";
	add(`/${originVersion}/models`);
	add("/models");
	return paths;
}

function safeDiscoveryUrl(value: string): string {
	try {
		const url = new URL(value);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return "model endpoint";
	}
}

interface ModelDiscoveryResult {
	models: DiscoveredModel[];
	baseUrl: string;
}

function normalizeDiscoveredBaseUrl(value: string): string {
	try {
		const url = new URL(value);
		url.search = "";
		url.hash = "";
		url.pathname = url.pathname.replace(/\/models\/?$/i, "").replace(/\/$/, "");
		return url.toString().replace(/\/$/, "");
	} catch {
		return value;
	}
}

function hasVersionedApiPath(value: string): boolean {
	try {
		const pathname = new URL(value).pathname;
		return /(^|\/)v\d+(?:beta\d*)?(?:\/|$)/i.test(pathname);
	} catch {
		return false;
	}
}

async function discoverModels(
	config: Pick<ProviderConfig, "baseUrl" | "api" | "apiKey" | "headers" | "authHeader">,
	callerSignal?: AbortSignal,
): Promise<ModelDiscoveryResult> {
	const urls = modelListCandidates(config.baseUrl, config.api, config.apiKey);
	if (urls.length === 0) throw new Error("UNSUPPORTED");
	const headers: Record<string, string> = { Accept: "application/json", ...config.headers };
	if (config.apiKey) {
		if (config.api === "anthropic-messages") {
			headers["x-api-key"] ??= config.apiKey;
			headers["anthropic-version"] ??= "2023-06-01";
		} else if (config.api === "azure-openai-responses") {
			headers["api-key"] ??= config.apiKey;
		} else if (config.api !== "google-generative-ai") {
			// Discovery is an independent HTTP request. Send the conventional bearer
			// header whenever a key exists, even if provider authHeader is false;
			// custom headers still take precedence via ??=.
			headers.Authorization ??= `Bearer ${config.apiKey}`;
		}
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
	try {
		const errors: string[] = [];
		for (const url of urls) {
			try {
				const response = await fetch(url, { headers, signal, redirect: "follow" });
				const text = await response.text();
				if (!response.ok) {
					errors.push(`${safeDiscoveryUrl(url)} → HTTP ${response.status}`);
					continue;
				}
				let body: any;
				try {
					body = JSON.parse(text);
				} catch {
					errors.push(`${safeDiscoveryUrl(url)} → response was not valid JSON`);
					continue;
				}
				const rows = Array.isArray(body)
					? body
					: Array.isArray(body?.data)
						? body.data
						: Array.isArray(body?.models)
							? body.models
							: Array.isArray(body?.result?.data)
								? body.result.data
								: Array.isArray(body?.result?.models)
									? body.result.models
									: [];
				const found = rows
					.map(metadataFromRaw)
					.filter((x: DiscoveredModel | null): x is DiscoveredModel => x !== null);
				if (found.length > 0) return { models: found, baseUrl: normalizeDiscoveredBaseUrl(url) };
				errors.push(`${safeDiscoveryUrl(url)} → no model array found`);
			} catch (error: any) {
				if (error?.name === "AbortError") {
					if (callerSignal?.aborted) throw error;
					if (controller.signal.aborted) throw new Error("Request timed out");
				}
				errors.push(`${safeDiscoveryUrl(url)} → ${String(error?.message || error)}`);
			}
		}
		throw new Error(errors.join("\n"));
	} finally {
		clearTimeout(timer);
	}
}

function parseImportedProviders(value: any): Array<{ name: string; config: ProviderConfig }> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const root = value.providers && typeof value.providers === "object" ? value.providers : value;
	if (typeof root.baseUrl === "string") {
		const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "imported-provider";
		return [{ name, config: parseProvider(root) }];
	}
	return Object.entries(root)
		.filter(([, raw]: [string, any]) => raw && typeof raw === "object" && typeof raw.baseUrl === "string")
		.map(([name, raw]) => ({ name, config: parseProvider(raw) }));
}

function parseProvider(raw: any): ProviderConfig {
	const p = defaultProvider();
	if (raw.baseUrl) p.baseUrl = raw.baseUrl;
	if (raw.api) p.api = raw.api;
	if (raw.apiKey) p.apiKey = raw.apiKey;
	if (raw.headers) p.headers = raw.headers;
	if (raw.authHeader) p.authHeader = raw.authHeader;
	if (raw.compat && typeof raw.compat === "object") p.compat = raw.compat;
	if (Array.isArray(raw.models)) {
		p.models = raw.models.map((m: any) => ({
			id: m.id || "",
			name: m.name || "",
			api: m.api || "",
			reasoning: m.reasoning || false,
			input: m.input || ["text"],
			contextWindow: m.contextWindow ?? 1000000,
			maxTokens: m.maxTokens ?? 32000,
			cost: {
				input: m.cost?.input ?? 0,
				output: m.cost?.output ?? 0,
				cacheRead: m.cost?.cacheRead ?? 0,
				cacheWrite: m.cost?.cacheWrite ?? 0,
			},
			compat: m.compat || {},
			thinkingLevelMap: m.thinkingLevelMap && typeof m.thinkingLevelMap === "object" ? m.thinkingLevelMap : {},
		}));
	}
	return p;
}

function serializeProvider(config: ProviderConfig): any {
	const result: any = {
		baseUrl: config.baseUrl,
		api: config.api,
		apiKey: config.apiKey,
		models: config.models.map((m) => {
			const out: any = {
				id: m.id,
				name: m.name || m.id,
				reasoning: m.reasoning,
				input: m.input,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			};
			if (m.api) out.api = m.api;
			if (m.cost.input || m.cost.output || m.cost.cacheRead || m.cost.cacheWrite) {
				out.cost = m.cost;
			}
			if (Object.keys(m.compat).length > 0) out.compat = m.compat;
			if (Object.keys(m.thinkingLevelMap).length > 0) out.thinkingLevelMap = m.thinkingLevelMap;
			return out;
		}),
	};
	if (Object.keys(config.headers).length > 0) result.headers = config.headers;
	if (config.authHeader) result.authHeader = true;
	if (Object.keys(config.compat).length > 0) result.compat = config.compat;
	return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline Input
// ═══════════════════════════════════════════════════════════════════════════════

interface Inp {
	text: string;
	cursor: number;
}

function inp(initial = ""): Inp {
	return { text: initial, cursor: initial.length };
}

function inpKey(i: Inp, data: string): boolean {
	if (matchesKey(data, Key.backspace)) {
		if (i.cursor > 0) {
			i.text = i.text.slice(0, i.cursor - 1) + i.text.slice(i.cursor);
			i.cursor--;
		}
		return true;
	}
	if (matchesKey(data, Key.delete)) {
		if (i.cursor < i.text.length) {
			i.text = i.text.slice(0, i.cursor) + i.text.slice(i.cursor + 1);
		}
		return true;
	}
	if (matchesKey(data, Key.left)) {
		i.cursor = Math.max(0, i.cursor - 1);
		return true;
	}
	if (matchesKey(data, Key.right)) {
		i.cursor = Math.min(i.text.length, i.cursor + 1);
		return true;
	}
	if (matchesKey(data, Key.home)) {
		i.cursor = 0;
		return true;
	}
	if (matchesKey(data, Key.end)) {
		i.cursor = i.text.length;
		return true;
	}
	// Handle bracketed paste: \x1b[200~ ... \x1b[201~
	if (data.startsWith("\x1b[200~")) {
		const content = data.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
		if (content.length > 0) {
			let insert = "";
			for (const ch of content) {
				if (ch.charCodeAt(0) >= 32 || ch === "\t") insert += ch;
			}
			if (insert.length > 0) {
				i.text = i.text.slice(0, i.cursor) + insert + i.text.slice(i.cursor);
				i.cursor += insert.length;
				return true;
			}
		}
		return false;
	}
	// Single char or paste (multi-char)
	if (data.length >= 1 && !data.startsWith("\x1b")) {
		let insert = "";
		for (const ch of data) {
			if (ch.charCodeAt(0) >= 32) insert += ch;
		}
		if (insert.length > 0) {
			i.text = i.text.slice(0, i.cursor) + insert + i.text.slice(i.cursor);
			i.cursor += insert.length;
			return true;
		}
	}
	return false;
}

function renderInp(i: Inp, active: boolean, cursorVisible: boolean, th: Theme, maxW: number, placeholder = ""): string {
	if (!active) {
		const style = i.text ? "text" : "dim";
		return truncateToWidth(th.fg(style, i.text || placeholder), maxW);
	}
	const txt = i.text;
	const before = txt.slice(0, i.cursor);
	const ch = i.cursor < txt.length ? txt[i.cursor]! : " ";
	const after = txt.slice(i.cursor + 1);
	const marker = cursorVisible ? CURSOR_MARKER : "";
	return truncateToWidth(`${before}${marker}\x1b[7m${ch}\x1b[27m${after}`, maxW);
}

function renderSecretInp(i: Inp, active: boolean, cursorVisible: boolean, th: Theme, maxW: number): string {
	const masked = { text: "•".repeat(i.text.length), cursor: i.cursor };
	return renderInp(masked, active, cursorVisible, th, maxW, i.text ? "" : "(not set)");
}

// Toggle display helper
function toggleStr(value: boolean, th: Theme): string {
	return value
		? th.fg("success", "● true") + th.fg("dim", " / false")
		: th.fg("dim", "true / ") + th.fg("error", "● false");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Entry
// ═══════════════════════════════════════════════════════════════════════════════

export default function providerManager(pi: ExtensionAPI) {
	let lang: Lang = loadLangPref() ?? detectLang();

	pi.registerCommand("provider", {
		description: "Manage custom providers and models",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("Provider manager requires interactive mode", "error");
				return;
			}

			let reopenMenu = true;
			while (reopenMenu) {
				reopenMenu = false;
				const t = LANGS[lang];

				// ── Provider select page ──────────────────────────────────────
				const modelsJson = loadModelsJson();
				const existing = Object.keys(modelsJson.providers || {});

				let action = await ctx.ui.custom<
					| "manage"
					| "new"
					| "import"
					| "lang"
					| "budgets"
					| { edit: string }
					| { copy: string }
					| { delete: string }
					| null
				>((tui, theme, _kb, done) => {
					const items: SelectItem[] = [
						{ value: "__manage__", label: t.managementActions, description: t.managementActionsDesc },
						...existing.map((name) => {
							const p = modelsJson.providers[name];
							const mc = Array.isArray(p.models) ? p.models.length : 0;
							return { value: name, label: name, description: `${p.api || "?"} • ${t.models(mc)}` };
						}),
					];

					const container = new Container();
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
					container.addChild(new Text(theme.fg("accent", theme.bold(` ${t.providerManager}`)), 0, 0));
					container.addChild(new Text("", 0, 0));

					const searchInput = new Input();
					const sl = new SelectList(
						items,
						Math.min(items.length, 10),
						{
							selectedPrefix: (x) => theme.fg("accent", x),
							selectedText: (x) => theme.fg("accent", x),
							description: (x) => theme.fg("muted", x),
							scrollInfo: (x) => theme.fg("dim", x),
							noMatch: (x) => theme.fg("warning", x),
						},
						{
							// Give long provider names room: default primary column is 32 cols
							minPrimaryColumnWidth: 24,
							maxPrimaryColumnWidth: 60,
						},
					);
					sl.onSelect = (item) => {
						if (item.value === "__manage__") done("manage");
						else done({ edit: item.value });
					};
					sl.onCancel = () => done(null);
					container.addChild(new Text(theme.fg("dim", ` ${t.providerSearchHint}`), 0, 0));
					container.addChild(searchInput);
					container.addChild(new Text("", 0, 0));
					container.addChild(sl);
					container.addChild(new Text("", 0, 0));
					container.addChild(new Text(theme.fg("dim", ` ${t.selectNav}`), 0, 0));
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

					let focused = false;
					return {
						get focused() {
							return focused;
						},
						set focused(value: boolean) {
							focused = value;
							searchInput.focused = value;
						},
						render: (w) => container.render(w),
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							if (data === "C") {
								const item = sl.getSelectedItem();
								if (item && !item.value.startsWith("__")) {
									done({ copy: item.value });
									return;
								}
							}
							if (matchesKey(data, Key.delete) || matchesKey(data, "ctrl+d")) {
								// Use the public API so this works even when the list is filtered
								const item = sl.getSelectedItem();
								if (item && !item.value.startsWith("__")) {
									done({ delete: item.value });
									return;
								}
							}
							if (
								matchesKey(data, Key.up) ||
								matchesKey(data, Key.down) ||
								matchesKey(data, Key.enter) ||
								matchesKey(data, Key.escape)
							) {
								sl.handleInput(data);
							} else {
								searchInput.handleInput(data);
								sl.setFilter(searchInput.getValue());
							}
							tui.requestRender();
						},
					};
				});

				if (action == null) return;
				if (action === "manage") {
					const picked = await ctx.ui.select(t.managementActions, [
						t.createNew,
						t.importProvider,
						t.budgetsMenu,
						`${t.langSelect} · ${lang === "en" ? "English" : "中文"}`,
					]);
					if (!picked) {
						reopenMenu = true;
						continue;
					}
					action =
						picked === t.createNew
							? "new"
							: picked === t.importProvider
								? "import"
								: picked === t.budgetsMenu
									? "budgets"
									: "lang";
				}

				// Language switch
				if (action === "lang") {
					const picked = await ctx.ui.select(t.langSelectTitle, ["English", "中文"]);
					if (picked === "English") lang = "en";
					else if (picked === "中文") lang = "zh";
					if (picked) saveLangPref(lang);
					reopenMenu = true;
					continue;
				}

				// Thinking budgets (global settings.json)
				if (action === "budgets") {
					const settings = loadSettingsJson();
					const budgets: Record<string, number> = { ...(settings.thinkingBudgets || {}) };
					const levels = ["minimal", "low", "medium", "high"] as const;
					let changed = false;
					for (const level of levels) {
						const cur = budgets[level] !== undefined ? String(budgets[level]) : "(default)";
						const raw = await ctx.ui.input(t.budgetsPrompt(level, cur), cur === "(default)" ? "e.g. 4096" : cur);
						if (raw === undefined) break; // Esc — stop asking, keep what we have so far
						const txt = raw.trim();
						if (!txt) continue; // empty = keep current
						const n = parseInt(txt, 10);
						if (Number.isNaN(n) || n < 0) continue;
						if (n === 0) {
							delete budgets[level];
							changed = true;
						} else {
							budgets[level] = n;
							changed = true;
						}
					}
					if (changed) {
						if (Object.keys(budgets).length > 0) settings.thinkingBudgets = budgets;
						else delete settings.thinkingBudgets;
						saveSettingsJson(settings);
						ctx.ui.notify(t.budgetsSaved, "info");
					}
					reopenMenu = true;
					continue;
				}

				// Delete
				if (typeof action === "object" && "delete" in action) {
					const name = action.delete;
					const ok = await ctx.ui.confirm(t.delProvider, t.confirmDeleteProvider(name));
					if (ok) {
						const d = loadModelsJson();
						delete d.providers[name];
						saveModelsJson(d);
						// Also remove from the live session so /model no longer lists it
						try {
							pi.unregisterProvider(name);
						} catch {
							/* ignore */
						}
						ctx.ui.notify(t.providerDeleted(name), "info");
					}
					reopenMenu = true;
					continue;
				}

				// Import JSON
				let imported: { name: string; config: ProviderConfig } | null = null;
				if (action === "import") {
					const pasted = await ctx.ui.editor(
						t.importTitle,
						'{\n  "baseUrl": "https://api.example.com/v1",\n  "api": "openai-completions",\n  "apiKey": "",\n  "models": []\n}',
					);
					if (pasted === undefined) {
						reopenMenu = true;
						continue;
					}
					try {
						const candidates = parseImportedProviders(JSON.parse(pasted));
						if (candidates.length === 1) imported = candidates[0];
						else if (candidates.length > 1) {
							const picked = await ctx.ui.select(
								t.importPick,
								candidates.map((x) => x.name),
							);
							imported = candidates.find((x) => x.name === picked) || null;
						}
					} catch {
						/* handled below */
					}
					if (!imported) {
						ctx.ui.notify(t.importInvalid, "error");
						reopenMenu = true;
						continue;
					}
				}

				// ── Open form ────────────────────────────────────────────────
				let provName = "";
				let config: ProviderConfig;
				const copyName = typeof action === "object" && "copy" in action ? action.copy : undefined;
				const editName = typeof action === "object" && "edit" in action ? action.edit : undefined;
				const isEdit = editName !== undefined;

				if (editName !== undefined) {
					provName = editName;
					config = parseProvider(modelsJson.providers[provName] || {});
				} else if (copyName !== undefined) {
					config = parseProvider(modelsJson.providers[copyName] || {});
					provName = t.copyProvider(copyName);
				} else if (imported) {
					config = imported.config;
					provName = imported.name;
				} else {
					config = defaultProvider();
				}

				const result = await ctx.ui.custom<{ name: string; config: ProviderConfig } | null>(
					(tui, theme, _kb, done) => new FormComponent(tui, theme, done, provName, config, isEdit, LANGS[lang]),
				);

				if (!result) {
					ctx.ui.notify(t.cancelled, "info");
					reopenMenu = true;
					continue;
				}

				if (!result.name.trim()) {
					ctx.ui.notify(t.nameRequired, "error");
					reopenMenu = true;
					continue;
				}
				if (!result.config.baseUrl.trim()) {
					ctx.ui.notify(t.baseUrlRequired, "error");
					reopenMenu = true;
					continue;
				}

				// Save
				const data = loadModelsJson();
				if (!data.providers) data.providers = {};
				if (isEdit && provName !== result.name) {
					delete data.providers[provName];
					// Remove the old name from the live session too
					try {
						pi.unregisterProvider(provName);
					} catch {
						/* ignore */
					}
				}
				data.providers[result.name] = serializeProvider(result.config);
				saveModelsJson(data);

				// Register in current session
				try {
					pi.registerProvider(result.name, {
						baseUrl: result.config.baseUrl,
						apiKey: result.config.apiKey,
						api: result.config.api as any,
						headers: result.config.headers,
						authHeader: result.config.authHeader,
						models: result.config.models.map((m) => ({
							id: m.id,
							name: m.name || m.id,
							...(m.api ? { api: m.api as any } : {}),
							reasoning: m.reasoning,
							...(Object.keys(m.thinkingLevelMap).length > 0
								? { thinkingLevelMap: m.thinkingLevelMap as any }
								: {}),
							input: m.input as ("text" | "image")[],
							cost: m.cost,
							contextWindow: m.contextWindow,
							maxTokens: m.maxTokens,
							...(Object.keys(m.compat).length > 0 ? { compat: m.compat as any } : {}),
						})),
					});
				} catch (e: any) {
					// models.json still works after restart even if live registration fails
					ctx.ui.notify(`Saved to models.json, but live registration failed: ${e?.message ?? e}`, "warning");
				}

				ctx.ui.notify(t.providerSaved(result.name, result.config.models.length), "info");
				reopenMenu = true; // back to the provider list with fresh data
			} // end while
		},
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Form Component
// ═══════════════════════════════════════════════════════════════════════════════

type Page = "main" | "connection" | "models" | "provider-advanced" | "model-edit" | "model-advanced";

type MainField = "connection" | "models" | "provAdvanced" | "confirm" | "cancel";

type ConnectionField =
	| "providerName"
	| "apiType"
	| "baseUrl"
	| "apiKey"
	| "headers"
	| "addPiHeaders"
	| "authHeader"
	| "back";

type ModelsField = "search" | "fetchModels" | "models" | "add" | "back";

type ModelField =
	| "id"
	| "name"
	| "api"
	| "reasoning"
	| "input"
	| "contextWindow"
	| "maxTokens"
	| "enrich"
	| "advanced"
	| "save"
	| "cancel";

type AdvField =
	| "costInput"
	| "costOutput"
	| "costCacheRead"
	| "costCacheWrite"
	| "thinkingMap"
	| "compatDeveloperRole"
	| "compatReasoningEffort"
	| "compatMaxTokensField"
	| "compatThinkingFormat"
	| "compatCacheControlFormat"
	| "back";

type ProvAdvField = "pDevRole" | "pReasonEff" | "pMaxTokensField" | "pThinkingFormat" | "pCacheControl" | "back";

class FormComponent implements Focusable {
	focused = false;

	private page: Page = "main";
	private th: Theme;
	private tui: { requestRender: () => void };
	private done: (r: { name: string; config: ProviderConfig } | null) => void;
	private isEdit: boolean;
	private t: I18n;
	private config: ProviderConfig;
	private busy = false;
	private fetchStatus = "";
	private fetchStatusError = false;
	private modelStatus = "";
	private modelStatusError = false;

	// ── Main fields ──
	private readonly mainFields: MainField[] = ["connection", "models", "provAdvanced", "confirm", "cancel"];
	private mainFocus = 0;
	private readonly connectionFields: ConnectionField[] = [
		"providerName",
		"apiType",
		"baseUrl",
		"apiKey",
		"headers",
		"addPiHeaders",
		"authHeader",
		"back",
	];
	private connectionFocus = 0;
	private readonly modelsFields: ModelsField[] = ["search", "fetchModels", "models", "add", "back"];
	private modelsFocus = 0;
	private modelSearch = inp();
	private modelBrowserIndex = 0;
	private fetchAbortController?: AbortController;
	private nameInp: Inp;
	private urlInp: Inp;
	private keyInp: Inp;
	private headersInp: Inp;
	private authHeaderVal: boolean;
	private apiIdx: number;

	// ── Model edit ──
	private readonly modelFields: ModelField[] = [
		"id",
		"name",
		"api",
		"reasoning",
		"input",
		"contextWindow",
		"maxTokens",
		"enrich",
		"advanced",
		"save",
		"cancel",
	];
	private meFocus = 0;
	private meIdx = -1; // editing index, -1=new
	private meId: Inp = inp();
	private meName: Inp = inp();
	private meApiIdx = 0; // index into MODEL_API_TYPES; 0 = inherit
	private meReasoning = false;
	private meInput: Inp = inp('["text"]');
	private meCtx: Inp = inp("1000000");
	private meMax: Inp = inp("32000");

	// ── Model advanced ──
	private readonly advFields: AdvField[] = [
		"costInput",
		"costOutput",
		"costCacheRead",
		"costCacheWrite",
		"thinkingMap",
		"compatDeveloperRole",
		"compatReasoningEffort",
		"compatMaxTokensField",
		"compatThinkingFormat",
		"compatCacheControlFormat",
		"back",
	];
	private advFocus = 0;
	private advCostIn: Inp = inp("0");
	private advCostOut: Inp = inp("0");
	private advCostCR: Inp = inp("0");
	private advCostCW: Inp = inp("0");
	private advThinkMap: Inp = inp("{}");
	private advDevRole = true;
	private advReasonEff = true;
	private advMaxTFIdx = 0;
	private advThinkFmtIdx = 0;
	private advCacheFmtIdx = 0;

	// ── Provider advanced (provider-wide compat) ──
	private readonly pAdvFields: ProvAdvField[] = [
		"pDevRole",
		"pReasonEff",
		"pMaxTokensField",
		"pThinkingFormat",
		"pCacheControl",
		"back",
	];
	private pAdvFocus = 0;
	private pDevRole = true;
	private pReasonEff = true;
	private pMaxTFIdx = 0;
	private pThinkFmtIdx = 0;
	private pCacheFmtIdx = 0;

	constructor(
		tui: { requestRender: () => void },
		theme: Theme,
		done: (r: { name: string; config: ProviderConfig } | null) => void,
		provName: string,
		config: ProviderConfig,
		isEdit: boolean,
		t: I18n,
	) {
		this.tui = tui;
		this.th = theme;
		this.done = done;
		this.isEdit = isEdit;
		this.t = t;
		this.config = {
			...config,
			compat: { ...(config.compat || {}) },
			models: config.models.map((m) => ({
				...m,
				cost: { ...m.cost },
				compat: { ...m.compat },
				thinkingLevelMap: { ...m.thinkingLevelMap },
			})),
		};
		this.nameInp = inp(provName);
		this.urlInp = inp(config.baseUrl);
		this.keyInp = inp(config.apiKey);
		this.headersInp = inp(Object.keys(config.headers).length > 0 ? JSON.stringify(config.headers) : "{}");
		this.authHeaderVal = config.authHeader;
		this.apiIdx = Math.max(0, API_TYPES.indexOf(config.api));
	}

	private refresh() {
		this.tui.requestRender();
	}

	// ═════════════════════════════════════════════════════════════════════════
	// Input dispatch
	// ═════════════════════════════════════════════════════════════════════════

	handleInput(data: string): void {
		if (this.busy) {
			if (matchesKey(data, Key.escape)) {
				this.fetchAbortController?.abort();
				this.setFetchStatus(this.t.fetchCancelled);
			}
			return;
		}
		if (this.page === "main") this.handleMain(data);
		else if (this.page === "connection") this.handleConnection(data);
		else if (this.page === "models") this.handleModels(data);
		else if (this.page === "provider-advanced") this.handleProvAdvanced(data);
		else if (this.page === "model-edit") this.handleModelEdit(data);
		else if (this.page === "model-advanced") this.handleAdvanced(data);
		this.refresh();
	}

	// ── Main ─────────────────────────────────────────────────────────────

	private handleMain(data: string): void {
		const f = this.mainFields[this.mainFocus];
		if (matchesKey(data, Key.escape)) {
			this.done(null);
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.mainFocus = Math.max(0, this.mainFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.mainFocus = Math.min(this.mainFields.length - 1, this.mainFocus + 1);
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		if (f === "connection") {
			this.connectionFocus = 0;
			this.page = "connection";
		} else if (f === "models") {
			this.modelsFocus = 0;
			this.clampModelBrowserIndex();
			this.page = "models";
		} else if (f === "provAdvanced") {
			this.openProvAdvanced();
		} else if (f === "confirm") {
			this.submit();
		} else {
			this.done(null);
		}
	}

	private handleConnection(data: string): void {
		const f = this.connectionFields[this.connectionFocus];
		if (matchesKey(data, Key.escape)) {
			this.page = "main";
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.connectionFocus = Math.max(0, this.connectionFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.connectionFocus = Math.min(this.connectionFields.length - 1, this.connectionFocus + 1);
			return;
		}
		switch (f) {
			case "providerName":
				inpKey(this.nameInp, data);
				break;
			case "apiType":
				if (matchesKey(data, Key.left)) this.apiIdx = (this.apiIdx - 1 + API_TYPES.length) % API_TYPES.length;
				else if (matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.apiIdx = (this.apiIdx + 1) % API_TYPES.length;
				break;
			case "baseUrl":
				inpKey(this.urlInp, data);
				break;
			case "apiKey":
				inpKey(this.keyInp, data);
				break;
			case "headers":
				inpKey(this.headersInp, data);
				break;
			case "addPiHeaders":
				if (matchesKey(data, Key.enter)) this.addPiAgentHeaders();
				break;
			case "authHeader":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.authHeaderVal = !this.authHeaderVal;
				break;
			case "back":
				if (matchesKey(data, Key.enter)) this.page = "main";
				break;
		}
	}

	private filteredModels(): ModelConfig[] {
		const query = this.modelSearch.text.trim().toLowerCase();
		if (!query) return this.config.models;
		return this.config.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query));
	}

	private clampModelBrowserIndex(): void {
		this.modelBrowserIndex = Math.min(this.modelBrowserIndex, Math.max(0, this.filteredModels().length - 1));
	}

	private handleModels(data: string): void {
		const f = this.modelsFields[this.modelsFocus];
		if (matchesKey(data, Key.escape)) {
			this.page = "main";
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.modelsFocus = Math.max(0, this.modelsFocus - 1);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.modelsFocus = Math.min(this.modelsFields.length - 1, this.modelsFocus + 1);
			return;
		}
		if (f === "models") {
			const models = this.filteredModels();
			if (matchesKey(data, Key.up)) {
				if (models.length === 0 || this.modelBrowserIndex === 0)
					this.modelsFocus = Math.max(0, this.modelsFocus - 1);
				else this.modelBrowserIndex--;
			} else if (matchesKey(data, Key.down)) {
				if (models.length === 0 || this.modelBrowserIndex >= models.length - 1)
					this.modelsFocus = Math.min(this.modelsFields.length - 1, this.modelsFocus + 1);
				else this.modelBrowserIndex++;
			} else if (matchesKey(data, Key.pageUp)) this.modelBrowserIndex = Math.max(0, this.modelBrowserIndex - 10);
			else if (matchesKey(data, Key.pageDown))
				this.modelBrowserIndex = Math.min(models.length - 1, this.modelBrowserIndex + 10);
			else if (matchesKey(data, Key.enter) && models[this.modelBrowserIndex]) {
				this.openModelEdit(this.config.models.indexOf(models[this.modelBrowserIndex]));
			} else if ((matchesKey(data, Key.delete) || matchesKey(data, "ctrl+d")) && models[this.modelBrowserIndex]) {
				this.config.models.splice(this.config.models.indexOf(models[this.modelBrowserIndex]), 1);
				this.clampModelBrowserIndex();
			}
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.modelsFocus = Math.max(0, this.modelsFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.modelsFocus = Math.min(this.modelsFields.length - 1, this.modelsFocus + 1);
			return;
		}
		if (f === "search") {
			if (matchesKey(data, Key.enter)) this.modelsFocus = this.modelsFields.indexOf("models");
			else {
				inpKey(this.modelSearch, data);
				this.modelBrowserIndex = 0;
			}
		} else if (f === "fetchModels" && matchesKey(data, Key.enter)) {
			this.startFetchModels();
		} else if (f === "add" && matchesKey(data, Key.enter)) {
			this.openModelEdit(-1);
		} else if (f === "back" && matchesKey(data, Key.enter)) {
			this.page = "main";
		}
	}

	// ── Model Edit ───────────────────────────────────────────────────────

	private handleModelEdit(data: string): void {
		const f = this.modelFields[this.meFocus];
		if (matchesKey(data, Key.escape)) {
			this.page = "models";
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.meFocus = Math.max(0, this.meFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.meFocus = Math.min(this.modelFields.length - 1, this.meFocus + 1);
			return;
		}

		switch (f) {
			case "id":
				inpKey(this.meId, data);
				break;
			case "name":
				inpKey(this.meName, data);
				break;
			case "api":
				if (matchesKey(data, Key.left))
					this.meApiIdx = (this.meApiIdx - 1 + MODEL_API_TYPES.length) % MODEL_API_TYPES.length;
				else if (matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.meApiIdx = (this.meApiIdx + 1) % MODEL_API_TYPES.length;
				break;
			case "reasoning":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.meReasoning = !this.meReasoning;
				break;
			case "input":
				inpKey(this.meInput, data);
				break;
			case "contextWindow":
				inpKey(this.meCtx, data);
				break;
			case "maxTokens":
				inpKey(this.meMax, data);
				break;
			case "enrich":
				if (matchesKey(data, Key.enter)) this.enrichCurrentModel();
				break;
			case "advanced":
				if (matchesKey(data, Key.enter)) this.openAdvanced();
				break;
			case "save":
				if (matchesKey(data, Key.enter)) this.saveModel();
				break;
			case "cancel":
				if (matchesKey(data, Key.enter)) {
					this.page = "models";
				}
				break;
		}
	}

	// ── Advanced ─────────────────────────────────────────────────────────

	private handleAdvanced(data: string): void {
		const f = this.advFields[this.advFocus];
		if (matchesKey(data, Key.escape)) {
			this.saveAdvanced();
			this.page = "model-edit";
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.advFocus = Math.max(0, this.advFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.advFocus = Math.min(this.advFields.length - 1, this.advFocus + 1);
			return;
		}

		switch (f) {
			case "costInput":
				inpKey(this.advCostIn, data);
				break;
			case "costOutput":
				inpKey(this.advCostOut, data);
				break;
			case "costCacheRead":
				inpKey(this.advCostCR, data);
				break;
			case "costCacheWrite":
				inpKey(this.advCostCW, data);
				break;
			case "thinkingMap":
				inpKey(this.advThinkMap, data);
				break;
			case "compatDeveloperRole":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.advDevRole = !this.advDevRole;
				break;
			case "compatReasoningEffort":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.advReasonEff = !this.advReasonEff;
				break;
			case "compatMaxTokensField":
				if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.advMaxTFIdx = (this.advMaxTFIdx + 1) % COMPAT_MAX_TOKENS_FIELDS.length;
				break;
			case "compatThinkingFormat":
				if (matchesKey(data, Key.left))
					this.advThinkFmtIdx =
						(this.advThinkFmtIdx - 1 + COMPAT_THINKING_FORMATS.length) % COMPAT_THINKING_FORMATS.length;
				else if (matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.advThinkFmtIdx = (this.advThinkFmtIdx + 1) % COMPAT_THINKING_FORMATS.length;
				break;
			case "compatCacheControlFormat":
				if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.advCacheFmtIdx = (this.advCacheFmtIdx + 1) % COMPAT_CACHE_FORMATS.length;
				break;
			case "back":
				if (matchesKey(data, Key.enter)) {
					this.saveAdvanced();
					this.page = "model-edit";
				}
				break;
		}
	}

	// ── Provider Advanced ─────────────────────────────────────────────

	private handleProvAdvanced(data: string): void {
		const f = this.pAdvFields[this.pAdvFocus];
		if (matchesKey(data, Key.escape)) {
			this.saveProvAdvanced();
			this.page = "main";
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.pAdvFocus = Math.max(0, this.pAdvFocus - 1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.pAdvFocus = Math.min(this.pAdvFields.length - 1, this.pAdvFocus + 1);
			return;
		}

		switch (f) {
			case "pDevRole":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.pDevRole = !this.pDevRole;
				break;
			case "pReasonEff":
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
					this.pReasonEff = !this.pReasonEff;
				break;
			case "pMaxTokensField":
				if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.pMaxTFIdx = (this.pMaxTFIdx + 1) % COMPAT_MAX_TOKENS_FIELDS.length;
				break;
			case "pThinkingFormat":
				if (matchesKey(data, Key.left))
					this.pThinkFmtIdx =
						(this.pThinkFmtIdx - 1 + COMPAT_THINKING_FORMATS.length) % COMPAT_THINKING_FORMATS.length;
				else if (matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.pThinkFmtIdx = (this.pThinkFmtIdx + 1) % COMPAT_THINKING_FORMATS.length;
				break;
			case "pCacheControl":
				if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.enter))
					this.pCacheFmtIdx = (this.pCacheFmtIdx + 1) % COMPAT_CACHE_FORMATS.length;
				break;
			case "back":
				if (matchesKey(data, Key.enter)) {
					this.saveProvAdvanced();
					this.page = "main";
				}
				break;
		}
	}

	private setFetchStatus(message: string, isError = false): void {
		this.fetchStatus = message.replace(/\s+/g, " ").trim();
		this.fetchStatusError = isError;
		this.refresh();
	}

	private setModelStatus(message: string, isError = false): void {
		this.modelStatus = message.replace(/\s+/g, " ").trim();
		this.modelStatusError = isError;
		this.refresh();
	}

	private addPiAgentHeaders(): void {
		let headers: Record<string, string> = {};
		try {
			const parsed = JSON.parse(this.headersInp.text || "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) headers = parsed;
		} catch {
			this.setFetchStatus(this.t.fetchModelsError("Headers must be valid JSON"), true);
			return;
		}
		const preset: Record<string, string> = {
			"HTTP-Referer": "https://pi.dev",
			"X-Title": "pi",
			"X-OpenRouter-Title": "pi",
			"X-OpenRouter-Categories": "cli-agent",
			"User-Agent": "pi-agent",
		};
		for (const [key, value] of Object.entries(preset)) {
			if (!Object.keys(headers).some((existing) => existing.toLowerCase() === key.toLowerCase()))
				headers[key] = value;
		}
		this.headersInp = inp(JSON.stringify(headers));
		this.setFetchStatus(this.t.piHeadersAdded);
	}

	private startFetchModels(): void {
		if (this.busy) return;
		this.busy = true;
		this.fetchAbortController = new AbortController();
		this.setFetchStatus(this.t.fetchingModels);
		// Keep all async failures inside the component. Never leave a rejected
		// promise attached to the TUI input dispatcher, which can stall Pi's UI.
		void this.fetchModelsFromApi(this.fetchAbortController.signal)
			.catch((error: any) => {
				this.setFetchStatus(
					error?.name === "AbortError"
						? this.t.fetchCancelled
						: this.t.fetchModelsError(String(error?.message || error)),
					error?.name !== "AbortError",
				);
			})
			.finally(() => {
				this.busy = false;
				this.fetchAbortController = undefined;
				this.refresh();
			});
	}

	private async fetchModelsFromApi(signal: AbortSignal): Promise<void> {
		const baseUrl = this.urlInp.text.trim();
		if (!baseUrl) {
			this.setFetchStatus(this.t.baseUrlRequired, true);
			return;
		}
		let headers: Record<string, string> = {};
		try {
			const parsed = JSON.parse(this.headersInp.text || "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) headers = parsed;
		} catch {
			this.setFetchStatus(this.t.fetchModelsError("Headers must be valid JSON"), true);
			return;
		}
		this.setFetchStatus(this.t.fetchingModels);
		try {
			const discovery = await discoverModels(
				{
					baseUrl,
					api: API_TYPES[this.apiIdx],
					apiKey: this.keyInp.text.trim(),
					headers,
					authHeader: this.authHeaderVal,
				},
				signal,
			);
			const found = discovery.models;
			if (API_TYPES[this.apiIdx] === "google-generative-ai" && !hasVersionedApiPath(baseUrl)) {
				this.urlInp = inp(discovery.baseUrl);
			}
			let added = 0;
			let updated = 0;
			for (const meta of found) {
				const index = this.config.models.findIndex((m) => m.id.toLowerCase() === meta.id.toLowerCase());
				if (index >= 0) {
					const current = this.config.models[index];
					const enriched = enrichModel(current, meta).model;
					// Model discovery must not infer a protocol override from Pi's global
					// catalog. Preserve an existing explicit override; otherwise inherit
					// this provider's API.
					enriched.api = current.api;
					if (JSON.stringify(enriched) !== JSON.stringify(current)) updated++;
					this.config.models[index] = enriched;
				} else {
					const seed = { ...defaultModel(), id: meta.id, name: meta.name || meta.id };
					const enriched = enrichModel(seed, meta).model;
					enriched.api = "";
					this.config.models.push(enriched);
					added++;
				}
			}
			const rich = found.filter((model) => model.rich).length;
			this.setFetchStatus(this.t.fetchModelsDone(added, updated, found.length, rich, found.length - rich));
		} catch (error: any) {
			if (error?.name === "AbortError") {
				this.setFetchStatus(this.t.fetchCancelled);
				return;
			}
			const message = error?.message === "UNSUPPORTED" ? this.t.fetchUnsupported : String(error?.message || error);
			this.setFetchStatus(this.t.fetchModelsError(message), true);
		}
	}

	private enrichCurrentModel(): void {
		const id = this.meId.text.trim();
		if (!id) return;
		let input: string[] = ["text"];
		try {
			const parsed = JSON.parse(this.meInput.text);
			if (Array.isArray(parsed)) input = parsed.map(String);
		} catch {
			/* use default */
		}
		const current: ModelConfig = {
			id,
			name: this.meName.text.trim() || id,
			api: MODEL_API_TYPES[this.meApiIdx] || "",
			reasoning: this.meReasoning,
			input,
			contextWindow: parseInt(this.meCtx.text, 10) || 1000000,
			maxTokens: parseInt(this.meMax.text, 10) || 32000,
			cost: this.meIdx >= 0 ? { ...this.config.models[this.meIdx].cost } : this._pendingCost || defaultModel().cost,
			compat: this.meIdx >= 0 ? { ...this.config.models[this.meIdx].compat } : this._pendingCompat || {},
			thinkingLevelMap:
				this.meIdx >= 0 ? { ...this.config.models[this.meIdx].thinkingLevelMap } : this._pendingThinkMap || {},
		};
		const result = enrichModel(current);
		if (!result.matched) {
			this.setModelStatus(this.t.modelEnrichMiss, true);
			return;
		}
		const model = result.model;
		this.meName = inp(model.name);
		this.meApiIdx = Math.max(0, MODEL_API_TYPES.indexOf(model.api || ""));
		this.meReasoning = model.reasoning;
		this.meInput = inp(JSON.stringify(model.input));
		this.meCtx = inp(String(model.contextWindow));
		this.meMax = inp(String(model.maxTokens));
		this._pendingCost = { ...model.cost };
		this.setModelStatus(this.t.modelEnrichDone);
	}

	private openProvAdvanced(): void {
		this.pAdvFocus = 0;
		const c = this.config.compat || {};
		this.pDevRole = c.supportsDeveloperRole !== false;
		this.pReasonEff = c.supportsReasoningEffort !== false;
		this.pMaxTFIdx = c.maxTokensField === "max_tokens" ? 1 : 0;
		this.pThinkFmtIdx = Math.max(0, COMPAT_THINKING_FORMATS.indexOf(c.thinkingFormat || "(none)"));
		this.pCacheFmtIdx = Math.max(0, COMPAT_CACHE_FORMATS.indexOf(c.cacheControlFormat || "(none)"));
		this.page = "provider-advanced";
	}

	private saveProvAdvanced(): void {
		const compat: Record<string, any> = {};
		if (!this.pDevRole) compat.supportsDeveloperRole = false;
		if (!this.pReasonEff) compat.supportsReasoningEffort = false;
		if (this.pMaxTFIdx === 1) compat.maxTokensField = "max_tokens";
		const tf = COMPAT_THINKING_FORMATS[this.pThinkFmtIdx];
		if (tf && tf !== "(none)") compat.thinkingFormat = tf;
		const cf = COMPAT_CACHE_FORMATS[this.pCacheFmtIdx];
		if (cf && cf !== "(none)") compat.cacheControlFormat = cf;
		this.config.compat = compat;
	}

	// ═════════════════════════════════════════════════════════════════════════
	// Model / Advanced helpers
	// ═════════════════════════════════════════════════════════════════════════

	private openModelEdit(idx: number): void {
		this.meIdx = idx;
		this.meFocus = 0;
		this.modelStatus = "";
		this.modelStatusError = false;
		this._pendingCost = undefined;
		this._pendingCompat = undefined;
		if (idx >= 0 && idx < this.config.models.length) {
			const m = this.config.models[idx];
			this.meId = inp(m.id);
			this.meName = inp(m.name);
			this.meApiIdx = Math.max(0, MODEL_API_TYPES.indexOf(m.api || ""));
			this.meReasoning = m.reasoning;
			this.meInput = inp(JSON.stringify(m.input));
			this.meCtx = inp(String(m.contextWindow));
			this.meMax = inp(String(m.maxTokens));
		} else {
			this.meId = inp();
			this.meName = inp();
			this.meApiIdx = 0;
			this.meReasoning = false;
			this.meInput = inp('["text"]');
			this.meCtx = inp("1000000");
			this.meMax = inp("32000");
		}
		this.page = "model-edit";
	}

	private saveModel(): void {
		const id = this.meId.text.trim();
		if (!id) return;

		let inputArr: string[];
		try {
			const p = JSON.parse(this.meInput.text);
			inputArr = Array.isArray(p) ? p : ["text"];
		} catch {
			inputArr = ["text"];
		}

		const model: ModelConfig = {
			id,
			name: this.meName.text.trim() || id,
			api: MODEL_API_TYPES[this.meApiIdx] || "",
			reasoning: this.meReasoning,
			input: inputArr,
			contextWindow: parseInt(this.meCtx.text, 10) || 1000000,
			maxTokens: parseInt(this.meMax.text, 10) || 32000,
			cost:
				this.meIdx >= 0
					? { ...this.config.models[this.meIdx].cost }
					: this._pendingCost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: this.meIdx >= 0 ? { ...this.config.models[this.meIdx].compat } : this._pendingCompat || {},
			thinkingLevelMap:
				this.meIdx >= 0 ? { ...this.config.models[this.meIdx].thinkingLevelMap } : this._pendingThinkMap || {},
		};
		this._pendingCost = undefined;
		this._pendingCompat = undefined;
		this._pendingThinkMap = undefined;

		if (this.meIdx >= 0) this.config.models[this.meIdx] = model;
		else this.config.models.push(model);

		this.page = "models";
		this.clampModelBrowserIndex();
	}

	private openAdvanced(): void {
		this.advFocus = 0;
		// Load from current editing model; for a new model, prefer pending values
		// from a previous visit to this page (so reopening doesn't lose edits)
		const m = this.meIdx >= 0 ? this.config.models[this.meIdx] : null;
		const cost = m?.cost || this._pendingCost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		this.advCostIn = inp(String(cost.input));
		this.advCostOut = inp(String(cost.output));
		this.advCostCR = inp(String(cost.cacheRead));
		this.advCostCW = inp(String(cost.cacheWrite));

		const c = m?.compat || this._pendingCompat || {};
		this.advDevRole = c.supportsDeveloperRole !== false;
		this.advReasonEff = c.supportsReasoningEffort !== false;
		this.advMaxTFIdx = c.maxTokensField === "max_tokens" ? 1 : 0;
		this.advThinkFmtIdx = Math.max(0, COMPAT_THINKING_FORMATS.indexOf(c.thinkingFormat || "(none)"));
		this.advCacheFmtIdx = Math.max(0, COMPAT_CACHE_FORMATS.indexOf(c.cacheControlFormat || "(none)"));

		const tm = m?.thinkingLevelMap || this._pendingThinkMap || {};
		this.advThinkMap = inp(Object.keys(tm).length > 0 ? JSON.stringify(tm) : "{}");

		this.page = "model-advanced";
	}

	private saveAdvanced(): void {
		const cost = {
			input: parseFloat(this.advCostIn.text) || 0,
			output: parseFloat(this.advCostOut.text) || 0,
			cacheRead: parseFloat(this.advCostCR.text) || 0,
			cacheWrite: parseFloat(this.advCostCW.text) || 0,
		};

		const compat: Record<string, any> = {};
		if (!this.advDevRole) compat.supportsDeveloperRole = false;
		if (!this.advReasonEff) compat.supportsReasoningEffort = false;
		if (this.advMaxTFIdx === 1) compat.maxTokensField = "max_tokens";
		const tf = COMPAT_THINKING_FORMATS[this.advThinkFmtIdx];
		if (tf && tf !== "(none)") compat.thinkingFormat = tf;
		const cf = COMPAT_CACHE_FORMATS[this.advCacheFmtIdx];
		if (cf && cf !== "(none)") compat.cacheControlFormat = cf;

		// Parse thinking level map; keep only valid pi levels with string|null values
		let thinkMap: Record<string, string | null> = {};
		try {
			const parsed = JSON.parse(this.advThinkMap.text || "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
				for (const [k, v] of Object.entries(parsed)) {
					if (validLevels.includes(k) && (typeof v === "string" || v === null)) thinkMap[k] = v as string | null;
				}
			}
		} catch {
			thinkMap = {};
		}

		// Apply to current editing model (save in-memory; will be committed when model is saved)
		if (this.meIdx >= 0 && this.meIdx < this.config.models.length) {
			this.config.models[this.meIdx].cost = cost;
			this.config.models[this.meIdx].compat = compat;
			this.config.models[this.meIdx].thinkingLevelMap = thinkMap;
		} else {
			// New model — store temporarily so saveModel() can pick it up
			this._pendingCost = cost;
			this._pendingCompat = compat;
			this._pendingThinkMap = thinkMap;
		}
	}
	private _pendingCost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	private _pendingCompat?: Record<string, any>;
	private _pendingThinkMap?: Record<string, string | null>;

	private submit(): void {
		this.config.baseUrl = this.urlInp.text.trim();
		this.config.api = API_TYPES[this.apiIdx];
		this.config.apiKey = this.keyInp.text.trim();
		try {
			this.config.headers = JSON.parse(this.headersInp.text);
		} catch {
			this.config.headers = {};
		}
		this.config.authHeader = this.authHeaderVal;
		this.done({ name: this.nameInp.text.trim(), config: this.config });
	}

	// ═════════════════════════════════════════════════════════════════════════
	// Rendering
	// ═════════════════════════════════════════════════════════════════════════

	render(width: number): string[] {
		if (this.page === "main") return this.renderOverview(width);
		if (this.page === "connection") return this.renderConnection(width);
		if (this.page === "models") return this.renderModels(width);
		if (this.page === "provider-advanced") return this.renderProvAdvanced(width);
		if (this.page === "model-edit") return this.renderModelEdit(width);
		if (this.page === "model-advanced") return this.renderAdvanced(width);
		return [];
	}

	invalidate(): void {}

	// ── Render helpers ───────────────────────────────────────────────────

	private hr(lines: string[], w: number) {
		lines.push(this.th.fg("accent", "─".repeat(w)));
	}

	private row(
		lines: string[],
		w: number,
		label: string,
		fieldName: string,
		currentField: string,
		content: string,
		padLen = 14,
	) {
		const active = fieldName === currentField;
		const pfx = active ? this.th.fg("accent", " ▶ ") : "   ";
		const lbl = active ? this.th.fg("accent", label.padEnd(padLen)) : this.th.fg("text", label.padEnd(padLen));
		lines.push(truncateToWidth(pfx + lbl + content, w));
	}

	private btn(label: string, active: boolean, color: "success" | "error" | "accent" | "muted"): string {
		return active ? this.th.bg("selectedBg", this.th.fg(color, ` ${label} `)) : this.th.fg(color, ` ${label} `);
	}

	/** Carousel display: ◀ value ▶ (i/n) — always fits, unlike joining all options */
	private carousel(options: string[], idx: number, active: boolean, emptyLabel = ""): string {
		const th = this.th;
		const val = options[idx] || "";
		const disp = val === "" ? emptyLabel : val;
		const pos = th.fg("dim", ` (${idx + 1}/${options.length})`);
		if (active)
			return th.fg("dim", "◀ ") + th.bg("selectedBg", th.fg("accent", ` ${disp} `)) + th.fg("dim", " ▶") + pos;
		return th.fg("text", disp) + pos;
	}

	// ── Compact provider overview ─────────────────────────────────────────

	private renderOverview(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.mainFields[this.mainFocus];
		const modelCount = this.config.models.length;
		const compatCount = Object.keys(this.config.compat || {}).length;

		this.hr(lines, w);
		lines.push(th.fg("accent", th.bold(` ${this.isEdit ? t.editProvider : t.newProvider}`)));
		lines.push(
			th.fg("muted", ` ${this.nameInp.text || "(unnamed)"} · ${API_TYPES[this.apiIdx]} · ${t.models(modelCount)}`),
		);
		lines.push("");
		this.row(lines, w, t.connectionSettings, "connection", cf, th.fg("muted", t.connectionSettingsDesc), 26);
		this.row(lines, w, t.modelsSettings, "models", cf, th.fg("muted", `${t.modelsSettingsDesc} · ${modelCount}`), 26);
		this.row(
			lines,
			w,
			t.provAdvanced,
			"provAdvanced",
			cf,
			th.fg("muted", `${t.provCompatHint} · ${compatCount}`),
			26,
		);
		lines.push("");
		this.row(lines, w, t.btnSave, "confirm", cf, th.fg("muted", t.models(modelCount)), 26);
		this.row(lines, w, t.btnCancel, "cancel", cf, "", 26);
		lines.push("");
		lines.push(th.fg("dim", ` ${t.mainNav}`));
		this.hr(lines, w);
		return lines.map((line) => truncateToWidth(line, w));
	}

	private renderConnection(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.connectionFields[this.connectionFocus];
		const pad = 20;

		this.hr(lines, w);
		lines.push(th.fg("accent", th.bold(` ${t.connectionSettings}`)));
		lines.push("");
		this.row(
			lines,
			w,
			t.fieldName,
			"providerName",
			cf,
			renderInp(this.nameInp, cf === "providerName", this.focused, th, w - pad - 5, "my-provider"),
			pad,
		);
		this.row(lines, w, t.fieldApiType, "apiType", cf, this.carousel(API_TYPES, this.apiIdx, cf === "apiType"), pad);
		this.row(
			lines,
			w,
			t.fieldBaseUrl,
			"baseUrl",
			cf,
			renderInp(this.urlInp, cf === "baseUrl", this.focused, th, w - pad - 5, "https://api.example.com/v1"),
			pad,
		);
		if (cf === "baseUrl") lines.push(th.fg("dim", `     ${t.baseUrlHint}`));
		this.row(
			lines,
			w,
			t.fieldApiKey,
			"apiKey",
			cf,
			renderSecretInp(this.keyInp, cf === "apiKey", this.focused, th, w - pad - 5),
			pad,
		);
		this.row(
			lines,
			w,
			t.fieldHeaders,
			"headers",
			cf,
			renderInp(this.headersInp, cf === "headers", this.focused, th, w - pad - 5, '{"Key":"Value"}'),
			pad,
		);
		this.row(
			lines,
			w,
			t.addPiHeaders,
			"addPiHeaders",
			cf,
			cf === "addPiHeaders" ? th.fg("dim", t.addPiHeadersHint) : "",
			pad,
		);
		this.row(lines, w, t.fieldAuthHeader, "authHeader", cf, toggleStr(this.authHeaderVal, th), pad);
		lines.push("");
		this.row(lines, w, t.backToOverview, "back", cf, "", pad);
		lines.push("");
		lines.push(th.fg("dim", ` ${t.mainNav} · ${t.switchHint}`));
		this.hr(lines, w);
		return lines.map((line) => truncateToWidth(line, w));
	}

	private renderModels(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.modelsFields[this.modelsFocus];
		const models = this.filteredModels();
		this.clampModelBrowserIndex();
		const selected = models[this.modelBrowserIndex];

		this.hr(lines, w);
		lines.push(
			th.fg("accent", th.bold(` ${t.modelsSettings}`)) +
				th.fg("muted", ` · ${models.length}/${this.config.models.length}`),
		);
		this.row(
			lines,
			w,
			"Search:",
			"search",
			cf,
			renderInp(this.modelSearch, cf === "search", this.focused, th, w - 18, t.modelSearchHint),
			14,
		);
		this.row(
			lines,
			w,
			this.busy ? t.fetchingModels : t.fetchModels,
			"fetchModels",
			cf,
			cf === "fetchModels" ? th.fg("dim", t.fetchModelsHint) : "",
			28,
		);
		if (this.fetchStatus) lines.push(th.fg(this.fetchStatusError ? "error" : "success", `   ${this.fetchStatus}`));
		lines.push("");

		const maxVisible = 5;
		const startIndex = Math.max(
			0,
			Math.min(this.modelBrowserIndex - Math.floor(maxVisible / 2), models.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, models.length);
		if (models.length === 0) {
			lines.push(th.fg("muted", `   ${t.noModels}`));
		} else {
			for (let i = startIndex; i < endIndex; i++) {
				const model = models[i]!;
				const active = cf === "models" && i === this.modelBrowserIndex;
				const prefix = active ? th.fg("accent", " › ") : "   ";
				const name = model.name && model.name !== model.id ? th.fg("muted", ` · ${model.name}`) : "";
				const badges = `${model.reasoning ? " ✦" : ""}${model.input.includes("image") ? " ▣" : ""}`;
				lines.push(
					truncateToWidth(
						`${prefix}${th.fg(active ? "accent" : "text", model.id)}${name}${th.fg("success", badges)}`,
						w,
					),
				);
			}
			lines.push(
				th.fg(
					"dim",
					`   ${t.modelPosition(this.modelBrowserIndex + 1, models.length)} · ${t.enterToOpen} · ${t.delToRemove}`,
				),
			);
		}

		if (selected) {
			lines.push(
				th.fg("accent", ` ${t.modelDetails}: `) +
					th.fg("text", selected.name || selected.id) +
					th.fg("muted", ` · ${selected.api || API_TYPES[this.apiIdx]} · ${selected.input.join("+")}`),
			);
			const cost = selected.cost;
			lines.push(
				th.fg(
					"dim",
					`   context ${selected.contextWindow} · max ${selected.maxTokens} · $/M in ${cost.input} out ${cost.output} cache ${cost.cacheRead}/${cost.cacheWrite}`,
				),
			);
		}
		lines.push("");
		this.row(lines, w, t.addNewModel, "add", cf, "", 28);
		this.row(lines, w, t.backToOverview, "back", cf, "", 28);
		lines.push(th.fg("dim", ` ${t.mainNav} · PgUp/PgDn`));
		this.hr(lines, w);
		return lines.map((line) => truncateToWidth(line, w));
	}

	// ── Model Edit ───────────────────────────────────────────────────────

	private renderModelEdit(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.modelFields[this.meFocus];
		const pad = 18;

		this.hr(lines, w);
		lines.push(th.fg("accent", th.bold(` ${this.meIdx >= 0 ? t.editModel : t.addModel}`)));
		lines.push("");

		this.row(
			lines,
			w,
			t.modelId,
			"id",
			cf,
			renderInp(this.meId, cf === "id", this.focused, th, w - pad - 6, "model-id"),
			pad,
		);
		this.row(
			lines,
			w,
			t.modelName,
			"name",
			cf,
			renderInp(this.meName, cf === "name", this.focused, th, w - pad - 6, t.defaultsToId),
			pad,
		);
		this.row(
			lines,
			w,
			t.modelApi,
			"api",
			cf,
			this.carousel(MODEL_API_TYPES, this.meApiIdx, cf === "api", t.inherit),
			pad,
		);
		this.row(lines, w, t.modelReasoning, "reasoning", cf, toggleStr(this.meReasoning, th), pad);
		this.row(
			lines,
			w,
			t.modelInput,
			"input",
			cf,
			renderInp(this.meInput, cf === "input", this.focused, th, w - pad - 6, '["text"]'),
			pad,
		);
		this.row(
			lines,
			w,
			t.modelContextWindow,
			"contextWindow",
			cf,
			renderInp(this.meCtx, cf === "contextWindow", this.focused, th, w - pad - 6, "1000000"),
			pad,
		);
		this.row(
			lines,
			w,
			t.modelMaxTokens,
			"maxTokens",
			cf,
			renderInp(this.meMax, cf === "maxTokens", this.focused, th, w - pad - 6, "32000"),
			pad,
		);

		lines.push("");
		// Metadata enrichment button
		const enrichActive = cf === "enrich";
		const enrichPfx = enrichActive ? th.fg("accent", " ▶ ") : "   ";
		lines.push(enrichPfx + th.fg(enrichActive ? "accent" : "text", t.modelEnrich));
		if (this.modelStatus) lines.push(`     ${th.fg(this.modelStatusError ? "error" : "success", this.modelStatus)}`);

		// Advanced button
		const advActive = cf === "advanced";
		const advPfx = advActive ? th.fg("accent", " ▶ ") : "   ";
		const advLbl = advActive ? th.fg("accent", t.modelAdvanced) : th.fg("text", t.modelAdvanced);
		lines.push(`${advPfx + advLbl} ${th.fg("dim", t.enterToOpen)}`);
		lines.push("");

		// Buttons
		lines.push(
			"   " +
				this.btn(t.btnSave, cf === "save", "success") +
				"   " +
				this.btn(t.btnCancel, cf === "cancel", cf === "cancel" ? "error" : "muted"),
		);
		lines.push("");
		lines.push(th.fg("dim", ` ${t.modelNav}`));
		this.hr(lines, w);

		return lines.map((l) => truncateToWidth(l, w));
	}

	// ── Advanced ─────────────────────────────────────────────────────────

	private renderAdvanced(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.advFields[this.advFocus];
		const pad = 24;

		this.hr(lines, w);
		lines.push(th.fg("accent", th.bold(` ${t.advancedTitle}`)));
		lines.push("");

		// Cost
		lines.push(`   ${th.fg("accent", t.costSection)}`);
		this.row(
			lines,
			w,
			t.costInput,
			"costInput",
			cf,
			renderInp(this.advCostIn, cf === "costInput", this.focused, th, w - pad - 6, "0"),
			pad,
		);
		this.row(
			lines,
			w,
			t.costOutput,
			"costOutput",
			cf,
			renderInp(this.advCostOut, cf === "costOutput", this.focused, th, w - pad - 6, "0"),
			pad,
		);
		this.row(
			lines,
			w,
			t.costCacheRead,
			"costCacheRead",
			cf,
			renderInp(this.advCostCR, cf === "costCacheRead", this.focused, th, w - pad - 6, "0"),
			pad,
		);
		this.row(
			lines,
			w,
			t.costCacheWrite,
			"costCacheWrite",
			cf,
			renderInp(this.advCostCW, cf === "costCacheWrite", this.focused, th, w - pad - 6, "0"),
			pad,
		);
		lines.push("");

		// Thinking level map (per-model thinking budget/levels)
		lines.push(`   ${th.fg("accent", t.thinkingSection)}`);
		this.row(
			lines,
			w,
			t.thinkingMapLabel,
			"thinkingMap",
			cf,
			renderInp(this.advThinkMap, cf === "thinkingMap", this.focused, th, w - pad - 6, "{}"),
			pad,
		);
		if (cf === "thinkingMap") lines.push(`     ${th.fg("dim", t.thinkingMapHint)}`);
		lines.push("");

		// Compat
		lines.push(`   ${th.fg("accent", t.compatSection)}`);
		this.row(lines, w, t.compatDeveloperRole, "compatDeveloperRole", cf, toggleStr(this.advDevRole, th), pad);
		this.row(lines, w, t.compatReasoningEffort, "compatReasoningEffort", cf, toggleStr(this.advReasonEff, th), pad);

		const mtfDisp = this.carousel(COMPAT_MAX_TOKENS_FIELDS, this.advMaxTFIdx, cf === "compatMaxTokensField");
		this.row(lines, w, t.compatMaxTokensField, "compatMaxTokensField", cf, mtfDisp, pad);

		this.row(
			lines,
			w,
			t.compatThinkingFormat,
			"compatThinkingFormat",
			cf,
			this.carousel(COMPAT_THINKING_FORMATS, this.advThinkFmtIdx, cf === "compatThinkingFormat"),
			pad,
		);

		this.row(
			lines,
			w,
			t.compatCacheControl,
			"compatCacheControlFormat",
			cf,
			this.carousel(COMPAT_CACHE_FORMATS, this.advCacheFmtIdx, cf === "compatCacheControlFormat"),
			pad,
		);
		lines.push("");

		// Back
		lines.push(`   ${this.btn(t.backAndSave, cf === "back", "accent")}`);
		lines.push("");
		lines.push(th.fg("dim", ` ${t.advancedNav}`));
		this.hr(lines, w);

		return lines.map((l) => truncateToWidth(l, w));
	}

	// ── Provider Advanced ───────────────────────────────────────────

	private renderProvAdvanced(w: number): string[] {
		const th = this.th;
		const t = this.t;
		const lines: string[] = [];
		const cf = this.pAdvFields[this.pAdvFocus];
		const pad = 24;

		this.hr(lines, w);
		lines.push(th.fg("accent", th.bold(` ${t.provAdvTitle}`)));
		lines.push(` ${th.fg("dim", t.provCompatHint)}`);
		lines.push("");

		lines.push(`   ${th.fg("accent", t.compatSection)}`);
		this.row(lines, w, t.compatDeveloperRole, "pDevRole", cf, toggleStr(this.pDevRole, th), pad);
		this.row(lines, w, t.compatReasoningEffort, "pReasonEff", cf, toggleStr(this.pReasonEff, th), pad);
		this.row(
			lines,
			w,
			t.compatMaxTokensField,
			"pMaxTokensField",
			cf,
			this.carousel(COMPAT_MAX_TOKENS_FIELDS, this.pMaxTFIdx, cf === "pMaxTokensField"),
			pad,
		);
		this.row(
			lines,
			w,
			t.compatThinkingFormat,
			"pThinkingFormat",
			cf,
			this.carousel(COMPAT_THINKING_FORMATS, this.pThinkFmtIdx, cf === "pThinkingFormat"),
			pad,
		);
		this.row(
			lines,
			w,
			t.compatCacheControl,
			"pCacheControl",
			cf,
			this.carousel(COMPAT_CACHE_FORMATS, this.pCacheFmtIdx, cf === "pCacheControl"),
			pad,
		);
		lines.push("");

		lines.push(`   ${this.btn(t.backAndSave, cf === "back", "accent")}`);
		lines.push("");
		lines.push(th.fg("dim", ` ${t.advancedNav}`));
		this.hr(lines, w);

		return lines.map((l) => truncateToWidth(l, w));
	}
}

/** @internal Exported only for deterministic example-package regression tests. */
export const providerManagerTestInternals = {
	discoverModels,
	metadataFromRaw,
	safeDiscoveryUrl,
	normalizeDiscoveredBaseUrl,
	hasVersionedApiPath,
};
