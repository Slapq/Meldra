import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";

export type MetaPiLanguage = "en" | "zh";

export function detectMetaPiLanguage(): MetaPiLanguage {
	const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
	if (/^zh/i.test(env)) return "zh";
	try {
		if (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale)) return "zh";
	} catch {
		/* use English fallback */
	}
	return "en";
}

export function getMetaPiLanguage(): MetaPiLanguage {
	try {
		const path = join(getAgentDir(), "plugin-configs", "pi-config.json");
		if (existsSync(path)) {
			const value = JSON.parse(readFileSync(path, "utf8")) as { lang?: unknown };
			if (value.lang === "zh" || value.lang === "en") return value.lang;
		}
	} catch {
		/* use locale fallback */
	}
	return detectMetaPiLanguage();
}
