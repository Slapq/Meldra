# MetaPi Development Guide

[中文](development.md) | [English](development.en.md) | [Home](../README.en.md)

This guide explains where MetaPi code belongs, how to work from source, and how to validate a change. Detailed Pi API
reference remains under `packages/coding-agent/docs/`; this page focuses on MetaPi ownership and delivery.

## 1. Development Principles

MetaPi uses an exact Pi baseline plus an auditable patch layer:

- preserve the complete Pi source, native agent path, CLI, TUI, Sessions, and Extension ecosystem;
- add MetaPi behavior as small, reviewable commits above a known upstream baseline;
- keep product-specific behavior out of generic Pi core;
- let an external Runtime retain ownership of its Agent loop, Sessions, protocol, models, tools, and persistence;
- preserve defaults, public contracts, and existing data formats unless an explicit change is approved.

Read `AGENTS.md`, more specific Profile/WorkSpace instructions, `CONTEXT.md`, related ADRs, and the current
callers/tests before editing.

## 2. Environment

Requirements are Node.js `>= 22.19.0`, npm, and Git. Linux also needs Python 3, Make, and a C++ toolchain to prepare DSH native modules. Windows requires Bash; native TUI work also requires Visual Studio C++ Build Tools and the Windows SDK.

```bash
npm install --ignore-scripts
npm run prepare:native-runtime
npm run build
```

Run from source:

```bash
./pi-test.sh                 # Linux / macOS
.\pi-test.ps1               # Windows PowerShell
```

The launchers preserve the caller's working directory. The built CLI can be run with:

```bash
node packages/coding-agent/dist/cli.js --profile default
```

There is no formal MetaPi release identity in the current repository. A local launcher, the official Pi npm package, and
this checkout are not interchangeable distribution targets.

## 3. Architecture

```text
MetaPi CLI / Pi TUI
        |
        +-- Profile domain -------- Profiles, bindings, Bundles, agentDir
        +-- Pi AgentSession -------- native Pi agent path
        +-- Profile Runtime host --- generic construction/lifecycle boundary
                    |
                    +-- DSH provider/runtime --- Harness process + native API

Profile Extensions consume the active host/runtime capability.
External Runtime state remains outside Pi Session state.
```

| Module | Owns | Does not own |
|---|---|---|
| Pi core | Session host, Extension API, TUI, generic Runtime boundary | DSH RPC, Presets, models, or product state |
| MetaPi Profile domain | Profile resolution, bindings, Bundles, Profile environment | Internal external-Runtime state |
| Runtime provider | Matching, construction, teardown, optional native packages | Native Pi defaults |
| DSH adapter | Harness process, ApiProxy, event boundary, native lifecycle | A second Harness Agent loop |
| DSH Extension | Commands, renderers, dialogs, status | Harness process or Session ownership |
| WorkSpace | Session working directory | Profile settings or Runtime plugins |
| Config Host | Shared plugin-field TUI and Profile-local JSON | A replacement Settings or Config Service |

See [Profile Runtime providers](../packages/coding-agent/docs/profile-runtimes.md) and [DSH
Runtime](../packages/coding-agent/docs/deepseek-harness.md) for the detailed contract.

## 4. Repository Layout

```text
packages/
  ai/                 provider/model abstraction
  agent/              native Pi agent loop
  tui/                terminal rendering and input
  coding-agent/       CLI, Session host, Extensions, MetaPi, DSH adapter
  protocol/           shared protocol contracts
  client/             client library
  server/             server package
  telemetry/          telemetry contracts
  session-backends/   optional Session storage

docs/
  adr/                accepted architecture decisions
  extensions/         MetaPi Extension inventory and config protocol
  investigations/     evidence records, not automatic product contracts
scripts/               build, lock, release, and validation tools
```

Key MetaPi locations in `packages/coding-agent/src/`:

| Path | Role |
|---|---|
| `main.ts` | composition root; connects generic capabilities |
| `metapi/profile-service.ts` | Profile selection, bindings, and paths |
| `metapi/profile-bundle.ts` | Portable Profile import/export/update |
| `core/profile-agent-runtime.ts` | product-neutral Runtime contract |
| `metapi/profile-runtime-providers.ts` | bundled provider registry |
| `metapi/dsh-profile-runtime*.ts` | DSH provider and Runtime adapter |
| `extensions/dsh/` | DSH Pi TUI surface and bridge |
| `extensions/metapi-config/` | inline built-in Profile Config Host |
| `metapi/profile-extension.ts` | `/profile` TUI |
| `metapi/workspace-extension.ts` | `/workspace` TUI |

