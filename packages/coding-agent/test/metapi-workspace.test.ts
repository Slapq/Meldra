import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METAPI_WORKSPACES_DIR } from "../src/metapi/profile-service.ts";
import {
	copyWorkspace,
	createEmptyWorkspace,
	getWorkspacePath,
	resolveWorkspaceRoot,
} from "../src/metapi/workspace-service.ts";

const cleanup: string[] = [];

function temp(name: string): string {
	const path = join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	cleanup.push(path);
	return path;
}

afterEach(() => {
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Meldra WorkSpace", () => {
	it("uses ~/.metapi/workspaces when no root is supplied", () => {
		expect(resolveWorkspaceRoot()).toBe(METAPI_WORKSPACES_DIR);
		expect(resolveWorkspaceRoot("", temp("metapi-workspace-default-launch"))).toBe(METAPI_WORKSPACES_DIR);
	});

	it("resolves relative roots from the launch cwd", () => {
		const launch = temp("metapi-workspace-launch");
		expect(resolveWorkspaceRoot("workspaces", launch)).toBe(join(launch, "workspaces"));
	});

	it("creates an empty session-id directory", () => {
		const root = temp("metapi-workspace-root");
		const result = createEmptyWorkspace(root, "session-one");
		expect(result.cwd).toBe(getWorkspacePath(root, "session-one"));
		expect(existsSync(result.cwd)).toBe(true);
		expect(() => createEmptyWorkspace(root, "session-one")).toThrow("already exists");
	});

	it("copies the full source tree for fork and clone workspaces", () => {
		const source = temp("metapi-workspace-source");
		const root = temp("metapi-workspace-copy-root");
		mkdirSync(join(source, "nested"), { recursive: true });
		writeFileSync(join(source, "nested", "file.txt"), "copied", "utf8");

		const result = copyWorkspace(source, root, "fork-session");

		expect(readFileSync(join(result.cwd, "nested", "file.txt"), "utf8")).toBe("copied");
	});

	it("rejects copying a workspace into its own tree", () => {
		const source = temp("metapi-workspace-nested-source");
		mkdirSync(source, { recursive: true });
		expect(() => copyWorkspace(source, source, "child")).toThrow("inside its source");
	});
});
