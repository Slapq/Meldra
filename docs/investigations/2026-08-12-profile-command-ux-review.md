# Profile Command UX Review

Date: 2026-08-12
Status: Re-evaluation complete; awaiting modification confirmation
Baseline: `4d9a852` on `metapi/main`

## 1. Hypothesis

MetaPi's Profile domain capabilities are present, but `/profile` is not useful enough because it behaves as a thin textual subcommand dispatcher rather than a discoverable management workflow. The expected contract is that a user can understand which Profile applies, why it applies, what changes on the next launch, and safely complete common Profile operations without memorizing commands.

## 2. Initial evaluation

Supporting evidence initially included the default `status` behavior, notification-based list output, and duplicated CLI/TUI subcommand logic. A possible counter-explanation was that Pi extensions intentionally expose lightweight modal APIs and that a full custom TUI would be disproportionate. Existing textual commands are also a legitimate compatibility surface and must remain available.

Candidate risks identified before search:

- Replacing textual commands could break advanced-user and scripted behavior.
- Reusing private Pi selector internals would create an upstream compatibility liability.
- A large custom full-screen manager would expand the patch and test surface.
- Improving discovery alone could conceal mutation-safety gaps in update/export.

## 3. Information search and baseline

### Pi interaction patterns

- `packages/coding-agent/examples/extensions/preset.ts:360-381`: `/preset <name>` performs the direct action, while bare `/preset` calls `showPresetSelector(ctx)`.
- `packages/coding-agent/examples/extensions/commands.ts:57`: long command lists use `ctx.ui.select()` instead of a notification.
- Pi's shipped `/llama` extension uses an action loop and refreshes its view after actions; destructive operations use explicit confirmation.
- The stable extension-facing UI is `ctx.ui.select/input/confirm/notify/custom`. Internal configuration components require host-only dependencies and are not a suitable downstream extension dependency.

### Current MetaPi behavior

- `packages/coding-agent/src/metapi/profile-extension.ts:68-75`: bare `/profile` resolves to `status` and emits a notification.
- `profile-extension.ts:79`: installed Profiles are formatted as notification lines.
- `profile-cli.ts` and `profile-extension.ts` separately parse and dispatch overlapping subcommands. Supported arguments already differ for status, bind, import and list.
- `profile-service.ts:229`: status data is limited to identity, agent directory, cwd, compatibility mode and one binding path.
- Installed records already contain source, package version, timestamps, portable settings/packages and environment declarations, but `/profile` does not present them.

### Mutation-safety gaps discovered

- `packages/coding-agent/src/metapi/profile-bundle.ts:384-414`: `updateProfile()` performs the package update and rewrites the installed record directly.
- ADR 0009 requires additions/removals/package/executable-resource preview, explicit confirmation, preservation of the old snapshot and rollback.
- `profile-bundle.ts:334`: export recursively removes the destination before copying, with no preflight confirmation in either adapter.

### Baseline

- Git tree was clean at `4d9a852` before this investigation documentation.
- Focused tests: 4 files, 243 tests passed.
- Existing Profile tests primarily cover argument extraction, profile-directory resolution, unsafe names and Settings base-layer precedence; lifecycle and TUI flows are not covered.

## 4. Re-evaluation

### Conclusion

**The original hypothesis is highly likely and supported by direct evidence.** The main usability problem is not absence of Profile operations but absence of a browse/detail/action workflow and clear next-launch semantics.

A second conclusion is also highly likely: update and export safety are not merely presentation defects. They are separate behavioral gaps and should not be disguised behind a more polished UI.

### Recommended minimal architecture

1. Keep all existing CLI and slash subcommands.
2. Make only bare `/profile` open a Profile Hub.
3. Build the first Hub with public `ctx.ui.select/input/confirm/notify`; do not import private Pi TUI components.
4. Add a shared Profile application service/read model so CLI and TUI render common domain results rather than reimplementing command semantics.
5. Profile Hub first screen:
   - current session Profile;
   - effective next-launch Profile and resolution reason;
   - project recommendation, if any;
   - browse installed Profiles;
   - import;
   - bind/unbind current directory;
   - export and update entry points only with accurate safety state.
6. Profile details:
   - stable ID/display name/type;
   - source/version/import/update timestamps;
   - agent directory and compatibility semantics;
   - bindings;
   - portable packages/settings summary;
   - required/optional/inherited environment variable names and missing required names;
   - explicit local-only/export exclusions;
   - exact next-launch command.

### Candidate slices

#### Slice A — Profile Hub and shared service

Runtime behavior change: bare `/profile` becomes interactive. Existing `/profile status|list|...` and all CLI commands remain unchanged. Includes guided browse/details/import/bind and project recommendation. Does not add hot switching, deletion, custom full-screen TUI, model/provider workflows or automatic actions.

#### Slice B — Update/export safety

Adds an update plan, preview, confirmation, prior snapshot and rollback; export preflights destination and requires explicit overwrite approval. This is a separate persistence/recovery change and should be reviewed independently, even if approved in the same user response.

### Costs and risks

- Not changing Slice A leaves Profiles technically available but difficult to discover and understand.
- Not changing Slice B leaves behavior inconsistent with ADR 0009 and permits destructive export target replacement.
- Slice A risk is moderate and constrained by preserving direct commands.
- Slice B risk is higher because it changes filesystem mutation and recovery semantics.

### Rollback

Implement each slice as a separate commit. Slice A can be reverted without changing Profile data. Slice B can be reverted independently; its snapshot layout must be versioned and tested before release.

## 5. Modification gate

No runtime source changes are authorized by this investigation alone. Explicit approval is required for Slice A, Slice B, or both before implementation.
