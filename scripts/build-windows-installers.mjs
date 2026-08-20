#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WINDOWS_RUNTIME = {
	node: {
		version: "24.19.0",
		url: "https://nodejs.org/download/release/v24.19.0/node-v24.19.0-win-x64.zip",
		sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
	},
	terminal: {
		version: "1.24.11911.0",
		url: "https://github.com/microsoft/terminal/releases/download/v1.24.11911.0/Microsoft.WindowsTerminal_1.24.11911.0_x64.zip",
		sha256: "7691efeb71c8dd0b95536c84e366fa4cf809a42c534912f9cefa1056534383bd",
	},
	terminalLicense: {
		filename: "windows-terminal-LICENSE.txt",
		url: "https://raw.githubusercontent.com/microsoft/terminal/v1.24.11911.0/LICENSE",
		sha256: "5d177f23ecfeb0ea8e050b6a5a16355e1ae9a0b286436ca8f83ed08b3795be6b",
	},
};

function parseArgs(args) {
	const options = { outDir: undefined, version: undefined, skipAppBuild: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--out") options.outDir = args[++index];
		else if (arg === "--version") options.version = args[++index];
		else if (arg === "--skip-app-build") options.skipAppBuild = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.outDir) throw new Error("--out is required");
	if (!options.version) throw new Error("--version is required");
	return options;
}

export function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function downloadVerified(spec, cacheDir) {
	mkdirSync(cacheDir, { recursive: true });
	const destination = join(cacheDir, spec.filename ?? basename(new URL(spec.url).pathname));
	if (!existsSync(destination) || sha256(destination) !== spec.sha256) {
		const response = await fetch(spec.url, { redirect: "follow" });
		if (!response.ok) throw new Error(`Download failed (${response.status}): ${spec.url}`);
		writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
	}
	const actual = sha256(destination);
	if (actual !== spec.sha256) throw new Error(`SHA-256 mismatch for ${destination}: ${actual}`);
	return destination;
}

function run(command, args, options = {}) {
	console.log(`$ ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", stdio: "inherit" });
	if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
}

function expandZip(archive, destination) {
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	run("powershell.exe", [
		"-NoProfile",
		"-Command",
		`Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
	]);
}

function singleDirectory(root) {
	const entries = readdirSync(root).filter((name) => !name.startsWith("."));
	if (entries.length === 1 && statSync(join(root, entries[0])).isDirectory()) return join(root, entries[0]);
	return root;
}

function findIscc() {
	const candidates = [
		process.env.ISCC_PATH,
		join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
		"C:/Program Files (x86)/Inno Setup 6/ISCC.exe",
		"C:/Program Files/Inno Setup 6/ISCC.exe",
	].filter(Boolean);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error("Inno Setup 6 ISCC.exe was not found. Set ISCC_PATH.");
	return found;
}

function copyInstallerSources(repoRoot, payload) {
	const source = join(repoRoot, "scripts", "windows-installer");
	for (const name of ["meldra.cmd", "meldra-shell.cmd", "meldra-onboarding.cmd", "metapi.cmd", "metapi-shell.cmd", "metapi-onboarding.cmd", "pi-app.ico"]) {
		cpSync(join(source, name), join(payload, name));
	}
	cpSync(join(repoRoot, "LICENSE"), join(payload, "META_LICENSE.txt"));
}

function writeNotices(payload) {
	writeFileSync(
		join(payload, "THIRD_PARTY_NOTICES.md"),
		`# Bundled runtime notices\n\n` +
			`Meldra redistributes these unmodified official binary distributions:\n\n` +
			`- Node.js ${WINDOWS_RUNTIME.node.version} x64: ${WINDOWS_RUNTIME.node.url}\n` +
			`  - SHA-256: \`${WINDOWS_RUNTIME.node.sha256}\`\n` +
			`  - License: \`runtime/LICENSE\` in the bundled-runtime installation.\n` +
			`- Windows Terminal ${WINDOWS_RUNTIME.terminal.version} x64: ${WINDOWS_RUNTIME.terminal.url}\n` +
			`  - SHA-256: \`${WINDOWS_RUNTIME.terminal.sha256}\`\n` +
			`  - License: \`terminal/LICENSE\`.\n\n` +
			`Windows Terminal runs in its officially supported portable mode and stores its settings under the Meldra installation directory.\n`,
		"utf8",
	);
}

