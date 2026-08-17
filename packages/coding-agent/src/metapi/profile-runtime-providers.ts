import type { ProfileRuntimeProvider } from "../core/profile-agent-runtime.ts";
import { dshProfileRuntimeProvider } from "./dsh-profile-runtime-provider.ts";

export const builtInProfileRuntimeProviders: readonly ProfileRuntimeProvider[] = [dshProfileRuntimeProvider];
