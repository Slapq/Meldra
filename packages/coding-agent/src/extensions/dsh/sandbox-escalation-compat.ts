import type { Context } from "@deepseek-ai/cordis";
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import {
	TOOL_RUNTIME_SCHEDULER,
	type ToolExecutionInput,
	type ToolRuntime,
	type ToolRuntimeScheduler,
} from "@deepseek-ai/dsh-tools";

export const name = "meldra-sandbox-escalation-compat";
export const inject = ["tools", "sandboxPolicy"];

const ESCALATING_TOOLS = new Set(["bash", "pwsh", "write", "edit"]);
const MODE_RANK: Record<SandboxMode, number> = {
	"read-only": 0,
	"workspace-write": 1,
	"danger-full-access": 2,
};
const ESCALATION_TARGET_RANK: Partial<Record<SandboxMode, number>> = {
	"workspace-write": MODE_RANK["workspace-write"],
	"danger-full-access": MODE_RANK["danger-full-access"],
};
const CORDIS_ORIGINAL = Symbol.for("cordis.original");
const INSTALLATION = Symbol.for("meldra.dsh.sandbox-escalation-compat.installation");

interface Installation {
	active: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEscalationTarget(value: unknown): value is "workspace-write" | "danger-full-access" {
	return typeof value === "string" && Object.hasOwn(ESCALATION_TARGET_RANK, value);
}

export function normalizeCoveredSandboxEscalation(
	input: ToolExecutionInput,
	effectiveMode: SandboxMode,
): ToolExecutionInput {
	if (!ESCALATING_TOOLS.has(input.name) || !isRecord(input.arguments)) return input;
	const requestedMode = input.arguments.sandbox_permissions;
	if (!isEscalationTarget(requestedMode) || typeof input.arguments.justification !== "string") return input;
	if ((ESCALATION_TARGET_RANK[requestedMode] as number) > MODE_RANK[effectiveMode]) return input;

	const normalizedArguments = { ...input.arguments };
	delete normalizedArguments.sandbox_permissions;
	delete normalizedArguments.justification;
	return { ...input, arguments: normalizedArguments };
}

function originalService<T extends object>(service: T): T {
	return ((service as unknown as Record<symbol, unknown>)[CORDIS_ORIGINAL] ?? service) as T;
}

export function apply(ctx: Context): void {
	const runtime = originalService(ctx.tools);
	const sandboxPolicy = originalService(ctx.sandboxPolicy) as SandboxPolicyService;
	const installationRecord = runtime as unknown as Record<symbol, unknown>;
	if (installationRecord[INSTALLATION] !== undefined) throw new Error(`${name} is already installed`);

	const scheduler: ToolRuntimeScheduler = runtime[TOOL_RUNTIME_SCHEDULER];
	const originalExecute = runtime.execute;
	const originalPrepare = scheduler.prepare;
	const installation: Installation = { active: true };
	const normalize = (input: ToolExecutionInput): ToolExecutionInput => {
		if (!installation.active || !ESCALATING_TOOLS.has(input.name) || !isRecord(input.arguments)) return input;
		if (input.arguments.sandbox_permissions === undefined) return input;
		const policy = sandboxPolicy.resolve(input.agent === undefined ? {} : { session: input.agent.session });
		return normalizeCoveredSandboxEscalation(input, policy.mode);
	};
	const patchedExecute = function (this: ToolRuntime, input: ToolExecutionInput) {
		return originalExecute.call(runtime, normalize(input));
	};
	const patchedPrepare = function (this: ToolRuntimeScheduler, input: ToolExecutionInput) {
		return originalPrepare.call(scheduler, normalize(input));
	};
	const dispose = () => {
		installation.active = false;
		if (runtime.execute === patchedExecute) runtime.execute = originalExecute;
		if (scheduler.prepare === patchedPrepare) scheduler.prepare = originalPrepare;
		if (installationRecord[INSTALLATION] === installation) delete installationRecord[INSTALLATION];
	};

	try {
		installationRecord[INSTALLATION] = installation;
		runtime.execute = patchedExecute;
		scheduler.prepare = patchedPrepare;
		ctx.effect(() => dispose, "DSH sandbox escalation compatibility wrapper teardown");
	} catch (error) {
		dispose();
		throw error;
	}
}
