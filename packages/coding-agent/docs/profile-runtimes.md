# Profile Agent Runtimes

MetaPi can construct a Profile-owned agent backend while retaining Pi's session host, extensions, terminal lifecycle, and TUI. This is a composition interface for external runtimes, not a second agent implementation inside Pi core.

## Responsibilities

Pi core owns only the generic host boundary:

- select at most one `ProfileRuntimeProvider` during runtime construction;
- attach the resulting `ProfileAgentRuntime` to `AgentSession` before prompts begin;
- delegate prompt, abort, idle waiting, and disposal to that runtime;
- expose the attached runtime to extensions as a read-only capability;
- preserve the native Pi agent path when no provider matches.

A provider and its runtime own all product-specific behavior, including upstream protocol methods, agent loops, models, presets, tools, persistence, and event interpretation. Those details must not be added to `main.ts` or the generic core interfaces.

## Provider selection

`ProfileRuntimeDescriptor` describes the active Profile and construction context:

- `name` and `displayName` identify the selected Profile;
- `agentDir` is the Profile-owned state directory;
- `cwd` is the session WorkSpace;
- `compatibility` identifies the reserved original-Pi compatibility path;
- optional `runtime` is the Profile's portable `{ provider, config? }` selection;
- `modelRuntime` provides the already-composed MetaPi model and credential boundary.

The `runtime.provider` string is a stable provider identity, not a Profile name. `runtime.config` is opaque to MetaPi/Pi core and interpreted only by the matching provider. A Profile without a runtime declaration follows the native Pi path unless a provider supplies a documented legacy compatibility match. This allows differently named Profiles to select the same external runtime while retaining separate `agentDir`, settings, sessions, packages, and provider-owned state.

A Profile Bundle declares the selection under its existing `metapi` manifest:

```json
{
  "metapi": {
    "profileVersion": 1,
    "displayName": "Research Harness",
    "runtime": {
      "provider": "deepseek-harness",
      "config": {
        "plugins": ["npm:@example/dsh-plugin@1.0.0"]
      }
    }
  }
}
```

The `config` example is provider-owned data, not a generic plugin schema. Profile import/export preserves it without interpreting, executing, or merging it into project configuration. Runtime-specific provisioning is performed only through an explicit provider capability and user operation.

MetaPi passes this descriptor to each registered provider. Zero matches keeps Pi's native agent backend. One match constructs that Profile runtime. Multiple matches are rejected as an ambiguous composition instead of choosing by registration order. Provider selection is part of the Profile environment: a project may recommend, bind, or activate the Profile, but project `.pi` configuration does not replace its provider or mutate provider-owned packages.

The current `builtInProfileRuntimeProviders` registry is a MetaPi composition seam for bundled providers. It is not yet a public dynamic package registration API. A provider's matching rules and factory belong in that provider's module.

## Profile Runtime package capability

A Profile is one complete working environment, so a Runtime provider may expose its own package manager through the optional `ProfileRuntimeProvider.packages` capability. This is distinct from Pi Packages: Pi continues to own Extensions, Skills, Prompts, and Themes in the Profile's `agentDir`, while an external Runtime owns packages interpreted by its native loader.

```ts
interface ProfileRuntimePackageManager {
  execute(
    profile: ProfileEnvironmentDescriptor,
    request: ProfileRuntimePackageRequest,
    options?: ProfileRuntimePackageExecutionOptions,
  ): Promise<ProfileRuntimePackageResult>;
  verify?(profile: ProfileEnvironmentDescriptor): Promise<ProfileRuntimePackageVerification>;
  snapshot?(profile: ProfileEnvironmentDescriptor, currentConfig: unknown): Promise<unknown>;
  restore?(
    profile: ProfileEnvironmentDescriptor,
    config: unknown,
    options?: ProfileRuntimePackageExecutionOptions,
  ): Promise<ProfileRuntimePackageResult>;
}

type ProfileRuntimePackageRequest =
  | { operation: "list" }
  | { operation: "add"; source: string }
  | { operation: "remove"; packageName: string }
  | { operation: "update" };
```

`ProfileEnvironmentDescriptor` carries the Profile identity, `agentDir`, current command `cwd`, compatibility fact, and portable runtime declaration; unlike `ProfileRuntimeDescriptor`, it has no `ModelRuntime` and can be used by one-shot Profile CLI operations without constructing an agent Runtime. `resolveProfileRuntimeProvider()` applies the same zero/one/many matching contract for both runtime construction and management commands.

The package manager owns source syntax, native executable selection, storage, reconciliation, and exit semantics. MetaPi passes source/package strings unchanged, streams optional output through `onOutput`, propagates `AbortSignal`, and treats only `code: 0` as command completion. A mutation result may set `verificationRequired`; when the provider also implements `verify()`, one-shot CLI and Profile restore construct a fresh provider-owned Loader/Runtime check before reporting activation success. TUI flows may satisfy the same contract by restarting their already-owned Runtime and reading its inventory. Package operations are always Profile-scoped. Project `.pi`, WorkSpace resources, directory bindings, and the current process directory do not acquire package ownership from this capability.

The optional `snapshot()` and `restore()` methods connect provider-owned packages to Portable Profile export/import without exposing a provider's config schema to Pi core. Export passes the current opaque `runtime.config` to `snapshot()` and writes the returned value back under the provider declaration. Import and update pass that config to `restore()` after Pi packages are installed; a nonzero result fails the Profile operation and is never reported as successful. Providers without these methods retain the declaration-only behavior. Snapshot data must contain source declarations needed for restoration, not native caches, Loader state, Sessions, Settings, or credentials.

## Runtime lifecycle

