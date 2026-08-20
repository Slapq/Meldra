# Meldra Hooks

Meldra Hooks run deterministic external commands at supported Agent lifecycle points. The configuration shape follows Claude Code command hooks where Meldra can preserve the behavior truthfully.

Hooks are executable configuration. A Hook command has the same operating-system permissions as Meldra. Only configure commands and project repositories you trust.

## Configuration

Profile Hooks apply to that Profile in every project:

```text
<profile-agentDir>/settings.json
```

Project Hooks apply only after Meldra Project Trust accepts the project:

```text
<cwd>/.pi/settings.json
```

Profile and project handlers for the same event are appended. Identical event, matcher, condition, and handler declarations run once. Project `disableAllHooks` overrides the Profile value when explicitly present.

Meldra watches the Profile `settings.json` and the trusted project's `.pi/settings.json` during a live Session. Changes to `hooks`, `disableAllHooks`, or the Hook `shellPath` normally apply within about 600 ms. A valid snapshot replaces the previous configuration atomically and is forwarded to an active DSH Runtime. Invalid JSON, schema, matcher, or condition changes keep the last-known-good configuration and produce an interactive warning. Deleting one settings file removes only that source's Hook declarations. The watcher never applies unrelated model, provider, theme, or TUI setting changes; use `/reload` when those resources or settings must be refreshed.

Command handlers are spawned anew for every matching event. Changes to an external script, executable, or its imported files therefore take effect on the next invocation without waiting for the settings watcher; a process already running keeps its current code.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.pi/hooks/check-tool.sh",
            "args": [],
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Use `"disableAllHooks": true` to disable Profile and project Hooks for the effective configuration.

An old Pi setting shaped as `"hooks": ["extension.ts"]` is not a Meldra Hook configuration and is not executed. Move executable TypeScript extensions to the `extensions` setting.

## Command Handlers

A command handler supports:

| Field | Type | Meaning |
|---|---|---|
| `type` | `"command"` | Required handler type |
| `command` | string | Executable in exec form, shell command in shell form |
| `args` | string[] | Enables exec form; every argument is passed literally |
| `timeout` | number | Positive timeout in seconds; default 600 |
| `shell` | `"bash"` or `"powershell"` | Optional shell-form override |
| `if` | string | Optional permission-rule subset evaluated before spawning on tool events |

When `args` is present, Meldra spawns `command` directly, including Windows command shims such as `.cmd` files. Without `args`, Meldra uses the configured Pi shell, or PowerShell when explicitly selected. `${CLAUDE_PROJECT_DIR}` and `${MELDRA_PROJECT_DIR}` are replaced in exec-form command/arguments and exported to every Hook process.

Meldra writes one JSON object to stdin and decodes command output as a UTF-8 stream, preserving characters split across process output chunks. Stdout and stderr are each bounded to 200,000 characters. Timeout, turn cancellation, Session shutdown, and process exit terminate the Hook process tree.

## Matchers

An omitted matcher, an empty matcher, or `"*"` matches every occurrence.

Matchers containing only letters, digits, `_`, `-`, spaces, `,`, and `|` are exact alternatives. For example, `"Edit, Write"` and `"Edit|Write"` match the same tools. Other values are JavaScript regular expressions tested without implicit anchors.

Built-in tool names use Claude-compatible matcher names where there is a direct equivalent:

| Runtime tool | Hook name |
|---|---|
| `bash` | `Bash` |
| `pwsh` | `PowerShell` |
| `read` | `Read` |
| `edit` | `Edit` |
| `write` | `Write` |
| `grep` | `Grep` |
| `find` | `Glob` |
| `ls` | `LS` |

Custom and MCP tool names are preserved.

## Conditions

A command handler on `PreToolUse`, `PostToolUse`, or `PostToolUseFailure` may set one `if` condition. Conditions run after the matcher group and before the process is spawned:

```json
{
  "type": "command",
  "if": "Bash(git *)",
  "command": "node",
  "args": ["${MELDRA_PROJECT_DIR}/.pi/hooks/check-git.mjs"]
}
```

The supported permission-rule subset is:

- `Tool` or `Tool(*)` for every call to one tool;
- tool-name wildcards such as `mcp__github__*`;
- `Tool(glob)` against the primary command, path, or URL field;
- `Tool(param:value)` against one top-level scalar tool input field.

`*` matches any character sequence. File paths use minimatch-style `*` and `**` after Windows separators are normalized to `/`. PowerShell command and scalar matching is case-insensitive.

Bash and PowerShell conditions intentionally parse only simple single commands. If a command contains compound operators, quotes, substitutions, redirects, escapes, leading environment assignments, known execution wrappers, or other syntax that cannot be interpreted reliably, the condition fails open and the Hook runs. Common aliases for `Remove-Item` are normalized before a simple PowerShell match. This filter reduces irrelevant process spawns; it is not a permission boundary. The Hook script and Runtime sandbox or approval policy remain authoritative. Conditions on non-tool events and malformed rules produce configuration diagnostics and do not execute.

## Events

