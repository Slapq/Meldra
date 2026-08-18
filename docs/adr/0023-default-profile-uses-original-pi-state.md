---
status: superseded by ADR-0025
---

# Use original Pi user state as the default Profile

Meldra originally chose the original `~/.pi/agent` directory as its `default` Profile. This decision was superseded because Meldra must expose its own Starter Profile on the normal `metapi` path while preserving original Pi through a separate reserved `pi` compatibility Profile.