A `ProfileAgentRuntime` is constructed once per `AgentSession` runtime and receives a `ProfileAgentRuntimeHost` through `attach()` before user prompts are delegated.

The host provides:

- the active working directory and containing Pi session ID;
- `appendEntry()` for provider-specific transcript entries rendered by an extension; providers can set `notify: false` when a transient UI event already rendered the same durable snapshot;
- `emit()` for transient generic `AgentSessionEvent` delivery when a provider can represent its live updates through the shared event model.

`emit()` updates current host subscribers only. It does not persist a Pi Session message and does not add external-runtime content to Pi's model context. The provider remains responsible for durable upstream state. If it also keeps a Pi-side display snapshot, it uses `appendEntry()` and avoids notifying twice.

Providers may attach generic presentation metadata to a tool result's open `details` object. `profilePresentation` uses product-independent `terminal`, `diff`, `read`, `search`, `web-search`, or `web-fetch` data; the provider translates its upstream protocol at the boundary, while Pi's fallback renderer owns theme-aware layout, folding, and expansion. Unknown or malformed presentation data falls back to the ordinary raw arguments/result surface. `durationMs`, when present, is a finite non-negative elapsed duration in milliseconds derived from the provider's authoritative lifecycle timestamps. Neither field changes native Pi tool definitions, extension renderers, execution, persistence, or model context.

The runtime implements:

- `prompt()` for user text, optional images, and queue behavior;
- `abort()` for cancellation using the external runtime's native semantics;
- `waitForIdle()` for lifecycle synchronization;
- `isStreaming` for host interaction state;
- optional `commandSurface.preferredExtensionCommands` for same-name extension commands that should own interactive discovery and dispatch while this Runtime is attached;
- optional `commandSurface.hiddenBuiltinCommands` for built-ins whose semantics cannot be honored by this Runtime; hidden commands are removed from completion and rejected before built-in dispatch;
- optional `commandSurface.doubleEscapeExtensionCommand` for routing Pi's native idle, empty-editor double-Escape gesture to one registered extension command; `doubleEscapeAction: "none"`, single-Escape cancellation, streaming abort, Bash, autocomplete, and overlay behavior remain host-owned;
- active-Session HTML export may reuse registered product-neutral custom-entry TUI renderers; standalone export has no extension runtime and keeps those entries hidden;
- optional `selectModel(model)` for applying a user-confirmed Pi model before the containing `AgentSession` commits its model-change entry and Profile preference;
- optional `getLastAssistantText()` for copy surfaces when finalized provider messages do not live in Pi agent state;
- `dispose()` for subprocesses, cursors, listeners, and other owned resources.

The command-surface declaration contains only generic command names. Pi honors a preferred name only when an extension command with that exact invocation name is registered; otherwise the built-in command remains authoritative. A preferred extension command replaces the same-name built-in only in autocomplete, built-in-conflict diagnostics, and interactive dispatch for the attached Runtime. A hidden built-in is omitted from autocomplete and produces an explicit unavailable warning when typed; it is not forwarded to the external agent as prompt text. The extension still owns preferred-command execution and errors. `getLastAssistantText()` supplies only transient finalized text for the active provider Session and does not alter Pi transcript or model context. Runtimes that omit these declarations, including ordinary Pi sessions, retain the existing built-in command list, copy source, and dispatch behavior.

When a Runtime implements `selectModel(model)`, Pi's native `/model` selector, direct `/model provider/id` command, and model-selection validation remain authoritative. The Runtime receives only the model the user confirmed. Pi waits for the Runtime before changing agent state, appending a model-change entry, or persisting the Profile preference; rejection leaves the previous Pi selection intact. A Runtime that omits the hook retains ordinary Pi behavior.

Interactive cancellation surfaces delegate through `AgentSession.abort()`. The ordinary Pi path keeps its existing retry abort, native agent abort, and idle wait; a matched Profile Runtime receives `abort()` and owns the external cancellation semantics. UI code must not bypass this boundary by aborting Pi's underlying agent directly.

Profile switching, session replacement, and process shutdown await disposal before the next runtime is used. A successful in-session Profile switch invalidates the command's old extension context; completion feedback and status updates belong to the rebuilt runtime host or a replacement-session callback, not code after the awaited switch on the old context. Extensions may inspect `ctx.profileRuntime` and register UI, commands, renderers, or compact status indicators, but they do not own or dispose the runtime. A Profile extension may atomically restore transient text and image input through `ctx.ui.setEditorDraft()`; the TUI owns that draft until one ordinary prompt submission consumes it, and setting a draft does not persist bytes to either Pi or external Runtime history. Runtime-specific write-only values may use the additive `ctx.ui.secretInput()` TUI capability; ordinary `ctx.ui.input()` behavior remains unchanged for existing Pi extensions, and non-TUI modes return no secret value. A runtime must stop emitting before `dispose()` resolves; its extension must unsubscribe and clear provider-owned status keys on session shutdown. Runtime prompt or event-stream failures remain explicit errors and must not be converted into completed assistant turns.

## Compatibility rules

- A provider must leave ordinary Pi sessions unchanged when it does not match.
- The reserved `pi` Profile remains on the original Pi state and native agent path unless an explicit future contract says otherwise.
- External runtime sessions and Pi sessions remain separate unless a provider documents a tested mapping.
- Product-specific defaults, protocols, and persistence stay outside generic interfaces.
- New host capabilities require documentation of ownership, lifecycle, errors, teardown, a real provider use case, and native Pi compatibility coverage.

DeepSeek Harness is the first provider using this boundary. See [DeepSeek Harness Profile Runtime](deepseek-harness.md).
