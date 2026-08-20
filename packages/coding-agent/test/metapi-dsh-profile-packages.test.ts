import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileEnvironmentDescriptor } from "../src/core/profile-agent-runtime.ts";
import { dshProfilePackageManager, resolveCorepackPnpmShimDirectory } from "../src/meldra/dsh-profile-packages.ts";

function writeFakePnpm(directory: string): void {
	if (process.platform === "win32") {
		writeFileSync(join(directory, "pnpm.cmd"), "@echo off\r\necho fake-pnpm %*\r\n", "utf8");
		return;
	}
	const path = join(directory, "pnpm");
	writeFileSync(path, "#!/bin/sh\nprintf 'fake-pnpm %s\\n' \"$*\"\n", "utf8");
	chmodSync(path, 0o755);
}

describe("DSH Profile package manager", () => {
	const tempDirs: string[] = [];
	const originalPath = process.env.PATH;

	afterEach(() => {
		process.env.PATH = originalPath;
		vi.restoreAllMocks();
		for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
	});

	it("snapshots and restores portable provider package declarations", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-dsh-package-config-"));
		tempDirs.push(root);
		const profile: ProfileEnvironmentDescriptor = {
			name: "research",
			displayName: "Research",
			agentDir: join(root, "agent"),
			cwd: root,
			compatibility: false,
			runtime: { provider: "deepseek-harness" },
		};
		const manifestPath = join(profile.agentDir, "dsh-runtime", "profiles", "meldra", "package.json");
		mkdirSync(dirname(manifestPath), { recursive: true });
		writeFileSync(
			manifestPath,
			JSON.stringify({ dependencies: { "@example/plugin": "1.2.3", local: "link:C:/plugins/local" } }),
			"utf8",
		);

		await expect(dshProfilePackageManager.snapshot?.(profile, { channel: "stable" })).resolves.toEqual({
			channel: "stable",
			plugins: ["@example/plugin@1.2.3", "local@link:C:/plugins/local"],
		});
		const execute = vi.spyOn(dshProfilePackageManager, "execute").mockResolvedValue({ code: 0, output: "ok" });
		await expect(
			dshProfilePackageManager.restore?.(profile, {
				plugins: [" npm:@example/plugin@1.2.3 ", "github:example/plugin"],
			}),
		).resolves.toEqual({ code: 0, output: "ok\nok", verificationRequired: true });
		expect(execute).toHaveBeenNthCalledWith(
			1,
			profile,
			{
				operation: "add",
				source: "npm:@example/plugin@1.2.3",
			},
			undefined,
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			profile,
			{
				operation: "add",
				source: "github:example/plugin",
			},
			undefined,
		);
		await expect(dshProfilePackageManager.restore?.(profile, { plugins: [""] })).resolves.toEqual({
			code: 2,
			output: 'Harness Runtime config field "plugins" must be an array of non-empty sources.',
		});
	});

	it("prefers the Meldra shim directory and falls back to the legacy MetaPi directory", () => {
		const root = mkdtempSync(join(tmpdir(), "meldra-dsh-shim-"));
		tempDirs.push(root);
		const agentDir = join(root, "agent");
		const legacyDirectory = join(agentDir, "dsh-runtime", ".metapi-bin");
		const meldraDirectory = join(agentDir, "dsh-runtime", ".meldra-bin");
		mkdirSync(legacyDirectory, { recursive: true });
		writeFakePnpm(legacyDirectory);

		expect(resolveCorepackPnpmShimDirectory(agentDir)).toBe(legacyDirectory);

		mkdirSync(meldraDirectory, { recursive: true });
		writeFakePnpm(meldraDirectory);
		expect(resolveCorepackPnpmShimDirectory(agentDir)).toBe(meldraDirectory);
	});

	it("forwards a unified list request through the native DSH profile CLI", async () => {
		const root = mkdtempSync(join(tmpdir(), "metapi-dsh-packages-"));
		tempDirs.push(root);
		const binDir = join(root, "bin");
		const agentDir = join(root, "profile", "agent");
		const cwd = join(root, "workspace");
		mkdirSync(binDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFakePnpm(binDir);
		process.env.PATH = [binDir, originalPath].filter(Boolean).join(delimiter);
		const profile: ProfileEnvironmentDescriptor = {
			name: "research",
			displayName: "Research",
			agentDir,
			cwd,
			compatibility: false,
			runtime: { provider: "deepseek-harness" },
		};

		const result = await dshProfilePackageManager.execute(profile, { operation: "list" });

		expect(result.code).toBe(0);
		expect(result.output).toContain("fake-pnpm list --depth 0");
		const manifestPath = join(agentDir, "dsh-runtime", "profiles", "meldra", "package.json");
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			dsh: { profile: { bundles: string[] } };
		};
		expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
	}, 60_000);
});
