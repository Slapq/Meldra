<div align="center">

# Meldra Coding Agent

### 🧭 An AI coding terminal with Pi's TUI and Profile-isolated environments

<p>
  <img alt="Development" src="https://img.shields.io/badge/status-development-f59e0b?style=flat-square">
  <img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Pi baseline 0.84.2" src="https://img.shields.io/badge/Pi_baseline-v0.84.2-4f46e5?style=flat-square">
  <img alt="DeepSeek Harness 0.1.0 rc.7" src="https://img.shields.io/badge/DSH-0.1.0--rc.7-0ea5e9?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square">
</p>

[中文](README.md) · [English](README.en.md) · [Project home](../../README.en.md) · [User guide](../../docs/user-guide.en.md)

</div>

> [!IMPORTANT]
> The repository does not yet define an official Meldra npm release or self-update source. The package manifest provides
> the `meldra` command and retains `metapi` as a compatibility alias; development work should use a trusted source checkout and build.

<p align="center">
  <img src="docs/images/metapi-profile-tui.png" alt="Meldra Profile selector" width="100%">
</p>

## ✨ Features

- Pi's native interaction, tools, Sessions, Extensions, Skills, Prompts, and Themes.
- Independent Profiles for models, settings, packages, Sessions, and external Runtime state.
- A reserved `pi` compatibility Profile for original `~/.pi/agent` state.
- Session-bound WorkSpaces and Portable Profile import/export.
- A generic Profile Runtime provider boundary for external Agent backends.
- A DeepSeek Harness adapter that keeps Harness state authoritative.
- A shared `/config` surface for ordinary Meldra Profile plugin settings.
- A restorable Starter Bundle for `default`, with `meldra setup` and `/setup` onboarding for Provider, model, and Scout configuration.

## 🚀 Run From Source

From the repository root:

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

Built entry point:

```bash
node packages/coding-agent/dist/cli.js --profile default
```

## 🧰 Common Commands

```bash
meldra --profile default
meldra setup
meldra profile status
meldra profile list
meldra --workspace
meldra -c
meldra -r
```

Common TUI entries are `/setup`, `/model`, `/profile`, `/workspace`, `/config`, `/settings`, `/resume`, `/export`, and `/reload`.

## 🧭 Profiles and State

| Profile | State location | Behavior |
|---|---|---|
| `default` | `~/.meldra/profiles/default/` | Meldra's default isolated environment |
| Ordinary Profile | `~/.meldra/profiles/<name>/` | Independent Pi resources and optional Runtime |
| `pi` | `~/.pi/agent/` | Original Pi compatibility; no Meldra-only injection |

Profile selection is explicit `--profile`, then the nearest directory binding, then `default`.

## 🔌 Two Package Paths

Pi Packages manage Extensions, Skills, Prompts, and Themes:

```bash
meldra install <source>
meldra update --extensions
meldra list
meldra config
```

An external Profile Runtime may expose its own native package capability:

```bash
meldra profile plugins <profile> list
meldra profile plugins <profile> add <source>
meldra profile plugins <profile> remove <package>
meldra profile plugins <profile> update
```

These scopes are different and cannot replace each other.

## ◈ DeepSeek Harness

A Portable Profile selects DSH with `runtime.provider: "deepseek-harness"`. Harness owns the Agent loop, Sessions,
models, tools, Settings, plugins, and persistence. Meldra owns process lifecycle, protocol adaptation, and Pi TUI
presentation.

```bash
meldra --profile research-harness
```

Use `/dsh` for the management center. Common entries include `/sessions`, `/model`, `/preset`, `/settings`, `/queue`,
`/plugins`, and `/dsh trajectory`.

## ⚠️ Security Boundary

> [!WARNING]
> Meldra and Pi use the launching user's filesystem, process, and network permissions by default. They do not provide a
> built-in sandbox. Third-party Packages, Extensions, and Runtime plugins may execute code or access the network; inspect
> sources before installation.

Real credentials must not enter source, Profile Bundles, Session exports, logs, or test fixtures. See
[Containerization](docs/containerization.md) for stronger boundaries.

## 📚 Documentation

- [Meldra User Guide](../../docs/user-guide.en.md)
- [Meldra Development Guide](../../docs/development.en.md)
- [Pi documentation index](docs/index.md)
- [Profile Runtime providers](docs/profile-runtimes.md)
- [DeepSeek Harness](docs/deepseek-harness.md)
- [Extension development](docs/extensions.md)
- [Pi Packages](docs/packages.md)
- [Windows](docs/windows.md)

## 🛠️ Development

```bash
npm run build
npm run check
npm test
```

Meldra is maintained as an exact Pi baseline plus an auditable patch layer. Runtime changes require evidence, scoped
approval, and validation for ordinary Pi, the `pi` compatibility Profile, and affected Profile Runtimes.

## 🌱 Upstream and License

Meldra is maintained from the complete source of [earendil-works/pi](https://github.com/earendil-works/pi) and retains
the MIT license and upstream compatibility path.
