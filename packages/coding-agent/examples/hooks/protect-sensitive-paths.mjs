#!/usr/bin/env node

import { basename, relative, resolve } from "node:path";

const MAX_INPUT_CHARS = 1_000_000;
const ENV_TEMPLATE_NAMES = new Set([".env.example", ".env.sample", ".env.template"]);

async function readHookInput() {
	let raw = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		raw += chunk;
		if (raw.length > MAX_INPUT_CHARS) throw new Error("Hook input exceeds 1,000,000 characters");
	}
	const value = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hook input must be an object");
	return value;
}

let input;
try {
	input = await readHookInput();
} catch (error) {
	console.error(`Invalid Hook input: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

if (input.hook_event_name !== "PreToolUse") process.exit(0);
const rawPath = input.tool_input?.path ?? input.tool_input?.file_path;
if (typeof rawPath !== "string" || rawPath.length === 0) process.exit(0);

const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const absolutePath = resolve(cwd, rawPath);
const projectPath = relative(cwd, absolutePath).replaceAll("\\", "/");
const segments = projectPath.toLowerCase().split("/").filter(Boolean);
const fileName = basename(absolutePath).toLowerCase();
const protectedGitPath = segments.includes(".git");
const protectedEnvFile =
	(fileName === ".env" || fileName.startsWith(".env.")) && !ENV_TEMPLATE_NAMES.has(fileName);

if (protectedGitPath || protectedEnvFile) {
	console.error(`Blocked by example Hook: protected path ${JSON.stringify(rawPath)}`);
	process.exit(2);
}
