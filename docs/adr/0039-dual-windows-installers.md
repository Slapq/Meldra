# ADR 0039: Publish dual current-user Windows installers

- Status: Accepted
- Date: 2026-08-17
- Supersedes: the Windows-installer exclusion in ADR 0029

## Context

ADR 0029 limited the first distribution milestone to an npm global package and explicitly excluded a Windows installer. The product decision has changed: ordinary Windows users need a double-click installer, while users who already manage Node.js need a smaller package that preserves their selected runtime.

MetaPi must keep Node execution semantics for Pi packages, Profile packages, and DeepSeek Harness. A Bun-compiled executable is therefore not treated as an equivalent replacement for the Node runtime in this distribution. MetaPi also needs a predictable terminal for the desktop entry without preventing use from other terminals.

## Decision

MetaPi publishes two Windows 10 build 19041+ / Windows 11 x64 installers under one Inno Setup `AppId`:

- `MetaPi-Setup.exe` bundles the pinned official Node.js x64 distribution;
- `MetaPi-Setup-NodeJS.exe` uses the user's system Node.js.

The system-Node installer reports missing npm or an unsupported Node version but does not block installation. Launch remains truthful: without an executable Node runtime, `metapi` reports the missing prerequisite and exits without claiming success.

Both installers:

- install per user under `%LOCALAPPDATA%\Programs\MetaPi` without elevation;
- bundle the pinned official Windows Terminal x64 unpackaged distribution in portable mode;
- add the install directory to the current-user PATH so `metapi` works in any newly opened terminal;
- create one desktop shortcut that defaults to the bundled Windows Terminal and launches `metapi --profile default --workspace`;
- invoke the existing MetaPi Setup service for first-use onboarding;
- share one `AppId`, allowing either variant to upgrade the other in place;
- preserve `~/.metapi` on upgrade and uninstall;
- remove only the application, desktop shortcut, portable Terminal state, and exact MetaPi PATH entry on uninstall;
- include third-party versions, source URLs, licenses, and verified SHA-256 values;
- publish installer checksums beside the Release assets.

The installer does not change the Windows system default terminal. MetaPi remains usable from PowerShell, cmd, Git Bash, Windows Terminal, VS Code terminal, and other compatible terminals.

## Consequences

Windows x64 users receive a real installation, launch, upgrade, and uninstall loop. The bundled-runtime installer is larger. The system-Node installer can be installed before Node.js exists, but it cannot run MetaPi until a Node executable is available.

The preview installers are unsigned because no code-signing certificate is currently available. Windows may show Unknown publisher or SmartScreen warnings. ARM64 installers, automatic updates, a signed release pipeline, and the scoped npm Bootstrap remain separate future decisions.

## Validation

Each release must validate pinned upstream hashes, production dependency staging, both installer variants, no-system-Node behavior, current-user PATH behavior, portable Windows Terminal launch, Starter provisioning in an isolated HOME, in-place reinstall, uninstall preservation of Profile data, Authenticode status, final asset checksums, and anonymous GitHub download.

## Rollback

Delete the affected GitHub Release assets or Release, revert the installer commit, and restore the previous public snapshot. Installed users can run the generated uninstaller; their `~/.metapi` data remains available for a source or later installer build.
