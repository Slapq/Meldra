#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NATIVE_RUNTIME_PACKAGES = ["@deepseek-ai/dsh-subprocess-local", "koffi", "node-pty"];

export function nativeRuntimeRebuildArgs() {
	return ["rebuild", "--foreground-scripts", ...NATIVE_RUNTIME_PACKAGES];
}

function readRuntimeLock(repoRoot) {
	return JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
}

export function runtimeOverrides(repoRoot) {
	const lock = readRuntimeLock(repoRoot);
	const overrides = {};
	for (const [path, entry] of Object.entries(lock.packages ?? {})) {
		const marker = "node_modules/";
		const index = path.lastIndexOf(marker);
		if (index < 0 || typeof entry.version !== "string") continue;
		const name = path.slice(index + marker.length);
		if (!name.startsWith("@deepseek-ai/") && name !== "koffi" && name !== "node-pty") continue;
		if (overrides[name] && overrides[name] !== entry.version) {
			throw new Error(`Release lock contains conflicting versions for ${name}.`);
		}
		overrides[name] = entry.version;
	}
	if (overrides["@deepseek-ai/dsh"] !== "0.1.1-rc.1" || overrides["node-pty"] !== "1.2.0-beta.15") {
		throw new Error("Release lock does not preserve the reviewed DSH rc.1 native runtime.");
	}
	return overrides;
}

function currentLibc() {
	return process.report?.getReport()?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

function supportsRuntime(entry, runtime) {
	return (
		(!Array.isArray(entry.os) || entry.os.includes(runtime.platform)) &&
		(!Array.isArray(entry.cpu) || entry.cpu.includes(runtime.arch)) &&
		(!Array.isArray(entry.libc) || entry.libc.includes(runtime.libc))
	);
}

export function runtimeInstallDependencies(
	repoRoot,
	runtime = {
		platform: process.platform,
		arch: process.arch,
		libc: process.platform === "linux" ? currentLibc() : undefined,
	},
) {
	const lock = readRuntimeLock(repoRoot);
	const dependencies = {};
	for (const [path, entry] of Object.entries(lock.packages ?? {})) {
		const marker = "node_modules/";
		const index = path.lastIndexOf(marker);
		if (index < 0 || typeof entry.version !== "string") continue;
		const name = path.slice(index + marker.length);
		if (!name.startsWith("@deepseek-ai/") || !supportsRuntime(entry, runtime)) continue;
		dependencies[name] = entry.version;
	}
	return dependencies;
}

export function runtimeInstallSpecs(repoRoot, runtime) {
	return Object.entries(runtimeInstallDependencies(repoRoot, runtime))
		.map(([name, version]) => `${name}@${version}`)
		.sort();
}

function parseArgs(args) {
	let cwd = process.cwd();
	let dryRun = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--cwd") {
			const value = args[++index];
			if (!value) throw new Error("--cwd requires a directory");
			cwd = resolve(value);
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return { cwd, dryRun };
}

function packageDirectory(cwd, name) {
	return join(cwd, "node_modules", ...name.split("/"));
}

export function prepareNativeRuntime(options = {}) {
	const cwd = resolve(options.cwd ?? process.cwd());
	const missing = NATIVE_RUNTIME_PACKAGES.filter((name) => !existsSync(join(packageDirectory(cwd, name), "package.json")));
	if (missing.length > 0) {
		throw new Error(`Native runtime packages are not installed under ${cwd}: ${missing.join(", ")}`);
	}
	const rebuildArgs = nativeRuntimeRebuildArgs();
	const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	const command = process.platform === "win32" ? process.execPath : "npm";
	const args = process.platform === "win32" ? [npmCli, ...rebuildArgs] : rebuildArgs;
	if (options.dryRun) return { command, args, cwd };
	const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
	if (result.status !== 0) {
		throw new Error(`Native runtime preparation failed with exit code ${result.status ?? "unknown"}.`);
	}
	return { command, args, cwd };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const options = parseArgs(process.argv.slice(2));
	const result = prepareNativeRuntime(options);
	if (options.dryRun) console.log(JSON.stringify(result));
}
