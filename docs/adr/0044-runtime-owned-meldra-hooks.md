---
status: superseded by ADR-0045
---

# Keep hook interception inside the owning Agent Runtime

Meldra defines one declarative Hook protocol, while each Agent Runtime executes lifecycle-sensitive Hook Events inside its own loop. Native Pi maps the protocol through Extension events. DeepSeek Harness maps it through a Meldra Cordis plugin using Harness-owned tool, agent, and session seams. Meldra may pass a resolved in-memory Hook snapshot across the Profile Runtime bridge, but it does not reproduce an external Runtime's tool or Agent loop in generic Pi core.

This preserves deterministic command-hook configuration across Profiles and trusted projects without pretending that different Runtimes expose identical mutation points. Compatibility is stated per event and per Runtime. In particular, a DSH `PreToolUse` Hook may allow, ask, or deny through `tools/pre-execute`, but it cannot rewrite frozen tool arguments; Native Pi may apply `updatedInput` through its mutable `tool_call` event.

Hook configuration is executable input. Profile Hooks live in Profile settings. Project Hooks live in trusted project settings and remain unavailable before Project Trust succeeds. Hook definitions are not scalar Profile Config fields, Session overrides, Provider configuration, or portable external-Runtime plugin declarations.

The initial handler type is `command`. Additional handler types or lifecycle events require their own ownership and security evaluation rather than being inferred from Claude Code names.
