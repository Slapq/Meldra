import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HooksManagerLang } from "./ui.ts";

function preferencePath(agentDir: string): string {
	return join(agentDir, "plugin-configs", "meldra-hooks.json");
}

export function detectHooksManagerLanguage(): HooksManagerLang {
	const locale = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
	if (/^zh/iu.test(locale)) return "zh";
	try {
		if (/^zh/iu.test(Intl.DateTimeFormat().resolvedOptions().locale)) return "zh";
	} catch {
		// Locale detection is optional.
	}
	return "en";
}

export function loadHooksManagerLanguage(agentDir: string): HooksManagerLang | undefined {
	try {
		const value = JSON.parse(readFileSync(preferencePath(agentDir), "utf8")) as Record<string, unknown>;
		return value.lang === "en" || value.lang === "zh" ? value.lang : undefined;
	} catch {
		return undefined;
	}
}

export function saveHooksManagerLanguage(agentDir: string, lang: HooksManagerLang): void {
	const path = preferencePath(agentDir);
	const dir = join(agentDir, "plugin-configs");
	let current: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			current = parsed as Record<string, unknown>;
		}
	} catch {
		// A missing or malformed preference file is replaced with this plugin's preference.
	}
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify({ ...current, lang }, null, 2), "utf8");
}
