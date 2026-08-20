import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface MeldraHooksSettingsWatcher {
	close(): void;
	flush(): Promise<void>;
}

export interface MeldraHooksSettingsWatcherOptions {
	paths: string[];
	reload(): void | Promise<void>;
	onError(error: unknown): void;
	intervalMs?: number;
	debounceMs?: number;
}

function contentFingerprint(path: string): string {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code?: unknown }).code)
				: "unknown";
		return `unreadable:${code}`;
	}
}

export function createMeldraHooksSettingsWatcher(
	options: MeldraHooksSettingsWatcherOptions,
): MeldraHooksSettingsWatcher {
	const intervalMs = options.intervalMs ?? 500;
	const debounceMs = options.debounceMs ?? 100;
	const paths = [...new Set(options.paths)];
	const fingerprints = new Map(paths.map((path) => [path, contentFingerprint(path)]));
	let closed = false;
	let debounceTimer: NodeJS.Timeout | undefined;
	let reloadTask = Promise.resolve();

	const runReload = (): void => {
		if (closed) return;
		reloadTask = reloadTask.then(options.reload).catch((error) => {
			try {
				options.onError(error);
			} catch {
				// Error reporting must not stop later reload attempts.
			}
		});
	};
	const scheduleReload = (): void => {
		if (closed) return;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			runReload();
		}, debounceMs);
		debounceTimer.unref?.();
	};
	const poll = (): void => {
		if (closed) return;
		let changed = false;
		for (const path of paths) {
			const next = contentFingerprint(path);
			if (fingerprints.get(path) === next) continue;
			fingerprints.set(path, next);
			changed = true;
		}
		if (changed) scheduleReload();
	};
	const pollTimer = setInterval(poll, intervalMs);
	pollTimer.unref?.();

	return {
		close() {
			if (closed) return;
			closed = true;
			clearInterval(pollTimer);
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = undefined;
			}
			fingerprints.clear();
		},
		async flush() {
			poll();
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = undefined;
				runReload();
			}
			await reloadTask;
		},
	};
}
