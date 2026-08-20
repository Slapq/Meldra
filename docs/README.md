# Meldra 文档

[中文](README.md) | [English](README.en.md)

Meldra 是建立在 Pi 之上的 Profile 化补丁层。本目录记录 Meldra 自己拥有的行为；未被 Meldra 改写的 Pi 功能，仍以 `packages/coding-agent/docs/` 下的详细参考为准。

## 指南

- [使用教程](user-guide.md)：Profile、WorkSpace、Package、配置、DSH、Session、导出和故障处理。
- [Setup 与发行合同](setup-and-distribution.md)：当前入口与计划中的安装器、npm Bootstrap、Starter Bundle、onboarding 和快捷方式。
- [开发文档](development.md)：架构、仓库结构、源码工作流、扩展点、测试、上游同步和发行边界。
- [Meldra Hook 编写与开发](hooks.md)：Handler、Decision、Runtime Adapter、TUI、热重载、安全和测试。
- [领域术语](../CONTEXT.md)：Meldra 的权威术语和所有权边界。
- [Agent 治理](../AGENTS.md)：调查、兼容、审批和验证要求。

## 架构与扩展

- [架构决策](adr/)
- [Profile Runtime provider 合同](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness Profile Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [Pi Extension API](../packages/coding-agent/docs/extensions.md)
- [Meldra Extension 清单](extensions/README.md)
- [Profile Config 注册规范](extensions/profile-config-protocol.md)

## Pi 参考

- [Pi 文档索引](../packages/coding-agent/docs/index.md)
- [日常使用与 CLI](../packages/coding-agent/docs/usage.md)
- [Provider 与模型](../packages/coding-agent/docs/providers.md)
- [Session](../packages/coding-agent/docs/sessions.md)
- [Settings](../packages/coding-agent/docs/settings.md)
- [Pi Package](../packages/coding-agent/docs/packages.md)
- [SDK、RPC 与 JSON 模式](../packages/coding-agent/docs/sdk.md)
- [Windows 与终端设置](../packages/coding-agent/docs/windows.md)

## 文档权威顺序

文档冲突时，依次采用：用户最新决定、作用域内的 `AGENTS.md`、当前 ADR 与 `CONTEXT.md`、当前源码/测试/help。`docs/investigations/` 是调查证据，不会仅因被记录就自动成为当前产品规范。
