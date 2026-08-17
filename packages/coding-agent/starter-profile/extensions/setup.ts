import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

type SetupStepId = "provider" | "model" | "scout";
type StepResult = "complete" | "skipped" | "exit";
type ConfigurationState = "configured" | "partial" | "unconfigured";

interface ScoutConfig {
	model?: string;
	thinkingLevel?: string;
}

interface SetupStatus {
	providerReady: boolean;
	modelSelected: boolean;
	modelReady: boolean;
	scoutModelConfigured: boolean;
	scoutModelReady: boolean;
	scoutThinkingReady: boolean;
}

interface SetupStep {
	id: SetupStepId;
	command: "/login" | "/model" | "/scout";
	ready: (status: SetupStatus) => boolean;
}

const SETUP_STEPS: SetupStep[] = [
	{ id: "provider", command: "/login", ready: (status) => status.providerReady },
	{ id: "model", command: "/model", ready: (status) => status.modelReady },
	{
		id: "scout",
		command: "/scout",
		ready: (status) => status.scoutModelReady && status.scoutThinkingReady,
	},
];

function isChinese(): boolean {
	const locale = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
	if (/^zh/i.test(locale)) return true;
	try {
		return /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale);
	} catch {
		return false;
	}
}

function readScoutConfig(): ScoutConfig {
	const paths = [join(getAgentDir(), "plugin-configs", "scout.json"), join(getAgentDir(), "scout.json")];
	for (const path of paths) {
		if (!existsSync(path)) continue;
		try {
			const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
			if (value && typeof value === "object" && !Array.isArray(value)) return value as ScoutConfig;
		} catch {
			/* try the legacy path */
		}
	}
	return {};
}

function inspectStatus(ctx: ExtensionContext): SetupStatus {
	const models = ctx.modelRegistry.getAvailable();
	const providerReady = models.some((model) => ctx.modelRegistry.hasConfiguredAuth(model));
	const modelReady = Boolean(ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model));
	const scout = readScoutConfig();
	const scoutRef = typeof scout.model === "string" ? scout.model : "";
	const scoutSeparator = scoutRef.indexOf("/");
	const scoutModel =
		scoutSeparator > 0
			? ctx.modelRegistry.find(scoutRef.slice(0, scoutSeparator), scoutRef.slice(scoutSeparator + 1))
			: undefined;
	return {
		providerReady,
		modelSelected: Boolean(ctx.model),
		modelReady,
		scoutModelConfigured: scoutRef.includes("/"),
		scoutModelReady: Boolean(scoutModel && ctx.modelRegistry.hasConfiguredAuth(scoutModel)),
		scoutThinkingReady: typeof scout.thinkingLevel === "string" && THINKING_LEVELS.has(scout.thinkingLevel),
	};
}

function completedCount(status: SetupStatus): number {
	return SETUP_STEPS.filter((step) => step.ready(status)).length;
}

function updateStatus(ctx: ExtensionContext): SetupStatus {
	const status = inspectStatus(ctx);
	const completed = completedCount(status);
	ctx.ui.setStatus(
		"metapi-starter-setup",
		completed === SETUP_STEPS.length
			? undefined
			: ctx.ui.theme.fg("warning", `Setup ${completed}/${SETUP_STEPS.length} · /setup`),
	);
	return status;
}

function configurationState(id: SetupStepId, status: SetupStatus): ConfigurationState {
	const step = SETUP_STEPS.find((candidate) => candidate.id === id);
	if (!step) return "unconfigured";
	if (step.ready(status)) return "configured";
	if (id === "model" && status.modelSelected) return "partial";
	if (id === "scout" && (status.scoutModelConfigured || status.scoutThinkingReady)) return "partial";
	return "unconfigured";
}

function stateLabel(state: ConfigurationState, zh: boolean): string {
	if (state === "configured") return zh ? "已配置" : "Configured";
	if (state === "partial") return zh ? "部分配置" : "Partially configured";
	return zh ? "未配置" : "Not configured";
}

function stepName(id: SetupStepId, zh: boolean): string {
	if (id === "provider") return zh ? "Provider 凭据" : "Provider credentials";
	if (id === "model") return zh ? "默认模型" : "Default model";
	return zh ? "Scout 模型与 thinking" : "Scout model and thinking";
}

