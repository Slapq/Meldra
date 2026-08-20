---
status: accepted
---

# Make Hooks a cross-Runtime out-of-band intervention plane

Meldra Hooks are out-of-band interventions shared by every Agent Runtime, not model-selected tools or aliases for Runtime-native plugins. Handler output never becomes model-visible Prompt content; normalized decisions may observe, permit, block, mutate external operations, or request an additional model call through the owning Runtime's native continuation semantics. A Runtime may use one fixed Runtime-owned model control message for continuation, but must never place Handler stdout, stderr, reason, or structured output into that message. Runtime adapters remain authoritative and must report unsupported decisions rather than recreating an external Agent loop in the Host. Ordinary Meldra Profiles own the Profile and trusted-project root `hooks/` directories as Hook resources, while the `pi` Compatibility Profile retains Pi's original deprecated-Extension warning and migration behavior for those directories.
