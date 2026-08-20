# Authoring and Developing Meldra Hooks

[中文](hooks.md) | [English](hooks.en.md) | [Home](README.en.md)

A Meldra Hook is a cross-Agent-Runtime out-of-band intervention. It is triggered by user configuration; it is neither an Extension nor a model-selected tool. Native Pi and DeepSeek Harness (DSH) use the same Hook configuration and Decision protocol while executing lifecycle mappings inside the Agent loop owned by each Runtime.

Hook Handler stdout, stderr, reasons, and structured output never become model Prompt content. A Hook Decision may block user input or tool execution, mutate Native Pi tool arguments, or request one Stop continuation through Meldra's fixed Runtime-owned control message.

Working implementations live in [`packages/coding-agent/examples/hooks/`](../packages/coding-agent/examples/hooks/). See the [Meldra Hooks protocol reference](../packages/coding-agent/docs/hooks.md) for the low-level field, event-input, and compatibility specification.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Locations and Scope](#configuration-locations-and-scope)
- [Command Handlers](#command-handlers)
- [Events](#events)
- [Matchers](#matchers)
- [`if` Conditions](#if-conditions)
- [Input Protocol](#input-protocol)
- [Decisions and Exit Codes](#decisions-and-exit-codes)
- [Prompt Output Isolation](#prompt-output-isolation)
- [Common Handler Patterns](#common-handler-patterns)
- [The `/hooks` Manager](#the-hooks-manager)
- [Hot Reload](#hot-reload)
- [Native Pi and DSH](#native-pi-and-dsh)
- [Security](#security)
- [Debugging](#debugging)
- [Developing the Hook Protocol](#developing-the-hook-protocol)
- [Developing a Runtime Adapter](#developing-a-runtime-adapter)
- [Testing and Validation](#testing-and-validation)
- [Reference](#reference)

## Quick Start

### 1. Create a Handler

Create `.pi/hooks/audit.mjs` in a trusted project:

```js
#!/usr/bin/env node

const MAX_INPUT_CHARS = 1_000_000;
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > MAX_INPUT_CHARS) throw new Error("Hook input is too large");
}

const input = JSON.parse(raw);
console.error(`[hook] ${input.hook_event_name} session=${input.session_id}`);
```

A Handler must read one JSON object from stdin. Do not infer the Session, event, or tool input from command-line arguments.

### 2. Add Configuration

Merge this object into the trusted project's `.pi/settings.json`:

```json
{
  "hooks": {
    "AgentEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${MELDRA_PROJECT_DIR}/.pi/hooks/audit.mjs"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Do not overwrite unrelated settings in the file.

### 3. Inspect the Configuration

After Project Trust succeeds, run:

```text
/hooks
```

Open `Agent events` -> `AgentEnd`. The manager shows the Handler source, state, matcher, condition, and command.

### 4. Modify and Verify

A saved `.pi/settings.json` change normally applies within about 600 ms. Editing the `.mjs` file needs no reload: the next event starts a new Node process and reads the new code.

## Configuration Locations and Scope

### Profile Hooks

Profile Hooks apply to every project using that Profile:

```text
<profile-agentDir>/settings.json
<profile-agentDir>/hooks/
```

Profile configuration should use an absolute path to its Handler script.

### Project Hooks

Project Hooks are read and executed only after Project Trust succeeds:

```text
<cwd>/.pi/settings.json
<cwd>/.pi/hooks/
```

Ordinary Meldra Profiles own these root `hooks/` directories as Hook resources. The reserved `pi` Compatibility Profile does not load Meldra Hooks and continues to treat `hooks/` as a deprecated Pi Extension directory.

### Merge Order

Resolution order is:

```text
Profile handlers
-> Project handlers
-> deduplicate identical event + matcher + handler declarations
```

An explicitly present project `disableAllHooks` overrides the Profile value. A Project Handler cannot override a Profile Handler by copying it; the identical declaration runs once.

## Command Handlers

A command Handler supports:

| Field | Type | Default | Meaning |
|---|---|---:|---|
| `type` | `"command"` | required | The only current Handler type |
| `command` | string | required | Executable or shell command |
| `args` | string[] | none | Enables exec form; each argument is literal |
| `timeout` | number | `600` | Positive timeout in seconds |
| `shell` | `"bash"` or `"powershell"` | current shell | Used only in shell form |
| `if` | string | none | Process-start filter supported on tool events |
| `disabled` | boolean | `false` | Keeps configuration without starting a process |

Exec form:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${MELDRA_PROJECT_DIR}/.pi/hooks/check.mjs"],
  "timeout": 10
}
```

Shell form:

```json
{
  "type": "command",
  "command": "./check.sh --strict",
  "shell": "bash",
  "timeout": 10
}
```

Prefer exec form. It does not ask a shell to reinterpret arguments and supports `.cmd` shims on Windows.

Every Handler process receives:

```text
cwd = current project directory
CLAUDE_PROJECT_DIR = current project directory
MELDRA_PROJECT_DIR = current project directory
stdin = one Hook input JSON object
```

`${CLAUDE_PROJECT_DIR}` and `${MELDRA_PROJECT_DIR}` are also substituted in exec-form commands and arguments.

### Execution and Cleanup

All matching Handlers for one Event run in parallel. Any blocking Decision wins, but it does not prevent sibling Handlers from starting or completing. A Handler must not depend on declaration order or another Handler's side effect.

Stdout and stderr are each limited to 200,000 characters, with excess content marked by a truncation marker. The Runner uses a streaming UTF-8 decoder and preserves multibyte characters split across chunks. Only a stdout JSON object from exit `0` is parsed as structured output.

Timeout, AbortSignal, Session shutdown, and process exit terminate the tracked process tree. A running process keeps the code and configuration it started with; configuration or script edits affect the next invocation.

## Events

| Event | Matcher input | Can change execution? | Primary use |
|---|---|---:|---|
| `SessionStart` | startup source | No | External setup, notification, audit |
| `UserPromptSubmit` | none | Can block | Input preflight |
| `PreToolUse` | tool name | Can block; Native can mutate arguments | Tool policy and approval |
| `PostToolUse` | tool name | No | External success audit |
| `PostToolUseFailure` | tool name | No | External failure audit |
| `AgentStart` | none | No | Agent-run notification |
| `AgentEnd` | none | No | Completion notification and external automation |
| `TurnStart` | none | No | Model-call start audit |
| `TurnEnd` | none | No | Model-call end audit |
| `Stop` | none | Can request continuation | Continue the current task |
| `SessionEnd` | shutdown reason | No | Shutdown and cleanup |

`AgentStart`, `AgentEnd`, `TurnStart`, and `TurnEnd` are notification-only. Exit `2` cannot roll back lifecycle that already happened.

## Matchers

A matcher belongs to a Handler group:

```json
{
  "matcher": "Bash|Write",
  "hooks": [
    { "type": "command", "command": "node", "args": ["check.mjs"] }
  ]
}
```

Rules:

- omitted, empty, or `"*"` matches every occurrence;
- `Bash|Write` and `Bash, Write` are exact alternatives;
- other strings are JavaScript regular expressions without implicit anchors;
- an invalid expression produces a configuration diagnostic and the group does not run.

Built-in tool mapping:

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

## `if` Conditions

`if` reduces clearly irrelevant process starts for `PreToolUse`, `PostToolUse`, and `PostToolUseFailure`:

```json
{
  "type": "command",
  "if": "Bash(git *)",
  "command": "node",
  "args": ["check-git.mjs"]
}
```

Supported forms:

```text
Tool
Tool(*)
Tool(glob)
Tool(param:value)
mcp__github__*
```

Examples:

```text
Bash(rm *)
PowerShell(Remove-Item *)
Edit(src/**)
*(.env*)
custom_tool(mode:strict*)
WebFetch(https://example.com/*)
```

File paths use minimatch-style `*` and `**`. Windows separators are normalized to `/`.

`if` is not a permission boundary. Complex shell syntax, quotes, substitutions, redirects, environment assignments, and wrappers fail open when they cannot be interpreted reliably, so the Handler still runs. The Handler or Runtime policy must make the authoritative decision.

## Input Protocol

Every Event receives:

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

Event-specific fields:

| Event | Fields |
|---|---|
| `SessionStart` | `source` |
| `UserPromptSubmit` | `prompt` |
| `PostToolUse` | `tool_response` |
| `PostToolUseFailure` | `tool_response`, `error` |
| `TurnStart`, `TurnEnd` | `turn_index`, `timestamp` |
| DSH Turn events | `runtime_turn`, `runtime_step` |
| `Stop` | `stop_hook_active` |
| `SessionEnd` | `reason` |

Native Pi also supplies `transcript_path` when the Session has a persistent file. DSH does not fabricate a Pi transcript path.

Input may contain prompts, tool arguments, and tool results. Do not write it wholesale to logs or send it over the network.

## Decisions and Exit Codes

### Exit `0`

Indicates success. Stdout beginning with a JSON object is parsed as structured output. Plain stdout is not a Decision and is discarded by Runtime Adapters.

### Exit `2`

- `UserPromptSubmit`: block Prompt submission;
- `PreToolUse`: block tool execution;
- `Stop`: request one protected continuation;
- notification-only and post-tool Events: ignore the Decision and report a diagnostic.

### Other Exit Codes

They are non-blocking errors. Stderr is sent to the TUI or Runtime diagnostic channel, never to model context.

Matching Handlers execute in parallel. Any block or deny wins; allow only means that Handler has no objection and cannot override a sibling denial, Runtime sandbox, or approval policy.

### Structured Decisions

PreTool deny:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Protected command"
  }
}
```

DSH ask:

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "ask",
    "permissionDecisionReason": "Confirm in the Runtime approval UI"
  }
}
```

Native updated input:

```json
{
  "hookSpecificOutput": {
    "updatedInput": {
      "command": "npm test"
    }
  }
}
```

Stop continuation:

```json
{
  "decision": "continue"
}
```

Stop also accepts exit `2` and `decision: "block"`. Use `stop_hook_active` to prevent an immediate continuation loop.

## Prompt Output Isolation

Handler output and a Hook Decision are different objects.

A Handler can emit a private reason:

```text
customer policy 42 denied this command
```

That text is visible only in the user UI or Runtime diagnostics. The model-visible tool denial is always:

```text
Tool execution blocked by a Meldra Hook.
```

The model control for Stop continuation is always:

```text
Continue the current task.
```

Native and DSH share these constants. Handler stdout, stderr, reasons, and JSON fields are never interpolated into either message.

`additionalContext` is unsupported. Returning it reports and ignores this diagnostic:

```text
additionalContext ignored; Hook output cannot enter Prompt
```

Use a Runtime-native Extension, Preset, Skill, or Agent-loop API when system prompts, user prompts, or model context must change.

## Common Handler Patterns

The patterns below reuse one bounded stdin reader:

```js
async function readHookInput() {
  const MAX_INPUT_CHARS = 1_000_000;
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > MAX_INPUT_CHARS) throw new Error("Hook input is too large");
  }
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Hook input must be an object");
  }
  return input;
}
```

### External Notification

```js
#!/usr/bin/env node

const input = await readHookInput();

if (input.hook_event_name !== "AgentEnd") process.exit(0);
// Call an explicitly configured local notification program here.
```

### Tool Blocking

```js
#!/usr/bin/env node

const input = await readHookInput();

const command = String(input.tool_input?.command ?? "");
if (/\brm\s+-rf\b/.test(command)) {
  console.error("Recursive forced removal requires manual review");
  process.exit(2);
}
```

The Handler reason is shown to the user, while the model receives only the fixed generic block message.

### Stop Continuation

```js
#!/usr/bin/env node

const input = await readHookInput();

if (input.stop_hook_active !== true && shouldContinueExternally()) {
  process.stdout.write(JSON.stringify({ decision: "continue" }));
}

function shouldContinueExternally() {
  return false;
}
```

Do not place next-step instructions in Handler output. The Runtime uses only Meldra's fixed continuation control.

### Redacted Audit

Record metadata only:

```js
const row = {
  timestamp: new Date().toISOString(),
  hook_event_name: input.hook_event_name,
  session_id: input.session_id,
  tool_name: input.tool_name,
  tool_use_id: input.tool_use_id,
};
```

Do not record `prompt`, `tool_input`, `tool_response`, `error`, stdout, or stderr by default.

## The `/hooks` Manager

`/hooks` is a dedicated Hook resource manager, not a `/config` scalar form.

Navigation hierarchy:

```text
Home
-> Session / Agent / Turn / Tool category
-> Event
-> Handler
-> Edit / Disable or Enable / Delete
-> JSON editor
```

Management actions provide:

- Profile / Project scope;
- JSON import;
- `disableAllHooks`;
- Hook shell path;
- complete source-local Hook JSON;
- diagnostics;
- English / 中文.

The language preference is stored in:

```text
<profile-agentDir>/plugin-configs/meldra-hooks.json
```

### Import

A direct Hook map is accepted:

```json
{
  "AgentEnd": [
    { "hooks": [{ "type": "command", "command": "node", "args": ["notify.mjs"] }] }
  ]
}
```

A settings envelope is also accepted:

```json
{
  "hooks": { "AgentEnd": [] },
  "disableAllHooks": false,
  "shellPath": "/bin/bash"
}
```

`Merge` appends by Event, combines groups with the same matcher, and removes identical Handlers. `Replace` changes only Hook fields present in the import. Both require confirmation. Local JSON files are limited to 1,000,000 bytes. Import does not execute scripts, copy files, install Packages, or read URLs.

## Hot Reload

Meldra watches:

```text
<profile-agentDir>/settings.json
<trusted-project>/.pi/settings.json
```

It rereads only:

```text
hooks
disableAllHooks
shellPath
```

A valid snapshot atomically replaces the last-known-good snapshot and is sent to an active DSH worker through the same RPC. Invalid JSON, schema, matcher, or condition changes report a diagnostic without replacing the current configuration.

The watcher uses content fingerprints and detects:

- creation;
- deletion;
- atomic rename;
- same-size content changes.

Handler script edits do not depend on the settings watcher. Every Event starts a new process.

## Native Pi and DSH

| Capability | Native Pi | DSH |
|---|---|---|
| Profile/Project config | Supported | Supported, same resolved snapshot |
| Prompt preflight block | Exact `input` | Approximate `agent/pre-step` reject |
| PreTool deny | Supported | Supported |
| PreTool ask | Runtime-owned permission surface | DSH ask supported |
| `updatedInput` | Supported | Unsupported; arguments are frozen |
| PostTool output mutation | Unsupported | Unsupported |
| Agent lifecycle | Native exact | Approximate `agent/status` |
| Turn lifecycle | Native model turn | DSH step |
| Stop continuation | Fixed hidden follow-up | Fixed `agent.steer` message |
| SessionEnd | Awaited shutdown | Approximate disposed + drain |

A Runtime Adapter must label approximate behavior as approximate and unsupported behavior as unsupported. It must not rewrite DSH durable logs, bypass frozen arguments, or reproduce an external Agent loop in the Host to create superficial parity.

## Security

Hooks are executable configuration and run with Meldra's operating-system permissions.

Minimum requirements:

1. Load Project Hooks only after Project Trust.
2. Use exec form and literal arguments unless a shell is required.
3. Do not place tokens, cookies, or API keys in commands, arguments, logs, or examples.
4. Bound stdin in the Handler.
5. Bound file and network output owned by the Handler.
6. Use the shortest reasonable timeout.
7. Make Handlers repeatable and safe under parallel invocation.
8. Check `stop_hook_active` in Stop Handlers.
9. Do not treat `if` as a security boundary.
10. Do not send Hook payloads to an HTTP endpoint by default.

Command Handlers are foreground operations. Detached/background Handlers are not currently supported.

## Debugging

### `/hooks` Reports a Diagnostic

Common causes:

- unsupported event name;
- invalid matcher regular expression;
- `hooks` is not a non-empty array;
- empty command;
- args is not a string array;
- timeout is not positive;
- shell is not `bash` or `powershell`;
- `if` is used on a non-tool Event;
- `additionalContext` was rejected.

### A Handler Does Not Run

Check:

1. effective state is enabled in `/hooks`;
2. the Handler and Event are enabled;
3. Project Trust succeeded;
4. matcher uses the canonical tool name;
5. `if` matches the input;
6. command paths resolve against the current `cwd`;
7. the Runtime supports the requested Decision.

### Script Edits Do Not Apply

Verify that you edited the file referenced by effective configuration. Profile scripts, Project scripts, repository examples, and deployed copies may be separate files.

### Windows

- Exec form can start `.cmd` shims.
- Use `/` separators in Node arguments.
- Select PowerShell shell form with `shell: "powershell"`.
- Timeout and shutdown terminate the entire tracked process tree.

## Developing the Hook Protocol

This section is for Meldra maintainers. Read these documents before changing behavior:

- [ADR 0045](adr/0045-cross-runtime-out-of-band-hooks.md)
- [Profile Runtime contract](../packages/coding-agent/docs/profile-runtimes.md)
- [DSH Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [Low-level Hook reference](../packages/coding-agent/docs/hooks.md)
- [Agent governance](../AGENTS.md)

### Module Boundaries

| Module | Ownership |
|---|---|
| `src/hooks/types.ts` | Public event and configuration types |
| `src/hooks/config.ts` | Schema, merge, matcher, execution filter |
| `src/hooks/condition.ts` | Safe `if` subset |
| `src/hooks/decisions.ts` | Cross-Runtime Decision normalization and fixed controls |
| `src/hooks/command-runner.ts` | Process, stdin/stdout, timeout, cleanup |
| `src/hooks/settings-watcher.ts` | Hook-only live settings watcher |
| `src/hooks/management.ts` | Pure import, merge, and CRUD functions |
| `extensions/meldra-hooks/` | Native Adapter, TUI, i18n |
| `extensions/dsh/hooks.ts` | DSH Cordis Runtime Adapter |
| `core/settings-manager.ts` | Profile/Project Hook-layer storage |

Do not move an external Runtime's Agent-loop behavior into `src/hooks/` or generic Pi core.

### Adding an Event

Adding an Event requires all of the following:

1. Add a stable name to `MELDRA_HOOK_EVENTS`.
2. Define portable input.
3. Select matcher input.
4. Specify allowed Decision types.
5. Identify a real Native lifecycle seam.
6. Mark every external Runtime exact, approximate, or unsupported.
7. Add the Event to a TUI category.
8. Update the documentation matrix.
9. Add Native and DSH tests.
10. Verify shutdown and hot reload.

Do not infer equivalent semantics from equivalent event names.

### Adding a Decision

Decision normalization belongs in `src/hooks/decisions.ts`; Adapters only map a Decision into their Runtime.

A new Decision must answer:

- Can it block an operation that already happened?
- Does it change model-visible content?
- Can raw Handler output leak?
- What is the precedence across parallel Handlers?
- Is unsupported behavior ignored, warned, or failed?
- Does it need a loop guard?
- Does it change a durable Session?

Any model-visible control must be fixed Runtime-owned text. It must not interpolate Handler output.

### Adding a Handler Type

The only current type is `command`. Before adding HTTP, MCP, or another Handler, define:

- ownership;
- authentication;
- SSRF and redirect policy;
- payload redaction;
- timeout and response bounds;
- retry semantics;
- cancellation;
- Native/DSH consistency;
- TUI, hot reload, and diagnostics.

Do not wrap the command runner into an implicit network Handler.

## Developing a Runtime Adapter

A Runtime Adapter must at least:

1. Receive the resolved in-memory snapshot.
2. Trigger Events inside Runtime-owned lifecycle seams.
3. Construct portable input.
4. Call shared matcher, condition, and Decision helpers.
5. Keep Handler output out of Prompt content.
6. Use fixed generic block and continuation controls.
7. Report unsupported and approximate behavior.
8. Serialize lifecycle notifications that require order.
9. Drain or terminate processes during shutdown.
10. Never write Hook config into Runtime settings or credentials.

### Native Adapter

The Native Adapter is a hidden inline Extension. It uses Pi Extension events, but a Hook is still not a user Extension. Tool arguments can change only at the mutable `tool_call` input seam.

### DSH Adapter

The DSH Adapter is an injected Cordis plugin:

```text
meldra-command-hooks
```

It receives snapshots through `meldra/hooks.configure`. It must use public DSH seams such as:

```text
agent/pre-step
tools/pre-execute
tools/post-execute
agent/turn-stopping
agent/status
session/event
agent/disposed
```

Do not monkey-patch `ReactLoopAgent`, mutate private phase state, intercept `deriveMessages()`, or create a second DSH Agent loop in the Host.

## Testing and Validation

### Handler Smoke Test

Feed stdin directly:

```bash
printf '%s' '{"session_id":"test","cwd":"/tmp/project","hook_event_name":"AgentEnd"}' \
  | node .pi/hooks/audit.mjs
```

Windows PowerShell:

```powershell
'{"session_id":"test","cwd":"C:/work","hook_event_name":"AgentEnd"}' |
  node .pi/hooks/audit.mjs
```

Do not call real networks, credentials, desktop programs, or production scripts in validation unless the user explicitly authorizes it.

### Focused Tests

```bash
npm --prefix packages/coding-agent test -- \
  meldra-hooks-config.test.ts \
  meldra-hooks-condition.test.ts \
  meldra-hooks-decisions.test.ts \
  meldra-hooks-runner.test.ts \
  meldra-hooks-native.test.ts \
  metapi-dsh-hooks.test.ts
```

Management and hot reload:

```bash
npm --prefix packages/coding-agent test -- \
  meldra-hooks-management.test.ts \
  meldra-hooks-hot-reload.test.ts \
  meldra-hooks-directory-owner.test.ts \
  meldra-hook-examples.test.ts
```

### Completion Matrix

A protocol or Adapter change must cover:

- valid and invalid schema;
- Profile/Project merge and Trust;
- global/Event/Handler disable;
- matcher and condition;
- exit `0`, `2`, error, timeout, abort;
- split UTF-8 chunks;
- stdout/stderr bounds;
- Prompt output isolation;
- fixed block and continuation controls;
- Native/DSH Decision parity;
- DSH notification ordering;
- watcher creation/deletion/atomic replacement;
- last-known-good fallback;
- shutdown drain and process-tree cleanup;
- `/hooks` at 60/80/120 columns;
- `pi` Compatibility hooks-directory warning;
- ordinary Meldra hooks-directory ownership.

Build and broad validation:

```bash
npm --prefix packages/coding-agent run build
npm --prefix packages/coding-agent test
npm run check:pinned-deps
npm run check:ts-imports
npm run check:shrinkwrap
npm run check:install-lock:coding-agent
```

Passing tests does not prove a real Runtime, TUI, browser, network, or deployment was validated. Completion reports must distinguish these states.

## Reference

- [Meldra Hooks protocol reference](../packages/coding-agent/docs/hooks.md)
- [Hook examples](../packages/coding-agent/examples/hooks/)
- [Settings](../packages/coding-agent/docs/settings.md)
- [Profile Runtime provider contract](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [Pi Extension API](../packages/coding-agent/docs/extensions.md)
- [TUI Components](../packages/coding-agent/docs/tui.md)
- [ADR 0045](adr/0045-cross-runtime-out-of-band-hooks.md)
- [HTTP Handler security evaluation](investigations/2026-08-21-meldra-http-hook-handler-evaluation.md)
