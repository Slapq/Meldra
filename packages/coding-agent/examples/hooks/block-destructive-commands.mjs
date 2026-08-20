#!/usr/bin/env node

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

if (input.hook_event_name !== "PreToolUse") process.exit(0);
const command = input.tool_input?.command;
if (typeof command !== "string") process.exit(0);

const checks = [
	{
		label: "recursive forced removal",
		matches: () =>
			/\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\b/i.test(command) ||
			(/\bRemove-Item\b/i.test(command) && /(?:^|\s)-Recurse\b/i.test(command) && /(?:^|\s)-Force\b/i.test(command)),
	},
	{ label: "hard Git reset", matches: () => /\bgit\s+reset\s+--hard\b/i.test(command) },
	{ label: "forced Git clean", matches: () => /\bgit\s+clean\s+(?:-[a-z]*f[a-z]*\b|--force\b)/i.test(command) },
	{ label: "forced Git push", matches: () => /\bgit\s+push\b[^\r\n]*(?:--force(?:-with-lease)?\b|-f\b)/i.test(command) },
];

const blocked = checks.find((check) => check.matches());
if (blocked) {
	console.error(`Blocked by example Hook: ${blocked.label}`);
	process.exit(2);
}
