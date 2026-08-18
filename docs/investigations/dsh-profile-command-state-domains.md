# DSH Profile Built-in Command State-Domain Review

## Scope and baseline

This investigation reviews `/clone`, `/tree`, `/resume`, `/export`, `/copy`, `/session`, and `/scoped-models` in a DSH Profile. The governing boundary is that Pi owns the containing Session, Profile, WorkSpace, lifecycle, and generic TUI, while Harness owns its Session history, model route, context, and agent execution.

Baseline before modification:

- branch: `metapi/main` at `63d7160`;
- focused DSH/Profile/interactive tests: 111 passed, 0 failed;
- coding-agent build passed;
- working tree clean.

## `/clone`

### Hypothesis

The built-in clones only the containing Pi Session and can present copied DSH snapshots beside a different Harness Session state.

### Initial evaluation

Pi clone may intentionally preserve the one-Session-one-WorkSpace contract. Opposing evidence would be a native Harness clone mapping or an explicit containing-session-only product contract visible to DSH users.

### Information search

`InteractiveMode.handleCloneCommand()` calls `runtimeHost.fork(leafId, { position: "at" })`. `AgentSessionRuntime.fork()` creates a new Pi Session and replacement runtime. `SessionManager.createBranchedSession()` copies the Pi branch, including custom DSH display entries. A new `DshProfileRuntime` derives its native ID from the new containing Pi Session ID and calls Harness `session.create`. No Harness clone API or DSH clone action exists; Harness `session.fork` is exposed separately by `/fork`.

### Baseline

Pi clone and SessionManager branch tests pass. No test proves a cloned DSH containing Session has matching native Harness history.

### Re-evaluation

**Highly likely to be a definite problem.** The visible Pi snapshot branch and the newly addressed Harness Session do not share one authoritative history. DSH must not advertise or dispatch `/clone` until an explicit native mapping contract exists. Ordinary Pi clone remains unchanged.

## `/tree`

### Hypothesis

The built-in navigates only Pi Session entries and therefore cannot navigate authoritative Harness history.

### Initial evaluation

Pi tree may be useful for generic transcript navigation, but DSH custom entries are display snapshots and do not define Harness branch state.

### Information search

`showTreeSelector()` reads `SessionManager.getTree()` and calls `AgentSession.navigateTree()`. Navigation changes the Pi leaf, may append a Pi branch summary, and rebuilds Pi agent state. It does not call `DshProfileRuntime` or a Harness tree API. No Harness `session.tree` API was found in the current runtime surface.

### Baseline

Native Pi tree tests pass. No DSH tree-state synchronization test exists.

### Re-evaluation

**Highly likely to be a definite problem.** Successful Pi tree navigation can claim a state change that did not occur in Harness. Hide it only for DSH until a native contract exists.

## `/resume`

### Hypothesis

The built-in may resume only Pi state and fail to restore the corresponding DSH runtime.

### Initial evaluation

`/resume` is also the Meldra containing-session and Profile restoration path, so hiding it could break a legitimate cross-Profile workflow.

### Information search

`/resume` selects a Pi Session path and calls `AgentSessionRuntime.switchSession()`. The target Session's persisted Profile and cwd are restored before services and the Profile Runtime are rebuilt. For a DSH Profile, the new runtime receives the target Pi Session ID and derives `metapi-<PiSessionId>`, then calls Harness `session.create`, which resumes that stable native ID. Existing tests cover Profile restoration, replacement lifecycle, and DSH cancellation during resume.

### Baseline

The existing resume/Profile/DSH lifecycle tests pass; credentialed interruption remains a manual external acceptance step.

### Re-evaluation

**Hypothesis rejected.** `/resume` has a legitimate containing-layer contract and deterministically restores the mapped DSH Runtime. Preserve it.

### Superseding native-browser decision

The earlier conclusion was correct for the then-approved containing-Session contract, but a later explicit product decision changed the DSH interactive surface. In a DSH Profile, `/resume` now joins `/sessions` as an alias over Harness `session.list` and `sessionId` switching. It reuses the product-neutral core extracted from Pi's cursor Session selector rather than flattening native summaries into string labels. CLI `--resume` remains the containing Meldra/Pi startup selector, so Profile and WorkSpace restoration still have an explicit host path.

The same decision routes enabled idle/empty-editor double Escape to the registered DSH `/rewind` command. DSH rewind reuses Pi's cursor user-message selector while Harness remains authoritative for history boundaries, attachments, cancellation, `session.fork({ atSeq })`, and active Session selection. Ordinary Pi `/resume`, tree/fork, and double-Escape behavior remain unchanged.

## `/export`

### Hypothesis

The built-in may omit DSH transcript snapshots.

### Initial evaluation

JSONL and HTML have different serialization paths and must be evaluated separately.

### Information search

JSONL export serializes the current Pi branch entries, including `type: "custom"` entries containing `metapi-dsh-message` data. HTML embeds all entries but its renderer handles `custom_message`, not current non-context `custom` entries. DSH snapshots are persisted through `SessionManager.appendCustomEntry()` as `type: "custom"`. No current Harness binary Session export/download RPC was found.

### Baseline

Generic HTML and JSONL export tests pass. No DSH custom-entry HTML export regression exists.

### Re-evaluation