| Hook Event | Matcher | Native Pi | DSH rc.8 |
|---|---|---|---|
| `SessionStart` | startup source | Context injection before next request | Context injection at first `agent/pre-step` |
| `UserPromptSubmit` | none | Exact input preflight | Approximate `agent/pre-step` preflight |
| `PreToolUse` | tool name | Allow, block, `updatedInput` | Allow, ask, deny; no argument rewriting |
| `PostToolUse` | tool name | Result feedback/context | Result feedback/context |
| `PostToolUseFailure` | tool name | Error feedback/context | Error feedback/context |
| `AgentStart` | none | Exact native Agent run start | Approximate `agent/status: running` notification |
| `AgentEnd` | none | Exact native Agent run end | Approximate `agent/status: idle` notification |
| `TurnStart` | none | Exact native model turn start | DSH `step/start` notification |
| `TurnEnd` | none | Exact native model turn end | DSH `step/end` notification |
| `Stop` | none | Protected follow-up continuation | Native `agent/turn-stopping` steering |
| `SessionEnd` | shutdown reason | Awaited `session_shutdown` | Approximate `agent/disposed` notification |

DSH owns its tool and Agent loops. Its tool arguments are frozen before `tools/pre-execute`; an `updatedInput` returned for DSH is ignored with an explicit interactive warning. A Hook `ask` decision is combined with later DSH pre-execute decisions, guards, sandbox policy, and tool-owned approval checks; it does not replace a stronger denial. Meldra does not mutate DSH logs behind the Runtime's back.

## Input

Every event receives:

```json
{
  "session_id": "session-id",
  "cwd": "/workspace",
  "hook_event_name": "PreToolUse"
}
```

Tool events also receive:

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "call-id"
}
```

`UserPromptSubmit` receives `prompt`. `SessionStart` receives `source`. `SessionEnd` receives `reason`. `Stop` receives `stop_hook_active`, which lets scripts avoid continuation loops. `PostToolUse` and `PostToolUseFailure` receive `tool_response`; failures also receive `error`.

`TurnStart` and `TurnEnd` receive zero-based `turn_index` and `timestamp`. In DSH, one Meldra Hook Turn deliberately maps to one Harness step because a step is one model call plus its requested tools; the input also includes Harness's authoritative one-based `runtime_turn` and `runtime_step`. `AgentStart`, `AgentEnd`, `TurnStart`, and `TurnEnd` are notification-only. Exit `2` cannot reverse an event that has already occurred and is reported as an ignored block warning.

A Native Pi Session includes `transcript_path` when it has a persistent Session file. DSH does not expose a Pi transcript path because Harness owns its durable Session log.

## Decisions

- Exit `0`: success. Plain stdout supplies additional context for `SessionStart` and `UserPromptSubmit`. A JSON object is interpreted as structured output.
- Exit `2`: block where the event can block. Stderr is the preferred reason, then stdout.
- Other exit codes: non-blocking Hook errors. Interactive mode shows a warning in both Native Pi and DSH Profiles; DSH transports the diagnostic over its runtime bridge without adding it to model context or the Pi Session.

`PreToolUse` accepts Claude-style structured output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Protected command"
  }
}
```

Native Pi also accepts `hookSpecificOutput.updatedInput`. DSH reports it as unsupported. A Hook `allow` decision means that Hook has no objection; it never bypasses a Runtime sandbox, deny rule, or approval policy.

Context-producing events accept `hookSpecificOutput.additionalContext` or top-level `additionalContext`. Post-tool and Stop events accept top-level `decision: "block"` plus `reason`.

All matching command handlers run to completion in parallel. Any blocking result wins. One handler's block does not prevent sibling Hook commands from running.

Native Pi awaits `SessionEnd` during `session_shutdown`. DSH's `agent/disposed` notification remains approximate, but graceful Runtime shutdown drains Hook commands that have already started before exiting. Forced worker teardown terminates every tracked Hook process tree.

## Examples

See [`examples/hooks/`](../examples/hooks/) for standalone Node.js handlers that block destructive commands, protect sensitive paths, inject trusted project context, and write metadata-only audit records. The directory includes a complete project `settings.json` example and runner-backed tests.

## Inspect Hooks

Run `/hooks` in the interactive TUI. The read-only browser shows whether Hooks are enabled, configuration and hot-reload diagnostics, event counts, source (`profile` or `project`), matcher, condition, and command. Valid Hook settings changes are watched automatically; use `/reload` for Extensions, Skills, prompts, themes, context files, and unrelated settings.

## Current Exclusions

The current protocol does not implement HTTP, MCP tool, prompt, or agent handlers; asynchronous handlers; `once`; managed policy; Skill/Subagent frontmatter Hooks; or Claude-specific events not listed above. Full Claude permission-rule shell AST parity is also outside the initial `if` subset. Unsupported event names produce diagnostics and do not execute.

HTTP/Webhook execution remains deferred pending URL and environment allowlists, SSRF policy, payload redaction, retry semantics, and bounded response handling. See the [HTTP Hook handler evaluation](../../../docs/investigations/2026-08-21-meldra-http-hook-handler-evaluation.md).
