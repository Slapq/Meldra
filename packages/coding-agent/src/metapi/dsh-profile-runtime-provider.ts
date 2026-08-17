import type { ProfileRuntimeProvider } from "../core/profile-agent-runtime.ts";
import { dshProfilePackageManager } from "./dsh-profile-packages.ts";
import { DshProfileRuntime } from "./dsh-profile-runtime.ts";

const LEGACY_DSH_PROFILE_NAMES = new Set(["dsh", "deepseek-harness"]);
export const DSH_PROFILE_RUNTIME_PROVIDER = "deepseek-harness";

export const dshProfileRuntimeProvider: ProfileRuntimeProvider = {
	id: DSH_PROFILE_RUNTIME_PROVIDER,
	packages: {
		...dshProfilePackageManager,
		async verify(profile) {
			const runtime = new DshProfileRuntime({ cwd: profile.cwd, agentDir: profile.agentDir });
			try {
				const entries = await runtime.plugins();
				return {
					activeEntries: entries.length,
					identities: entries.map((entry) => `${entry.entryId ?? ""}\0${entry.moduleName ?? ""}`),
				};
			} finally {
				await runtime.dispose();
			}
		},
	},
	supports: (profile) =>
		profile.runtime
			? profile.runtime.provider === DSH_PROFILE_RUNTIME_PROVIDER
			: LEGACY_DSH_PROFILE_NAMES.has(profile.name),
	create: (profile) =>
		new DshProfileRuntime({
			cwd: profile.cwd,
			agentDir: profile.agentDir,
			modelRuntime: profile.modelRuntime,
		}),
};
