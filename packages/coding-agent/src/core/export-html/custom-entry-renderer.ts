/**
 * HTML adapter for extension-owned custom session entries.
 *
 * Invokes the same product-neutral TUI renderer used by the interactive
 * transcript, then converts its ANSI output to HTML for an active Session
 * export. Standalone exports have no ExtensionRunner and therefore do not use
 * this adapter.
 */

import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { EntryRenderer } from "../extensions/types.ts";
import type { CustomEntry } from "../session-manager.ts";
import { ansiLinesToHtml } from "./ansi-to-html.ts";

export interface CustomEntryHtmlRendererDeps {
	getEntryRenderer: (customType: string) => EntryRenderer | undefined;
	theme: Theme;
	/** Terminal width used to lay out the TUI component before conversion. */
	width?: number;
}

export interface CustomEntryHtmlRenderer {
	/** Render an entry to HTML, or return undefined when no renderer is registered. */
	render(entry: CustomEntry): string | undefined;
}

const ANSI_ESCAPE_REGEX = /\x1b\[[\d;]*m/g;

function isBlankRenderedLine(line: string): boolean {
	return line.replace(ANSI_ESCAPE_REGEX, "").trim().length === 0;
}

function trimRenderedLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlankRenderedLine(lines[start])) start++;
	while (end > start && isBlankRenderedLine(lines[end - 1])) end--;
	return lines.slice(start, end);
}

export function createCustomEntryHtmlRenderer(deps: CustomEntryHtmlRendererDeps): CustomEntryHtmlRenderer {
	const { getEntryRenderer, theme, width = 100 } = deps;

	return {
		render(entry: CustomEntry): string | undefined {
			const renderer = getEntryRenderer(entry.customType);
			if (!renderer) return undefined;

			let component: Component | undefined;
			try {
				component = renderer(entry, { expanded: true }, theme);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Custom entry renderer failed for ${entry.customType}: ${message}`, { cause: error });
			}
			if (!component) return undefined;

			try {
				const html = ansiLinesToHtml(trimRenderedLines(component.render(width)));
				return html || undefined;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Custom entry renderer failed for ${entry.customType}: ${message}`, { cause: error });
			}
		},
	};
}
