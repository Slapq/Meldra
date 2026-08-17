# Upgrade DeepSeek Harness as one complete rc.7 graph

MetaPi upgrades its DeepSeek Harness integration from `0.1.0-rc.6` to `0.1.0-rc.7` as one exact dependency graph. Direct DSH packages, required peer services, native packages, root lock, coding-agent shrinkwrap, installer lock, Windows staging, and Linux staging must resolve to the same release candidate; npm range drift that mixes rc.6 and rc.7 is unsupported because it can close the Harness transport during composition loading.

The rc.7 SDK, boot, Session, Settings, event, model, preset, jobs, and plugin contracts used by MetaPi remain compatible with the rc.6 adapter. The only observed public type removal is the unused `settings-not-exposed` RPC error code. Native preparation remains limited to the reviewed `@deepseek-ai/dsh-subprocess-local`, `koffi`, and `node-pty` install scripts.
