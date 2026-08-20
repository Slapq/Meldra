import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatChecksums, WINDOWS_RUNTIME } from "./build-windows-installers.mjs";

const repoRoot = new URL("../", import.meta.url);
const readRepo = (relative) => readFileSync(new URL(relative, repoRoot), "utf8");

function readIcoFrameCorners(icon) {
	const count = icon.readUInt16LE(4);
	const corners = [];
	for (let index = 0; index < count; index++) {
		const entry = 6 + index * 16;
		const width = icon[entry] || 256;
		const height = icon[entry + 1] || 256;
		const bitDepth = icon.readUInt16LE(entry + 6);
		const offset = icon.readUInt32LE(entry + 12);
		assert.equal(bitDepth, 32);
		const stride = width * 4;
		for (const y of [0, height - 1]) {
			const row = offset + 40 + y * stride;
			for (const x of [0, width - 1]) {
				const pixel = row + x * 4;
				corners.push({ red: icon[pixel + 2], green: icon[pixel + 1], blue: icon[pixel], alpha: icon[pixel + 3] });
			}
		}
	}
	return corners;
}

test("publishes Meldra as the primary CLI and keeps the legacy alias", () => {
	const manifest = JSON.parse(readRepo("packages/coding-agent/package.json"));
	assert.equal(manifest.piConfig.name, "meldra");
	assert.equal(manifest.bin.meldra, "dist/cli.js");
	assert.equal(manifest.bin.metapi, "dist/cli.js");
});

test("pins official Windows runtime artifacts by SHA-256", () => {
	assert.equal(WINDOWS_RUNTIME.node.version, "24.19.0");
	assert.match(WINDOWS_RUNTIME.node.url, /^https:\/\/nodejs\.org\/download\/release\//);
	assert.match(WINDOWS_RUNTIME.node.sha256, /^[a-f0-9]{64}$/);
	assert.equal(WINDOWS_RUNTIME.terminal.version, "1.24.11911.0");
	assert.match(WINDOWS_RUNTIME.terminal.url, /^https:\/\/github\.com\/microsoft\/terminal\/releases\/download\//);
	assert.match(WINDOWS_RUNTIME.terminal.sha256, /^[a-f0-9]{64}$/);
	assert.match(WINDOWS_RUNTIME.terminalLicense.url, /raw\.githubusercontent\.com\/microsoft\/terminal/);
	assert.match(WINDOWS_RUNTIME.terminalLicense.sha256, /^[a-f0-9]{64}$/);
});

test("writes standard Meldra release checksums", () => {
	const directory = mkdtempSync(join(tmpdir(), "metapi-installer-checksum-"));
	try {
		const first = join(directory, "Meldra-Setup.exe");
		const second = join(directory, "Meldra-Setup-NodeJS.exe");
		writeFileSync(first, "bundled");
		writeFileSync(second, "system");
		const checksums = formatChecksums([first, second]);
		assert.match(checksums, /^[a-f0-9]{64}  Meldra-Setup\.exe\n[a-f0-9]{64}  Meldra-Setup-NodeJS\.exe\n$/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("system Node installer warns without blocking installation", () => {
	const script = readRepo("scripts/windows-installer/meldra.iss");
	assert.match(script, /Installation is still allowed/);
	assert.doesNotMatch(script, /function\s+NextButtonClick/i);
	assert.doesNotMatch(script, /function\s+InitializeSetup/i);
});

test("desktop shortcut always launches the bundled portable Windows Terminal", () => {
	const script = readRepo("scripts/windows-installer/meldra.iss");
	assert.match(script, /\{app\}\\terminal\\WindowsTerminal\.exe/);
	assert.match(script, /meldra-shell\.cmd/);
	assert.match(script, /DefaultDirName=\{localappdata\}\\Programs\\Meldra/);
	assert.match(script, /Source: "\{#PayloadDir\}\\metapi\.cmd"/);
	assert.match(script, /MinVersion=10\.0\.19041/);
	assert.match(script, /PrivilegesRequired=lowest/);
	assert.match(script, /ChangesEnvironment=yes/);
	assert.match(script, /AddMeldraToUserPath/);
	assert.match(script, /RemoveMeldraFromUserPath/);
	assert.match(script, /\{userdesktop\}\\Meldra/);
});

test("Meldra icon uses a centered 450x450 white glyph with transparent rounded corners", () => {
	const script = readRepo("scripts/windows-installer/meldra.iss");
	const source = readRepo("scripts/windows-installer/pi-favicon.svg");
	const icon = readFileSync(new URL("scripts/windows-installer/pi-app.ico", repoRoot));
	assert.match(source, /<rect[^>]+rx="120"[^>]+fill="#09090b"/);
	assert.match(source, /<path fill="#fff"/);
	assert.match(source, /M175 175 H400 V287\.5 H287\.5 V625 H175 Z/);
	assert.match(source, /M512\.5 175 H625 V625 H512\.5 V400 H400 V287\.5 H512\.5 Z/);
	assert.match(script, /SetupIconFile=\{#PayloadDir\}\\pi-app\.ico/);
	assert.match(script, /UninstallDisplayIcon=\{app\}\\pi-app\.ico/);
	assert.match(script, /IconFilename: "\{app\}\\pi-app\.ico"/);
	assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
	for (const corner of readIcoFrameCorners(icon)) {
		assert.ok(corner.alpha < 128);
		assert.ok(corner.red <= 16 && corner.green <= 16 && corner.blue <= 16);
	}
});

test("root READMEs lead with the Meldra brand logo", () => {
	for (const readme of ["README.md", "README.en.md"]) {
		assert.match(
			readRepo(readme),
			/^<div align="center">\n\n<img src="scripts\/windows-installer\/pi-favicon\.svg" alt="Meldra Logo" width="160" height="160">/,
		);
	}
});

test("first-use onboarding quotes the Windows Terminal title as one argument", () => {
	const script = readRepo("scripts/windows-installer/meldra.iss");
	assert.match(script, /--title ""Meldra Setup"" -- cmd\.exe \/d \/c/);
	assert.match(script, /meldra-onboarding\.cmd/);
	assert.match(readRepo("scripts/windows-installer/meldra-onboarding.cmd"), /--startup-command \/setup/);
});

test("legacy Windows launcher forwards to the canonical Meldra launcher", () => {
	const launcher = readRepo("scripts/windows-installer/metapi.cmd");
	assert.match(launcher, /call "%~dp0meldra\.cmd" %\*/);
	assert.doesNotMatch(launcher, /METAPI_(ROOT|APP|CLI|NODE)/);
});
test("local release staging is reproducible and keeps DSH rc peer resolution", () => {
	const script = readRepo("scripts/local-release.mjs");
	assert.match(script, /--offline-model-data/);
	assert.match(script, /"--legacy-peer-deps"/);
	assert.match(script, /for \(const command of \["meldra", "metapi", "pi"\]\)/);
});

test("Meldra runtime launcher prefers bundled Node but permits the selected system runtime", () => {
	const launcher = readRepo("scripts/windows-installer/meldra.cmd");
	assert.match(launcher, /runtime\\node\.exe/);
	assert.match(launcher, /where node\.exe/);
	assert.match(launcher, /The installed Node\.js will still be used as requested/);
	assert.match(launcher, /%MELDRA_NODE%.*%MELDRA_CLI%/);
});
