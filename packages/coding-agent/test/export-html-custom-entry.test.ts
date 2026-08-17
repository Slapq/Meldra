import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomEntryHtmlRenderer } from "../src/core/export-html/custom-entry-renderer.ts";
import { exportFromFile, exportSessionToHtml } from "../src/core/export-html/index.ts";
import type { EntryRenderer } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { Theme } from "../src/modes/interactive/theme/theme.ts";

function decodeSessionData(html: string): Record<string, unknown> {
	const match = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
	if (!match) throw new Error("Missing embedded Session data");
	return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as Record<string, unknown>;
}

describe("custom entry HTML export", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("exports a renderable custom-only Session before its JSONL file exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-custom-html-"));
		tempDirs.push(dir);
		const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Missing Session path");
		const renderedId = sessionManager.appendCustomEntry("visible-card", { text: "private visible payload" });
		sessionManager.appendCustomEntry("internal-state", { secret: "must not leak" });
		const component: Component = {
			render: () => ["", "\u001b[32mVisible <entry>\u001b[0m", ""],
			invalidate: () => {},
		};
		const renderer = vi.fn<EntryRenderer>(() => component);
		const customEntryRenderer = createCustomEntryHtmlRenderer({
			getEntryRenderer: (customType) => (customType === "visible-card" ? renderer : undefined),
			theme: {} as Theme,
		});
		const outputPath = join(dir, "session.html");

		expect(existsSync(sessionFile)).toBe(false);
		await exportSessionToHtml(sessionManager, undefined, { outputPath, customEntryRenderer });

		const html = readFileSync(outputPath, "utf8");
		const data = decodeSessionData(html) as {
			entries: Array<Record<string, unknown>>;
			renderedCustomEntries: Record<string, string>;
		};
		expect(data.renderedCustomEntries[renderedId]).toContain("Visible &lt;entry&gt;");
		expect(data.renderedCustomEntries[renderedId]).not.toContain("private visible payload");
		expect(JSON.stringify(data.entries)).not.toContain("visible-card");
		expect(JSON.stringify(data.entries)).not.toContain("internal-state");
		expect(JSON.stringify(data.entries)).not.toContain("must not leak");
		expect(renderer).toHaveBeenCalledWith(
			expect.objectContaining({ id: renderedId }),
			{ expanded: true },
			expect.anything(),
		);
		expect(html).toContain("renderedCustomEntries?.[entry.id]");
	});

	it("keeps rejecting an unflushed ordinary Pi Session without rendered custom content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-unflushed-html-"));
		tempDirs.push(dir);
		const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
		sessionManager.appendMessage({ role: "user", content: "not answered yet", timestamp: Date.now() });
		const customEntryRenderer = createCustomEntryHtmlRenderer({
			getEntryRenderer: () => undefined,
			theme: {} as Theme,
		});
		const outputPath = join(dir, "session.html");

		await expect(exportSessionToHtml(sessionManager, undefined, { outputPath, customEntryRenderer })).rejects.toThrow(
			"Nothing to export yet - start a conversation first",
		);
		expect(existsSync(outputPath)).toBe(false);
	});

	it("keeps standalone custom entries private when no ExtensionRunner is active", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-standalone-custom-html-"));
		tempDirs.push(dir);
		const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
		sessionManager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
		sessionManager.appendMessage(fauxAssistantMessage("seed response"));
		sessionManager.appendCustomEntry("standalone-private", { secret: "standalone secret" });
		const inputPath = sessionManager.getSessionFile();
		if (!inputPath) throw new Error("Missing Session path");
		const outputPath = join(dir, "standalone.html");

		await exportFromFile(inputPath, { outputPath });

		const data = decodeSessionData(readFileSync(outputPath, "utf8")) as {
			entries: Array<Record<string, unknown>>;
			renderedCustomEntries?: Record<string, string>;
		};
		expect(data.renderedCustomEntries).toBeUndefined();
		expect(JSON.stringify(data.entries)).not.toContain("standalone-private");
		expect(JSON.stringify(data.entries)).not.toContain("standalone secret");
	});

	it("fails explicitly when a registered renderer fails", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-custom-html-failure-"));
		tempDirs.push(dir);
		const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
		sessionManager.appendCustomEntry("broken-card", { text: "hidden" });
		const customEntryRenderer = createCustomEntryHtmlRenderer({
			getEntryRenderer: () => {
				return (() => {
					throw new Error("render exploded");
				}) as EntryRenderer;
			},
			theme: {} as Theme,
		});
		const outputPath = join(dir, "session.html");

		await expect(exportSessionToHtml(sessionManager, undefined, { outputPath, customEntryRenderer })).rejects.toThrow(
			"Custom entry renderer failed for broken-card: render exploded",
		);
		expect(existsSync(outputPath)).toBe(false);
	});
});
