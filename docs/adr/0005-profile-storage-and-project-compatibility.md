---
status: superseded by ADR-0023
---

# Isolate user state by Profile while preserving project Pi resources

Meldra originally planned to keep every Profile, including `default`, separate from original Pi user state. This decision was superseded when `default` was chosen as a direct compatibility alias for `~/.pi/agent`; non-default Profiles remain isolated and project-local Pi resources remain compatible.
