import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "./agent-session.ts";
import type { ModelRuntime } from "./model-runtime.ts";

export type ProfileToolPresentation =
	| {
			kind: "terminal";
			title?: string;
			description?: string;
			cwd?: string;
			output?: string;
			exitCode?: number;
			signal?: string;
	  }
	| {
			kind: "diff";
			title?: string;
			files: Array<{ path: string; oldText: string | null; newText: string }>;
	  }
	| {
			kind: "read";
			title?: string;
			path: string;
			offset: number;
			totalLines: number;
			lines: Array<{ number: number; text: string }>;
	  }
	| {
			kind: "search";
			title?: string;
			entries: Array<{ path: string; lineNumber?: number; text?: string }>;
			total: number;
			truncated: boolean;
	  }
	| {
			kind: "web-search";
			title?: string;
			sources: Array<{
				url: string;
				title?: string;
				snippet?: string;
				publishedAt?: string;
			}>;
			answer?: string;
			truncated: boolean;
	  }
	| {
			kind: "web-fetch";
			title?: string;
			url: string;
			statusCode: number;
			truncated: boolean;
	  };

export function isProfileToolPresentation(value: unknown): value is ProfileToolPresentation {
	if (!value || typeof value !== "object" || !("kind" in value)) return false;
	const presentation = value as Record<string, unknown>;
	if (presentation.title !== undefined && typeof presentation.title !== "string") return false;
	if (presentation.kind === "terminal") {
		return (
			(presentation.description === undefined || typeof presentation.description === "string") &&
			(presentation.cwd === undefined || typeof presentation.cwd === "string") &&
			(presentation.output === undefined || typeof presentation.output === "string") &&
			(presentation.exitCode === undefined || typeof presentation.exitCode === "number") &&
			(presentation.signal === undefined || typeof presentation.signal === "string")
		);
	}
	if (presentation.kind === "diff") {
		return (
			Array.isArray(presentation.files) &&
			presentation.files.every(
				(file) =>
					file !== null &&
					typeof file === "object" &&
					typeof file.path === "string" &&
					(file.oldText === null || typeof file.oldText === "string") &&
					typeof file.newText === "string",
			)
		);
	}
	if (presentation.kind === "read") {
		return (
			typeof presentation.path === "string" &&
			typeof presentation.offset === "number" &&
			typeof presentation.totalLines === "number" &&
			Array.isArray(presentation.lines) &&
			presentation.lines.every(
				(line) =>
					line !== null &&
					typeof line === "object" &&
					typeof line.number === "number" &&
					typeof line.text === "string",
			)
		);
	}
	if (presentation.kind === "search") {
		return (
			typeof presentation.total === "number" &&
			typeof presentation.truncated === "boolean" &&
			Array.isArray(presentation.entries) &&
			presentation.entries.every(
				(entry) =>
					entry !== null &&
					typeof entry === "object" &&
					typeof entry.path === "string" &&
					(entry.lineNumber === undefined || typeof entry.lineNumber === "number") &&
					(entry.text === undefined || typeof entry.text === "string"),
			)
		);
	}
	if (presentation.kind === "web-search") {
		return (
			typeof presentation.truncated === "boolean" &&
			(presentation.answer === undefined || typeof presentation.answer === "string") &&
			Array.isArray(presentation.sources) &&
			presentation.sources.every(
				(source) =>
					source !== null &&
					typeof source === "object" &&
					typeof source.url === "string" &&
					(source.title === undefined || typeof source.title === "string") &&
					(source.snippet === undefined || typeof source.snippet === "string") &&
					(source.publishedAt === undefined || typeof source.publishedAt === "string"),
			)
		);
	}
	if (presentation.kind === "web-fetch") {
		return (
			typeof presentation.url === "string" &&
			typeof presentation.statusCode === "number" &&
			typeof presentation.truncated === "boolean"
		);
	}
	return false;
}

export interface ProfileToolResultDetails {
	profilePresentation?: ProfileToolPresentation;
	durationMs?: number;
	[key: string]: unknown;
}

export interface ProfileRuntimeSelection {
	/** Stable provider identity declared by the active Profile. */
	provider: string;
	/** Opaque portable configuration interpreted only by the matching provider. */
	config?: unknown;
}

export interface ProfileEnvironmentDescriptor {
	name: string;
	displayName: string;
	agentDir: string;
	cwd: string;
	compatibility: boolean;
	runtime?: ProfileRuntimeSelection;
}

export interface ProfileRuntimeDescriptor extends ProfileEnvironmentDescriptor {
	modelRuntime: ModelRuntime;
}

