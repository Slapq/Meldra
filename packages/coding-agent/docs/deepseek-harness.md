# DeepSeek Harness Profile Runtime

> For a workflow-oriented introduction, start with the Chinese [Meldra User
> Guide](../../../docs/user-guide.md#12-使用-deepseek-harness-profile) or the [English
> guide](../../../docs/user-guide.en.md#12-run-a-deepseek-harness-profile).

Meldra can run DeepSeek Harness (DSH) as the agent backend of an independent Profile while retaining the Pi terminal
interface. A portable Profile selects it with `meldra.runtime.provider: "deepseek-harness"`; Profile names are
user-owned and do not determine the Runtime.

The legacy `dsh` and `deepseek-harness` names remain compatibility matches for existing installations without that
declaration. The generic composition root asks registered [Profile Runtime providers](profile-runtimes.md) for a match;
DSH provider identity and its factory are declared only by the DSH provider module.

The paired Pi extension checks the selected provider before registering any command, renderer, event handler, or status
surface. Ordinary Profiles therefore have neither a DSH Runtime match nor DSH extension registrations and keep the
native Pi agent path and command registry.

## Start

Configure the `deepseek` provider through Meldra `/login`, then launch an imported DSH Profile by its own name:

```bash
meldra --profile research-harness
```

Existing installations may continue to use the legacy compatibility name:

```bash
meldra --profile dsh
```

Normal editor input is delegated by `AgentSession` to the Profile-owned DSH Runtime. Pi's agent loop does not receive
those prompts.

The Runtime submits prompts through Harness's native `session.prompt` ApiProxy method; Harness owns admission, commands,
queueing, Agent creation/resume, preset composition, tools, and durable events. Meldra consumes those events through the
native mux and host streams and renders them in Pi's TUI.

For the DSH Profile only, selecting an `@` file or directory from Pi's native completion marks that exact path as an
input attachment. At submission, the original mention remains visible and Meldra appends deterministic source-delimited
content before calling the ordinary Runtime prompt chain.

UTF-8 text is capped at 50,000 characters per file and 200,000 characters across one prompt; a directory contributes at
most 200 sorted top-level entries. Supported images reuse Pi's signature detection and image processing and enter the
same native image array as pasted images.

Merely typing an `@name` does not attach it. A selected path that disappears, is unreadable, or is not valid UTF-8 stops
that submission and restores the complete editor draft instead of silently sending an unexpanded prompt.

These attachments are transient prompt inputs and do not create a parallel file cache or Pi Session record.

While a DSH turn is running, Pi's ordinary streaming-input gestures retain their delivery meaning: steer input maps to
Harness `mode: "steer"`, and follow-up input maps to `mode: "queue"`. The product-neutral interrupt-and-send action
calls `AgentSession.abort()`, waits for the Profile Runtime to settle, then submits the editor text through the ordinary
prompt chain; its default is `Ctrl+Enter` except on Windows, where `Ctrl+Shift+Enter` avoids Pi's existing Windows
Terminal newline compatibility.

Harness native cancellation preserves pending FIFO work, so the replacement message is admitted after previously queued
items instead of replacing them. These calls finish when Harness confirms native inbox admission; they do not create
another Meldra turn tracker or replace the foreground task awaited by cancel, Session replacement, and shutdown.

Harness's `session/queue` snapshot remains authoritative for pending work.

Meldra initializes and loads Harness's native `$DSH_HOME/profiles/meldra` profile tree. Its default
`dsh.profile.bundles` roster is the published `@deepseek-ai/dsh-base` plus `@deepseek-ai/dsh-web-app` rc.8 layers,
preserving the previous zero-configuration composition.

The profile manifest, profile-local dependencies, installed bundle layers, and `cordis.patch.yml` are resolved by
`dsh-app-boot`; the profile's user patch is applied after bundles, then Meldra's small surface overlay disables
HTTP/browser transport, selects Harness's browse directory provider, injects the published `@deepseek-ai/dsh` preset
root, and adds the absolute stdio bridge module. This makes bundles installed through Harness's native `dsh plugin
--profile meldra ...` contract part of the next Runtime boot without introducing a Meldra Loader state.

The `/dsh plugins` package manager delegates list/add/remove/update to that CLI, requires `pnpm` on `PATH`, confirms
source/install lifecycle effects before writes, preserves native failure output, and can gracefully reload the same
Profile Runtime after a successful mutation. The live Loader inventory remains authoritative and directly inspectable;
Meldra does not infer package success from the requested operation.

## Runtime commands

```text
/dsh
/dsh exit
/dsh sessions
/dsh new
/dsh history
/dsh rewind
/dsh fork
/dsh rename [title]
/dsh cancel
/dsh queue
/dsh preset
/dsh model
/dsh effort
/dsh workspace
/dsh subagents
/dsh jobs
/dsh goal
/dsh plan
/dsh todo
/dsh feedback
/dsh attachments
/dsh evidence
/dsh trajectory
/dsh plugins
/dsh settings
/dsh context
/dsh commands
/dsh run /<native-command> [args]
/dsh skills
/dsh invoke /<skill> [args]
/dsh compact
```

The most common Harness operations are also available directly in any Profile selecting the DSH Runtime:

```text
/resume
/sessions
/new
/history
/rewind
/fork
/name
/compact
/session
/settings
/model
/preset
/plan
/goal
/queue
/permission [read-only|workspace-write|danger-full-access]
/cancel
/plugins
/plugin list
/plugin add <npm|git|path|tarball|alias source>
/plugin remove <package>
/plugin update
```

`/permission` changes the Harness-native standing sandbox and approval policy for the current DSH Session. The Meldra
surface also installs a removable DSH compatibility plugin for redundant model-generated escalation metadata: for
`bash`, `pwsh`, `write`, and `edit`, a known `sandbox_permissions` target already covered by the standing mode is removed
together with its paired `justification` before the native tool validates the call. The command then runs under the
unchanged standing policy. A genuinely wider request, an unknown target, a malformed pair, or a policy-resolution error
is passed through unchanged to Harness's approval and fail-closed validation. The plugin neither grants nor persists a
permission and does not alter ordinary Pi tools.

From a normal terminal, the same Profile-owned package adapter is available without starting the TUI:

```bash
meldra profile plugins research-harness list
meldra profile plugins research-harness add github:owner/dsh-plugin
meldra profile plugins research-harness remove package-name
meldra profile plugins research-harness update
```

These commands never write project `.pi` settings and never install into another Profile. They stream the native
DSH/pnpm output and return a nonzero process status on failure.

In a DSH Profile, `/resume` and `/sessions` are exact aliases over the same Harness-native Session browser. The browser
reuses Pi's cursor, current/all scope, search, sort, title, lineage, cwd, status-badge, loading, and cancellation grammar;
DSH supplies structured `session.list` rows and the selected `sessionId`. It does not manufacture Pi Session files or
offer file delete for Harness Sessions. CLI `--resume` remains the containing Meldra/Pi startup selector.

An explicit mutation may use Corepack to fetch Meldra's pinned pnpm when no `pnpm` command is on PATH; read-only `list`
does not trigger that download. Package changes require a fresh Runtime boot.

In the TUI, Meldra asks before external writes and then asks whether to restart the current Runtime; after restart it
reads the native Loader Inventory and reports the entry delta. Terminal mutations are themselves the explicit write
request; after DSH reconciliation they start a short-lived isolated Harness Runtime, read Loader Inventory, print the
active entry count, and tear it down.

Portable Profile export snapshots the current native DSH profile dependencies as `meldra.runtime.config.plugins` source
declarations. Import and Profile update restore those declarations through the same DSH CLI adapter, then validate
activation through a fresh Harness Loader Inventory before writing a successful Profile record.

A package-manager success followed by a Loader startup/inventory error fails the Profile operation explicitly. The
portable manifest does not contain pnpm/Corepack caches, Loader inventory, Harness Sessions, Settings, or credentials.

Path/link declarations retain their native pnpm path and therefore require that path to exist on the destination
machine; use a registry, git, tarball, or alias source for cross-machine bundles.

### Plugin workflow

Meldra passes every source unchanged to `dsh plugin --profile meldra add`, so the current DSH/pnpm grammar is
authoritative. Typical forms are a registry package (`@scope/plugin@1.2.3`), a git shorthand
(`github:owner/repository`), a local directory (`C:\\plugins\\my-dsh-plugin`), a tarball URL, or a pnpm alias.

Do not put credentials in source URLs: terminal output, native manifests, and exported source declarations are not
credential stores.

In the TUI, use `/plugins` for the Loader/package view or `/plugin add <source>` for a direct operation. Meldra confirms
the external write, shows cancellable streamed progress, reports the native exit status, offers to restart Harness, and
then compares Loader Inventory before and after restart.

A zero exit code with no inventory delta means the package manifest changed but no new Loader entry was observed;
inspect whether the source is a DSH bundle and whether its patch entries are enabled. Native plugin commands, tools,
services, or UI become available according to that plugin's own contract; Meldra does not invent a second activation or
command namespace.

From a terminal, use `meldra profile plugins <profile> list|add|remove|update`. `add` accepts one source, `remove`
accepts the native dependency package name, and `update` updates the Profile's current native dependency set.

Mutations stream DSH/pnpm output, then boot a temporary Harness instance for Loader verification and tear it down.
`list` is read-only and never bootstraps pnpm.

If pnpm is absent, only an explicit mutation may fetch pinned pnpm through Corepack; the Profile-local shim is reused
afterward.

For migration, run `meldra profile export <profile> <directory>` and inspect `package.json` under `meldra.runtime`.
Import with `meldra profile import <directory> --name <new-profile> --no-bind` (or choose binding interactively).

The destination gets its own `agent/dsh-runtime`, package manifest, shim, Harness Settings, Sessions, and later Runtime
process; none of those writable paths are shared with the source Profile. Registry/git/tarball restoration may access
the network and run package lifecycle scripts, so import only a Profile Bundle whose package declarations you trust.

Common failures are explicit:

- `requires pnpm or Corepack`: install one of them or use a Node distribution that includes Corepack.
- `pnpm is not prepared`: run an explicit `add`, `remove`, or `update`; `list` intentionally does not download tools.
- nonzero DSH/pnpm exit: no activation success is reported; inspect the streamed native output and source syntax.
- Loader startup or inventory error: package reconciliation may have completed, but the Profile operation is not
  reported as verified.
- package installed with no new inventory entry: confirm that the package declares a DSH bundle and that its native
  patch is enabled.
- exported `link:` path missing on import: restore that path or reinstall from a portable registry, git, tarball, or
  alias source and export again.

`/new`, `/fork`, `/name`, `/compact`, `/session`, and `/settings` use the generic Profile Runtime command-surface
declaration so their same-name DSH extension handlers replace Pi's built-in discovery and interactive dispatch only
while the DSH Runtime is attached. `/model` deliberately remains Pi-owned: it uses the native Pi selector, search,
catalog refresh, exact `provider/model` arguments, scoped-model rules, and authentication check over the active Meldra
Profile's effective `ModelRuntime`.

After the user confirms one model, or cycles to one with Pi's ordinary model-cycle action, `AgentSession` calls the
DSH Runtime's generic model-selection hook before committing the Pi model change. DSH writes only that provider/model
route into the live `llm-pi-ai` Settings namespace, stores a resolved key through the Harness credential service under a
stable reference rather than in Settings, and then calls native `session.selectModel`. Pi persists its model-change entry
and Profile preference only after all three operations succeed. The selector keeps the selection pending until that
asynchronous bridge finishes, rejects duplicate confirmation, closes only after the accepted model is committed, and
forces the current Pi footer to render the new provider/model immediately rather than waiting for the next prompt. The DSH
status listens to the committed Pi `model_select` event, re-reads `session.models`, and labels the Pi active model
separately from the authoritative Harness native route instead of presenting either value as a generic Profile preference.
Opening or cancelling `/model` performs no DSH write, and Meldra does not bulk-copy its model catalog or auth files. The
bundled rc.8 `llm-pi-ai` configuration supports
`openai-completions`, `openai-responses`, and
`anthropic-messages`. Anthropic routes preserve the selected model's endpoint, credential reference, headers, reasoning
metadata, and capacities; use the same endpoint root required by Pi's native Anthropic provider (for example
`https://api.anthropic.com`, with the SDK appending `/v1/messages`). Completion-only `thinkingFormat`, `supportsReasoningEffort`, and `supportsDeveloperRole` switches are serialized only for `openai-completions`.

Other Meldra APIs remain visible in Pi's catalog but are rejected before any Harness Settings write because the current
Meldra bridge does not declare their transport/auth mapping: `bedrock-converse-stream`, `azure-openai-responses`,
`openai-codex-responses`, `google-generative-ai`, `google-vertex`, and `mistral-conversations`. The error names the
selected API and the currently bridgeable set; Meldra does not guess a different wire protocol. Route collisions,
read-only Settings, revision conflicts, and native selection errors also remain explicit and leave the Pi selection
unchanged. `/dsh model` remains the explicitly namespaced Harness native-catalog selector.

`/settings` opens one DSH control surface for the native model selector, adapter-declared reasoning effort, and Harness
Settings/Provider/credential editor; it does not mutate Pi thinking level as a substitute for Harness effort.

`/session` displays Harness projection statistics rather than Pi message/token counts. `/clone`, `/tree`,
`/scoped-models`, `/import`, `/login`, and `/logout` are hidden in DSH because their Pi state or credential mutations do
not control the corresponding Harness authority; explicitly typing one produces an unavailable warning instead of
sending it as model input.

Configure provider credentials before entering DSH or use the native credential editor under DSH `/settings`. Ordinary
Pi Profiles retain their original behavior.

`/copy` reads the latest finalized text supplied by the active DSH Runtime and falls back to Pi agent state only for
runtimes that do not implement that query.

Active DSH `/export` HTML uses the registered `meldra-dsh-message` entry renderer, so user, assistant, tool,
informational, and error snapshots are included without embedding their private custom-entry payload. It also works
before Pi creates its deferred containing Session JSONL, because a complete DSH transcript consists of renderable custom
entries rather than Pi assistant messages.

`/share` consumes the same complete active-Session HTML export. JSONL `/export` continues to preserve the original
custom snapshots, while standalone HTML export has no active Profile extension renderer and therefore leaves custom
entries hidden.

Bare `/dsh` opens a two-level themed management center rather than printing the action list. The first page groups
native capabilities into Session, Agent and execution, Workspace, Settings and runtime, and History and diagnostics.

The second page shows a Chinese label, a concise purpose, and the compatible direct `/dsh <action>` form for every item.
`Esc` returns from a capability page to the group page and closes from the group page.

Direct commands and `/dsh run`/`/dsh invoke` remain available for scripting and experienced users; non-TUI modes receive
the textual action list instead of attempting a terminal dialog. Meldra-owned titles, operations, statuses, and
explanations in the queue, feedback, attachment, trajectory, settings, package, Goal, Job, Subagent, Workspace, and
compact status surfaces use Chinese labels.

Harness-owned identifiers, phase and event values, native command and Skill descriptions, validation errors, and result
payloads remain unchanged.

`/dsh exit` requests Pi's existing graceful process shutdown, which owns Profile Runtime teardown and Harness process
cleanup; it does not send a Harness prompt or introduce a parallel exit state machine. Use `/profile` instead when the
intent is to keep Meldra open and switch to another Profile.

These commands operate on DSH Sessions, Workspaces, direct Subagents, the native Agent Preset roster, and the DSH model
catalog. `/dsh effort` reads the exact current route and adapter-owned effort roster from `session.models`, returns the
selected opaque effort through native `session.selectModel`, and can restore Provider/default behavior by omitting the
field.

Switching `/dsh model` to another route carries that target model's declared default effort, while reselecting the
current route preserves its current effort. Meldra does not map these values to Pi thinking levels or write them through
Settings.

Preset selection uses Harness's `agentPreset.select` contract and is therefore limited to blank Sessions by Harness. The
Workspace menu lists and adopts existing directories, renames or removes registrations, reorders Workspaces and
already-accounted Sessions, and archives the current DSH Session through native `workspace.*` methods.

Removing a Workspace registration does not delete its directory, files, or Session logs. The Subagent menu lists native
child and diagnostic rows; healthy children expose history, while continuable children additionally expose follow-up and
interrupt.

The catalog's parent-availability field remains a hint and is not treated as local authorization. The Jobs menu consumes
the latest authoritative `session/jobs` snapshot and shows lifecycle, labels, details, and elapsed time.

It is read-only because the current Harness API exposes no `jobs.*` unary control or output API; background output remains available
through Harness's native `job_output` tool. The Goal menu reads the native `goal` projection from the history-tail
baseline and live projection frames, then sends create/edit/pause/resume/complete/clear through native `goal.*` methods
with the exact projected CAS revision.

The Plan menu reads the native `plan` projection and executes Harness's `/plan` or `/plan off` through native
`CommandRuntime.execute`; it does not reproduce plan policy. The Todo menu is read-only because the current Harness API exposes
Todo writes only to the Harness tool/event path; it displays the whole `todos` projection, which Harness retires at the
next turn start.

The Feedback editor addresses finalized append-origin assistant message IDs from raw history and delegates
list/put/delete to Harness's durable message-feedback service with its exact CAS version (or `null` on create); version
conflicts and validation failures remain explicit native errors. Session-wide `/feedback <text>` is also available from
the dynamic Commands menu.

The Attachments browser pages durable image refs from raw message history, retrieves a selected image through the
Session-scoped `session.attachment` proof, and renders it in a temporary Pi `Image` surface. `/dsh evidence` scans at
most 20 native history pages or 500 distinct events and reports only durable evidence: the highest-seq full
`request/header` actually used by a request and non-user `user/message.source` context injections.

Its result includes scan counts and an explicit truncation fact; it does not assemble or claim the not-yet-created next
request context. The Session history browser pages older native messages by the Host-provided `hasMore` fact and the
current page's minimum event seq, and renders text plus retrieved image blocks in their native message order inside a
temporary themed surface; it does not accumulate the full history or synthesize Pi transcript messages.

`/dsh rewind`, `/rewind`, and double Escape with an enabled `doubleEscapeAction` share Pi's cursor-driven user-message
selector. The adapter scans at most 50 native history pages or 1,000 events and supplies only user messages whose one leading text
block and following image blocks can be restored without reordering content, and forks at the preceding completed
`turn/end` through native `session.fork({ atSeq })`. Before mutation it retrieves and validates every native attachment;
a missing image leaves the source untouched.

The source Session remains unchanged. A running turn is settled through the Runtime's native abort boundary before the fork,
so cancellation closes both Harness work and the local active turn instead of polling a UI status projection. Attachment
loads use a 10-second bound; cancellation and fork each use a 30-second bound and fail explicitly without reporting
success. The child becomes active, projections and queue/catalog surfaces refresh, and text plus transient image bytes are
restored atomically through Pi's editor draft. If the native fork succeeds but UI/draft restoration fails, the error names
the already-created child Session instead of claiming that no mutation occurred. First-turn messages and content shapes
outside the shared Pi/Harness text-plus-images contract remain explicitly unavailable.

Base64 bytes are never appended to the Pi Session, notification text, or logs. The Trajectory inspector pages the native
raw Session ledger using `session.history`, lists seq/type/turn/step/time, and displays the selected `{ event, view? }`
without rebuilding it from Pi transcript data.

Its search scans native pages from the latest event, retains at most 100 matching raw entries across at most 50 pages,
and marks capped results instead of claiming a complete search. The current page can also be folded by authoritative
event type and count, or viewed as a seq/timestamp/turn/step timeline.

The waterfall pairs only native `tool/call` and `tool/result` events sharing a callId and computes duration from their
event timestamps; unmatched events remain duration-free. A bounded cross-page timeline scans at most 20 native pages or
500 events, marks capped results, and permits call/result spans to pair across a page boundary without retaining a
durable index.

Every row still selects the same raw entry. The Plugin Inventory reads the Harness Loader directly on every call and
exposes its authoritative entry id, module specifier, effective enablement, and live fiber phase; Meldra maintains no
parallel plugin state.

The Settings view reads native redacted namespace descriptors and the provider directory. It shows resolved/base/user
layers, revision, live/restart semantics, provider settings addresses, and only each secret slot's path/configured
boolean; a stored secret value never rides the response.

Writable non-secret scalar fields declared by the wire schema can be set or reset to their inherited value across fixed
object paths and currently resolved dictionary keys; enum and boolean values use selectors, strings and numbers use
input, and the reconstructed schema node validates each value before mutation. Schema-declared array fields, including
provider model arrays, are available through a complete JSON draft editor.

The reconstructed array node validates the parsed draft before one exact path set/reset operation; Meldra does not
derive provider routes, adapter defaults, model fields, or credential references from the draft. Writable
schema-declared secret slots can be set through Pi's additive masked `secretInput()` path or unset after confirmation.

Each operation uses one native `settings.mutate` path op with the descriptor's exact revision, so unrelated fields and
hidden secrets are preserved; revision conflicts and server validation failures remain explicit and are not retried
automatically. Credential references are independently discovered from visible `role('credential-ref')` Settings fields
and batch-described through Harness `credentials.describe`.

Writable references support masked set and confirmed unset through the native credential service; environment-shadowed
references remain read-only, and credential values are never displayed, persisted in Pi, or returned by the service. The
Context view and compact metrics consume Harness's whole-log `sessionStats`, `tokenUsage`, `contextPressure`, and
`contextBreakdown` projections.

Context occupancy uses `projectedTokens` with the provider sample fallback and is a reference value, not billing or
admission input; the system/tools/messages breakdown is explicitly heuristic. The Commands menu resolves the active
Agent's native scoped command registry, including each command's description and optional input hint, then executes the
selected line through a small stdio bridge to Harness's native `CommandRuntime.execute`; command lines and detached
results do not enter model context. It does not hard-code the installed command roster.

`/dsh run /<native-command>` provides a directly editable namespaced form with asynchronous argument completion from the
same catalog. Arbitrary native command names remain under the DSH namespace to avoid accidental collisions with Pi
commands. The common `/permission [preset]` shortcut queries or switches the current Session's Harness permission preset
through that same native command bridge; omitting the preset reports the current value.

Dedicated top-level DSH handlers own the explicitly documented same-name commands through the generic Profile Runtime
command-surface declaration, while every `/dsh <action>` form remains compatible. `commands/change` and the current
Session's `agent-preset/selected` event invalidate the cached completion catalog.

This makes native commands such as `export`, `feedback`, `permission`, and preset-scoped additions available even before
a dedicated rich result surface exists. The Compact command executes Harness's `/compact` command and displays native
start/summary/end facts without reimplementing selection, summarization, or replacement.

The Skills menu reads `skill.list` for the active Session's project and submits the selected `/<name> [args]` through
the normal Runtime prompt lifecycle, preserving native Skill expansion and model-turn semantics. `/dsh invoke /<skill>`
exposes the same Session-scoped catalog through asynchronous argument completion without registering the Skill in Pi or
occupying a top-level slash name.

The skill cache changes with the DSH Session and is invalidated only by the current Session's `agent-preset/selected`
event, matching the Harness contract. Pi JSONL export preserves DSH custom transcript snapshots.

Active-Session HTML export renders registered DSH custom entries through the product-neutral custom-entry adapter and
includes the complete renderable Harness transcript; standalone export has no active Profile renderer and leaves unknown
custom metadata hidden. The commands do not switch, merge, or rewrite the containing Pi Session.

The TUI also handles DSH approval requests, structured user questions, and the authoritative pending inbox through the
same Web `ApiProxy` service used by DSH's browser client. Approval and question requests share one FIFO interaction lane
so concurrent root/Subagent requests cannot replace each other's Pi dialog; a Profile lifecycle generation prevents a
dialog completed after shutdown or rebind from answering through the stale Runtime.

Harness still owns request identity, validation, cancellation, and durable outcome. `session/queue` snapshots are scoped
to the active DSH Session; user `queued` and `steering` items appear in a compact Pi widget, while runtime-injected
`context` items remain hidden until Harness claims them.

`/dsh queue` edits text-only items, removes pending items, strictly steers a queued item while the current turn is
running, or withdraws a selected text item through native `session.updateQueue(remove)` and restores it to Pi's editor
only after the native mutation succeeds. Meldra does not mutate the displayed queue optimistically; the next complete
Harness snapshot is authoritative.

Pending user prompts remain in that queue surface until Harness emits a durable `user/message`. A message with
`source.kind: "user"` then becomes one persisted DSH `You` snapshot in Pi; instructions and plugin-authored
`user/message` events are not presented as user input, and image snapshots retain only a count rather than attachment
bytes.

Native assistant chunks are projected into Pi's existing streaming Markdown/reasoning pipeline; native tool-call and
tool-result events use Pi's existing live tool component. Final `assistant/message` content is authoritative and
corrects an incomplete transient projection after reconnect or dropped chunks.

## Meldra Hooks

A DSH Profile executes Meldra command Hooks through the injected `meldra-command-hooks` Cordis plugin. The host sends the resolved Profile/project Hook snapshot through the in-memory `meldra/hooks.configure` RPC before creating the Harness Session; the snapshot is not written to Harness Settings or credentials. Valid Profile or trusted-project Hook settings changes are watched and sent through the same RPC, so the next DSH lifecycle event uses the new snapshot without restarting Harness. Invalid changes retain the last-known-good snapshot.

The plugin maps `PreToolUse`, post-tool events, prompt preflight, Stop, and Session lifecycle to DSH rc.8's native `tools/*` and `agent/*` seams. `AgentStart` and `AgentEnd` are approximate `agent/status` running/idle notifications. Meldra `TurnStart` and `TurnEnd` map to Harness `step/start` and `step/end`, because one Harness step is one model call plus the tools it requested; Harness's broader turn can contain multiple such steps. These four events are notification-only and run in source order per Agent. DSH owns those decisions. In particular, `PreToolUse` can allow, ask, or deny, but cannot apply Claude-style `updatedInput` because Harness freezes and logs tool arguments before policy dispatch. An `ask` remains subject to later DSH pre-execute decisions, guards, sandbox policy, and tool-owned approval checks. Non-blocking Hook errors, timeouts, and unsupported `updatedInput` results travel over a dedicated Runtime notification and appear as Pi TUI warnings without entering either Runtime's model context or durable Session state.

DSH `SessionEnd` remains an approximate `agent/disposed` notification. Graceful worker shutdown drains Hook commands that have already started; EOF follows that drain path, while handled termination signals kill every tracked Hook process tree before the worker exits. See [Meldra Hooks](hooks.md) for the event matrix and configuration.

## Ownership and storage

- `main.ts` uses only the generic provider selection interface. The DSH provider module owns DSH Profile matching and
  constructs `DshProfileRuntime`.
- Profile switching, Runtime reload, and exit use the existing graceful lifecycle. Meldra attempts native cursor close
  with a 500 ms acknowledgement bound, always awaits Harness SDK shutdown and its process-termination ladder, then
  drains event-pump tasks for up to 500 ms before releasing listeners; an unresponsive auxiliary RPC cannot permanently
  block teardown.
- Meldra passes an already configured DeepSeek credential and endpoint when available; otherwise Harness's native
  settings and credential sources remain authoritative. Meldra does not require a DeepSeek credential merely to start
  the Runtime or use another Harness provider.
- Harness state stays under `~/.meldra/profiles/<profile>/agent/dsh-runtime/` through the standard `DSH_HOME` contract.
  This includes native JSONL Sessions, settings, credentials, user presets, and other Harness-owned state.
- DSH state is not added to Pi's Session format. Pi and DSH Session discovery remain separate. Pi stores only
  provider-owned display snapshots for transcript restoration; live projected events are transient and never enter Pi
  model context.
- Meldra's injected DSH JSON-RPC bridge uses `meldra/*` for all new client requests. The ten bridge methods are
  `api.call`, `api.respond`, `commands.list`, `commands.execute`, `hooks.configure`, `message-feedback.call`, `plugin-inventory.list`,
  `api.events.open`, `api.events.next`, and `api.events.close`; the server accepts the historical `metapi/*` aliases
  and routes them to the same handlers. Harness-native `initialize`, `session/prompt`, and `shutdown` methods remain
  unchanged.
- Windows exposes DSH's PowerShell executor and `pwsh` tool. POSIX systems expose DSH's Bash executor and `bash` tool.
- Filesystem and shell tools use the permissions of the Meldra process, matching the existing unsandboxed Pi default.

## Migration status

Available in the TUI now:

- published Harness `standard`, `code`, `minimal`, and `cordis` Agent Presets;
- native default-preset selection and Session preset restoration;
- persistent DSH runtime and multi-turn prompts;
- native busy-turn steer and follow-up admission through Harness's inbox without replacing the foreground task;
- explicit `/dsh exit` through Pi's graceful shutdown lifecycle;
- DSH session summary picker with current/running/blank/preset/cwd/update facts, plus create, switch, history, fork, and
  rename;
- native DSH cancel;
- model catalog and model selection;
- streamed assistant text and reasoning through Pi's existing message surface;
- live tool arguments, result content, error state, event-derived duration, and normalized
  terminal/diff/read/search/web-search/web-fetch presentation through Pi's existing tool surface; absent, generic, or
  unknown Harness views retain Pi's generic collapsed/expanded fallback;
- compact native model, input/output token, cache-token, cache-hit-rate, running, queue, TTFT, and decode-speed status;
- native Workspace list/adopt/rename/remove/order, Session creation inside a selected Workspace, accounted-Session
  order, and current-Session archive operations;
- native image prompt admission from Pi image inputs through Harness `session.prompt`; Harness remains responsible for
  media-type, byte, size, count, and pixel validation;
- Web mux event transport;
- durable per-message positive/negative feedback with native CAS versions;
- paged restored native message history with inline temporary text/image rendering, plus paged durable image attachment
  retrieval;
- paged raw Trajectory ledger inspection, bounded native-history content search, event-type folding, and bounded
  cross-page native timestamp/callId Tool waterfall with Host-computed views;
- authoritative Loader Plugin Inventory inspection;
- native Profile package list/add/remove/update delegation with explicit external-effects confirmation and graceful
  Runtime reload (`pnpm` required);
- redacted Settings namespace and configurable Provider directory inspection;
- schema-driven set/reset for nested non-secret scalar Settings with exact path operations and revision CAS;
- schema-driven JSON array/model field set/reset with native node validation and exact path/revision CAS;
- masked set/unset operations for schema-declared Settings secret slots;
- Settings-discovered credential reference status and native masked set/confirmed unset, preserving read-only sources;
- whole-log Session statistics, cumulative token usage, and projected context occupancy from native projections;
- active-Agent native command discovery, invalidation-aware `/dsh run` completion, and execution through the Harness
  command registry;
- native `/compact` execution and compaction start/summary/end status;
- native Skill catalog, invalidation-aware `/dsh invoke` completion, and invocation through the Runtime prompt
  lifecycle;
- native Plan projection and `/plan` command-slot transitions;
- native read-only Todo projection and compact completion status;
- native Goal projection restore/live updates and CAS-guarded create/edit/pause/resume/complete/clear;
- native background Job snapshots, active count, lifecycle/detail inspection, and elapsed time;
- native direct-Subagent catalog, diagnostic rows, history, continuable follow-up, and interrupt;
- FIFO approval and structured-question interaction with stale-Runtime response suppression;
- active-Session native pending queue widget plus text edit, removal, and strict steer through authoritative
  `session/queue`/`session.updateQueue`;
- queued-work status.

Still being migrated from the native Harness and Web client:

- richer Trajectory visual timeline presentation beyond the selector-based waterfall;
- richer field-specific provider/model forms beyond the validated JSON-array editor;
- additional dynamic Loader enable/disable controls beyond native profile package mutation and Session Cordis tools;
- dedicated Session ZIP export/download surface (the current Harness exposes this as an HTTP streaming route, not a stdio binary RPC);
- trajectory view, projection details, context breakdown, deliverables, and message feedback.

DSH remains pinned to `0.1.0-rc.8`; its release-candidate protocol and event shapes may change.