**JSONL hypothesis rejected; HTML support is partial.** Keep `/export` because it truthfully exports the containing Session and JSONL preserves DSH snapshots. Record HTML omission as a separate generic custom-entry export contract; do not hard-code DSH in the HTML template or silently claim complete rendered export.

### Approved follow-up resolution

The user approved the separate HTML contract and DSH-only hiding of commands that cannot preserve Harness authority. Active-Session HTML export now pre-renders registered custom entries through the generic ExtensionRunner entry renderer and passes HTML keyed by Session entry ID to the template. Extension-private `customType` and `data` are removed from embedded HTML Session data; unregistered entries stay invisible; registered renderer failure aborts export. `/share` reuses the same path. JSONL and standalone HTML behavior remain distinct and unchanged except that standalone HTML also strips private custom-entry payloads.

In DSH, `/import`, `/login`, and `/logout` join `/clone`, `/tree`, and `/scoped-models` in `hiddenBuiltinCommands`: their existing Pi implementations mutate Pi Session or credential state without a complete Harness artifact or credential synchronization contract. Ordinary Pi Profiles remain unchanged.

### Snapshot-only HTML export regression

After the custom-entry renderer contract shipped, a real DSH Session still produced `Nothing to export yet - start a conversation first`. `SessionManager` assigns a future JSONL path immediately but intentionally creates the file only after a normal Pi assistant message. DSH owns its transcript as renderable custom entries and does not append a Pi assistant message, while `exportSessionToHtml()` checked `existsSync(sessionFile)` before pre-rendering custom entries. The approved narrow correction pre-renders custom entries first and permits a missing JSONL only when at least one registered custom entry rendered successfully. Empty and user-only ordinary Pi Sessions retain the original rejection; Session persistence and JSONL export are unchanged.

## `/copy`

### Hypothesis

The built-in cannot copy the latest Harness assistant text.

### Initial evaluation

DSH emits a normal `message_end` event for TUI rendering, but that event might or might not update Pi agent state.

### Information search

`handleCopyCommand()` calls `AgentSession.getLastAssistantText()`, which scans `agent.state.messages`. `DshProfileRuntime` emits transient host `message_end` events and persists a silent `metapi-dsh-message` custom entry; host emission does not mutate Pi agent state. Final Harness text is available in `finishAssistant()` before the projection is cleared.

### Baseline

DSH projection tests verify the final event and custom snapshot. No copy regression exists for a Profile Runtime.

### Re-evaluation

**Highly likely to be a definite problem.** Add an optional product-neutral Profile Runtime last-assistant-text query and let `AgentSession.getLastAssistantText()` prefer it when present. DSH stores only the latest finalized text for the active native Session and clears it on Session switch. Ordinary Pi behavior remains the fallback.

## `/session`

### Hypothesis

The built-in displays Pi statistics as if they represented Harness Session statistics.

### Initial evaluation

The containing Pi Session ID/path remain real facts, but message/token/context counts come from Pi message entries and Pi model state.

### Information search

`handleSessionCommand()` calls `AgentSession.getSessionStats()`, which counts Pi `message` entries and Pi usage, not DSH custom snapshots or Harness projections. DSH already exposes authoritative `sessionStats`, `tokenUsage`, `contextPressure`, and `contextBreakdown` through its `context` action.

### Baseline

Pi stats tests pass; DSH context action tests cover projection display paths.

### Re-evaluation

**Highly likely to be a definite problem.** In DSH only, route `/session` to the existing DSH `context` handler. Keep ordinary Pi `/session` unchanged.

## `/scoped-models`

### Hypothesis

The built-in offers model scoping that does not constrain Harness execution.

### Initial evaluation

Meldra model preferences remain a valid control plane, but Harness `session.models` is the execution authority and only exact current preference bridging is approved.

### Information search

`showModelsSelector()` reads Pi `ModelRuntime`, `settingsManager`, and `AgentSession.scopedModels`; its mutations affect Pi model cycling and optional settings persistence. It never calls `ProfileAgentRuntime`. DSH model selection calls native `session.models`/`session.selectModel`; the bridge writes one Profile provider/model preference and does not consume Pi scoped model cycling state.

### Baseline

Pi scoped-model tests pass. No test shows that changing scoped models changes a Harness route.

### Re-evaluation

**Highly likely to be a definite problem.** Hide `/scoped-models` in DSH because it presents a non-enforced execution constraint. Keep `/model` as the exact native selector and preserve ordinary Pi scoping.

## Approved modification scope

The user's instruction requires real confirmed issues to be resolved. This review limits implementation to:

- optional generic Profile Runtime last-assistant-text query and DSH implementation;
- DSH `/session` delegation to the existing native context/statistics action;
- optional generic hidden built-in command declaration;
- DSH hiding of `/clone`, `/tree`, and `/scoped-models` with an explicit unavailable message if typed;
- focused compatibility tests and documentation.

Excluded:

- changing `/resume`;
- removing JSONL export;
- DSH-specific HTML template logic;
- inventing Harness clone/tree APIs;
- changing ordinary Pi command behavior;
- changing Session persistence or the Pi/Harness mapping contract.

Rollback is one commit reverting the optional interfaces, DSH declarations/handlers, tests, and documentation. Residual risk is limited to real TUI presentation, which still requires PTY acceptance.
