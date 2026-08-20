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
