import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	ProfileEnvironmentDescriptor,
	ProfileRuntimePackageExecutionOptions,
	ProfileRuntimePackageManager,
	ProfileRuntimePackageRequest,
	ProfileRuntimePackageResult,
} from "../core/profile-agent-runtime.ts";
import { prepareDshComposition } from "../extensions/dsh/composition.ts";

const COREPACK_PNPM_VERSION = "10.34.4";
const MAX_OUTPUT_CHARS = 200_000;

function commandAvailable(command: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
		child.once("error", () => resolve(false));
		child.once("close", (code) => resolve(code === 0));
	});
}

function collectProcess(
	command: string,
	args: string[],
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		signal?: AbortSignal;
		onOutput?: (chunk: string) => void;
	},
): Promise<ProfileRuntimePackageResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			windowsHide: true,
			signal: options.signal,
		});
		let output = "";
		const collect = (chunk: Buffer): void => {
			const text = chunk.toString("utf8");
			options.onOutput?.(text);
			output += text;
			if (output.length > MAX_OUTPUT_CHARS) output = `[output truncated]\n${output.slice(-MAX_OUTPUT_CHARS)}`;
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.once("error", reject);
		child.once("close", (code) => resolve({ code: code ?? 1, output: output.trim() }));
	});
}

function prependPath(env: NodeJS.ProcessEnv, directory: string): NodeJS.ProcessEnv {
	return { ...env, PATH: [directory, env.PATH].filter(Boolean).join(delimiter) };
}

function corepackPnpmShimDirectory(agentDir: string): string {
	return join(agentDir, "dsh-runtime", ".metapi-bin");
}

function hasCorepackPnpmShim(agentDir: string): boolean {
	return existsSync(join(corepackPnpmShimDirectory(agentDir), process.platform === "win32" ? "pnpm.cmd" : "pnpm"));
}

interface CorepackLauncher {
	command: string;
	args: string[];
}

function windowsCorepackPath(): string {
	return join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
}

function corepackLauncher(): CorepackLauncher {
	return process.platform === "win32"
		? { command: process.execPath, args: [windowsCorepackPath()] }
		: { command: "corepack", args: [] };
}

function writeCorepackPnpmShim(agentDir: string): string {
	const directory = corepackPnpmShimDirectory(agentDir);
	mkdirSync(directory, { recursive: true });
	if (process.platform === "win32") {
		writeFileSync(
			join(directory, "pnpm.cmd"),
			`@echo off\r\n"${process.execPath}" "${windowsCorepackPath()}" pnpm@${COREPACK_PNPM_VERSION} %*\r\n`,
			"utf8",
		);
	} else {
		const path = join(directory, "pnpm");
		writeFileSync(path, `#!/bin/sh\nexec corepack pnpm@${COREPACK_PNPM_VERSION} "$@"\n`, "utf8");
		chmodSync(path, 0o755);
	}
	return directory;
}

async function resolvePnpmEnvironment(
	profile: ProfileEnvironmentDescriptor,
	allowBootstrap: boolean,
	options?: ProfileRuntimePackageExecutionOptions,
): Promise<{ env?: NodeJS.ProcessEnv; failure?: ProfileRuntimePackageResult }> {
	const pnpmProbe = process.platform === "win32" ? ["where.exe", ["pnpm"]] : ["pnpm", ["--version"]];
	if (await commandAvailable(pnpmProbe[0] as string, pnpmProbe[1] as string[])) return { env: process.env };
	if (hasCorepackPnpmShim(profile.agentDir)) {
		return { env: prependPath(process.env, corepackPnpmShimDirectory(profile.agentDir)) };
	}

	const corepack = corepackLauncher();
	const corepackAvailable =
		process.platform === "win32"
			? existsSync(windowsCorepackPath())
			: await commandAvailable(corepack.command, ["--version"]);
	if (!corepackAvailable) {
		return {
			failure: {
				code: 127,
				output: "Harness Profile package management requires pnpm or Corepack on PATH.",
			},
		};
	}
	if (!allowBootstrap) {
		return {
			failure: {
				code: 127,
				output: `pnpm is not prepared for this Profile. Run an explicit add, remove, or update operation to let MetaPi fetch pnpm ${COREPACK_PNPM_VERSION} through Corepack.`,
			},
		};
	}

	const prepared = await collectProcess(
		corepack.command,
		[...corepack.args, `pnpm@${COREPACK_PNPM_VERSION}`, "--version"],
		{
			signal: options?.signal,
			onOutput: options?.onOutput,
		},
	);
	if (prepared.code !== 0) return { failure: prepared };
	return { env: prependPath(process.env, writeCorepackPnpmShim(profile.agentDir)) };
}

