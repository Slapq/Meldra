import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatChecksums, WINDOWS_RUNTIME } from "./build-windows-installers.mjs";

const repoRoot = new URL("../", import.meta.url);
const readRepo = (relative) => readFileSync(new URL(relative, repoRoot), "utf8");

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

test("writes standard release checksums", () => {
	const directory = mkdtempSync(join(tmpdir(), "metapi-installer-checksum-"));
	try {
		const first = join(directory, "MetaPi-Setup.exe");
		const second = join(directory, "MetaPi-Setup-NodeJS.exe");
		writeFileSync(first, "bundled");
		writeFileSync(second, "system");
		const checksums = formatChecksums([first, second]);
		assert.match(checksums, /^[a-f0-9]{64}  MetaPi-Setup\.exe\n[a-f0-9]{64}  MetaPi-Setup-NodeJS\.exe\n$/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("system Node installer warns without blocking installation", () => {
	const script = readRepo("scripts/windows-installer/metapi.iss");
	assert.match(script, /Installation is still allowed/);
	assert.doesNotMatch(script, /function\s+NextButtonClick/i);
	assert.doesNotMatch(script, /function\s+InitializeSetup/i);
});

test("desktop shortcut always launches the bundled portable Windows Terminal", () => {
	const script = readRepo("scripts/windows-installer/metapi.iss");
	assert.match(script, /\{app\}\\terminal\\WindowsTerminal\.exe/);
	assert.match(script, /metapi-shell\.cmd/);
	assert.match(script, /MinVersion=10\.0\.19041/);
	assert.match(script, /PrivilegesRequired=lowest/);
	assert.match(script, /ChangesEnvironment=yes/);
	assert.match(script, /AddMetaPiToUserPath/);
	assert.match(script, /RemoveMetaPiFromUserPath/);
	assert.match(script, /\{userdesktop\}\\MetaPi/);
});

test("desktop shortcut and installer use the official Pi favicon with transparent corners", () => {
	const script = readRepo("scripts/windows-installer/metapi.iss");
	const source = readRepo("scripts/windows-installer/pi-favicon.svg");
	const icon = readFileSync(new URL("scripts/windows-installer/pi-app.ico", repoRoot));
	assert.match(source, /<rect[^>]+rx="120"[^>]+fill="#09090b"/);
	assert.match(source, /<path fill="#fff"/);
	assert.match(script, /SetupIconFile=\{#PayloadDir\}\\pi-app\.ico/);
	assert.match(script, /UninstallDisplayIcon=\{app\}\\pi-app\.ico/);
	assert.match(script, /IconFilename: "\{app\}\\pi-app\.ico"/);
	assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
});

test("first-use onboarding quotes the Windows Terminal title as one argument", () => {
	const script = readRepo("scripts/windows-installer/metapi.iss");
	assert.match(script, /--title ""MetaPi Setup"" -- cmd\.exe \/d \/c/);
	assert.match(script, /metapi-onboarding\.cmd/);
});

test("local release staging is reproducible and keeps DSH rc peer resolution", () => {
	const script = readRepo("scripts/local-release.mjs");
	assert.match(script, /--offline-model-data/);
	assert.match(script, /"--legacy-peer-deps"/);
	assert.match(script, /for \(const command of \["metapi", "pi"\]\)/);
});

test("runtime launcher prefers bundled Node but permits the selected system runtime", () => {
	const launcher = readRepo("scripts/windows-installer/metapi.cmd");
	assert.match(launcher, /runtime\\node\.exe/);
	assert.match(launcher, /where node\.exe/);
	assert.match(launcher, /The installed Node\.js will still be used as requested/);
	assert.match(launcher, /%METAPI_NODE%.*%METAPI_CLI%/);
});
