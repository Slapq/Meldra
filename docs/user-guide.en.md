# Meldra User Guide

[中文](user-guide.md) | [English](user-guide.en.md) | [Home](../README.en.md)

This guide covers the practical Meldra workflow: starting from source, choosing a Profile, using a WorkSpace, managing
Sessions and packages, configuring plugins, and running DeepSeek Harness. For unchanged Pi behavior, use the detailed
[Pi documentation](../packages/coding-agent/docs/index.md).

## 1. Prepare the Environment

Requirements:

- Node.js `>= 22.19.0`
- npm and Git
- A supported terminal
- Bash on Windows; Git for Windows is recommended

Windows x64 users can download the dual installers from [`v0.2.2`](https://github.com/Slapq/Meldra/releases/tag/v0.2.2): `Meldra-Setup.exe` bundles Node.js, while `Meldra-Setup-NodeJS.exe` uses the system Node.js. Both include portable Windows Terminal for the desktop shortcut. The installer adds `meldra` to the current-user PATH and retains `metapi` as a compatibility alias, so any newly opened PowerShell, cmd, Git Bash, Windows Terminal, or VS Code terminal can run Meldra. The installers are currently unsigned, so Windows may show Unknown publisher or SmartScreen warnings.

The scoped npm Bootstrap remains unpublished; do not substitute the official Pi package for Meldra. `meldra update --self` remains disabled. Starter Bundle Setup and Provider/model/Scout onboarding are supported. See the [Setup and Distribution Contract](setup-and-distribution.en.md) for the full boundary.

The installers support Windows 10 build 19041+ / Windows 11 x64. The Bash tool still requires Bash; Git for Windows is recommended. Running from source additionally requires Node.js `>=22.19.0`, npm, and Git. Linux DSH also requires Python 3, Make, and a C++ toolchain.

After cloning the repository:

```bash
npm install --ignore-scripts
npm run prepare:native-runtime
npm run build
```

Linux / macOS:

```bash
./pi-test.sh
```

Windows PowerShell:

```powershell
.\pi-test.ps1
```

The source launchers preserve the directory from which they are called. The examples below use `meldra`; replace it with
the appropriate source launcher when working from checkout.

## 2. Understand the State Boundaries

| State | Default location | Owner |
|---|---|---|
| Meldra Profile | `~/.meldra/profiles/<name>/` | The Profile |
| Meldra user preferences | `~/.meldra/user/preferences.json` | The current Meldra user |
| Pi compatibility | `~/.pi/agent/` | Original Pi |
| WorkSpace | `~/.meldra/workspaces/` or an explicit directory | The Meldra Session |
| DSH Runtime | `<profile>/agent/dsh-runtime/` | Harness in that Profile |

Ordinary Profiles do not share Profile workflow settings, plugin configuration, Sessions, or Runtime state. Interface and
control choices such as Theme, terminal presentation, editor behavior, and navigation are User Experience Preferences;
ordinary Profiles share them through `~/.meldra/user/preferences.json`. The reserved `pi` Profile continues to use original
Pi state, does not read these Meldra user preferences, and does not receive Meldra-owned injection.

A WorkSpace is a Session working directory. It does not automatically own Profile models, packages, settings, or Harness
state.

## 3. Start the First Pi Session

```bash
meldra --profile default
```

`default` is a minimal Meldra Starter Profile continuously tuned by the project team. A clean first Meldra initialization provisions the Starter Bundle automatically; existing users can run `meldra setup` to install or restore it. The Bundle provides Provider Manager, Scout, Meldra Workflows, and `/setup`, while `/config` remains the built-in Profile Config Host.

After entering the TUI, run:

```text
/setup
```

The wizard always shows all three steps in Provider → model → Scout order and does not skip existing configuration. Each step is marked **Configured**, **Partially configured**, or **Not configured**. Configured steps can be kept and continued or reconfigured; incomplete steps continuously open and await the native `/login`, `/model`, and `/scout` surfaces. Cancellation or failure remains on that step with retry, skip-for-this-run, and exit choices. The final summary can continue into `/config`.

Run `/login` if a provider is not configured, or use a provider-supported environment/auth path. See
[Providers](../packages/coding-agent/docs/providers.md). Never put real API keys in a repository, Profile Bundle,
Session export, or documentation.

Choose a model with `/model`, then enter a request such as:

```text
Analyze this repository and tell me which checks I should run.
```

Useful entries include `/model`, `/settings`, `/profile`, `/workspace`, `/config`, `/resume`, `/reload`, `/export`, and
`/hotkeys`.

Meldra inherits Pi's file and shell tools and the permissions of the launching process. It does not provide a built-in
sandbox. See [Containerization](../packages/coding-agent/docs/containerization.md) when stronger isolation is required.

## 4. Editor and Resources

- Type `@` to select a file; only a completion-selected path is treated as an attachment by a Runtime that supports it.
- `!command` sends command output to the model; `!!command` does not add output to context.
- `/reload` reloads disk Extensions, Skills, Prompt Templates, Themes, keybindings, and context files.
- `/hotkeys` shows the active shortcuts.

`meldra-config` is an inline built-in exception. `/reload` recreates its registrations but is not a source-code
hot-reload boundary for that built-in.

See [Using Pi](../packages/coding-agent/docs/usage.md) and [Keybindings](../packages/coding-agent/docs/keybindings.md).

## 5. Manage Profiles

```bash
meldra profile status
meldra profile list
meldra profile bind research
meldra profile unbind
meldra profile import <source> --name research --no-bind
meldra profile export research ./research-profile
meldra profile update research
```

Profile selection is explicit `--profile`, then the nearest directory binding, then `default`. To use original Pi state
explicitly:

```bash
meldra --profile pi
```

Use `/profile` in the TUI to inspect or switch ordinary Meldra Profiles. A switch rebuilds the Profile's settings,
models, Extensions, and optional Runtime while retaining the Meldra Session and WorkSpace. The `pi` compatibility
Profile uses the independent original Pi Session store and cannot be entered or left within the current session. Exit
and start it explicitly with `meldra --profile pi`; returning to an ordinary Profile also requires a new explicit launch.
Neither domain moves, copies, or discovers the other domain's Session files.

Non-interactive import requires `--bind-current` or `--no-bind`. A Portable Profile uses a Pi-compatible `package.json` and can carry Pi resources, public settings, model choices, Provider declarations, packages, Scout, workflows, and Runtime declarations. Official Pi can load the Package and ignore Meldra metadata it does not recognize. Another user receives the same shareable configuration on import, but not the author's credentials, Sessions, current environment-variable values, machine-local paths, Runtime caches, Loader inventory, or process state. Imports containing remote package sources may access the network and run lifecycle scripts; use trusted Bundles.

## 6. Use a WorkSpace

```bash
meldra --workspace
meldra --workspace D:/WorkSpaces/release-audit
```

Use `/workspace` to show the binding. `meldra-workspace` is a built-in package for every ordinary Meldra Profile. Windows Setup creates one current-user desktop shortcut that launches `meldra --profile default --workspace`. The shortcut uses the bundled Windows Terminal, but the CLI is not bound to that terminal.

Profile and WorkSpace are orthogonal:

- the Profile owns the environment, models, Pi resources, and Runtime;
- the WorkSpace is the current working directory;
- only an explicit Current WorkSpace choice writes Pi project resources to that WorkSpace's `.pi` directory;
- switching Profiles does not replace the WorkSpace.

## 7. Project Profile Recommendations

```bash
meldra init
```

This creates `.pi/meldra.json`. A project may recommend a Profile Bundle source:

```json
{
  "schemaVersion": 1,
  "profile": {
    "source": "./profiles/team-profile",
    "displayName": "Team Profile"
  }
}
```

A recommendation does not automatically import, bind, or activate a Profile. A project cannot use this file to mutate an
installed Profile's Runtime plugins.

## 8. Install Pi Packages

```bash
meldra install <source>
meldra list
meldra update --extensions
meldra remove <source>
```

Use `-l` for the current WorkSpace/project `.pi` settings:

```bash
meldra install <source> -l
meldra config -l
```

Project resources require project trust. `meldra config` is the Package resource selector, not the plugin field
configuration page. See [Pi Packages](../packages/coding-agent/docs/packages.md) for source, trust, and update behavior.

## 9. Configuration and Settings

`/config` is available in ordinary Meldra Profiles:

```text
/config
/config <plugin-id>
```

It edits registered plugin fields and stores values under:

```text
<profile-agentDir>/plugin-configs/<plugin-id>.json
```

Profiles are isolated. The `pi` compatibility Profile does not receive Meldra's host; an original Pi installation of
`pi-config` remains its own authority.

`/settings` is Pi's Settings UI on the native Pi Runtime. On DSH it is owned by Harness and exposes native model,
effort, Settings, Provider, and credential controls.

`meldra config` is the Pi Package resource selector. These surfaces are intentionally different. Ordinary Profile
plugins must follow the [Profile Config Registration Protocol](extensions/profile-config-protocol.en.md).

## 10. Sessions, Resume, and Branches

```bash
meldra -c
meldra -r
meldra --session <path-or-id>
meldra --fork <path-or-id>
meldra --no-session
meldra --name "release audit"
```

In the TUI, use `/resume`, `/new`, `/name`, `/tree`, `/fork`, `/clone`, and `/compact`. In a native Pi Agent Profile, `/resume` searches the physical directories of ordinary Meldra Profiles but only shows Sessions whose latest Profile metadata belongs to the active Profile. A legacy Session without metadata falls back to its physical Profile directory. This keeps a Session recoverable after a Profile switch without mixing default Pi Agent and DSH conversations. `meldra --profile pi` still discovers original Pi Sessions only.

See [Sessions](../packages/coding-agent/docs/sessions.md) for the complete native behavior.

## 11. Export and Share

```text
/export
/export output.html
/share
```

`/export` writes HTML or JSONL. `/share` performs a real remote upload, so confirm that the Session can leave the
machine.

Active DSH Sessions use the registered custom-entry renderer for complete renderable transcript entries. A standalone
HTML export has no active Profile Extension renderer and does not pretend to render unknown custom metadata.

Profile export is a different artifact:

```bash
meldra profile export research ./research-profile
```

Session export preserves a conversation; Profile export moves an environment declaration.

Profile export first warns that Bundle source files are copied as-is. Meldra-managed credentials, Sessions, Runtime Settings, caches, Loader state, project `.pi` configuration, directory bindings, and one-run CLI overrides are not added automatically. A key or token already hardcoded in a Bundle source file can still be exported with that file.

Every export writes `MELDRA_PROFILE_EXPORT_AUDIT.md` with:

- the included configuration categories and complete file manifest;
- the managed state that was not added automatically;
- file paths, line numbers, and types for credential-like literals.

The report never records matched values. Findings do not block export or rewrite files. Move hardcoded values to the Meldra credential service or environment variables, export again, and review the new report before sharing.

## 12. Run a DeepSeek Harness Profile

A Portable Profile selects Harness with `runtime.provider: "deepseek-harness"`. The Profile name does not determine the
Runtime.

```bash
meldra --profile research-harness
```

Open the management center with `/dsh`. Common entries are `/resume`, `/sessions`, `/new`, `/history`, `/rewind`, `/model`,
`/preset`, `/settings`, `/queue`, `/cancel`, `/plugins`, `/dsh trajectory`, and `/dsh evidence`.

Harness owns the Agent loop, queue, active model route, presets, tools, Settings, Session ledger, plugins, and
persistence. Meldra owns process lifecycle, protocol adaptation, and Pi TUI presentation. DSH Sessions and the
containing Pi Session remain separate.

DSH `/resume` and `/sessions` open the same Pi-native cursor Session browser over structured Harness `session.list` rows. `/rewind`, `/dsh rewind`, and double Escape when enabled open the same Pi cursor message selector before Harness performs the native fork. Neither browser copies Harness history into Pi Session files.

When DSH fails, switch to the default Pi Agent in the same WorkSpace, inspect the project and Meldra/DSH integration state, apply a repair, and switch back to DSH. This is a manual recovery workflow; automatic multi-Agent orchestration, delegation, and shared writable Sessions are not current capabilities.

`/model` uses Pi's native selector over the current Meldra Profile's Providers and models. Only after the user confirms a
model does Meldra register that one route in DSH `llm-pi-ai` Settings, supply its credential through a credential
reference, and ask Harness to select it. Cancelling the selector performs no DSH write. `/dsh model` remains the
explicit Harness-native catalog selector.

The bundled rc.1 bridge supports `openai-completions`, `openai-responses`, and `anthropic-messages`. Anthropic endpoints
use Pi's native service-root convention; the SDK appends `/v1/messages`. Other APIs are rejected before DSH Settings are
written rather than being guessed as another wire protocol.

See [DeepSeek Harness Profile Runtime](../packages/coding-agent/docs/deepseek-harness.md) for the full current surface.

## 13. Manage DSH Plugins

Terminal:

```bash
meldra profile plugins research-harness list
meldra profile plugins research-harness add <source>
meldra profile plugins research-harness remove <package>
meldra profile plugins research-harness update
```

TUI:

```text
/plugins
/plugin list
/plugin add <source>
/plugin remove <package>
/plugin update
```

Meldra passes the source to DSH/pnpm unchanged. Writes may access the network and run lifecycle scripts; the TUI asks
for confirmation. A successful package command is not activation proof: Meldra verifies the result through a fresh
Runtime/Loader inventory.

`list` is read-only and does not download pnpm. An explicit mutation may use Corepack to obtain the pinned version when
pnpm is not on PATH.

## 14. Non-interactive Use

```bash
meldra -p "Summarize this repository"
meldra --mode json -p "Run the static checks"
meldra --mode rpc
```

Non-interactive modes do not show a project trust prompt. They use a saved trust decision, `defaultProjectTrust`, or a
one-run `--approve` / `--no-approve` override.

Whether an external Runtime supports a particular print or RPC path is provider-specific. Do not infer it from the
command name.

## 15. Troubleshooting

### The wrong Profile starts

```bash
meldra profile status
```

Check `--profile` and parent-directory bindings. Remove a binding with `meldra profile unbind <directory>`.

### `/config` is empty

Confirm that the plugin loaded and emitted `config:register` while its factory ran, then use `/reload`. The `pi`
compatibility Profile intentionally has no Meldra Config Host.

### `meldra config` does not show plugin fields

That is expected. `meldra config` manages Package resources; `/config` manages plugin fields.

### DSH commands are unavailable

Check the Profile's runtime provider:

```bash
meldra profile status <name>
```

The Profile name alone does not select Harness.

### DSH plugin operations need pnpm

Read-only `list` does not download tools. Run an explicit add/remove/update or install pnpm/Corepack, then inspect the
native output.

### `/reload` does not reload built-in source

Disk Extensions clear their module cache and re-import. Inline built-in factories come from the current process; rebuild
and restart after changing Meldra built-in source.

### Windows shell or tests fail

Check Git Bash, PowerShell, PATH, and the Windows SDK/Build Tools. Separate recorded symlink `EPERM`, Unix socket, and
terminal-image platform baselines from a new feature regression.

### Self-update is unavailable

This is intentional. Meldra has no authoritative release source and must not use the Pi update source as a substitute.
Update a development checkout by pulling/building it from its trusted source.

## 16. Backups and Shutdown

Exit with `/quit`; DSH also supports `/dsh exit`, both through graceful Meldra teardown.

Back up after related processes exit:

```text
~/.meldra/
~/.pi/agent/            # original Pi compatibility Profile only
```

A single active JSONL file is not a complete Runtime backup. Portable Profile export, Session export, and
directory-level backup solve different problems.

## Next Steps

- [Development Guide](development.en.md)
- [Pi Usage Reference](../packages/coding-agent/docs/usage.md)
- [Profile Runtime provider](../packages/coding-agent/docs/profile-runtimes.md)
- [Extension Development](../packages/coding-agent/docs/extensions.md)
- [Authoring and Developing Meldra Hooks](hooks.en.md)
- [Profile Config Protocol](extensions/profile-config-protocol.en.md)
