import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	runtimeInstallDependencies,
	runtimeInstallSpecs,
	runtimeOverrides,
	NATIVE_RUNTIME_PACKAGES,
	nativeRuntimeRebuildArgs,
	prepareNativeRuntime,
} from "./prepare-native-runtime.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "metapi-native-runtime-"));
	for (const name of NATIVE_RUNTIME_PACKAGES) {
		const directory = join(root, "node_modules", ...name.split("/"));
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "package.json"), JSON.stringify({ name }));
	}
	return root;
}

test("rebuilds only the reviewed native runtime package scripts", () => {
	assert.deepEqual(NATIVE_RUNTIME_PACKAGES, ["@deepseek-ai/dsh-subprocess-local", "koffi", "node-pty"]);
	assert.deepEqual(nativeRuntimeRebuildArgs(), [
		"rebuild",
		"--foreground-scripts",
		"@deepseek-ai/dsh-subprocess-local",
		"koffi",
		"node-pty",
	]);
});

test("dry run requires every native runtime package and does not execute npm", () => {
	const root = fixture();
	try {
		const result = prepareNativeRuntime({ cwd: root, dryRun: true });
		assert.equal(result.cwd, root);
		assert.deepEqual(result.args.slice(-nativeRuntimeRebuildArgs().length), nativeRuntimeRebuildArgs());
		if (process.platform === "win32") {
			assert.equal(result.command, process.execPath);
			assert.match(result.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
		}
		rmSync(join(root, "node_modules", "node-pty"), { recursive: true, force: true });
		assert.throws(() => prepareNativeRuntime({ cwd: root, dryRun: true }), /node-pty/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("release lock preserves the reviewed DSH rc.1 runtime versions", () => {
	const repoRoot = new URL("../", import.meta.url);
	const root = fileURLToPath(repoRoot);
	const overrides = runtimeOverrides(root);
	assert.equal(overrides["@deepseek-ai/dsh"], "0.1.1-rc.1");
	assert.equal(overrides["@deepseek-ai/dsh-subprocess-local"], "0.1.1-rc.1");
	assert.equal(overrides["node-pty"], "1.2.0-beta.15");
	assert.equal(overrides.koffi, "3.1.6");
	const linuxSpecs = runtimeInstallSpecs(root, { platform: "linux", arch: "x64", libc: "musl" });
	assert.ok(linuxSpecs.length > 170);
	assert.ok(linuxSpecs.includes("@deepseek-ai/dsh-scope@0.1.1-rc.1"));
	assert.ok(linuxSpecs.includes("@deepseek-ai/dsh-timeout@0.1.1-rc.1"));
	assert.ok(linuxSpecs.includes("@deepseek-ai/cordis-plugin-group@1.0.1"));
	assert.ok(linuxSpecs.includes("@deepseek-ai/node-addon-landlock-run-linux-x64@0.1.1"));
	assert.ok(!linuxSpecs.includes("@deepseek-ai/node-addon-landlock-run-linux-arm64@0.1.1"));
	const windowsDependencies = runtimeInstallDependencies(root, { platform: "win32", arch: "x64", libc: undefined });
	assert.equal(windowsDependencies["@deepseek-ai/dsh"], "0.1.1-rc.1");
	assert.equal(windowsDependencies["@deepseek-ai/dsh-scope"], "0.1.1-rc.1");
	const windowsSpecs = runtimeInstallSpecs(root, { platform: "win32", arch: "x64", libc: undefined });
	assert.ok(windowsSpecs.includes("@deepseek-ai/dsh-scope@0.1.1-rc.1"));
	assert.ok(!windowsSpecs.some((spec) => spec.includes("landlock-run-linux")));
});

test("release staging prepares native modules and ships the Starter Bundle", () => {
	const repoRoot = new URL("../", import.meta.url);
	const localRelease = readFileSync(new URL("scripts/local-release.mjs", repoRoot), "utf8");
	const binaryBuild = readFileSync(new URL("scripts/build-binaries.sh", repoRoot), "utf8");
	assert.match(localRelease, /runtimeOverrides\(repoRoot\)/);
	assert.match(localRelease, /runtimeInstallDependencies\(repoRoot\)/);
	assert.match(localRelease, /prepare-native-runtime\.mjs/);
	assert.match(binaryBuild, /cp -r starter-profile "\$OUTPUT_DIR\/\$platform\/"/);
});
