import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";

const { bindDirectoryMock, unbindDirectoryMock } = vi.hoisted(() => ({
	bindDirectoryMock: vi.fn(() => "C:\\work"),
	unbindDirectoryMock: vi.fn(() => true),
}));

vi.mock("../src/metapi/profile-service.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/metapi/profile-service.ts")>();
	return {
		...actual,
		bindDirectory: bindDirectoryMock,
		unbindDirectory: unbindDirectoryMock,
		listInstalledProfiles: () => ["default", "work", "pi"],
		resolveProfile: (_cwd: string, requestedName?: string) => {
			const name = requestedName ?? "default";
			if (name === "pi") {
				return {
					name: "pi",
					displayName: "Pi compatibility",
					agentDir: "C:\\Users\\test\\.pi\\agent",
					compatibility: true,
				};
			}
			return {
				name,
				displayName: name === "work" ? "工作配置" : "MetaPi Starter",
				agentDir: `C:\\Users\\test\\.metapi\\profiles\\${name}\\agent`,
				compatibility: false,
			};
		},
	};
});

import { createMetaPiProfileExtension } from "../src/metapi/profile-extension.ts";
import { METAPI_SESSION_PROFILE_ENTRY } from "../src/metapi/session-profile.ts";

interface SetupOptions {
	selectResults?: Array<string | undefined>;
	confirmResults?: boolean[];
	currentProfile?: string;
}

function setup(options: SetupOptions = {}) {
	let profileCommand: Omit<RegisteredCommand, "name" | "sourceInfo"> | undefined;
	const api = {
		registerCommand(name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) {
			if (name === "profile") profileCommand = command;
		},
		on: vi.fn(),
	} as unknown as ExtensionAPI;
	createMetaPiProfileExtension()(api);

	let selectIndex = 0;
	let confirmIndex = 0;
	let contextStale = false;
	const switchProfile = vi.fn(async () => {
		contextStale = true;
		return { cancelled: false };
	});
	const ctx = {
		cwd: "C:\\work",
		hasUI: true,
		sessionManager: {
			getEntries: () => [
				{
					type: "custom",
					customType: METAPI_SESSION_PROFILE_ENTRY,
					data: { profile: options.currentProfile ?? "pi" },
				},
			],
		},
		switchProfile,
		ui: {
			notify: vi.fn(() => {
				if (contextStale) throw new Error("stale command ctx");
			}),
			select: vi.fn(async () => options.selectResults?.[selectIndex++]),
			input: vi.fn(async () => undefined),
			confirm: vi.fn(async () => options.confirmResults?.[confirmIndex++] ?? false),
			setStatus: vi.fn(),
			theme: { fg: (_name: string, text: string) => text },
		},
	} as unknown as ExtensionCommandContext;

	if (!profileCommand) throw new Error("Profile command was not registered");
	return { command: profileCommand, ctx, switchProfile };
}

describe("MetaPi Profile extension", () => {
	it("opens a current-session Profile chooser", async () => {
		const { command, ctx } = setup();

		await command.handler("", ctx);

		expect(ctx.ui.select).toHaveBeenCalledTimes(1);
		const [title, items] = vi.mocked(ctx.ui.select).mock.calls[0];
		expect(title).toContain("选择当前会话使用的配置");
		expect(items).toContain("原版 Pi 配置（当前会话）");
		expect(items).not.toContain("MetaPi 默认配置");
		expect(items).not.toContain("工作配置");
	});

	it("switches the current session between ordinary Profiles after confirmation", async () => {
		const { command, ctx, switchProfile } = setup({
			currentProfile: "default",
			selectResults: ["工作配置"],
			confirmResults: [true],
		});

		await command.handler("", ctx);

		expect(switchProfile).toHaveBeenCalledWith("work");
		expect(ctx.ui.confirm).toHaveBeenCalledWith(
			"切换到“工作配置”？",
			"当前对话将保留在原配置中；目标配置会在当前 WorkSpace 中新建空对话，不继承上下文。",
		);
		expect(vi.mocked(ctx.ui.select).mock.calls[0]?.[1]).not.toContain("原版 Pi 配置");
		expect(ctx.ui.notify).not.toHaveBeenCalled();
		expect(bindDirectoryMock).not.toHaveBeenCalled();
	});

	it("switches to a named ordinary Profile directly", async () => {
		const { command, ctx, switchProfile } = setup({ currentProfile: "default", confirmResults: [true] });

		await command.handler("work", ctx);

		expect(ctx.ui.select).not.toHaveBeenCalled();
		expect(switchProfile).toHaveBeenCalledWith("work");
	});

	it.each([
		{ currentProfile: "default", targetProfile: "pi" },
		{ currentProfile: "pi", targetProfile: "default" },
	])(
		"requires a new launch when switching from $currentProfile to $targetProfile",
		async ({ currentProfile, targetProfile }) => {
			const { command, ctx, switchProfile } = setup({ currentProfile, confirmResults: [true] });

			await command.handler(targetProfile, ctx);

			expect(switchProfile).not.toHaveBeenCalled();
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining(`metapi --profile ${targetProfile}`),
				"error",
			);
		},
	);

	it("reports current session and next-launch defaults separately", async () => {
		const { command, ctx } = setup();

		await command.handler("status", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("当前会话：原版 Pi 配置"), "info");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("当前目录下次启动：MetaPi 默认配置"), "info");
	});

	it("keeps directory binding as an explicit command", async () => {
		const { command, ctx } = setup();

		await command.handler("bind default", ctx);

		expect(bindDirectoryMock).toHaveBeenCalledWith("C:\\work", "default");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("下次新建会话"), "info");
	});

	it("completes subcommands and Profile names", async () => {
		const { command } = setup();
		if (!command.getArgumentCompletions) throw new Error("Profile completions were not registered");

		expect(await command.getArgumentCompletions("st")).toEqual([
			expect.objectContaining({ value: "status", label: "status" }),
		]);
		expect(await command.getArgumentCompletions("bind d")).toEqual(
			expect.arrayContaining([expect.objectContaining({ value: "bind default", label: "default" })]),
		);
	});
});
