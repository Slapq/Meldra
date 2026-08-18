# MetaPi Project Development Manual

This is the repository-root `AGENTS.md` for MetaPi development. It is the complete project-specific manual; global Profile instructions may add general operating rules.

## Scope and Sources

- Apply this file to this repository and its subdirectories. More specific project instructions and the user's latest explicit decision take priority.
- Read relevant Markdown files completely and follow their links before editing.
- Use `docs/development.en.md` for architecture and delivery, `docs/setup-and-distribution.en.md` for distribution, `CONTEXT.md` for domain terms, and `docs/adr/` for accepted decisions.
- Treat current source, callers, tests, schemas, ADRs, upstream material, and real runtime behavior as evidence. Do not infer contracts from names.
- Preserve defaults and user-visible behavior until the exact change is investigated and approved. Make the smallest scoped change and record validation and rollback.

## Repository and Release Identity

- Product: `MetaPi`. Public repository: `https://github.com/Slapq/MetaPi`; public default branch: `main`.
- A private branch such as `metapi/main` is not the public tree's direct Git history.
- Never push the private development history directly to public `main` or force-push over public history.
- Publish through an existing redaction-audited public worktree or equivalent public base: apply only the approved incremental patch, audit it, then commit.
- Before publication, exclude private Profile Agent context, user Profiles and Sessions, credentials, machine paths, temporary files, build output, unreviewed external sources, and internal files not approved for the public tree. Repository governance files may be published only when they are intentional source files in the reviewed patch.

## Version Boundaries

- MetaPi product tags such as `v0.1.1` are independent from Pi workspace package versions.
- The private root version is a Pi workspace baseline field; `packages/coding-agent/package.json` retains its upstream Pi package version; Starter has its own Profile package version; public Pi packages retain upstream lockstep versions.
- Do not mechanically align product tags, CLI, Starter, workspace packages, dependency ranges, lockfiles, or shrinkwraps.
- `scripts/sync-versions.js` and the upstream `scripts/release.mjs` implement Pi workspace/npm release semantics. Do not use them as the MetaPi product release flow without an explicit version decision.

## Pi, MetaPi, and Runtime Boundaries

- MetaPi is a distribution and compatibility layer over Pi, not the upstream Pi project or release repository.
- User-facing CLI names and errors use `metapi`; compatibility code may retain upstream package/import names and source links.
- Preserve upstream capabilities, parameters, errors, and protocol semantics. Put MetaPi behavior in Profiles, Starter, providers, adapters, Extensions, or explicit boundaries.
- Native MetaPi Profiles, the reserved Pi compatibility Profile, and external Profile Runtimes do not implicitly share state, Sessions, models, Skills, packages, plugins, or lifecycle.
- External Runtimes remain authoritative for their Agent loop, protocol, state, and native capabilities; do not reproduce them in generic Pi core.

## Profile, Starter, and Package State

- Keep user assets, user preferences, Profile `agentDir`, project `.pi`, Session overrides, and external Runtime state in their documented ownership domains.
- Starter source is `packages/coding-agent/starter-profile/`; a deployed Profile package is a separate copy. Distinguish source tests, Bundle restore, and deployed validation.
- Read `packages/coding-agent/starter-profile/DEVELOPMENT.md` and `docs/extensions/profile-config-protocol.md` before Starter or Profile Config changes.
- Keep Starter top-level Extension entries unique. `questionnaire.ts` is imported by Workflows and must not be registered as another package entry.
- Never clean, rewrite, migrate, or delete existing Profiles, packages, settings, model assets, Sessions, or credentials to simplify tests or release work. Upgrade and uninstall preserve user state.
- `metapi install` and `remove` must await Settings flush before reporting success. Normal package commands resolve `agentDir` from the active Profile; tests may inject an isolated directory.
- Project-local `-l` writes to project `.pi` and requires project trust or explicit `--approve`. Use `node:path` in Windows-sensitive tests.
- MetaPi distribution self-update is disabled. Mark unsupported upstream paths explicitly; never fake success.

## Windows and Installer Rules

- Validate Unix socket filesystem semantics only on Unix. Do not present Windows named pipes as inode, chmod, stale-socket, or Unix `EACCES` compatibility.
- Installer source is `scripts/windows-installer/`; build with `scripts/build-windows-installers.mjs` and Inno Setup 6.
- A formal Windows release produces `MetaPi-Setup.exe`, `MetaPi-Setup-NodeJS.exe`, and `SHA256SUMS.txt`.
- Preserve the existing AppId and install directory so installer variants upgrade each other in place. Never implement upgrade as user-data deletion and reinstall.
- Installer version comes from `--version`. Record build completion, file size, SHA-256, script tests, and upload status separately. If Inno Setup or a build is unavailable, do not claim new executables exist or reuse old assets as current output.
- The desktop shortcut uses the installed `pi-app.ico`; icon changes must preserve launch target, arguments, Profile, and WorkSpace behavior.
- For icon changes, verify `pi-favicon.svg`, `pi-app.ico`, Inno Setup references, shortcut references, ICO headers/32-bit frames, and transparent rounded corners with `scripts/build-windows-installers.test.mjs`.

## Validation and Deferred Issues

- Never run commands concurrently when they read or rewrite the same build output. In particular, spawned CLI tests may read `packages/ai/dist` while builds replace its provider data.
- Release validation order: `npm run check`; `npm run build:offline`; coding-agent tests; server tests; `node --test scripts/*.test.mjs`; installer tests; final `git diff --check`; public-tree audit.
- Report passes, platform skips, deferred defects, and unavailable real-environment checks separately; do not collapse them into "all green."
- `MP-AUTH-REVISION-001` is deferred: rapid same-length Windows rewrites may reuse stale `AuthStorage` or `FileModelsStore` revisions. Do not skip or weaken assertions, call it environment noise, or publish it in current Release Notes.
- Reopen that defect only with a content-fingerprint approach covering both stores plus performance and regression validation. See `Todo.md`.

## Public Release

- The formal release target is `Slapq/MetaPi`; the upstream Pi release flow is not a MetaPi release.
- Review both private-source and public-tree diffs, confirm version fields, run the required validation, apply the approved patch to the public worktree, and repeat the redaction audit.
- Commit and tag in the public tree, create the GitHub Release with `--repo Slapq/MetaPi`, and upload only installers built and hashed for that commit.
- Verify with `gh release view` and the GitHub API: `draft=false`, `prerelease=false`, tag, commit, and all assets. A pushed tag alone is not a completed release.
- Public Release Notes are Chinese and describe only verified, uploaded results. Do not include the deferred auth revision issue.

## Security and Completion

- Never publish keys, tokens, passwords, cookies, Profile JSON, Session JSONL, machine configuration, or internal governance data in source, commits, installer payloads, or Release assets.
- Never substitute stale installers, icons, temporary artifacts, or output from another commit. Do not force-push after rejection; re-establish the public-base boundary.
- Commit, tag, push, and Release are external operations and require explicit user scope.
- Completion reports list the real public URL, commit, tag, assets, hashes, test counts, skipped/deferred states, and unverified boundaries.
