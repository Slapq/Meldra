# Built-in and Current-Machine Extensions

Baseline: Pi v0.84.2 plus the current Meldra patch layer. Current-machine observations were collected on 2026-08-12 and
are not part of the immutable upstream inventory.

## Product built-in Extensions

Meldra-owned built-ins are named inline factories with `hidden: true`. Hidden does **not** mean inactive: the loaded
Extension still registers commands, providers, or lifecycle guidance. It means the resource is marked hidden in loader
metadata.

### `metapi-config`

| Field | Value |
|---|---|
| Entry | `packages/coding-agent/src/extensions/metapi-config/index.ts` |
| Built-in name | `metapi-config` |
| User entry | `/config [plugin-id]` |
| Events | `config:register`, `config:unregister`, `config:get`, `config:updated:<id>` |
| State | In-memory registration catalog plus Profile-local plugin values |
| Files | `<profile-agentDir>/plugin-configs/<id>.json` |
| Compatibility | Not registered in the reserved `pi` Profile |

**Responsibility.** It automatically gives every ordinary Meldra Profile the existing simple pi-config TUI and event
protocol. It does not add a native Config API, reinterpret Meldra settings, or make plugin configuration project-owned.
The registration object, supported fields, event payloads, persistence scope, and compatibility rules are the normative
[Profile Config Registration Protocol](profile-config-protocol.en.md); Meldra Profile plugins use that contract for
ordinary scalar configuration so configuration surfaces retain one style.

### `llama.cpp`

| Field | Value |
|---|---|
| Entry | `packages/coding-agent/src/extensions/llama/index.ts` |
| Built-in name | `llama.cpp` |
| User entry | `/llama`; authentication entry `/login llama.cpp` |
| Command | `llama` |
| Provider | `llama.cpp` |
| Tools / events | None |
| Main UI | Custom interactive model manager |
| State | In-memory loaded-model catalog plus Pi model-catalog persistence |
| Configuration | `LLAMA_BASE_URL`, `LLAMA_API_KEY`; default router `http://127.0.0.1:8080` |
| External services | llama.cpp router and optional Hugging Face API |
| Token lookup | `HF_TOKEN`, `HF_TOKEN_PATH`, `HF_HOME`, `XDG_CACHE_HOME`, standard HF cache path |

**Responsibility.** It registers a native `llama.cpp` provider, discovers loaded router models, refreshes the Pi model
registry, and gives `/llama` a TUI for loading, unloading, searching, and downloading GGUF models.

**Internal modules.** `client.ts` implements router HTTP/SSE calls; `provider.ts` maps the router catalog into Pi models
and authentication; `huggingface.ts` searches GGUF repositories and locates an HF token; `ui.ts` implements the TUI.

**Direct relationships.** It shares `ctx.ui.custom()` with several official UI examples, but has no command, tool,
provider ID, or lifecycle-event name collision in the official example set. The official custom-provider examples
register `custom-anthropic` and `gitlab-duo`, not `llama.cpp`.

Evidence: `src/extensions/index.ts`, `src/extensions/llama/index.ts`, `src/extensions/llama/provider.ts`,
`src/extensions/llama/client.ts`, `src/extensions/llama/huggingface.ts`, and `src/extensions/llama/ui.ts`.

### `metapi-dsh`

| Field | Value |
|---|---|
| Entry | `packages/coding-agent/src/extensions/dsh/index.ts` |
| Built-in name | `metapi-dsh` |
| Activation | Only a Profile whose selected Runtime provider is `deepseek-harness` |
| User entry | `/dsh`, documented direct DSH aliases, renderers, dialogs, and compact status |
| Runtime ownership | None; `DshProfileRuntime` owns Harness subprocesses, cursors, listeners, and Sessions |
| Compatibility | Registers no DSH surface for ordinary Pi Runtime Profiles |

**Responsibility.** It presents Harness-native Sessions, models, Presets, commands, Skills, tools, settings, queue,
packages, and diagnostics through Pi's TUI. It consumes the attached Profile Runtime capability and does not implement
or persist a second Harness Agent loop. See [DeepSeek Harness Profile
Runtime](../../packages/coding-agent/docs/deepseek-harness.md).

