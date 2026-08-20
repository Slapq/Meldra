# Meldra Setup and Distribution Contract

[中文](setup-and-distribution.md) | [English](setup-and-distribution.en.md) | [Home](../README.en.md)

> [!IMPORTANT]
> Dual Windows x64 installers are published starting with `v0.1.0-preview.7`. They are currently unsigned, so Windows may show Unknown publisher or SmartScreen warnings. The scoped npm Bootstrap remains unpublished.

## Current Status

| Capability | Status | Current entry |
|---|---|---|
| Build and run from source | `SUPPORTED` | `npm install --ignore-scripts`, `npm run prepare:native-runtime`, `npm run build`, source launchers |
| Linux x64 standalone Bun archive | `PARTIAL` | Default/ordinary Profiles work; DeepSeek Harness is explicitly `UNSUPPORTED`, so use the Node.js source distribution |
| Portable Profile import/export | `SUPPORTED` | `meldra profile import` / `export` |
| Redacted Profile export audit | `SUPPORTED` | Each export writes `MELDRA_PROFILE_EXPORT_AUDIT.md` |
| Dual Windows x64 installers | `SUPPORTED` | [`v0.2.1`](https://github.com/Slapq/Meldra/releases/tag/v0.2.1) provides bundled-Node and system-Node variants |
| Scoped npm Bootstrap | `PLANNED` | The organization and package name are unconfirmed; no placeholder command is published |
| Starter Profile Bundle Setup | `SUPPORTED` | A clean first Meldra initialization provisions it automatically; existing users run `meldra setup` to install or restore it |
| Provider, model, and Scout onboarding | `SUPPORTED` | Run `/setup` in `default`; it points to `/login`, `/model`, `/scout`, or `/config` |
| Windows desktop shortcut | `SUPPORTED` | Launches the default Profile + WorkSpace in the bundled portable Windows Terminal |

## Public Snapshot and Release Audit

The public repository is published from a redaction-audited public tree. Audited incremental commits may be added on top of an already public base, but a local development history containing Profile, Session, credential, machine-path, Agent-context, or private investigation data must never be pushed directly. Each public release must audit all reachable public content, not only the current working tree.

## Two Bootstrap Entries

Meldra provides a Windows installer and retains a planned npm Bootstrap as the two first-install entries. Both use the same Setup service instead of maintaining separate installation semantics.

### Linux source distribution

Linux x64 has been validated in a real Alpine 3.24.1 WSL2 environment across build, Setup, TUI, Bash, and DSH Runtime startup. Source installation keeps the default dependency boundary with `--ignore-scripts`, then runs `npm run prepare:native-runtime` to execute only the reviewed and recorded native install scripts for `@deepseek-ai/dsh-subprocess-local`, `koffi`, and `node-pty`. Windows and Linux Node release staging install one complete, platform-matched DSH rc.7 exact graph from the root lock; rc.6/rc.7 mixtures are unsupported. Linux requires Python 3, Make, and a C++ toolchain; Alpine also requires Linux headers.

The standalone Linux Bun archive includes the Starter Bundle and supports the default and ordinary Profiles. It does not carry Harness's dynamic Node dependencies, so DeepSeek Harness is explicitly `UNSUPPORTED` instead of reporting false compatibility. Use the Node.js source distribution when DSH is required. Linux ARM64 and glibc distributions remain unverified and are not inferred from the x64 musl result.

### Windows installer

The Release provides two installers for Windows 10 build 19041+ / Windows 11 x64:

- `Meldra-Setup.exe` targets machines without a preinstalled Node.js and bundles official Node.js 24.19.0;
- `Meldra-Setup-NodeJS.exe` uses the machine's existing Node.js. Missing Node/npm or a version below 22.19.0 produces truthful guidance but does not block installation.

Both variants bundle the official Windows Terminal 1.24.11911.0 x64 unpackaged distribution in `.portable` mode. The installer adds `meldra` to the current-user PATH and keeps `metapi` as a compatibility alias, so the CLI works in any newly opened PowerShell, cmd, Git Bash, Windows Terminal, or VS Code terminal. The desktop `Meldra` shortcut defaults to the bundled Windows Terminal without binding Meldra to it or changing the system default terminal.

Both variants share one `AppId` and can upgrade each other in place. The default location is `%LOCALAPPDATA%\Programs\Meldra`, with no administrator requirement. Upgrades preserve `~/.meldra`; uninstall removes the application, shortcut, and Meldra's own PATH entry while preserving Profiles, credentials, models, and Sessions.

### npm Bootstrap

The planned npm Bootstrap will use a scoped package owned by the eventual Meldra organization. The organization, scope, package name, registry, version, and publishing authority are not confirmed, so this document reserves the capability without inventing a package name.

The existing `meldra install` command remains part of the Pi Package manager. It does not install the Meldra product.

## Setup Service

The source distribution now provides the shared Setup service. A clean first Meldra user initialization provisions the Starter Profile Bundle; existing users can run:

```text
meldra setup
```

When migratable original Pi state exists, an interactive terminal reuses the established migration choice. A non-interactive invocation must pass `--migrate` or `--start-fresh` explicitly. Re-running Setup restores the project-maintained Bundle while preserving other Profile packages, plugin configuration, Providers, models, credentials, and Sessions.

After entering the `default` Profile, run `/setup`. The wizard always shows all three steps in Provider → model → Scout order instead of skipping existing configuration. Each step is marked **Configured**, **Partially configured**, or **Not configured**. A configured step can be kept and continued or reconfigured; incomplete steps reuse and await their native commands. A genuinely completed step advances to the next one. Cancellation or failure stays on the current step with retry, skip-for-this-run, and exit choices. Incomplete configuration leaves a compact `/setup` status instead of reporting fake success.

The shared Setup service currently:

1. initializes the Meldra user directory;
2. installs or restores the project-maintained Meldra Starter Profile Bundle;
3. guides Provider login and model selection;
4. guides Scout model and thinking-level configuration;
5. shows incomplete items and the shortest next action in the status area.

The Windows installer invokes this same Setup service; the future npm Bootstrap must also reuse it. The installer now creates the current-user desktop shortcut.

## Starter Profile

The default Meldra Profile is positioned as a minimal Starter Profile continuously tuned by the project team. It aims to provide a stable, direct daily development experience with a small set of defaults.

The current Starter Bundle declares the project-maintained Provider Manager, Scout, workflow extensions, and `/setup` onboarding. `/config` remains the Meldra built-in Profile Config Host and is not duplicated in the Bundle. The Bundle contains no API keys, OAuth tokens, current environment-variable values, Sessions, or machine-local directory bindings. Users provide their own credentials through the local credential service or a Provider-supported authentication path.

## Desktop Shortcut

The Windows Setup creates one shortcut on the current user's desktop only. It does not write to the Start menu or require administrator privileges. Re-running Setup updates the same shortcut instead of creating duplicates. The shortcut uses the bundled portable Windows Terminal; the `meldra` command remains available in other terminals through the current-user PATH, with `metapi` retained as a compatibility alias.

Its product launch semantics are:

```text
meldra --profile default --workspace
```

This enters the Meldra Starter Profile and creates or binds an isolated WorkSpace, preventing the desktop or a system directory from becoming the accidental project directory.

## Sharing Profiles

A Portable Profile Bundle can carry Profile configuration, model choices, Provider declarations, packages, Scout, WorkSpace workflow, and interface experience. Another user receives the same shareable configuration on import. Meldra metadata remains additive inside a Pi-compatible `package.json`; official Pi can load the Package and ignore Meldra metadata it does not recognize.

Credentials, Sessions, and machine-local paths are not shared. First-use onboarding tells the importing user how to provide their own Provider credentials.

Profile export lists the actual files and explicit exclusions, and reports credential-like literals using redacted paths, line numbers, and types only. Findings do not block export or rewrite files. Move hardcoded values to the credential service or environment variables, then export again.

## DSH Recovery Workflow

DeepSeek Harness is an externally compatible Agent Runtime. It retains authority over its Agent loop, Sessions, presets, tools, Settings, and persistence while adopting Meldra's Pi TUI design language, Profile lifecycle, and model-selection experience.

When DSH fails, the user can switch to the default Pi Agent in the same WorkSpace, inspect the project and integration state, apply a repair, and switch back to DSH. This is a manual recovery workflow, not automatic multi-Agent orchestration, delegation, or a shared writable Session.
