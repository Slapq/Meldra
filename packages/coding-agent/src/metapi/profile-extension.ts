import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../core/extensions/types.ts";
import {
	checkProfileUpdate,
	exportProfileWithAudit,
	type InstalledProfileRecord,
	importProfile,
	ProfileConflictError,
	updateProfile,
} from "./profile-bundle.ts";
import {
	bindDirectory,
	listDirectoryBindings,
	listInstalledProfiles,
	type ProfileSelection,
	readProjectProfileRecommendation,
	resolveProfile,
	unbindDirectory,
} from "./profile-service.ts";
import { getSessionProfile } from "./session-profile.ts";

const PROFILE_COMMANDS = [
	{ value: "status", description: "查看当前会话使用的配置" },
	{ value: "list", description: "查看所有配置" },
	{ value: "import", description: "添加别人分享的配置" },
	{ value: "export", description: "分享一套配置" },
	{ value: "update", description: "更新一套配置" },
	{ value: "bind", description: "设置当前文件夹下次启动的默认配置" },
	{ value: "unbind", description: "取消当前文件夹的启动默认配置" },
] as const;

function notifyProfile(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	ctx.ui.notify(message, type);
}

function getInstalledProfileNames(currentProfile?: ProfileSelection): string[] {
	const names = new Set(listInstalledProfiles());
	if (currentProfile) names.add(currentProfile.name);
	return [...names].sort();
}

function getFriendlyProfileLabel(name: string, cwd = process.cwd()): string {
	if (name === "default") return "MetaPi 默认配置";
	if (name === "pi") return "原版 Pi 配置";
	return resolveProfile(cwd, name).displayName;
}

function currentProfile(ctx: ExtensionContext): ProfileSelection {
	return resolveProfile(
		ctx.cwd,
		getSessionProfile(ctx.sessionManager) ?? process.env.METAPI_PROFILE_NAME ?? "default",
	);
}

function getProfileChoices(profile: ProfileSelection, cwd: string, switchableOnly = false) {
	return getInstalledProfileNames(profile)
		.map((name) => ({
			name,
			profile: resolveProfile(cwd, name),
			label:
				name === profile.name
					? `${getFriendlyProfileLabel(name, cwd)}（当前会话）`
					: getFriendlyProfileLabel(name, cwd),
		}))
		.filter((choice) => !switchableOnly || choice.profile.compatibility === profile.compatibility);
}

function formatCurrentState(profile: ProfileSelection, cwd: string): string {
	const nextProfile = resolveProfile(cwd);
	return [
		`当前会话：${getFriendlyProfileLabel(profile.name, cwd)}`,
		`当前目录下次启动：${getFriendlyProfileLabel(nextProfile.name, cwd)}`,
	].join("\n");
}

function getArgumentCompletions(argumentPrefix: string) {
	const profileNames = getInstalledProfileNames();
	const normalized = argumentPrefix.trimStart();
	const firstSpace = normalized.indexOf(" ");
	if (firstSpace === -1) {
		const candidates = [
			...PROFILE_COMMANDS.map((command) => ({
				value: command.value,
				label: command.value,
				description: command.description,
			})),
			...profileNames.map((name) => ({
				value: name,
				label: name,
				description: `切换到${getFriendlyProfileLabel(name)}`,
			})),
		];
		const prefix = normalized.toLowerCase();
		const matches = candidates.filter((item) => item.value.toLowerCase().startsWith(prefix));
		return matches.length > 0 ? matches : null;
	}

	const command = normalized.slice(0, firstSpace);
	const profilePrefix = normalized.slice(firstSpace + 1).toLowerCase();
	if (!["export", "update", "bind"].includes(command) || profilePrefix.includes(" ")) return null;
	const matches = profileNames
		.filter((name) => name.toLowerCase().startsWith(profilePrefix))
		.map((name) => ({ value: `${command} ${name}`, label: name, description: getFriendlyProfileLabel(name) }));
	return matches.length > 0 ? matches : null;
}