### `metapi-profile`

| Field | Value |
|---|---|
| Entry | `packages/coding-agent/src/metapi/profile-extension.ts` |
| Built-in name | `metapi-profile` |
| User entry | `/profile` |
| Command | `profile`, with `status`, `list`, `import`, `export`, `update`, `bind`, `unbind` |
| Event | `session_start` |
| Tools / providers | None |
| Main UI | Single configuration chooser and confirmation dialogs |
| Status key | `metapi-profile` |
| State | Directory bindings and installed Profile records |
| Configuration | `METAPI_PROFILE_NAME`, `METAPI_CODING_AGENT_DIR`, `PI_OFFLINE` |
| Files | `~/.metapi/project-bindings.json`, `~/.metapi/profiles/<id>/profile.json`, optional project `.pi/metapi.json` |

**Responsibility.** It presents and switches the Profile used by the current Meldra session, imports and manages Profile
Bundles, persists the active Profile with the session, and separately records which Profile the current directory will
use when a new session is launched there.

**Direct relationships.** It shares `session_start` with many official examples and uses a distinct keyed status slot,
so it can coexist with other `setStatus()` users. No official example registers `/profile`.

Evidence: `src/extensions/index.ts`, `src/metapi/profile-extension.ts`, `src/metapi/profile-service.ts`,
`src/metapi/profile-bundle.ts`, and `src/metapi/session-profile.ts`.

### `metapi-workspace`

| Field | Value |
|---|---|
| Entry | `packages/coding-agent/src/metapi/workspace-extension.ts` |
| Built-in name | `metapi-workspace` |
| User entry | `/workspace` |
| Command | `workspace` |
| Events | `session_start`, `before_agent_start` |
| Tools / providers | None |
| Status key | `metapi-workspace` |
| State | Session custom entry containing the WorkSpace root |
| Default root | `~/.metapi/workspaces/` |

**Responsibility.** It shows the WorkSpace bound to the current conversation and injects scope guidance so Skills,
Extensions, Prompt Templates, Themes, and package resources remain in the current Profile unless the user explicitly
selects Current WorkSpace. WorkSpace scope maps to Pi's project-local `.pi` resources.

**Direct relationships.** It shares `session_start` with the Profile extension, uses a distinct keyed status slot, and
modifies the per-turn system prompt only for sessions carrying WorkSpace metadata.

Evidence: `src/extensions/index.ts`, `src/metapi/workspace-extension.ts`, `src/metapi/workspace-service.ts`, and
`src/metapi/session-profile.ts`.

## Current-machine inventory

### Discovery summary

| Scope | Entry | Discovery | User surface |
|---|---|---|---|
| Original Pi user | `C:\Users\Administrator\.pi\agent\extensions\scout.ts` | User Extension directory | `scout` tool and `/scout` |
| Original Pi user Package | `S:\VSCODE\ollama-web-search\extensions\ollama-web-search.ts` | `settings.json` local Package | `/search`, `/fetch`, `web_search`, `web_fetch` |
| Original Pi user Package | `S:\VSCODE\provider-manager\extensions\provider-manager.ts` | `settings.json` local Package | `/provider`, dynamic providers |
| Original Pi user Package | `S:\VSCODE\pi-config\extensions\pi-config.ts` | `settings.json` local Package | `/config`, shared config event protocol |
| Original Pi user Package | `C:\Users\Administrator\MyAPPS\pi-claude-code-provider\index.ts` | `settings.json` local Package | Claude setup/status commands and provider |
| Meldra repository project | `.pi/extensions/import-repro.ts` | Trusted project Extension directory | `/ir` |
| Meldra repository project | `.pi/extensions/prompt-url-widget.ts` | Trusted project Extension directory | Automatic widget |
| Meldra repository project | `.pi/extensions/redraws.ts` | Trusted project Extension directory | `/tui` |
| Meldra repository project | `.pi/extensions/tps.ts` | Trusted project Extension directory | Automatic notification |

