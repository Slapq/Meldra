# MetaPi Documentation

[中文](README.md) | [English](README.en.md)

MetaPi is a Profile-oriented patch layer over Pi. MetaPi-owned behavior is documented here; the detailed Pi references
under `packages/coding-agent/docs/` remain authoritative for unchanged Pi behavior.

## Guides

- [User Guide](user-guide.en.md): Profiles, WorkSpaces, packages, configuration, DSH, Sessions, export, and
  troubleshooting.
- [Setup and Distribution Contract](setup-and-distribution.en.md): the current entry and planned installer, npm
  Bootstrap, Starter Bundle, onboarding, and shortcut.
- [Development Guide](development.en.md): architecture, repository layout, source workflow, extension points, tests,
  upstream synchronization, and release boundaries.
- [Architecture Decisions](adr/): public product, ownership, and compatibility decisions.

## Architecture and Extensions

- [Architecture decisions](adr/)
- [Profile Runtime provider contract](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness Profile Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [Pi Extension API](../packages/coding-agent/docs/extensions.md)
- [MetaPi Extension inventory](extensions/README.md)
- [Profile Config Registration Protocol](extensions/profile-config-protocol.en.md)

## Pi Reference

- [Pi documentation index](../packages/coding-agent/docs/index.md)
- [Usage and CLI](../packages/coding-agent/docs/usage.md)
- [Providers and models](../packages/coding-agent/docs/providers.md)
- [Sessions](../packages/coding-agent/docs/sessions.md)
- [Settings](../packages/coding-agent/docs/settings.md)
- [Packages](../packages/coding-agent/docs/packages.md)
- [SDK, RPC, and JSON modes](../packages/coding-agent/docs/sdk.md)
- [Windows and terminal setup](../packages/coding-agent/docs/windows.md)

## Authority

When documents disagree, use current ADRs, source, tests, and CLI help. Investigation notes are evidence records, not
product specifications unless adopted by current architecture documents.