async function importFromTui(source: string, ctx: ExtensionCommandContext): Promise<void> {
	let record: InstalledProfileRecord;
	try {
		record = await importProfile(source, { cwd: ctx.cwd });
	} catch (error) {
		if (!(error instanceof ProfileConflictError)) throw error;
		const choice = await ctx.ui.select(`名为“${error.profileId}”的配置已经存在`, [
			"替换原配置",
			"换个名字保存",
			"取消",
		]);
		if (!choice || choice === "取消") return;
		if (choice === "换个名字保存") {
			const name = await ctx.ui.input("给这套配置起个名字");
			if (!name) return;
			record = await importProfile(source, { cwd: ctx.cwd, name });
		} else {
			record = await importProfile(source, { cwd: ctx.cwd, replace: true });
		}
	}
	const label = getFriendlyProfileLabel(record.id, ctx.cwd);
	const useNow = await ctx.ui.confirm("配置已添加", `现在将当前会话切换到“${label}”吗？`);
	if (useNow) {
		await switchProfile(record.id, ctx);
		return;
	}
	notifyProfile(ctx, `已添加“${label}”。以后输入 /profile 就能切换。`);
}

async function switchProfile(name: string, ctx: ExtensionCommandContext): Promise<void> {
	const profile = currentProfile(ctx);
	const target = resolveProfile(ctx.cwd, name);
	const label = getFriendlyProfileLabel(name, ctx.cwd);
	if (name === profile.name) {
		notifyProfile(ctx, `当前会话已经在使用“${label}”。`);
		return;
	}
	if (profile.compatibility !== target.compatibility) {
		throw new Error(
			`“${label}”使用独立的 Session 存储，不能在当前会话内切换。请退出后运行 metapi --profile ${name}。`,
		);
	}
	if (!ctx.switchProfile) throw new Error("当前运行模式不支持会话内切换配置");
	const confirmed = await ctx.ui.confirm(
		`切换到“${label}”？`,
		"当前对话将保留在原配置中；目标配置会在当前 WorkSpace 中新建空对话，不继承上下文。",
	);
	if (!confirmed) return;
	await ctx.switchProfile(name);
}

async function openProfileHub(ctx: ExtensionCommandContext): Promise<void> {
	const profile = currentProfile(ctx);
	const choices = getProfileChoices(profile, ctx.cwd, true);
	const actions = ["＋ 添加别人分享的配置", "⚙ 设置当前目录下次启动的默认配置"];
	const selected = await ctx.ui.select(
		`选择当前会话使用的配置 · 现在：${getFriendlyProfileLabel(profile.name, ctx.cwd)}`,
		[...choices.map((choice) => choice.label), ...actions],
	);
	if (!selected) return;

	const selectedProfile = choices.find((choice) => choice.label === selected);
	if (selectedProfile) {
		await switchProfile(selectedProfile.name, ctx);
		return;
	}
	if (selected === "＋ 添加别人分享的配置") {
		const source = await ctx.ui.input("配置来源（本地文件夹或分享地址）");
		if (source?.trim()) await importFromTui(source.trim(), ctx);
		return;
	}
	const bindableProfiles = getProfileChoices(profile, ctx.cwd);
	const bindingChoices = bindableProfiles.map((choice) => `${choice.label.replace("（当前会话）", "")} · 下次启动`);
	bindingChoices.push("取消当前目录的启动默认配置");
	const binding = await ctx.ui.select("设置当前目录及其子目录下次启动的默认配置", bindingChoices);
	if (!binding) return;
	if (binding === "取消当前目录的启动默认配置") {
		const removed = unbindDirectory(ctx.cwd);
		notifyProfile(
			ctx,
			removed ? "已取消当前目录的启动默认配置。" : "当前目录没有单独的启动默认配置。",
			removed ? "info" : "warning",
		);
		return;
	}
	const target = bindableProfiles[bindingChoices.indexOf(binding)];
	if (target) {
		bindDirectory(ctx.cwd, target.name);
		notifyProfile(ctx, `当前目录下次新建会话时将默认使用“${getFriendlyProfileLabel(target.name, ctx.cwd)}”。`);
	}
}