No project `.pi/settings.json` was present at inspection time. The default Meldra Profile settings contained two
temporary local Package paths, but both targets no longer existed; no Extension entry could be loaded from them.

### `scout.ts`

| Field | Value |
|---|---|
| Tool | `scout` |
| Command | `/scout` compatibility alias for `/config scout` |
| Events | `session_start`, `session_shutdown`, `before_agent_start` |
| State | Active child-process PIDs and per-session fallback-notification state |
| Config | `<agentDir>/plugin-configs/scout.json` via the Profile Config protocol; legacy `<agentDir>/scout.json` is read as a migration fallback |
| External process | A disposable child Meldra process in JSON print mode; Windows cleanup can call `taskkill.exe` |
| Child capabilities | `read`, `grep`, `find`, `ls`, `bash`; no session and no Extensions |

The tool delegates a self-contained read/search task to an isolated context and returns a compressed report. `/scout`
configures model, thinking, and guideline injection. It has no name collision with the built-ins.

Evidence: `scout.ts:1-28,161-203,443-564,764-837,841-1113,1137-1148`.

### `ollama-web-search.ts`

| Field | Value |
|---|---|
| Package | `pi-ollama-web-search@1.0.0` |
| Commands | `/search`, `/fetch` |
| Tools | `web_search`, `web_fetch`, both with custom renderers |
| Event | `session_start`; shared events `config:register`, `config:get`, `config:updated:ollama-web-search` |
| Configuration | API key, base URL, timeout, result/content/link limits |
| Environment | `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`; locale variables for EN/ZH |
| External service | Ollama Web Search API: `/api/web_search`, `/api/web_fetch` |

It provides both direct user commands and model-callable web search/fetch tools. It delegates persistence to `pi-config`
through the shared event bus. Its registered names do not duplicate names in the built-in or official example catalogs.

Evidence: `S:\VSCODE\ollama-web-search\package.json:1-25`; `extensions/ollama-web-search.ts:103-211,243-377,383-486`.

### `provider-manager.ts`

| Field | Value |
|---|---|
| Package | `pi-provider-manager@1.0.0` |
| Command | `/provider` |
| Providers | Dynamically registers or unregisters user-named providers |
| Events / tools | None |
| Files | `<agentDir>/models.json`, `<agentDir>/settings.json`, `<agentDir>/plugin-configs/provider-manager.json` |
| Environment | `LANG`, `LC_ALL`, `LANGUAGE` for EN/ZH interface selection |
| External service | User-configured provider `/models` endpoints |

It presents a TUI for creating, importing, editing, copying, and deleting provider/model definitions, writes Pi's
existing model/settings files, and immediately updates the runtime provider registry. Dynamic provider names can relate
to any existing provider ID chosen by the user; the fixed command name has no static collision in this index.

Evidence: `S:\VSCODE\provider-manager\package.json:1-23`;
`extensions/provider-manager.ts:347-538,631-712,881-1181,1474-2013`.

### `pi-config.ts`

| Field | Value |
|---|---|
| Package | `pi-config@1.0.0` |
| Command | `/config [plugin-id]` |
| Shared events | Listens to `config:register`, `config:unregister`, `config:get`; emits `config:updated:<id>` |
| Tools / providers / lifecycle events | None |
| Files | `<agentDir>/plugin-configs/<id>.json` and its own `pi-config.json` |
| External dependencies | No process or network service; Pi TUI only |

It is a configuration host for other Extensions. Registered Extensions provide field metadata/defaults over `pi.events`;
`pi-config` owns the selection/form UI and JSON persistence. On this machine it directly hosts configuration for
`ollama-web-search` and `pi-claude-code-newapi`.

Evidence: `S:\VSCODE\pi-config\package.json:1-23`; `extensions/pi-config.ts:159-227,310-452,463-803`.

### `pi-claude-code-newapi`

