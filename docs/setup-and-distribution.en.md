# MetaPi Setup and Distribution Contract

[中文](setup-and-distribution.md) | [English](setup-and-distribution.en.md) | [Home](../README.en.md)

> [!IMPORTANT]
> This document records confirmed product contracts. It does not mean that an installer or npm Bootstrap has been released. [Running from source](user-guide.en.md#1-prepare-the-environment) remains the only reliable entry today.

## Current Status

| Capability | Status | Current entry |
|---|---|---|
| Build and run from source | `SUPPORTED` | `npm install --ignore-scripts`, `npm run build`, source launchers |
| Portable Profile import/export | `SUPPORTED` | `metapi profile import` / `export` |
| Redacted Profile export audit | `SUPPORTED` | Each export writes `METAPI_PROFILE_EXPORT_AUDIT.md` |
| Standalone Windows installer | `PLANNED` | No download artifact or authoritative release URL exists yet |
| Scoped npm Bootstrap | `PLANNED` | The organization and package name are unconfirmed; no placeholder command is published |
| Starter Profile Bundle Setup | `PLANNED` | It is not yet available as a clean-install asset |
| Provider, model, and Scout onboarding | `PLANNED` | Today use `/login`, `/model`, and the settings surface of an installed Scout package |
| Windows desktop shortcut | `PLANNED` | No current installer creates it |

## Two Bootstrap Entries

MetaPi plans two first-install entries. Both must invoke one shared Setup service rather than maintaining separate installation semantics.

### Windows installer

The planned `MetaPi-Setup.exe` is the primary entry for ordinary Windows users. It installs the MetaPi launcher/runtime and then invokes the Setup service. Until it is released, the README and documentation must not provide a fabricated download link.

### npm Bootstrap

The planned npm Bootstrap will use a scoped package owned by the eventual MetaPi organization. The organization, scope, package name, registry, version, and publishing authority are not confirmed, so this document reserves the capability without inventing a package name.

The existing `metapi install` command remains part of the Pi Package manager. It does not install the MetaPi product.

## Setup Service

After Bootstrap, the shared Setup service is planned to:

1. initialize the MetaPi user directory;
2. install or restore the project-maintained MetaPi Starter Profile Bundle;
3. guide Provider login and model selection;
4. guide Scout model and thinking-level configuration;
5. show incomplete items and the shortest next action in the status area;
6. idempotently create one MetaPi shortcut on the current user's Windows desktop.

The wizard is skippable. When a Provider, model, or Scout setting is missing, MetaPi must not fabricate success. The status area should point to `/login`, `/model`, or the Scout settings surface respectively.

## Starter Profile

The default MetaPi Profile is positioned as a minimal Starter Profile continuously tuned by the project team. It aims to provide a stable, direct daily development experience with a small set of defaults.

The planned Starter Bundle should declare project-maintained Provider configuration, `/config` integration, Scout, and workflow packages. It must not contain API keys, OAuth tokens, current environment-variable values, Sessions, or machine-local directory bindings. Users provide their own credentials through the local credential service or a Provider-supported authentication path.

## Desktop Shortcut

The planned Windows Setup creates one shortcut on the current user's desktop only. It does not write to the Start menu or require administrator privileges. Re-running Setup updates the same shortcut instead of creating duplicates.

Its product launch semantics are:

```text
metapi --profile default --workspace
```

This enters the MetaPi Starter Profile and creates or binds an isolated WorkSpace, preventing the desktop or a system directory from becoming the accidental project directory.

## Sharing Profiles

A Portable Profile Bundle can carry Profile configuration, model choices, Provider declarations, packages, Scout, WorkSpace workflow, and interface experience. Another user receives the same shareable configuration on import. MetaPi metadata remains additive inside a Pi-compatible `package.json`; official Pi can load the Package and ignore MetaPi metadata it does not recognize.

Credentials, Sessions, and machine-local paths are not shared. First-use onboarding tells the importing user how to provide their own Provider credentials.

Profile export lists the actual files and explicit exclusions, and reports credential-like literals using redacted paths, line numbers, and types only. Findings do not block export or rewrite files. Move hardcoded values to the credential service or environment variables, then export again.

## DSH Recovery Workflow

DeepSeek Harness is an externally compatible Agent Runtime. It retains authority over its Agent loop, Sessions, presets, tools, Settings, and persistence while adopting MetaPi's Pi TUI design language, Profile lifecycle, and model-selection experience.

When DSH fails, the user can switch to the default Pi Agent in the same WorkSpace, inspect the project and integration state, apply a repair, and switch back to DSH. This is a manual recovery workflow, not automatic multi-Agent orchestration, delegation, or a shared writable Session.
