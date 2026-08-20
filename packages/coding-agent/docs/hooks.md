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

Profile and project handlers for the same event are appended. Identical event, matcher, and handler declarations run once. Project `disableAllHooks` overrides the Profile value when explicitly present. Run `/reload` after editing settings.

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

When `args` is present, Meldra spawns `command` directly. Without `args`, Meldra uses the configured Pi shell, or PowerShell when explicitly selected. `${CLAUDE_PROJECT_DIR}` and `${MELDRA_PROJECT_DIR}` are replaced in exec-form command/arguments and exported to every Hook process.

Meldra writes one JSON object to stdin. Stdout and stderr are each bounded to 200,000 characters. Timeout, turn cancellation, Session shutdown, and process exit terminate the Hook process tree.

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

Custom and MCP tool names are preserved.

## Events

| Hook Event | Matcher | Native Pi | DSH rc.8 |
|---|---|---|---|
| `SessionStart` | startup source | Context injection before next request | Context injection at first `agent/pre-step` |
| `UserPromptSubmit` | none | Exact input preflight | Approximate `agent/pre-step` preflight |
| `PreToolUse` | tool name | Allow, block, `updatedInput` | Allow, ask, deny; no argument rewriting |
| `PostToolUse` | tool name | Result feedback/context | Result feedback/context |
| `PostToolUseFailure` | tool name | Error feedback/context | Error feedback/context |
| `Stop` | none | Protected follow-up continuation | Native `agent/turn-stopping` steering |
| `SessionEnd` | shutdown reason | Awaited `session_shutdown` | Approximate `agent/disposed` notification |

DSH owns its tool and Agent loops. Its tool arguments are frozen before `tools/pre-execute`; an `updatedInput` returned for DSH is ignored with an explicit diagnostic. Meldra does not mutate DSH logs behind the Runtime's back.

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

A Native Pi Session includes `transcript_path` when it has a persistent Session file. DSH does not expose a Pi transcript path because Harness owns its durable Session log.

## Decisions

- Exit `0`: success. Plain stdout supplies additional context for `SessionStart` and `UserPromptSubmit`. A JSON object is interpreted as structured output.
- Exit `2`: block where the event can block. Stderr is the preferred reason, then stdout.
- Other exit codes: non-blocking Hook errors. Interactive mode shows a warning.

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

## Inspect Hooks

Run `/hooks` in the interactive TUI. The read-only browser shows whether Hooks are enabled, configuration diagnostics, event counts, source (`profile` or `project`), matcher, and command. Edit JSON settings to change Hooks, then run `/reload`.

## Current Exclusions

The first protocol version does not implement HTTP, MCP tool, prompt, or agent handlers; asynchronous handlers; `once`; permission-rule `if` filters; managed policy; automatic settings watchers; Skill/Subagent frontmatter Hooks; or Claude-specific events not listed above. Unsupported event names produce diagnostics and do not execute.