| Field | Value |
|---|---|
| Package | `pi-claude-code-newapi@0.2.0` |
| Commands | `/claude-code-setup`, `/claude-code-status` |
| Provider | Configurable ID, default `Claude`; Anthropic Messages API |
| Event | `before_provider_headers`; shared config events |
| Config | `plugin-configs/claude-code-newapi.json`, Pi `models.json`, Claude settings fallback |
| Environment | `CLAUDE_CODE_NEWAPI_KEY`, `PI_CODING_AGENT_DIR`, `CLAUDE_CONFIG_DIR`, Anthropic variables |
| External service | Configured NewAPI endpoint `/v1/models` and Anthropic-compatible `/v1/messages` |

It reads either a Pi provider, standalone plugin settings, Claude Code settings, or environment fallbacks, then
registers a provider and applies the configured authorization headers. It depends on `pi-config` for its form/update
event path. Its fixed command names do not collide with the built-in or official example sets; its configurable provider
ID may intentionally correspond to an existing provider definition.

Evidence: `C:\Users\Administrator\MyAPPS\pi-claude-code-provider\package.json:1-20`; `index.ts:8-217`;
`config.ts:1-146`.

### `import-repro.ts`

| Field | Value |
|---|---|
| Command | `/ir` |
| Events / tools | None |
| Function | Import a CI issue-analysis session and switch to it |
| Inputs | Gist ID/URL, Pi share URL, GitHub issue URL, local `.html` or `.jsonl` |
| State | Writes a rewritten JSONL session into the current session directory |
| Network | GitHub Gist and issue-comment APIs |

It rewrites a remote checkout `cwd` to the local checkout, asks before replacing an existing destination, writes the
imported session, and calls `ctx.switchSession()`.

Evidence: `.pi/extensions/import-repro.ts:1-17,61-77,222-284,284-350`.

### `prompt-url-widget.ts`

| Field | Value |
|---|---|
| Commands / tools | None |
| Events | `before_agent_start`, `session_start`, and `session_switch` in the source |
| UI | Widget key `prompt-url` |
| Function | Show PR, issue, or advisory metadata from recognized prompt formats |
| External program | GitHub CLI `gh` |
| State | Rebuilds from session messages; no separate persistent file |

It recognizes fixed prompt prefixes, fetches metadata with `gh`, sets a widget, and may set the session name.

**API compatibility observation.** `before_agent_start` and `session_start` are current Extension events.
`session_switch` is not present in the v0.84.2 `ExtensionAPI.on` overloads; the current API exposes
`session_before_switch`. This is recorded as a source/API mismatch only; this indexing task does not modify it.

Evidence: `.pi/extensions/prompt-url-widget.ts:8-10,30-46,80-108,117-190,201-232,246-269`;
`src/core/extensions/types.ts:1202-1243`.

### `redraws.ts`

| Field | Value |
|---|---|
| Command | `/tui` |
| Events / tools | None |
| Function | Display the TUI full-redraw counter |
| State / external dependencies | None |

It temporarily obtains the TUI instance through `ctx.ui.custom()`, reads `tui.fullRedraws`, and shows the count.

Evidence: `.pi/extensions/redraws.ts:1-23`.

### `tps.ts`

| Field | Value |
|---|---|
| Commands / tools | None |
| Events | `agent_start`, `agent_end` |
| Function | Display output-token throughput and usage totals after a run |
| State | In-memory start timestamp |
| External dependencies | None |

Evidence: `.pi/extensions/tps.ts:11-46`.

## Test-only Extension fixtures

Tests construct many inline factories or temporary Extension modules to verify discovery, trust, duplicate
commands/tools/flags, shortcut precedence, events, providers, renderers, dynamic tools, compaction, model selection,
queueing, and reload behavior.

They are not product plugins and are excluded from the 89-entry runtime catalog. Principal fixture locations include:

- `packages/coding-agent/test/extensions-discovery.test.ts`
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/resource-loader.test.ts`
- `packages/coding-agent/test/agent-session-dynamic-tools.test.ts`
- `packages/coding-agent/test/agent-session-dynamic-provider.test.ts`
- `packages/coding-agent/test/suite/agent-session-*.test.ts`
- `packages/coding-agent/test/suite/regressions/*extension*.test.ts`

The test fixtures remain useful evidence for runtime semantics, especially duplicate registration and load ordering, but
they are not user-facing Extension entries.
