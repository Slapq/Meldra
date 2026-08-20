import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type MeldraHookInput, type ResolvedMeldraCommandHook, runMeldraCommandHook } from "../src/hooks/index.ts";

const dirs: string[] = [];

function fixture(source: string): { cwd: string; hook: ResolvedMeldraCommandHook } {
	const cwd = mkdtempSync(join(tmpdir(), "meldra-hook-"));
	dirs.push(cwd);
	const path = join(cwd, "hook.mjs");
	writeFileSync(path, source, "utf8");
	return {
		cwd,
		hook: { type: "command", command: process.execPath, args: [path], source: "profile", timeout: 2 },
	};
}

const input: MeldraHookInput = {
	session_id: "session-1",
	cwd: "C:/workspace",
	hook_event_name: "PreToolUse",
	tool_name: "Bash",
};

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Meldra command hook runner", () => {
	it("writes JSON to stdin and parses structured stdout", async () => {
		const { cwd, hook } = fixture(`
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => data += chunk);
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ seen: JSON.parse(data).tool_name, project: process.env.CLAUDE_PROJECT_DIR })));
`);
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result.status).toBe("success");
		expect(result.output).toEqual({ seen: "Bash", project: cwd });
	});

	it("substitutes project placeholders in exec-form arguments", async () => {
		const { cwd, hook } = fixture(`process.stdout.write(JSON.stringify({ argv: process.argv[2] }));`);
		hook.args = ["${" + "MELDRA_PROJECT_DIR}/hook.mjs", "${" + "CLAUDE_PROJECT_DIR}/target.txt"];
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result.output).toEqual({ argv: `${cwd}/target.txt` });
	});

	it("preserves UTF-8 characters split across output chunks", async () => {
		const { cwd, hook } = fixture(`
const payload = Buffer.from(JSON.stringify({ message: "你" }));
const split = payload.indexOf(Buffer.from("你")) + 1;
process.stdout.write(payload.subarray(0, split));
setTimeout(() => process.stdout.write(payload.subarray(split)), 20);
`);
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result.stdout).toBe('{"message":"你"}');
		expect(result.output).toEqual({ message: "你" });
	});

	it.runIf(process.platform === "win32")("executes Windows command shims in exec form", async () => {
		const { cwd, hook } = fixture("");
		const command = join(cwd, "hook.cmd");
		writeFileSync(command, '@echo off\r\necho {"message":"cmd"}\r\n', "utf8");
		hook.command = command;
		hook.args = ["literal-argument"];
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result.status).toBe("success");
		expect(result.output).toEqual({ message: "cmd" });
	});

	it("normalizes synchronous spawn failures", async () => {
		const { cwd, hook } = fixture("");
		hook.command = "invalid\\0command";
		hook.args = [];
		await expect(runMeldraCommandHook({ hook, input, cwd })).resolves.toMatchObject({
			status: "error",
			code: 1,
		});
	});

	it("maps exit code 2 to a blocking result", async () => {
		const { cwd, hook } = fixture(`process.stderr.write("blocked by policy"); process.exit(2);`);
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result).toMatchObject({ status: "block", code: 2, stderr: "blocked by policy" });
	});

	it("terminates timed out hooks", async () => {
		const { cwd, hook } = fixture(`setInterval(() => {}, 1000);`);
		hook.timeout = 0.02;
		const result = await runMeldraCommandHook({ hook, input, cwd });
		expect(result.status).toBe("timeout");
	});
});
