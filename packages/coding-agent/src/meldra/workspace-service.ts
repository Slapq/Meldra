import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { resolvePath } from "../utils/paths.ts";
import { MELDRA_WORKSPACES_DIR } from "./profile-service.ts";

export interface WorkspaceTarget {
	root: string;
	cwd: string;
}

export function resolveWorkspaceRoot(value?: string, launchCwd: string = process.cwd()): string {
	if (value === undefined) return resolvePath(MELDRA_WORKSPACES_DIR);
	const trimmed = value.trim();
	if (!trimmed) return resolvePath(MELDRA_WORKSPACES_DIR);
	return resolvePath(isAbsolute(trimmed) ? trimmed : resolve(launchCwd, trimmed));
}

export function getWorkspacePath(root: string, sessionId: string): string {
	return resolvePath(resolve(root, sessionId));
}

function assertFreshWorkspace(target: string): void {
	if (existsSync(target)) {
		throw new Error(`Workspace already exists for this session: ${target}`);
	}
}

export function createEmptyWorkspace(root: string, sessionId: string): WorkspaceTarget {
	const resolvedRoot = resolvePath(root);
	const cwd = getWorkspacePath(resolvedRoot, sessionId);
	assertFreshWorkspace(cwd);
	mkdirSync(cwd, { recursive: true });
	return { root: resolvedRoot, cwd };
}

export function copyWorkspace(sourceCwd: string, root: string, sessionId: string): WorkspaceTarget {
	const source = resolvePath(sourceCwd);
	const resolvedRoot = resolvePath(root);
	const cwd = getWorkspacePath(resolvedRoot, sessionId);
	assertFreshWorkspace(cwd);

	const relation = relative(source, cwd);
	if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
		throw new Error(`Cannot create a copied workspace inside its source: ${cwd}`);
	}

	mkdirSync(cwd, { recursive: true });
	try {
		for (const entry of readdirSync(source, { withFileTypes: true })) {
			cpSync(resolve(source, entry.name), resolve(cwd, entry.name), {
				recursive: true,
				force: true,
				errorOnExist: true,
			});
		}
	} catch (error) {
		rmSync(cwd, { recursive: true, force: true });
		throw error;
	}
	return { root: resolvedRoot, cwd };
}