## 5. Standard Workflow

### Establish a baseline

Before editing:

```bash
git status --short
git log -1 --oneline
npm --prefix packages/coding-agent test -- <relevant-test-file>
```

Add build, type, or real probes in proportion to risk. Record existing Windows/environment failures separately from new
regressions.

### Use the five-stage process

For non-trivial work:

```text
Hypothesis -> Initial evaluation -> Information search -> Re-evaluation -> Modification
```

The hypothesis must be falsifiable. Read implementation, callers, and tests. Use current source, schemas, official
documentation, or read-only probes for external boundaries. Re-evaluation records supporting and opposing evidence.
Runtime changes require approval for the exact scope. Scouts retrieve facts; they do not decide defects or designs.

If evidence rejects the hypothesis, stop the original solution. Do not add compatibility layers or future infrastructure
merely to preserve a plan.

### Keep changes minimal

- Touch only files required for the approved goal.
- Preserve ordinary Pi and the `pi` compatibility path with focused regressions.
- Keep DSH-specific logic in its provider, adapter, or Extension.
- Ship one runnable slice per commit.
- Avoid opportunistic refactors, data migration, or unapproved default changes.

## 6. Choose the Right Extension Point

### Ordinary workflow or UI

Use a Pi Extension for commands, tools, events, renderers, shortcuts, and TUI. Follow the [Extension
Guide](../packages/coding-agent/docs/extensions.md) and [TUI reference](../packages/coding-agent/docs/tui.md).

Only composition capabilities that every ordinary MetaPi Profile must have belong in the bundled built-in registry.
`metapi-config` is an explicit inline built-in exception; do not give it a provision, package-copy, or source hot-reload
lifecycle.

### Plugin field configuration

Ordinary scalar configuration follows the [Profile Config Registration
Protocol](extensions/profile-config-protocol.en.md): one registration shape, six field variants, `config:*` events,
`<agentDir>/plugin-configs/<id>.json`, and one `/config` style. Do not add another dialect, a general Config Service, or
a duplicate plugin-owned configuration center.

### New Profile Runtime provider

Use the provider boundary only when a real external Agent backend must take ownership during construction. The provider
should:

1. define a stable provider identity;
2. match only its portable `runtime.provider` declaration;
3. use generic host events or display snapshots after `attach()`;
4. implement the actual prompt, abort, idle, and dispose semantics;
5. keep protocol translation at the adapter boundary;
6. expose package snapshot/restore/verify only when required;
7. add tests for both native Pi and the real provider;
8. update docs, ADRs, and rollback records.

Do not add provider names, RPC methods, Presets, or business defaults to `main.ts`, generic interfaces, or ordinary Pi
UI.

### Generic Pi core

Add a host capability only when a real provider uses it, ordinary Pi compatibility coverage exists, and
ownership/lifecycle/error/teardown are documented. Generic interfaces must remain product-neutral and omission must
preserve Pi defaults.

## 7. DSH Boundary

DSH is pinned to `0.1.0-rc.7`. Use current package types, Harness source, ApiProxy, events, and real Runtime probes as
evidence.

Preserve these boundaries:

- Harness owns Sessions, Agent loop, Presets, models, tools, Settings, queue, and ledger;
- `DshProfileRuntime` owns subprocess, cursor, listener, and Runtime lifecycle;
- the DSH Extension owns Pi commands, renderers, dialogs, and compact status;
- Pi stores only necessary display snapshots, not Harness model context;
- Profile switch, Session replacement, and exit await Runtime teardown;
- provider/model/effort use exact native values rather than Pi substitutes;
- native DSH/pnpm package operations are verified through Loader Inventory.

Before adding a DSH surface, trace the native Web/CLI service and error path. A capability without an RPC or tested
native path must be explicitly unavailable, not represented by an empty value.

## 8. Tests and Validation

Focused tests:

```bash
npm --prefix packages/coding-agent test -- test-file.test.ts
npm --prefix packages/tui test -- input.test.ts
```

Tests should be deterministic, offline, credential-free, and use temporary directories.

Build:

```bash
npm --prefix packages/coding-agent run build
npm run build
npm run build:offline
```

Run the root build when a shared package changes. Expand validation with the affected boundary.

Repository checks:

```bash
npm run check
```

