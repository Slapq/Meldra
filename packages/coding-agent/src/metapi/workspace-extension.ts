import type { ExtensionAPI } from "../core/extensions/types.ts";
import { getSessionWorkspaceRoot } from "./session-profile.ts";

export default function workspaceExtension(pi: ExtensionAPI): void {
	pi.registerCommand("workspace", {
		description: "Show the WorkSpace bound to the current Meldra session",
		handler: async (_args, ctx) => {
			const root = getSessionWorkspaceRoot(ctx.sessionManager);
			ctx.ui.notify(
				root
					? `当前 WorkSpace：${ctx.cwd}\nWorkSpace 根目录：${root}\nProfile 资源默认不会写入 WorkSpace。`
					: `当前会话未启用 WorkSpace；工作目录为 ${ctx.cwd}`,
				"info",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!getSessionWorkspaceRoot(ctx.sessionManager)) {
			ctx.ui.setStatus("metapi-workspace", undefined);
			return;
		}
		ctx.ui.setStatus("metapi-workspace", ctx.ui.theme.fg("accent", "WorkSpace · /workspace"));
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!getSessionWorkspaceRoot(ctx.sessionManager)) return;
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nMeldra WorkSpace scope:\n" +
				"- The current working directory is this session's WorkSpace.\n" +
				"- Skills, Extensions, Prompt Templates, Themes, and package resources belong to the current Profile by default.\n" +
				"- If the user asks to add, install, enable, or persist one of those resources without naming a scope, ask them to choose Current Profile or Current WorkSpace before writing settings or files.\n" +
				"- Choose Current WorkSpace only after explicit user selection; that maps to Pi project-local resources under the WorkSpace .pi directory.\n" +
				"- Do not silently create WorkSpace .pi resource files or use project-local package flags.",
		};
	});
}
