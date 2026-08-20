export const MELDRA_HOOK_EVENTS = [
	"SessionStart",
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"AgentStart",
	"AgentEnd",
	"TurnStart",
	"TurnEnd",
	"Stop",
	"SessionEnd",
] as const;

export type MeldraHookEventName = (typeof MELDRA_HOOK_EVENTS)[number];
export type MeldraHookSource = "profile" | "project";

export interface MeldraCommandHook {
	type: "command";
	command: string;
	args?: string[];
	timeout?: number;
	shell?: "bash" | "powershell";
	if?: string;
}

export interface MeldraHookMatcherGroup {
	matcher?: string;
	hooks: MeldraCommandHook[];
}

export type MeldraHooksSettings = Partial<Record<MeldraHookEventName, MeldraHookMatcherGroup[]>>;

export interface ResolvedMeldraCommandHook extends MeldraCommandHook {
	source: MeldraHookSource;
	matcher?: string;
}

export interface ResolvedMeldraHooks {
	disabled: boolean;
	events: Record<MeldraHookEventName, ResolvedMeldraCommandHook[]>;
	diagnostics: string[];
}

export interface MeldraHooksRuntimeConfig {
	hooks: ResolvedMeldraHooks;
	cwd: string;
	shellPath?: string;
}

export interface MeldraHookInput extends Record<string, unknown> {
	session_id: string;
	cwd: string;
	hook_event_name: MeldraHookEventName;
}

export interface MeldraHookRunResult {
	hook: ResolvedMeldraCommandHook;
	status: "success" | "block" | "error" | "timeout" | "aborted";
	code: number;
	stdout: string;
	stderr: string;
	output?: Record<string, unknown>;
}
