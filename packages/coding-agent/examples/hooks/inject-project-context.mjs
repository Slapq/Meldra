#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_INPUT_CHARS = 1_000_000;
const MAX_CONTEXT_CHARS = 20_000;

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

if (input.hook_event_name !== "SessionStart" && input.hook_event_name !== "UserPromptSubmit") process.exit(0);
const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const contextPath = process.argv[2] ? resolve(cwd, process.argv[2]) : join(cwd, ".pi", "hook-context.md");
let context;
try {
	context = await readFile(contextPath, "utf8");
} catch (error) {
	if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") process.exit(0);
	console.error(`Cannot read Hook context: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const clipped =
	context.length <= MAX_CONTEXT_CHARS
		? context
		: `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n[Hook context truncated at ${MAX_CONTEXT_CHARS} characters]`;
process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: input.hook_event_name,
			additionalContext: clipped,
		},
	}),
);