This runs Biome, pinned-dependency checks, TypeScript import checks, shrinkwrap and installer-lock checks, whole-tree
type checking, and browser smoke. Biome uses `--write`; inspect the working tree afterwards and do not include unrelated
formatting.

Full tests:

```bash
./test.sh
npm test
```

`test.sh` uses an isolated environment and removes common provider credentials. Known Windows path, permission,
Unix-socket, terminal-image, fswatch, and symlink differences must be reported separately. A focused green test set is
not a full platform acceptance claim.

Real validation is required for TUI, Profile switch, external Runtime, package activation, and teardown work. Validate
the built CLI/TUI, default and `pi`, the affected Runtime Profile, Session resume/export, fresh Loader inventory after
mutations, child process/cursor cleanup, and relevant Windows terminal sizes. Mark unavailable hosts/providers as
unverified.

## 9. Dependencies and Generated Locks

The root `package-lock.json` is the dependency source of truth. coding-agent also publishes generated:

- `packages/coding-agent/npm-shrinkwrap.json`;
- `packages/coding-agent/install-lock/package.json`;
- `packages/coding-agent/install-lock/package-lock.json`.

After dependency changes:

```bash
npm run shrinkwrap:coding-agent
npm run install-lock:coding-agent
npm run check
```

External direct dependencies are pinned. New lifecycle-script dependencies require review and an explicit allowlist
update. Follow the lockfile pre-commit gate instead of bypassing supply-chain checks.

## 10. Documentation and ADRs

Update docs when changing Profile/WorkSpace/Session semantics, Runtime ownership, public commands or protocols, storage,
import/export, DSH capabilities, or validation/rollback requirements.

Put durable product decisions in ADRs, terminology in `CONTEXT.md`, and complex evidence chains in
`docs/investigations/`. An investigation is not automatically an ADR.

MetaPi user and developer docs are Chinese-first with English mirrors. Workflows belong in the guides; type and protocol
details belong in reference pages.

## 11. Upstream Synchronization

MetaPi maintains an exact upstream Pi baseline plus auditable patch commits:

1. record the upstream tag/commit and a clean baseline;
2. merge rather than copy over MetaPi files;
3. preserve ordinary Pi contracts and ownership boundaries while resolving conflicts;
4. regenerate lock, shrinkwrap, and installer lock outputs;
5. run native Pi, default Profile, `pi` compatibility, and affected DSH tests;
6. record the upstream baseline and patch commits.

Do not mechanically restore the `pi` identity, update source, or Profile behavior into MetaPi.

## 12. Debugging

Useful surfaces:

- `metapi --verbose` for startup details;
- `/debug` for TUI render lines and recent model messages in the active agent directory;
- `metapi profile status` for Profile, agentDir, cwd, and binding;
- `/session` or DSH `/session` for the current state domain;
- `/dsh trajectory` and `/dsh evidence` for native Harness facts;
- `git diff --check` before committing.

Never log complete credentials. Keep external Runtime errors explicit with stable codes and redacted context.

## 13. Local Release and Distribution Boundary

Local packaging validation:

```bash
npm run release:local
```

It runs model-data checks, repository checks, builds, isolated tests, package packing, and isolated installs. See
`scripts/local-release.mjs --help` for options.

There is no authoritative MetaPi package name, latest-version source, or changelog service yet. Therefore:

- self-update remains disabled;
- the Pi npm source is not used as a MetaPi update target;
- publishing, tagging, and pushing require explicit authorization;
- a local launcher represents the current checkout, not release acceptance.

## 14. Completion Checklist

Before committing:

- the approved scope is implemented without adjacent expansion;
- ordinary Pi, default, `pi` compatibility, and affected Runtime contracts remain covered;
- focused tests, build, `npm run check`, and `git diff --check` are recorded;
- required real TUI/Runtime validation is complete;
- docs, ADRs, Todo, and implementation agree;
- rollback is a concrete commit/file/state operation;
- no credentials, user Sessions, caches, or temporary fixtures entered the commit;
- each runnable slice is a separate commit.

## References

- [MetaPi User Guide](user-guide.en.md)
- [Pi Development](../packages/coding-agent/docs/development.md)
- [Extension API](../packages/coding-agent/docs/extensions.md)
- [Profile Runtime providers](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness](../packages/coding-agent/docs/deepseek-harness.md)
- [Profile Config Protocol](extensions/profile-config-protocol.en.md)
- [Contributing](../CONTRIBUTING.md)
