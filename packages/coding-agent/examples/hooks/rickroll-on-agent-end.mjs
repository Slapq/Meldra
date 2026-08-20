#!/usr/bin/env node

import { spawn } from "node:child_process";

const MAX_INPUT_CHARS = 1_000_000;
const RICKROLL_URL = "https://www.bilibili.com/video/BV1UT42167xb/?autoplay=1";

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

function browserCommand() {
	if (process.platform === "win32") {
		return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", RICKROLL_URL] };
	}
	if (process.platform === "darwin") return { command: "open", args: [RICKROLL_URL] };
	return { command: "xdg-open", args: [RICKROLL_URL] };
}

let input;
try {
	input = await readHookInput();
} catch (error) {
	console.error(`Invalid Hook input: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

if (input.hook_event_name !== "AgentEnd") {
	console.error(`Expected AgentEnd, received ${String(input.hook_event_name)}`);
	process.exit(1);
}

if (process.argv.includes("--dry-run")) {
	process.stdout.write(JSON.stringify({ url: RICKROLL_URL, autoplayMayBeBlocked: true }));
	process.exit(0);
}

const { command, args } = browserCommand();
try {
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	await new Promise((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	child.unref();
} catch (error) {
	console.error(`Cannot open the default browser: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