export type ProfileRuntimePackageRequest =
	| { operation: "list" }
	| { operation: "add"; source: string }
	| { operation: "remove"; packageName: string }
	| { operation: "update" };

export interface ProfileRuntimePackageResult {
	code: number;
	output: string;
	/** A successful mutation still requires a fresh provider Runtime to validate activation. */
	verificationRequired?: boolean;
}

export interface ProfileRuntimePackageVerification {
	activeEntries: number;
	identities?: string[];
}

export interface ProfileRuntimePackageExecutionOptions {
	signal?: AbortSignal;
	onOutput?: (chunk: string) => void;
}

export interface ProfileRuntimePackageManager {
	execute(
		profile: ProfileEnvironmentDescriptor,
		request: ProfileRuntimePackageRequest,
		options?: ProfileRuntimePackageExecutionOptions,
	): Promise<ProfileRuntimePackageResult>;
	/** Validate package activation through a fresh provider-owned Runtime or Loader. */
	verify?(profile: ProfileEnvironmentDescriptor): Promise<ProfileRuntimePackageVerification>;
	/** Capture provider-owned package declarations for a Portable Profile export. */
	snapshot?(profile: ProfileEnvironmentDescriptor, currentConfig: unknown): Promise<unknown>;
	/** Restore provider-owned package declarations during an explicit Profile import/update. */
	restore?(
		profile: ProfileEnvironmentDescriptor,
		config: unknown,
		options?: ProfileRuntimePackageExecutionOptions,
	): Promise<ProfileRuntimePackageResult>;
}

export interface ProfileRuntimeProvider {
	readonly id: string;
	readonly packages?: ProfileRuntimePackageManager;
	supports(profile: ProfileEnvironmentDescriptor): boolean;
	create(profile: ProfileRuntimeDescriptor): Promise<ProfileAgentRuntime> | ProfileAgentRuntime;
}

export function resolveProfileRuntimeProvider(
	providers: readonly ProfileRuntimeProvider[],
	profile: ProfileEnvironmentDescriptor,
): ProfileRuntimeProvider | undefined {
	const matches = providers.filter((provider) => provider.supports(profile));
	if (matches.length > 1) {
		throw new Error(
			`Multiple Profile Runtime providers match Profile "${profile.name}": ${matches.map((item) => item.id).join(", ")}`,
		);
	}
	return matches[0];
}

export async function createProfileRuntime(
	providers: readonly ProfileRuntimeProvider[],
	profile: ProfileRuntimeDescriptor,
): Promise<ProfileAgentRuntime | undefined> {
	return resolveProfileRuntimeProvider(providers, profile)?.create(profile);
}

export interface ProfileAgentRuntimeHost {
	readonly cwd: string;
	readonly sessionId: string;
	/** Persist a provider-owned transcript entry. Set notify=false when a live UI event already rendered it. */
	appendEntry(customType: string, data: unknown, options?: { notify?: boolean }): void;
	/** Emit a transient host UI event. This does not persist a Pi Session message or enter model context. */
	emit(event: AgentSessionEvent): void;
}

export interface ProfileAgentPrompt {
	text: string;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
}

export interface ProfileAgentCommandSurface {
	/**
	 * Built-in command names whose same-name extension command owns discovery and dispatch
	 * while this Runtime is attached. Names without a registered extension command are ignored.
	 */
	preferredExtensionCommands?: readonly string[];
	/** Built-in commands omitted and rejected while this Runtime is attached. */
	hiddenBuiltinCommands?: readonly string[];
	/**
	 * Registered extension command opened by the native double-Escape gesture instead of Pi tree/fork.
	 * The user's explicit `doubleEscapeAction: "none"` still disables the gesture.
	 */
	doubleEscapeExtensionCommand?: string;
}

/**
 * Profile-owned agent backend selected by Meldra's composition root.
 * Ordinary Pi sessions omit this and keep the native Pi agent path.
 */
export interface ProfileAgentRuntime {
	readonly isStreaming: boolean;
	readonly commandSurface?: ProfileAgentCommandSurface;
	/** Apply a user-confirmed Pi model selection before the containing session commits it. */
	selectModel?(model: Model<any>): Promise<void>;
	/** Latest finalized assistant text owned by this Runtime, when it does not use Pi agent state. */
	getLastAssistantText?(): string | undefined;
	attach(host: ProfileAgentRuntimeHost): void;
	prompt(input: ProfileAgentPrompt): Promise<void>;
	abort(): Promise<void>;
	waitForIdle(): Promise<void>;
	dispose(): void | Promise<void>;
}