export function createMetaPiProfileExtension(): (pi: ExtensionAPI) => void {
	return (pi) => {
		pi.registerCommand("profile", {
			description: "Start a new session with another Profile",
			getArgumentCompletions,
			handler: async (args, ctx) => {
				const parts = args.trim().split(/\s+/).filter(Boolean);
				const command = parts[0];
				try {
					if (!command) {
						await openProfileHub(ctx);
						return;
					}
					const profile = currentProfile(ctx);
					if (command === "status") {
						notifyProfile(ctx, formatCurrentState(profile, ctx.cwd));
						return;
					}
					if (command === "list") {
						notifyProfile(
							ctx,
							getProfileChoices(profile, ctx.cwd)
								.map((choice) => choice.label)
								.join("\n"),
						);
						return;
					}
					if (command === "import") {
						const source = parts[1];
						if (!source) throw new Error("请在 import 后填写配置来源");
						await importFromTui(source, ctx);
						return;
					}
					if (command === "export") {
						const name = parts[1] ?? profile.name;
						notifyProfile(
							ctx,
							"导出会按原样复制 Bundle 源文件。托管凭据和 Session 不会导出，但硬编码的 Key 仍可能被包含。",
							"warning",
						);
						const result = await exportProfileWithAudit(name, parts[2] ?? `${name}-profile`, ctx.cwd);
						const findingSummary =
							result.audit.findings.length > 0
								? `发现 ${result.audit.findings.length} 处疑似硬编码凭据，请迁移后重新导出。`
								: "未发现疑似硬编码凭据。";
						notifyProfile(
							ctx,
							`配置已保存到 ${result.output}\n${findingSummary}\n分享前请检查 ${result.audit.reportPath}`,
							result.audit.findings.length > 0 ? "warning" : "info",
						);
						return;
					}
					if (command === "update") {
						const record = await updateProfile(parts[1] ?? profile.name, ctx.cwd);
						notifyProfile(ctx, `“${record.displayName}”已更新`);
						return;
					}
					if (command === "bind") {
						const target = parts[1] ?? profile.name;
						bindDirectory(ctx.cwd, target);
						notifyProfile(ctx, `当前目录下次新建会话时将默认使用“${getFriendlyProfileLabel(target, ctx.cwd)}”。`);
						return;
					}
					if (command === "unbind") {
						const removed = unbindDirectory(ctx.cwd);
						notifyProfile(
							ctx,
							removed ? "已取消当前目录的启动默认配置。" : "当前目录没有启动默认配置。",
							removed ? "info" : "warning",
						);
						return;
					}
					if (getInstalledProfileNames(profile).includes(command)) {
						await switchProfile(command, ctx);
						return;
					}
					notifyProfile(ctx, `没有找到“${command}”。输入 /profile 重新选择，或按 Tab 查看可用选项。`, "warning");
				} catch (error) {
					notifyProfile(ctx, error instanceof Error ? error.message : String(error), "error");
				}
			},
		});

		pi.on("session_start", async (_event, ctx) => {
			const profile = currentProfile(ctx);
			ctx.ui.setStatus(
				"metapi-profile",
				ctx.ui.theme.fg("accent", `配置:${getFriendlyProfileLabel(profile.name, ctx.cwd)} · /profile`),
			);
			if (!profile.compatibility) {
				const recommendation = readProjectProfileRecommendation(ctx.cwd);
				if (recommendation) {
					notifyProfile(
						ctx,
						`这个项目推荐使用“${recommendation.displayName ?? recommendation.source}”。输入 /profile import ${recommendation.source} 添加它。`,
						"info",
					);
				}
				if (!process.env.PI_OFFLINE) {
					setTimeout(() => {
						void checkProfileUpdate(profile.name).then((version) => {
							if (version) notifyProfile(ctx, `当前配置有新版本：${version}`, "warning");
						});
					}, 0);
				}
			}
		});
	};
}

export function getProfileCommandStatus(cwd: string, requestedName?: string): string {
	const profile = resolveProfile(cwd, requestedName);
	return [
		`Profile: ${profile.name}`,
		`Display: ${profile.displayName}`,
		`Agent directory: ${profile.agentDir}`,
		`Working directory: ${cwd}`,
	].join("\n");
}

export function getProfileCommandBindings(): string {
	const bindings = listDirectoryBindings();
	const entries = Object.entries(bindings);
	return entries.length === 0
		? "No directory bindings."
		: entries.map(([path, name]) => `${name}\t${path}`).join("\n");
}
