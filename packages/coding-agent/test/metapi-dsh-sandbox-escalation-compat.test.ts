import type { Context } from "@deepseek-ai/cordis";
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox";
import {
	TOOL_RUNTIME_SCHEDULER,
	type ToolExecutionInput,
	type ToolRuntime,
	type ToolRuntimeScheduler,
} from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { apply, normalizeCoveredSandboxEscalation } from "../src/extensions/dsh/sandbox-escalation-compat.ts";

const CORDIS_ORIGINAL = Symbol.for("cordis.original");

function execution(name: string, argumentsValue: unknown): ToolExecutionInput {
	return {
		callId: "compat-test" as ToolExecutionInput["callId"],
		name,
		arguments: argumentsValue,
		signal: new AbortController().signal,
	};
}

describe("DSH sandbox escalation compatibility", () => {
	it.each([
		["danger-full-access", "danger-full-access"],
		["workspace-write", "danger-full-access"],
		["workspace-write", "workspace-write"],
	] as const)("removes a covered %s request under %s", (requestedMode, effectiveMode) => {
		const argumentsValue = Object.freeze({
			command: "npm test",
			sandbox_permissions: requestedMode,
			justification: "",
		});
		const original = execution("pwsh", argumentsValue);
		const normalized = normalizeCoveredSandboxEscalation(original, effectiveMode);

		expect(normalized.arguments).toEqual({ command: "npm test" });
		expect(normalized).not.toBe(original);
		expect(argumentsValue).toHaveProperty("sandbox_permissions", requestedMode);
	});

	it("preserves a genuine widening request for native approval", () => {
		const original = execution("pwsh", {
			command: "npm test",
			sandbox_permissions: "danger-full-access",
			justification: "Write outside the workspace.",
		});

		expect(normalizeCoveredSandboxEscalation(original, "workspace-write")).toBe(original);
	});

	it.each([
		{ sandbox_permissions: "read-only", justification: "invalid target" },
		{ sandbox_permissions: "unknown", justification: "invalid target" },
		{ sandbox_permissions: "workspace-write" },
		{ justification: "missing target" },
	] as const)("preserves malformed or unsupported escalation arguments: %j", (extra) => {
		const original = execution("pwsh", { command: "npm test", ...extra });

		expect(normalizeCoveredSandboxEscalation(original, "danger-full-access")).toBe(original);
	});

	it("leaves unrelated tools and non-object arguments unchanged", () => {
		const unrelated = execution("web_fetch", {
			sandbox_permissions: "workspace-write",
			justification: "not a sandbox tool",
		});
		const nonObject = execution("pwsh", "npm test");

		expect(normalizeCoveredSandboxEscalation(unrelated, "danger-full-access")).toBe(unrelated);
		expect(normalizeCoveredSandboxEscalation(nonObject, "danger-full-access")).toBe(nonObject);
	});

	it("normalizes both ToolRuntime entry points before DSH snapshots arguments", async () => {
		let effectiveMode: SandboxMode = "danger-full-access";
		let dispose: (() => void) | undefined;
		const execute = vi.fn(async (_input: ToolExecutionInput) => ({ isError: false }));
		const prepare = vi.fn(async (_input: ToolExecutionInput) => ({ kind: "dispatch" }));
		const scheduler = { prepare } as unknown as ToolRuntimeScheduler;
		const runtime = {
			execute,
			[TOOL_RUNTIME_SCHEDULER]: scheduler,
		} as unknown as ToolRuntime;
		const toolsView = { [CORDIS_ORIGINAL]: runtime };
		const policyView = {
			[CORDIS_ORIGINAL]: { resolve: () => ({ mode: effectiveMode }) },
		};
		const ctx = {
			tools: toolsView,
			sandboxPolicy: policyView,
			effect: (register: () => () => void) => {
				dispose = register();
			},
		} as unknown as Context;
		const redundant = execution("pwsh", {
			command: "npm test",
			sandbox_permissions: "danger-full-access",
			justification: "",
		});

		apply(ctx);
		await runtime.execute(redundant);
		await scheduler.prepare(redundant);
		expect(execute.mock.calls[0]?.[0].arguments).toEqual({ command: "npm test" });
		expect(prepare.mock.calls[0]?.[0].arguments).toEqual({ command: "npm test" });

		effectiveMode = "workspace-write";
		const widening = execution("pwsh", {
			command: "npm test",
			sandbox_permissions: "danger-full-access",
			justification: "Write outside the workspace.",
		});
		await runtime.execute(widening);
		expect(execute.mock.calls[1]?.[0]).toBe(widening);

		dispose?.();
		expect(runtime.execute).toBe(execute);
		expect(scheduler.prepare).toBe(prepare);
	});
});