function compileInstaller(iscc, issFile, payload, output, version, filename, includeNode) {
	const args = [
		`/DAppVersion=${version}`,
		`/DPayloadDir=${payload}`,
		`/DOutputDir=${output}`,
		`/DOutputBaseFilename=${filename.replace(/\.exe$/i, "")}`,
	];
	if (includeNode) args.push("/DIncludeNode=1");
	args.push(issFile);
	run(iscc, args);
}

export function formatChecksums(files) {
	return `${files.map((file) => `${sha256(file)}  ${basename(file)}`).join("\n")}\n`;
}

async function main() {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error(`Windows x64 is required, got ${process.platform}/${process.arch}`);
	}
	const options = parseArgs(process.argv.slice(2));
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(scriptDir, "..");
	const outDir = resolve(options.outDir);
	const workDir = join(outDir, "work");
	const payload = join(workDir, "payload");
	const localRelease = join(workDir, "local-release");
	const cacheDir = join(outDir, "cache");
	const outputDir = join(outDir, "release");

	mkdirSync(outDir, { recursive: true });
	rmSync(payload, { recursive: true, force: true });
	mkdirSync(payload, { recursive: true });
	mkdirSync(outputDir, { recursive: true });

	if (!options.skipAppBuild) {
		run(
			process.execPath,
			[
				"scripts/local-release.mjs",
				"--out",
				localRelease,
				"--force",
				"--offline-model-data",
				"--skip-binary",
				"--skip-bun-install",
				"--skip-check",
				"--skip-test",
			],
			{ cwd: repoRoot },
		);
	}
	const appSource = join(localRelease, "node");
	if (!existsSync(join(appSource, "meldra.cmd"))) throw new Error(`Meldra staging is missing: ${appSource}`);
	cpSync(appSource, join(payload, "app"), { recursive: true });

	const [nodeArchive, terminalArchive, terminalLicense] = await Promise.all([
		downloadVerified(WINDOWS_RUNTIME.node, cacheDir),
		downloadVerified(WINDOWS_RUNTIME.terminal, cacheDir),
		downloadVerified(WINDOWS_RUNTIME.terminalLicense, cacheDir),
	]);
	const nodeExtract = join(workDir, "node-extract");
	const terminalExtract = join(workDir, "terminal-extract");
	expandZip(nodeArchive, nodeExtract);
	expandZip(terminalArchive, terminalExtract);
	cpSync(singleDirectory(nodeExtract), join(payload, "runtime"), { recursive: true });
	cpSync(singleDirectory(terminalExtract), join(payload, "terminal"), { recursive: true });
	cpSync(terminalLicense, join(payload, "terminal", "LICENSE"));
	writeFileSync(join(payload, "terminal", ".portable"), "", "utf8");
	copyInstallerSources(repoRoot, payload);
	writeNotices(payload);

	for (const required of [
		join(payload, "runtime", "node.exe"),
		join(payload, "runtime", "npm.cmd"),
		join(payload, "terminal", "WindowsTerminal.exe"),
		join(payload, "terminal", "LICENSE"),
		join(payload, "pi-app.ico"),
	]) {
		if (!existsSync(required)) throw new Error(`Bundled payload is missing ${required}`);
	}

	const iscc = findIscc();
	const issFile = join(repoRoot, "scripts", "windows-installer", "meldra.iss");
	compileInstaller(iscc, issFile, payload, outputDir, options.version, "Meldra-Setup.exe", true);
	compileInstaller(iscc, issFile, payload, outputDir, options.version, "Meldra-Setup-NodeJS.exe", false);
	const installers = [join(outputDir, "Meldra-Setup.exe"), join(outputDir, "Meldra-Setup-NodeJS.exe")];
	writeFileSync(join(outputDir, "SHA256SUMS.txt"), formatChecksums(installers), "utf8");

	console.log("\nWindows installers created:");
	for (const file of [...installers, join(outputDir, "SHA256SUMS.txt")]) {
		console.log(`  ${file}`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack : error);
		process.exitCode = 1;
	});
}