function requestArgs(request: ProfileRuntimePackageRequest): string[] {
	switch (request.operation) {
		case "list":
			return ["list", "--depth", "0"];
		case "add":
			return ["add", request.source];
		case "remove":
			return ["remove", request.packageName];
		case "update":
			return ["update"];
	}
}

function profilePackageManifestPath(profile: ProfileEnvironmentDescriptor): string {
	return join(profile.agentDir, "dsh-runtime", "profiles", "metapi", "package.json");
}

function packageSourcesFromConfig(config: unknown): string[] | undefined {
	if (config === undefined) return [];
	if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
	const plugins = (config as { plugins?: unknown }).plugins;
	if (plugins === undefined) return [];
	if (!Array.isArray(plugins) || plugins.some((source) => typeof source !== "string" || !source.trim())) {
		return undefined;
	}
	return plugins.map((source) => (source as string).trim());
}

function portablePackageSource(name: string, spec: string): string {
	return `${name}@${spec}`;
}

export const dshProfilePackageManager: ProfileRuntimePackageManager = {
	async execute(profile, request, options) {
		const pnpm = await resolvePnpmEnvironment(profile, request.operation !== "list", options);
		if (pnpm.failure) return pnpm.failure;

		const require = createRequire(import.meta.url);
		const manifestPath = require.resolve("@deepseek-ai/dsh/package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			bin?: string | Record<string, string>;
		};
		const relativeBin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
		if (!relativeBin) throw new Error("Harness package does not declare the dsh CLI.");
		const dshHome = join(profile.agentDir, "dsh-runtime");
		mkdirSync(dshHome, { recursive: true });
		prepareDshComposition({
			binName: "metapi",
			home: dshHome,
			installAnchor: manifestPath,
			surfacePath: fileURLToPath(new URL("../extensions/dsh/surface.patch.yml", import.meta.url)),
			serverPath: pathToFileURL(fileURLToPath(new URL("../extensions/dsh/server.js", import.meta.url))).href,
		});
		const result = await collectProcess(
			process.execPath,
			[join(manifestPath, "..", relativeBin), "plugin", "--profile", "metapi", ...requestArgs(request)],
			{
				cwd: profile.cwd,
				env: { ...pnpm.env, DSH_HOME: dshHome },
				signal: options?.signal,
				onOutput: options?.onOutput,
			},
		);
		return {
			...result,
			...(result.code === 0 && request.operation !== "list" ? { verificationRequired: true } : {}),
		};
	},
	async snapshot(profile, currentConfig) {
		const path = profilePackageManifestPath(profile);
		if (!existsSync(path)) return currentConfig;
		const manifest = JSON.parse(readFileSync(path, "utf8")) as { dependencies?: Record<string, string> };
		const plugins = Object.entries(manifest.dependencies ?? {}).map(([name, spec]) =>
			portablePackageSource(name, spec),
		);
		const base =
			currentConfig && typeof currentConfig === "object" && !Array.isArray(currentConfig) ? currentConfig : {};
		return { ...base, plugins };
	},
	async restore(profile, config, options) {
		const sources = packageSourcesFromConfig(config);
		if (!sources) {
			return { code: 2, output: 'Harness Runtime config field "plugins" must be an array of non-empty sources.' };
		}
		const output: string[] = [];
		for (const source of sources) {
			const result = await dshProfilePackageManager.execute(profile, { operation: "add", source }, options);
			if (result.output) output.push(result.output);
			if (result.code !== 0) return { code: result.code, output: output.join("\n") };
		}
		return {
			code: 0,
			output: output.join("\n"),
			...(sources.length ? { verificationRequired: true } : {}),
		};
	},
};
