<div align="center">

# MetaPi

### A Pi-based Agent framework and launcher

MetaPi organizes models, Providers, packages, Sessions, WorkSpaces, and external Agent Runtimes through Profiles while preserving official Pi's terminal experience and compatibility path.

<p>
  <img alt="Development" src="https://img.shields.io/badge/status-development-f59e0b?style=flat-square">
  <img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Pi baseline 0.84.2" src="https://img.shields.io/badge/Pi_baseline-v0.84.2-4f46e5?style=flat-square">
  <img alt="DeepSeek Harness 0.1.0 rc.7" src="https://img.shields.io/badge/DSH-0.1.0--rc.7-0ea5e9?style=flat-square">
  <img alt="Windows macOS Linux" src="https://img.shields.io/badge/Windows_%7C_macOS_%7C_Linux-334155?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square">
</p>

[中文](README.md) · [English](README.en.md) · [User Guide](docs/user-guide.en.md) · [Development Guide](docs/development.en.md) · [Pi Reference](packages/coding-agent/docs/index.md)

</div>

> [!IMPORTANT]
> **MetaPi is under active development.** The repository does not yet define an official MetaPi npm package,
> release source, or self-update service. Running from source is the reliable path today;
> `metapi update --self` remains disabled so it cannot install the official Pi package by mistake.

<p align="center">
  <img src="docs/images/metapi-profile-tui.png" alt="MetaPi Profile selector showing default, dsh, and original Pi environments" width="100%">
</p>
<p align="center"><sub>Real output from the current build: inspect and switch isolated Profiles inside one Session and WorkSpace.</sub></p>

## Why MetaPi

| What you get | What it means |
|---|---|
| **A Pi-based Agent framework and launcher** | Reuse Pi's CLI, TUI, tools, and Extension ecosystem while adding Profile, WorkSpace, and external-Runtime boundaries |
| **A minimal Starter Profile tuned by the project team** | The default `MetaPi Starter` uses a small set of defaults for a stable, direct daily development entry |
| **A complete shareable Profile configuration** | Import model choices, Provider declarations, packages, Scout, and workflows; each user supplies credentials locally |
| **External Agent Runtimes in one design language** | DSH retains native Agent ownership while adopting MetaPi's Pi TUI, Profile lifecycle, and model-selection experience |
| **A second path when DSH fails** | Switch to the default Pi Agent in the same WorkSpace, diagnose and repair the integration, then switch back to DSH |

## ✨ Core Capabilities

| | Capability | MetaPi boundary |
|---|---|---|
| 🧭 | **Profile isolation** | Independent workflow settings, models, packages, Sessions, and Runtime state; shared UI preferences |
| π | **Native Pi compatibility** | Preserves Pi's CLI, TUI, tools, Sessions, Extension ecosystem, and original `pi` compatibility entry |
| 🧳 | **Portable Profiles** | Import, export, update, and share configuration, resources, workflows, and Runtime declarations; official Pi ignores MetaPi metadata |
| 🗂️ | **Session WorkSpaces** | The built-in WorkSpace plugin assigns a working directory without moving Profile state into project `.pi` |
| 🔌 | **External Runtimes** | Attach external Agent backends through a product-neutral construction-time provider |
| ◈ | **DeepSeek Harness** | Shares MetaPi's TUI and model-selection experience while Harness retains Agent loop, tool, Settings, and Session authority |
| ⚙️ | **Unified plugin configuration** | Ordinary Profiles receive `/config`; the default Starter uses `/setup` for Provider, model, and Scout onboarding |

