import type { InlineExtension } from "../core/extensions/types.ts";
import { createMeldraProfileExtension } from "../metapi/profile-extension.ts";
import workspaceExtension from "../metapi/workspace-extension.ts";
import dshExtension from "./dsh/index.ts";
import llamaExtension from "./llama/index.ts";
import meldraConfig from "./metapi-config/index.ts";

const metapiProfileExtension: InlineExtension = {
	name: "metapi-profile",
	factory: (pi) => createMeldraProfileExtension()(pi),
	hidden: true,
};

const metapiWorkspaceExtension: InlineExtension = {
	name: "metapi-workspace",
	factory: workspaceExtension,
	hidden: true,
};

export const builtInExtensions: InlineExtension[] = [
	{ name: "metapi-config", factory: meldraConfig, hidden: true },
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
	{ name: "metapi-dsh", factory: dshExtension, hidden: true },
	metapiProfileExtension,
	metapiWorkspaceExtension,
];
