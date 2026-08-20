import type { InlineExtension } from "../core/extensions/types.ts";
import { createMeldraProfileExtension } from "../meldra/profile-extension.ts";
import workspaceExtension from "../meldra/workspace-extension.ts";
import dshExtension from "./dsh/index.ts";
import llamaExtension from "./llama/index.ts";
import meldraConfig from "./meldra-config/index.ts";

const meldraProfileExtension: InlineExtension = {
	name: "meldra-profile",
	factory: (pi) => createMeldraProfileExtension()(pi),
	hidden: true,
};

const meldraWorkspaceExtension: InlineExtension = {
	name: "meldra-workspace",
	factory: workspaceExtension,
	hidden: true,
};

export const builtInExtensions: InlineExtension[] = [
	{ name: "meldra-config", factory: meldraConfig, hidden: true },
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
	{ name: "meldra-dsh", factory: dshExtension, hidden: true },
	meldraProfileExtension,
	meldraWorkspaceExtension,
];
