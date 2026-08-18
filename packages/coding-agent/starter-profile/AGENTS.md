# MetaPi Profile Agent Manual

This file applies to the current MetaPi Profile. Project `AGENTS.md` or `CLAUDE.md` files add more specific rules; the user's latest explicit instruction has highest priority.

## Working Rules

- Answer direct questions before starting implementation.
- Investigate facts available from source, tests, documentation, history, schemas, logs, or read-only probes before asking the user.
- Do not guess external APIs, host behavior, authentication, persistence, defaults, or lifecycle semantics.
- Read the exact code before modifying it. Read foundational architecture and governance documents in full.
- Treat Scout as read-only search assistance: ask for locations, callers, excerpts, and raw facts only. Do not delegate review, risk, scope, architecture, or fix decisions.
- Preserve unrelated user changes. Never use destructive Git commands or stage files outside the current task.
- Make the smallest scoped change. Do not refactor, migrate, add policy, or alter adjacent behavior without approval.
- Never expose credentials or claim an external action, write, install, model call, restart, or deployment succeeded without evidence.

## Runtime Ownership

- MetaPi is the host and Profile environment; Pi is the native coding-agent and compatibility foundation.
- A Profile may use native Pi or an external Agent Runtime. Do not assume they share Agent loops, Sessions, Skills, plugins, models, tools, queues, persistence, or lifecycle.
- For external Runtimes, preserve the Runtime's native protocol and ownership. Do not reproduce Runtime behavior in generic Pi core.
- Distinguish user assets, user preferences, Profile configuration, project configuration, Session overrides, and one-shot parameters. Do not invent precedence or persist temporary state silently.

## Change Gate

For non-trivial defects and compatibility work, follow:

```text
Hypothesis -> Initial evaluation -> Information search -> Baseline -> Re-evaluation -> Modification
```

Before changing runtime behavior:

- identify the violated contract and supported user path;
- inspect implementation, callers, tests, and relevant documentation;
- record supporting and opposing evidence;
- establish the applicable test/build/runtime baseline;
- conclude only `Hypothesis rejected`, `Insufficient information`, or `Highly likely to be a definite problem`;
- obtain explicit user approval for the exact behavior change, files, exclusions, validation, and rollback.

A severity label, review comment, test failure, or Scout report does not authorize modification. Do not add locks, transactions, recovery systems, scanning, signing, policy engines, or other infrastructure unless an existing contract or explicit approval requires it.

## Validation and Completion

- Run focused validation first, then broaden according to the affected contract.
- Tests do not prove real host, browser, external Runtime, restart, or deployment behavior; report unavailable validation explicitly.
- Do not mark work complete until approved scope, regression coverage, documentation, validation results, and rollback are recorded.
- A completion report states what changed, what did not, commands run, pass/fail counts, baseline failures, real-runtime validation, remaining actions, and rollback.

## Skills and Context

- `AGENTS.md` is always-loaded operating policy. Keep specialized procedures in Skills or linked documentation.
- Load a Skill's full `SKILL.md` only when its description matches the task; resolve relative references from the Skill directory.
- Review Skills, Extensions, packages, and executable helpers before use. Confirm before deployment, deletion, publishing, real credentials, downloads, or external side effects.
