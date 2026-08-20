#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boot, installFailLoud } from "@deepseek-ai/dsh-app-boot";
import { prepareDshComposition } from "./composition.ts";

const NAME = "meldra-dsh-tui";
const require = createRequire(import.meta.url);
const surfacePath = fileURLToPath(new URL("./surface.patch.yml", import.meta.url));
const installAnchor = require.resolve("@deepseek-ai/dsh/package.json");
const dshHome = process.env.DSH_HOME;
const serverPath = pathToFileURL(fileURLToPath(new URL("./server.js", import.meta.url))).href;
const hooksPath = pathToFileURL(fileURLToPath(new URL("./hooks.js", import.meta.url))).href;
const sandboxEscalationCompatPath = pathToFileURL(
	fileURLToPath(new URL("./sandbox-escalation-compat.js", import.meta.url)),
).href;

if (!existsSync(surfacePath)) {
	throw new Error(`${NAME}: packaged composition assets are missing`);
}
if (!dshHome) throw new Error(`${NAME}: DSH_HOME is required`);

installFailLoud(NAME);
const composition = prepareDshComposition({
	binName: NAME,
	home: dshHome,
	installAnchor,
	surfacePath,
	serverPath,
	hooksPath,
	sandboxEscalationCompatPath,
});
const ctx = await boot(NAME, composition.rootPath, composition.patches);

let disposing = false;
const dispose = async (code: number): Promise<void> => {
	if (disposing) return;
	disposing = true;
	await ctx.fiber.dispose();
	process.exit(code);
};

process.stdin.on("end", () => void dispose(0));
process.on("SIGTERM", () => void dispose(0));
process.on("SIGINT", () => void dispose(130));