MetaPi is a Pi-based Agent framework, launcher, and auditable patch layer over the complete source of [Pi](https://github.com/earendil-works/pi).
It extends Pi without cloning the Pi agent or converting external Runtime state into another Pi Session.

## 🧭 One Environment, One Profile

| Environment | Default state path | Purpose |
|---|---|---|
| `default` | `~/.metapi/profiles/default/` | MetaPi's default isolated environment |
| Ordinary Profile | `~/.metapi/profiles/<name>/` | Independent workflow, models, packages, and optional Runtime |
| `pi` | `~/.pi/agent/` | Original Pi compatibility with no MetaPi-only injection |
| WorkSpace | `~/.metapi/workspaces/` or an explicit directory | Current Session working directory |

> [!NOTE]
> Profile resolution is fixed: explicit `--profile` → nearest directory binding → `default`.
> A WorkSpace chooses the working directory; it does not own Profile models, settings, or Runtime plugins.

Portable Profiles use a Pi-compatible `package.json`. Another user receives the same shareable configuration on import; credentials, Sessions, and machine-local paths stay out of the Bundle, so the importer supplies their own Provider credentials on first use. Every export also writes a redacted file manifest and hardcoded-credential advisory.

## 🚀 Quick Start

| Installation entry | Status | Meaning |
|---|---|---|
| Run from source | `SUPPORTED` | Development and audit entry |
| [`MetaPi-Setup.exe`](https://github.com/Slapq/MetaPi/releases/tag/v0.1.1) | `SUPPORTED` | Windows x64; includes Node.js and portable Windows Terminal |
| [`MetaPi-Setup-NodeJS.exe`](https://github.com/Slapq/MetaPi/releases/tag/v0.1.1) | `SUPPORTED` | Windows x64; uses existing Node.js and warns without blocking installation when it is absent or old |
| Scoped npm Bootstrap | `PLANNED` | The MetaPi organization and package name are unconfirmed; no fake command is provided |
| Starter Bundle + onboarding | `SUPPORTED` | `metapi setup` installs or restores the Bundle; `/setup` in `default` guides Provider, model, Scout, and thinking-level configuration and can be skipped |
| Windows desktop shortcut | `SUPPORTED` | Launches `metapi --profile default --workspace` in the bundled Windows Terminal |

The installer adds `metapi` to the current-user PATH, so it works in any newly opened PowerShell, cmd, Git Bash, Windows Terminal, or VS Code terminal. The bundled Windows Terminal is only the default host for the desktop shortcut and does not restrict other terminals.

See the confirmed [Setup and Distribution Contract](docs/setup-and-distribution.en.md).

### Requirements

The installers support Windows 10 build 19041+ / Windows 11 x64 and include Windows Terminal. `MetaPi-Setup.exe` also includes Node.js; the smaller `MetaPi-Setup-NodeJS.exe` uses the system Node.js. Both variants still require a Bash implementation for the Bash tool; Git for Windows is recommended.

Running from source requires:

- Node.js `>= 22.19.0`
- npm and Git
- Python 3, Make, and a C++ toolchain for DSH native modules on Linux
- Bash on Windows

### Run from source

```bash
npm install --ignore-scripts
npm run prepare:native-runtime
npm run build
```

<table>
<tr><th>Linux / macOS</th><th>Windows PowerShell</th></tr>
<tr><td>

```bash
./pi-test.sh
```

</td><td>

```powershell
.\pi-test.ps1
```

</td></tr>
</table>

The launchers preserve the caller's working directory, so they can be invoked directly from the target project.
Use `/login` for a normal Pi provider, then `/model` to choose a model.

```text
Analyze this repository, explain its structure, and tell me which checks I should run.
```

## 🧰 Daily Entries

| Goal | TUI | Terminal |
|---|---|---|
| Manage Profiles | `/profile` | `metapi profile list` |
| Inspect Profile status | `/profile status` | `metapi profile status` |
| Create a WorkSpace | `/workspace` | `metapi --workspace [dir]` |
| Configure the Starter Profile | `/setup` | `metapi setup` |
| Configure plugin fields | `/config` | — |
| Manage Pi Packages | — | `metapi install` / `list` / `config` |
| Resume a Session | `/resume` | `metapi -c` / `metapi -r` |
| Share and audit a Profile | `/profile export` | `metapi profile export <name>` |
| Export a Session | `/export` | `metapi --export <file>` |
| Reload resources | `/reload` | — |

See the [complete User Guide](docs/user-guide.en.md) for directory bindings, Profile Bundles, DSH, and troubleshooting.

## 🔌 Two Package Paths, Two Owners

| | Pi Package | Profile Runtime Plugin |
|---|---|---|
| Manages | Extensions, Skills, Prompts, Themes | Native external-Runtime plugins |
| Scope | Current Profile; `-l` targets WorkSpace `.pi` | The named Profile Runtime |
| Entry | `metapi install` / `config` | `metapi profile plugins` |
| Authority | Pi Package manager | The matching Runtime provider |

> [!TIP]
> `/config` edits Profile plugin fields; `/settings` belongs to the active Agent Runtime;
> `metapi config` is the Pi Package resource selector. They are separate configuration layers.

Ordinary plugin configuration follows the fixed
[Profile Config Registration Protocol](docs/extensions/profile-config-protocol.en.md)
to keep fields, storage, and interaction consistent.

## ◈ DeepSeek Harness, Running Natively

Any Portable Profile can select DSH with `runtime.provider: "deepseek-harness"`; the Profile does not need to be named `dsh`.

```bash
metapi --profile research-harness
```

Open `/dsh` for the management center. Common entries include:

```text
/resume  /sessions  /model  /preset  /settings  /queue  /plugins  /dsh trajectory
```

Harness owns the Agent loop, Session ledger, models, Presets, tools, queue, Settings, plugins, and persistence. MetaPi owns Profile lifecycle, protocol adaptation, Pi TUI presentation, and the verified model bridge. DSH therefore uses the same interface design language and model-selection entry as an ordinary MetaPi Profile without sharing a writable Session.

When DSH fails, switch to the default Pi Agent in the same WorkSpace, inspect and repair the project or integration, then switch back to DSH. This is a manual recovery workflow, not automatic multi-Agent orchestration.

[Explore the complete DSH surface and current limits →](packages/coding-agent/docs/deepseek-harness.md)

## 📚 Documentation

| Document | Covers |
|---|---|
| [User Guide](docs/user-guide.en.md) | Startup, Profiles, WorkSpaces, packages, DSH, Sessions, and export |
| [Setup and Distribution Contract](docs/setup-and-distribution.en.md) | Current entry and planned installer, Bootstrap, Starter Bundle, onboarding, and shortcut |
| [Development Guide](docs/development.en.md) | Ownership, extension points, tests, upstream sync, and release boundaries |
| [Documentation Index](docs/README.en.md) | Complete navigation across MetaPi and preserved Pi references |
| [Profile Runtimes](packages/coding-agent/docs/profile-runtimes.md) | External Agent Runtime provider contract |
| [Extension Development](packages/coding-agent/docs/extensions.md) | Commands, tools, events, renderers, and TUI |
| [Domain Context](CONTEXT.md) | Canonical Profile, WorkSpace, Runtime, and Package terminology |
| [Architecture Decisions](docs/adr/) | Current product and compatibility decisions |

## 🛠️ Development

```bash
npm run build
npm run check
npm test
```

MetaPi follows an **exact Pi baseline + auditable patch layer**. Native Pi behavior, public protocols, and Profile data
remain compatible by default. Runtime changes require evidence, scoped approval, and validation for `default`,
`pi` compatibility, and every affected Runtime Profile.

[Read the development and contribution workflow →](docs/development.en.md)

## ⚠️ Current Boundaries

> [!WARNING]
> - MetaPi and Pi use the launching user's filesystem, process, and network permissions; there is **no built-in sandbox**.
> - Third-party Packages and Runtime plugins may access the network or execute lifecycle scripts. Inspect their source.
> - DeepSeek Harness is pinned to `0.1.0-rc.7`; its release-candidate protocol may change.
> - Full Windows tests have recorded platform differences; focused tests do not replace real TUI/Runtime acceptance.

## 🌱 Upstream and License

MetaPi is maintained from the complete source of [earendil-works/pi](https://github.com/earendil-works/pi)
and retains the MIT license. It does not replace Pi; it adds isolated Profiles, external Runtimes,
and a multi-environment product layer on an auditable upstream baseline.
