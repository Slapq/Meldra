# Meldra Hook Examples

These standalone Node.js scripts demonstrate Meldra command Hooks. They work with Native Pi and DSH Profiles and require no npm dependencies.

Hooks run with the same operating-system permissions as Meldra. Review and adapt every script before enabling it. The safety examples are supplemental checks, not replacements for Runtime sandboxing, approvals, repository permissions, or backups.

## Scripts

| Script | Event | Purpose |
|---|---|---|
| `block-destructive-commands.mjs` | `PreToolUse` | Blocks common forced deletion and destructive Git commands with exit code `2`. |
| `protect-sensitive-paths.mjs` | `PreToolUse` | Blocks writes to `.git` and non-template `.env` files. |
| `inject-project-context.mjs` | `SessionStart`, `UserPromptSubmit` | Adds up to 20,000 characters from `.pi/hook-context.md` to model context. |
| `audit-hook-events.mjs` | Any supported event | Appends event metadata to JSONL without logging prompts, tool inputs, or tool responses. |

## Project Setup

1. Copy the scripts into the trusted project's `.pi/hooks/` directory.
2. Merge [`settings.example.json`](settings.example.json) into `.pi/settings.json`; do not overwrite unrelated settings.
3. Optionally create `.pi/hook-context.md` with project-specific instructions.
4. Add `.pi/hooks/events.jsonl` to `.gitignore` if the audit example is enabled.
5. Wait for the settings watcher, then inspect the effective configuration with `/hooks`.

Project Hooks do not load until Meldra Project Trust accepts the project. For Profile-wide use, place the scripts in a Profile-owned directory and use absolute paths in `<profile-agentDir>/settings.json`.

## Hot Reload

Hook commands start as new processes for every matching event. Editing one of these `.mjs` files, or a module it imports, takes effect on the next invocation; an already running invocation continues with the code it started with.

Meldra also watches Profile and trusted-project settings. Valid Hook configuration changes normally apply within about 600 ms and are forwarded to DSH without restarting Harness. Invalid changes keep the last-known-good configuration and appear as warnings. `/reload` remains available for unrelated Extensions, Skills, prompts, themes, and context files.

`settings.example.json` uses exec form: `node` is spawned directly and every argument is literal. Meldra replaces `${MELDRA_PROJECT_DIR}` before spawning. On Windows, forward slashes in these example arguments are accepted by Node.

## Behavior Notes

- The example uses `if` conditions to avoid spawning safety scripts for clearly unrelated simple tool calls. Complex shell syntax fails open and still runs the script.
- `AgentStart`, `AgentEnd`, `TurnStart`, and `TurnEnd` are notification-only; the audit example records them, but they cannot be blocked.
- All matching handlers run in parallel. The audit handler may record a `PreToolUse` event even when a sibling safety handler blocks it.
- `.env.example`, `.env.sample`, and `.env.template` are allowed by the path example; other `.env` variants are blocked.
- The command example deliberately blocks broad patterns such as any `rm -rf`. Tailor it to the commands your project actually permits.
- Context injected by `inject-project-context.mjs` is sent to the model. Do not put credentials or untrusted instructions in the context file.
- Audit rows contain timestamps, Session IDs, working directories, event names, and tool identifiers. Treat the log as potentially sensitive even though payload bodies are excluded.

## Test

From the repository root:

```bash
npm --prefix packages/coding-agent test -- meldra-hook-examples.test.ts
```

See [Meldra Hooks](../../docs/hooks.md) for the complete configuration and decision protocol.
