#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const MAX_INPUT_CHARS = 1_000_000;

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

const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const logPath = process.argv[2] ? resolve(cwd, process.argv[2]) : join(cwd, ".pi", "hooks", "events.jsonl");
const entry = {
	timestamp: new Date().toISOString(),
	hook_event_name: input.hook_event_name,
	session_id: input.session_id,
	cwd,
	...(typeof input.source === "string" ? { source: input.source } : {}),
	...(typeof input.reason === "string" ? { reason: input.reason } : {}),
	...(typeof input.tool_name === "string" ? { tool_name: input.tool_name } : {}),
	...(typeof input.tool_use_id === "string" ? { tool_use_id: input.tool_use_id } : {}),
	...(typeof input.turn_index === "number" ? { turn_index: input.turn_index } : {}),
	...(typeof input.timestamp === "number" ? { event_timestamp: input.timestamp } : {}),
	...(typeof input.runtime_turn === "number" ? { runtime_turn: input.runtime_turn } : {}),
	...(typeof input.runtime_step === "number" ? { runtime_step: input.runtime_step } : {}),
};

try {
	await mkdir(dirname(logPath), { recursive: true });
	await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
} catch (error) {
	console.error(`Cannot append Hook audit event: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
