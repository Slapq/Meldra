# Meldra Hooks

> Writing a Hook Handler or maintaining the protocol? Use the official Chinese-first [Meldra Hook authoring and development guide](../../../docs/hooks.md) or its [English version](../../../docs/hooks.en.md).

Meldra Hooks run deterministic external commands at supported Agent lifecycle points. The configuration shape follows Claude Code command hooks where Meldra can preserve the behavior truthfully. Hooks form an out-of-band intervention plane: Handler stdout, stderr, reasons, and structured output never become model Prompt content. A normalized Decision may still block or mutate an external operation, and a Stop continuation uses Meldra's fixed Runtime-owned control message.

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

Command scripts conventionally live under the source-owned root Hook directory:

```text
Profile: <profile-agentDir>/hooks/
Project: <cwd>/.pi/hooks/
```

Ordinary Meldra Profiles own these directories as Hook resources and do not show Pi's historical "Hooks have been renamed to extensions" warning. The reserved `pi` Compatibility Profile does not load Meldra Hooks and retains the original Pi migration warning and `extensions/` behavior.

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

Use `"disableAllHooks": true` to disable Profile and project Hooks for the effective configuration. A command handler may set `"disabled": true` to remain visible and editable without executing. `/hooks` can also disable or enable every handler under one event by updating those handler fields.

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
| `disabled` | boolean | Keeps the handler configured but excludes it from Native and DSH execution |

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
| `SessionStart` | startup source | Exact external notification | Approximate first-step external notification |
| `UserPromptSubmit` | none | Exact input preflight | Approximate `agent/pre-step` preflight |
| `PreToolUse` | tool name | Allow, block, `updatedInput` | Allow, ask, deny; no argument rewriting |
| `PostToolUse` | tool name | External observation after success | External observation after success |
| `PostToolUseFailure` | tool name | External observation after failure | External observation after failure |
| `AgentStart` | none | Exact native Agent run start | Approximate `agent/status: running` notification |
| `AgentEnd` | none | Exact native Agent run end | Approximate `agent/status: idle` notification |
| `TurnStart` | none | Exact native model turn start | DSH `step/start` notification |
| `TurnEnd` | none | Exact native model turn end | DSH `step/end` notification |
| `Stop` | none | Fixed Runtime-owned follow-up control | Fixed Runtime-owned `agent.steer` control |
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

- Exit `0`: success. A JSON object is interpreted as structured decision output; plain stdout is discarded by Runtime adapters and never enters the Prompt.
- Exit `2`: block for input/tool preflight. On `Stop`, it requests one protected continuation using the fixed Runtime-owned control message.
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

Native Pi also accepts `hookSpecificOutput.updatedInput`. DSH reports it as unsupported. A Hook `allow` decision means that Hook has no objection; it never bypasses a Runtime sandbox, deny rule, or approval policy. A blocking Handler's raw reason is shown only through external diagnostics; a model-visible tool denial uses the fixed generic message `Tool execution blocked by a Meldra Hook.`

A Stop Handler may request continuation with exit `2`, top-level `decision: "block"`, or top-level `decision: "continue"`. Both Native and DSH use the same fixed model-visible control message, `Continue the current task.` Handler output is never interpolated into that message. `stop_hook_active` prevents an immediate continuation loop.

`additionalContext` is not supported. Structured attempts to return it produce a diagnostic and are ignored. Post-tool Hooks observe the completed result but cannot add feedback/context or retroactively change that result.

All matching command handlers run to completion in parallel. Any blocking result wins. One handler's block does not prevent sibling Hook commands from running.

Native Pi awaits `SessionEnd` during `session_shutdown`. DSH's `agent/disposed` notification remains approximate, but graceful Runtime shutdown drains Hook commands that have already started before exiting. Forced worker teardown terminates every tracked Hook process tree.

## Examples

See [`examples/hooks/`](../examples/hooks/) for standalone Node.js handlers that block destructive commands, protect sensitive paths, open an external browser on `AgentEnd`, and write metadata-only audit records. The directory includes a complete project `settings.json` example and runner-backed tests.

## Manage Hooks

Run `/hooks` in the interactive TUI to open the Profile/Project Hook manager. It shows the effective state, live-reload diagnostics, source-local event and handler counts, matcher, condition, command, arguments, timeout, shell mode, and disabled state. Project scope is unavailable until Project Trust succeeds.

The manager follows the same hierarchical resource flow as Provider Manager:

1. The home page shows **Management actions** and four event categories: Session, Agent, Turn, and Tool.
2. A category opens its supported Hook Events with active/total counts.
3. An Event opens **Event actions** plus its command handlers.
4. Selecting a handler opens **Edit**, **Disable/Enable**, **Delete**, and **Back**.
5. Only **Edit handler** opens that handler's JSON source editor.

Event actions add a handler or enable/disable every handler under that Event. Management actions switch Profile/Project scope, import JSON, set `disableAllHooks`, edit the Hook shell path, open the complete source-local Hook JSON, and switch language. Every page uses Up/Down, Enter, and Escape navigation instead of requiring command hotkeys.

The TUI provides complete English and Chinese dictionaries. Its language follows the Provider Manager convention: a Profile-local preference is stored in `<profile-agentDir>/plugin-configs/meldra-hooks.json`; when absent, Meldra checks `LANG`, `LC_ALL`, `LANGUAGE`, and the system locale. The language preference is UI state and is not written into Hook settings.

Handler editing uses a JSON draft with one `matcher` and one `hook`. Every save validates the complete target layer before writing. Invalid drafts do not modify settings or replace the last-known-good Runtime snapshot. The editor writes only `hooks`, `disableAllHooks`, and `shellPath`; unrelated model, Provider, package, theme, and TUI fields already present in the same settings file are preserved and are not applied to the live Session.

### Import

Import accepts either a direct Hook event object or a settings envelope:

```json
{
  "hooks": {
    "AgentEnd": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["notify.mjs"] }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```

JSON can be pasted into the multi-line editor or read from a local file path explicitly entered by the user. Local imports are limited to 1,000,000 bytes. Unrelated top-level settings fields are ignored with a warning.

`Merge` appends events and handlers to the selected source, combines groups with the same matcher, and removes identical handlers. `Replace` replaces only Hook fields present in the import; omitted `disableAllHooks` and `shellPath` values remain unchanged. Both modes show a summary and require confirmation. Import never executes a Hook, copies a referenced script, installs a Package, reads a URL, or converts Claude settings automatically.

A successful save is picked up by the existing settings watcher and forwarded to DSH through the same `meldra/hooks.configure` RPC. The manager does not create a second Runtime update path.

## Current Exclusions

The current protocol does not implement HTTP, MCP tool, prompt, or agent handlers; asynchronous handlers; `once`; managed policy; Skill/Subagent frontmatter Hooks; Prompt/context injection; or Claude-specific events not listed above. Full Claude permission-rule shell AST parity is also outside the initial `if` subset. Unsupported event names produce diagnostics and do not execute.

HTTP/Webhook execution remains deferred pending URL and environment allowlists, SSRF policy, payload redaction, retry semantics, and bounded response handling. See the [HTTP Hook handler evaluation](../../../docs/investigations/2026-08-21-meldra-http-hook-handler-evaluation.md).
