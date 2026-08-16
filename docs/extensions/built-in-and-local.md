# Built-in and Current-Machine Extensions

Baseline: Pi v0.84.2 plus the current MetaPi patch layer. Current-machine observations were collected on 2026-08-12 and
are not part of the immutable upstream inventory.

## Product built-in Extensions

MetaPi-owned built-ins are named inline factories with `hidden: true`. Hidden does **not** mean inactive: the loaded
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

**Responsibility.** It automatically gives every ordinary MetaPi Profile the existing simple pi-config TUI and event
protocol. It does not add a native Config API, reinterpret MetaPi settings, or make plugin configuration project-owned.
The registration object, supported fields, event payloads, persistence scope, and compatibility rules are the normative
[Profile Config Registration Protocol](profile-config-protocol.en.md); MetaPi Profile plugins use that contract for
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

**Responsibility.** It presents and switches the Profile used by the current MetaPi session, imports and manages Profile
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
