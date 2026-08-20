import { StringDecoder } from "node:string_decoder";
import { spawnProcess, waitForChildProcess } from "../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../utils/shell.ts";
import type { MeldraHookInput, MeldraHookRunResult, ResolvedMeldraCommandHook } from "./types.ts";

const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_OUTPUT_CHARS = 200_000;

function collect(current: string, chunk: string): string {
	const next = current + chunk;
	return next.length <= MAX_OUTPUT_CHARS ? next : `[output truncated]\n${next.slice(-MAX_OUTPUT_CHARS)}`;
}

function parseOutput(stdout: string): Record<string, unknown> | undefined {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		const value = JSON.parse(trimmed) as unknown;
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

const CLAUDE_PROJECT_PLACEHOLDER = "${" + "CLAUDE_PROJECT_DIR}";
const MELDRA_PROJECT_PLACEHOLDER = "${" + "MELDRA_PROJECT_DIR}";

function substituteProjectDir(value: string, cwd: string): string {
	return value.replaceAll(CLAUDE_PROJECT_PLACEHOLDER, cwd).replaceAll(MELDRA_PROJECT_PLACEHOLDER, cwd);
}

function spawnSpec(
	hook: ResolvedMeldraCommandHook,
	cwd: string,
	shellPath?: string,
): { command: string; args: string[] } {
	if (hook.args) {
		return {
			command: substituteProjectDir(hook.command, cwd),
			args: hook.args.map((value) => substituteProjectDir(value, cwd)),
		};
	}
	if (hook.shell === "powershell") {
		return {
			command: process.platform === "win32" ? "powershell.exe" : "pwsh",
			args: ["-NoProfile", "-Command", hook.command],
		};
	}
	const shell = getShellConfig(shellPath);
	if (shell.commandTransport === "stdin") {
		throw new Error("The configured legacy shell cannot carry both a hook command and JSON stdin");
	}
	return { command: shell.shell, args: [...shell.args, hook.command] };
}

export async function runMeldraCommandHook(options: {
	hook: ResolvedMeldraCommandHook;
	input: MeldraHookInput;
	cwd: string;
	signal?: AbortSignal;
	shellPath?: string;
}): Promise<MeldraHookRunResult> {
	const { hook, input, cwd, signal, shellPath } = options;
	if (signal?.aborted) return { hook, status: "aborted", code: 1, stdout: "", stderr: "" };
	let spec: { command: string; args: string[] };
	try {
		spec = spawnSpec(hook, cwd, shellPath);
	} catch (error) {
		return {
			hook,
			status: "error",
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
		};
	}

	let child: ReturnType<typeof spawnProcess>;
	try {
		child = spawnProcess(spec.command, spec.args, {
			cwd,
			detached: process.platform !== "win32",
			env: { ...getShellEnv(), CLAUDE_PROJECT_DIR: cwd, MELDRA_PROJECT_DIR: cwd },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
	} catch (error) {
		return {
			hook,
			status: "error",
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
		};
	}

	return await new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let aborted = false;
		let settled = false;
		const timeoutMs = Math.min((hook.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000, MAX_TIMEOUT_MS);
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		if (child.pid) trackDetachedChildPid(child.pid);
		const stop = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		const onAbort = () => {
			aborted = true;
			stop();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, timeoutMs);
		if (signal) signal.addEventListener("abort", onAbort, { once: true });

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = collect(stdout, stdoutDecoder.write(chunk));
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = collect(stderr, stderrDecoder.write(chunk));
		});
		child.stdout?.once("end", () => {
			stdout = collect(stdout, stdoutDecoder.end());
		});
		child.stderr?.once("end", () => {
			stderr = collect(stderr, stderrDecoder.end());
		});
		child.stdin?.on("error", () => {});
		child.stdin?.end(JSON.stringify(input));

		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			if (child.pid) untrackDetachedChildPid(child.pid);
			const status = aborted
				? "aborted"
				: timedOut
					? "timeout"
					: code === 2
						? "block"
						: code === 0
							? "success"
							: "error";
			resolve({ hook, status, code, stdout, stderr, ...(code === 0 ? { output: parseOutput(stdout) } : {}) });
		};
		child.once("error", (error) => {
			stderr = collect(stderr, error.message);
			finish(1);
		});
		waitForChildProcess(child)
			.then((code) => finish(code ?? 1))
			.catch(() => finish(1));
	});
}

export async function runMeldraCommandHooks(options: {
	hooks: ResolvedMeldraCommandHook[];
	input: MeldraHookInput;
	cwd: string;
	signal?: AbortSignal;
	shellPath?: string;
}): Promise<MeldraHookRunResult[]> {
	return await Promise.all(options.hooks.map((hook) => runMeldraCommandHook({ ...options, hook })));
}
