import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { resolvePath } from "../utils/paths.ts";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.ts";
import type {
	ProjectTrustContext,
	ReplacedSessionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import { assertSessionCwdExists } from "./session-cwd.ts";
import { SessionManager } from "./session-manager.ts";

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	projectTrustContext?: ProjectTrustContext;
	profileName?: string;
}) => Promise<CreateAgentSessionRuntimeResult>;

export interface MeldraSessionLifecycle {
	getProfileName(sessionManager: SessionManager): string | undefined;
	setProfileName(sessionManager: SessionManager, profileName: string): void;
	getWorkspaceRoot(sessionManager: SessionManager, cwd: string): string | undefined;
	setWorkspaceRoot(sessionManager: SessionManager, root: string): void;
	getSessionDir(cwd: string, profileName: string): string;
	createEmptyWorkspace(root: string, sessionId: string): string;
	copyWorkspace(sourceCwd: string, root: string, sessionId: string): string;
}

/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 */
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeSessionInvalidate?: () => void;
	private _session: AgentSession;
	private _services: AgentSessionServices;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private _diagnostics: AgentSessionRuntimeDiagnostic[];
	private _modelFallbackMessage?: string;
	private readonly metapiLifecycle?: MeldraSessionLifecycle;

	constructor(
		_session: AgentSession,
		_services: AgentSessionServices,
		createRuntime: CreateAgentSessionRuntimeFactory,
		_diagnostics: AgentSessionRuntimeDiagnostic[] = [],
		_modelFallbackMessage?: string,
		metapiLifecycle?: MeldraSessionLifecycle,
	) {
		this._session = _session;
		this._services = _services;
		this.createRuntime = createRuntime;
		this._diagnostics = _diagnostics;
		this._modelFallbackMessage = _modelFallbackMessage;
		this.metapiLifecycle = metapiLifecycle;
	}

	get services(): AgentSessionServices {
		return this._services;
	}

	get session(): AgentSession {
		return this._session;
	}

	get cwd(): string {
		return this._services.cwd;
	}

	get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
		return this._diagnostics;
	}

	get modelFallbackMessage(): string | undefined {
		return this._modelFallbackMessage;
	}

	setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	/**
	 * Set a synchronous callback that runs after `session_shutdown` handlers finish
	 * but before the current session is invalidated.
	 *
	 * This is for host-owned UI teardown that must not yield to the event loop,
	 * such as detaching extension-provided TUI components before the old extension
	 * context becomes stale.
	 */
	setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
		this.beforeSessionInvalidate = beforeSessionInvalidate;
	}

	private async emitBeforeSwitch(
		reason: "new" | "resume",
		targetSessionFile?: string,
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_switch")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_switch",
			reason,
			targetSessionFile,
		});
		return { cancelled: result?.cancel === true };
	}

	private async emitBeforeFork(
		entryId: string,
		options: { position: "before" | "at" },
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_fork")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_fork",
			entryId,
			...options,
		});
		return { cancelled: result?.cancel === true };
	}

	private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
		// Settle any active response first so the aborted turn (including tool
		// results) is persisted to the outgoing session before it is replaced.
		await this.session.abort();
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason,
			targetSessionFile,
		});
		await this.session.disposeProfileRuntime();
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}

	private getCurrentProfileName(): string | undefined {
		return this.metapiLifecycle?.getProfileName(this.session.sessionManager);
	}

	private apply(result: CreateAgentSessionRuntimeResult): void {
		this._session = result.session;
		this._services = result.services;
		this._diagnostics = result.diagnostics;
		this._modelFallbackMessage = result.modelFallbackMessage;
	}

	private async finishSessionReplacement(withSession?: (ctx: ReplacedSessionContext) => Promise<void>): Promise<void> {
		if (this.rebindSession) {
			await this.rebindSession(this.session);
		}
		if (withSession) {
			await withSession(this.session.createReplacedSessionContext());
		}
	}

	async switchProfile(profileName: string): Promise<{ cancelled: boolean }> {
		if (!this.metapiLifecycle) {
			throw new Error("Profile switching is not available in this runtime");
		}
		return this.newSession({ profileName, preserveWorkspace: true });
	}

	async switchSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
		},
	): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdExists(sessionManager, this.cwd);
		const profileName = this.metapiLifecycle?.getProfileName(sessionManager) ?? this.getCurrentProfileName();
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
				projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
				profileName,
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async newSession(options?: {
		parentSession?: string;
		profileName?: string;
		preserveWorkspace?: boolean;
		setup?: (sessionManager: SessionManager) => Promise<void>;
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
	}): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("new");
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const sourceCwd = this.cwd;
		const profileName = options?.profileName ?? this.getCurrentProfileName();
		const workspaceRoot = this.metapiLifecycle?.getWorkspaceRoot(this.session.sessionManager, sourceCwd);
		let targetCwd = sourceCwd;
		let sessionManager: SessionManager;
		if (workspaceRoot && this.metapiLifecycle && profileName) {
			const provisional = options?.preserveWorkspace ? undefined : SessionManager.inMemory(sourceCwd);
			targetCwd = options?.preserveWorkspace
				? sourceCwd
				: this.metapiLifecycle.createEmptyWorkspace(workspaceRoot, provisional!.getSessionId());
			const sessionDir = this.metapiLifecycle.getSessionDir(targetCwd, profileName);
			sessionManager = this.session.sessionManager.isPersisted()
				? SessionManager.create(
					targetCwd,
					sessionDir,
					provisional ? { id: provisional.getSessionId() } : undefined,
				)
				: provisional
					? SessionManager.inMemory(targetCwd, { id: provisional.getSessionId() })
					: SessionManager.inMemory(targetCwd);
			this.metapiLifecycle.setProfileName(sessionManager, profileName);
			this.metapiLifecycle.setWorkspaceRoot(sessionManager, workspaceRoot);
		} else {
			const sessionDir =
				options?.profileName && this.metapiLifecycle
					? this.metapiLifecycle.getSessionDir(sourceCwd, options.profileName)
					: this.session.sessionManager.getSessionDir();
			sessionManager = this.session.sessionManager.isPersisted()
				? SessionManager.create(sourceCwd, sessionDir)
				: SessionManager.inMemory(sourceCwd);
			if (options?.profileName && this.metapiLifecycle) {
				this.metapiLifecycle.setProfileName(sessionManager, options.profileName);
			}
		}
		if (options?.parentSession) {
			sessionManager.newSession({ parentSession: options.parentSession });
		}

		await this.teardownCurrent("new", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: targetCwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
				profileName,
			}),
		);
		if (options?.setup) {
			await options.setup(this.session.sessionManager);
			this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
		}
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		const position = options?.position ?? "before";
		const beforeResult = await this.emitBeforeFork(entryId, { position });
		if (beforeResult.cancelled) {
			return { cancelled: true };
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;

		const selectedEntry = this.session.sessionManager.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}

		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			selectedText = extractUserMessageText(selectedEntry.message.content);
		}

		const previousSessionFile = this.session.sessionFile;
		const profileName = this.getCurrentProfileName();
		const sourceCwd = this.cwd;
		const workspaceRoot = this.metapiLifecycle?.getWorkspaceRoot(this.session.sessionManager, sourceCwd);
		if (this.session.sessionManager.isPersisted()) {
			const currentSessionFile = this.session.sessionFile;
			if (!currentSessionFile) {
				throw new Error("Persisted session is missing a session file");
			}
			const sessionDir = this.session.sessionManager.getSessionDir();
			if (!targetLeafId) {
				const provisional = SessionManager.inMemory(sourceCwd);
				const targetCwd =
					workspaceRoot && this.metapiLifecycle
						? this.metapiLifecycle.copyWorkspace(sourceCwd, workspaceRoot, provisional.getSessionId())
						: sourceCwd;
				const targetSessionDir =
					profileName && this.metapiLifecycle
						? this.metapiLifecycle.getSessionDir(targetCwd, profileName)
						: sessionDir;
				const sessionManager = SessionManager.create(targetCwd, targetSessionDir, {
					id: provisional.getSessionId(),
					parentSession: currentSessionFile,
				});
				if (profileName) this.metapiLifecycle?.setProfileName(sessionManager, profileName);
				if (workspaceRoot) this.metapiLifecycle?.setWorkspaceRoot(sessionManager, workspaceRoot);
				await this.teardownCurrent("fork", sessionManager.getSessionFile());
				this.apply(
					await this.createRuntime({
						cwd: targetCwd,
						agentDir: this.services.agentDir,
						sessionManager,
						sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
						profileName,
					}),
				);
				await this.finishSessionReplacement(options?.withSession);
				return { cancelled: false, selectedText };
			}

			if (!existsSync(currentSessionFile)) {
				throw new Error(
					"This session has not been saved yet. Wait for the first assistant response before cloning or forking it.",
				);
			}
			const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
			const provisional = SessionManager.inMemory(sourceCwd);
			const targetCwd =
				workspaceRoot && this.metapiLifecycle
					? this.metapiLifecycle.copyWorkspace(sourceCwd, workspaceRoot, provisional.getSessionId())
					: sourceCwd;
			const targetSessionDir =
				profileName && this.metapiLifecycle
					? this.metapiLifecycle.getSessionDir(targetCwd, profileName)
					: sessionDir;
			const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId, {
				cwd: targetCwd,
				sessionDir: targetSessionDir,
				id: provisional.getSessionId(),
			});
			if (workspaceRoot) this.metapiLifecycle?.setWorkspaceRoot(sessionManager, workspaceRoot);
			if (!forkedSessionPath) {
				throw new Error("Failed to create forked session");
			}
			await this.teardownCurrent("fork", sessionManager.getSessionFile());
			this.apply(
				await this.createRuntime({
					cwd: sessionManager.getCwd(),
					agentDir: this.services.agentDir,
					sessionManager,
					sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
					profileName,
				}),
			);
			await this.finishSessionReplacement(options?.withSession);
			return { cancelled: false, selectedText };
		}

		const sessionManager = this.session.sessionManager;
		let targetCwd = sourceCwd;
		if (workspaceRoot && this.metapiLifecycle) {
			const provisional = SessionManager.inMemory(sourceCwd);
			targetCwd = this.metapiLifecycle.copyWorkspace(sourceCwd, workspaceRoot, provisional.getSessionId());
			if (!targetLeafId) {
				sessionManager.newSession({ id: provisional.getSessionId(), parentSession: this.session.sessionFile });
			} else {
				sessionManager.createBranchedSession(targetLeafId, { cwd: targetCwd, id: provisional.getSessionId() });
			}
		} else if (!targetLeafId) {
			sessionManager.newSession({ parentSession: this.session.sessionFile });
		} else {
			sessionManager.createBranchedSession(targetLeafId);
		}
		if (profileName) this.metapiLifecycle?.setProfileName(sessionManager, profileName);
		if (workspaceRoot) this.metapiLifecycle?.setWorkspaceRoot(sessionManager, workspaceRoot);
		await this.teardownCurrent("fork", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: targetCwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
				profileName,
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false, selectedText };
	}

	/**
	 * Import a session JSONL file and switch runtime state to the imported session.
	 *
	 * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
	 * @throws {SessionImportFileNotFoundError} When the input path does not exist.
	 * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
	 */
	async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
		const resolvedPath = resolvePath(inputPath);
		if (!existsSync(resolvedPath)) {
			throw new SessionImportFileNotFoundError(resolvedPath);
		}

		const sessionDir = this.session.sessionManager.getSessionDir();
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		const destinationPath = join(sessionDir, basename(resolvedPath));
		const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		if (resolve(destinationPath) !== resolvedPath) {
			copyFileSync(resolvedPath, destinationPath);
		}

		const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
		assertSessionCwdExists(sessionManager, this.cwd);
		const profileName = this.metapiLifecycle?.getProfileName(sessionManager) ?? this.getCurrentProfileName();
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
				profileName,
			}),
		);
		await this.finishSessionReplacement();
		return { cancelled: false };
	}

	async dispose(): Promise<void> {
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason: "quit",
		});
		await this.session.disposeProfileRuntime();
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		agentDir: string;
		sessionManager: SessionManager;
		sessionStartEvent?: SessionStartEvent;
		profileName?: string;
		metapiLifecycle?: MeldraSessionLifecycle;
	},
): Promise<AgentSessionRuntime> {
	assertSessionCwdExists(options.sessionManager, options.cwd);
	const result = await createRuntime({
		cwd: options.cwd,
		agentDir: options.agentDir,
		sessionManager: options.sessionManager,
		sessionStartEvent: options.sessionStartEvent,
		profileName: options.profileName,
	});
	return new AgentSessionRuntime(
		result.session,
		result.services,
		createRuntime,
		result.diagnostics,
		result.modelFallbackMessage,
		options.metapiLifecycle,
	);
}

export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