async function runStep(
	ctx: ExtensionCommandContext,
	step: SetupStep,
	position: number,
	zh: boolean,
): Promise<StepResult> {
	while (true) {
		const status = updateStatus(ctx);
		const state = configurationState(step.id, status);
		const configure =
			state === "configured"
				? zh
					? `重新配置 · ${step.command}`
					: `Reconfigure · ${step.command}`
				: state === "partial"
					? zh
						? `继续配置 · ${step.command}`
						: `Continue configuration · ${step.command}`
					: zh
						? `现在配置 · ${step.command}`
						: `Configure now · ${step.command}`;
		const continueLabel =
			state === "configured" ? (zh ? "保留并继续" : "Keep and continue") : zh ? "跳过本步骤" : "Skip this step";
		const exit = zh ? "退出向导" : "Exit setup";
		const choices = state === "configured" ? [continueLabel, configure, exit] : [configure, continueLabel, exit];
		const selected = await ctx.ui.select(
			zh
				? `MetaPi 配置向导 · ${position}/${SETUP_STEPS.length} · ${stepName(step.id, zh)} · ${stateLabel(state, zh)}`
				: `MetaPi Setup · ${position}/${SETUP_STEPS.length} · ${stepName(step.id, zh)} · ${stateLabel(state, zh)}`,
			choices,
		);
		if (!selected || selected === exit) return "exit";
		if (selected === continueLabel) return state === "configured" ? "complete" : "skipped";

		const executed = await ctx.executeCommand(step.command);
		if (!executed) {
			ctx.ui.notify(
				zh ? `${step.command} 在当前模式不可用。` : `${step.command} is unavailable in the current mode.`,
				"error",
			);
			continue;
		}
		const nextStatus = updateStatus(ctx);
		if (step.ready(nextStatus)) {
			ctx.ui.notify(zh ? `${stepName(step.id, zh)}已完成。` : `${stepName(step.id, zh)} complete.`, "info");
			return "complete";
		}
		ctx.ui.notify(
			zh
				? `${stepName(step.id, zh)}仍未完成；可重试、跳过或退出。`
				: `${stepName(step.id, zh)} is still incomplete; retry, skip, or exit.`,
			"warning",
		);
	}
}

async function openSetup(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/setup requires interactive mode", "error");
		return;
	}
	const zh = isChinese();

	while (true) {
		const skipped = new Set<SetupStepId>();
		for (const [index, step] of SETUP_STEPS.entries()) {
			const result = await runStep(ctx, step, index + 1, zh);
			if (result === "exit") return;
			if (result === "skipped") skipped.add(step.id);
		}

		const status = updateStatus(ctx);
		const complete = completedCount(status) === SETUP_STEPS.length;
		const retry = zh ? "重试未完成步骤" : "Retry incomplete steps";
		const pluginConfig = zh ? "打开插件配置 · /config" : "Open plugin configuration · /config";
		const finish = zh ? "完成并关闭" : "Finish and close";
		const choices = [...(!complete && skipped.size > 0 ? [retry] : []), pluginConfig, finish];
		const selected = await ctx.ui.select(
			complete
				? zh
					? "MetaPi 配置完成 · 3/3"
					: "MetaPi Setup complete · 3/3"
				: zh
					? `MetaPi 配置汇总 · ${completedCount(status)}/3 已完成`
					: `MetaPi Setup summary · ${completedCount(status)}/3 complete`,
			choices,
		);
		if (!selected || selected === finish) return;
		if (selected === retry) continue;
		if (!(await ctx.executeCommand("/config"))) {
			ctx.ui.notify(zh ? "/config 在当前模式不可用。" : "/config is unavailable in the current mode.", "error");
		}
	}
}

export default function metaPiStarterSetup(pi: ExtensionAPI) {
	pi.registerCommand("setup", {
		description: "Configure the MetaPi Starter Profile",
		handler: async (_args, ctx) => openSetup(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		const status = updateStatus(ctx);
		if (completedCount(status) < SETUP_STEPS.length && ctx.mode === "tui") {
			ctx.ui.notify(
				isChinese()
					? "MetaPi Starter 配置未完成；运行 /setup 查看连续配置向导。"
					: "MetaPi Starter setup is incomplete; run /setup for the continuous setup wizard.",
				"info",
			);
		}
	});

	pi.on("model_select", async (_event, ctx) => {
		updateStatus(ctx);
	});
}

export const __starterSetupInternals = {
	inspectStatus,
	completedCount,
	readScoutConfig,
	configurationState,
	openSetup,
};
