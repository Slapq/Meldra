# Meldra Setup 与发行合同

[中文](setup-and-distribution.md) | [English](setup-and-distribution.en.md) | [返回首页](../README.md)

> [!IMPORTANT]
> Windows x64 双安装器从 `v0.1.0-preview.7` 开始发布。安装器目前未做代码签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。scoped npm Bootstrap 仍未发布。

## 当前状态

| 能力 | 状态 | 当前入口 |
|---|---|---|
| 从源码构建并运行 | `SUPPORTED` | `npm install --ignore-scripts`、`npm run prepare:native-runtime`、`npm run build`、源码启动脚本 |
| Linux x64 standalone Bun 归档 | `PARTIAL` | default/普通 Profile 可用；DeepSeek Harness 明确 `UNSUPPORTED`，应使用 Node.js 源码发行 |
| Portable Profile 导入/导出 | `SUPPORTED` | `meldra profile import` / `export` |
| Profile export 脱敏审计 | `SUPPORTED` | 导出时自动生成 `METAPI_PROFILE_EXPORT_AUDIT.md` |
| Windows x64 双安装器 | `SUPPORTED` | [`v0.1.1-fix`](https://github.com/Slapq/Meldra/releases/tag/v0.1.1-fix) 提供内置 Node 和使用系统 Node 两版 |
| scoped npm Bootstrap | `PLANNED` | organization 和包名尚未确认，不提供假命令 |
| Starter Profile Bundle Setup | `SUPPORTED` | 干净的首次 Meldra 初始化自动 provision；已有用户运行 `meldra setup` 安装或恢复 |
| Provider、模型和 Scout 引导 | `SUPPORTED` | default Profile 中运行 `/setup`；分别转到 `/login`、`/model`、`/scout` 或 `/config` |
| Windows 桌面快捷方式 | `SUPPORTED` | 使用安装器内置的 portable Windows Terminal 启动 default Profile + WorkSpace |

## 公开快照与发布审计

当前公开仓库发布使用经过脱敏审计的公开树。允许在已脱敏的公开基线上追加经过审计的增量 commit，但禁止直接推送包含本地 Profile、Session、凭据、本机路径、Agent 上下文或私有调查记录的开发历史。每次公开发布前必须审计所有可达公开内容，而不是只审计当前工作树。

## 双 Bootstrap 入口

Meldra 提供 Windows 安装器和计划中的 npm Bootstrap 两类首次安装入口。两者调用同一套 Setup service，不能维护两份安装语义。

### Linux 源码发行

Linux x64 已通过 Alpine 3.24.1 WSL2 的真实 build、Setup、TUI、Bash 和 DSH Runtime 验证。源码安装先以 `--ignore-scripts` 保持默认依赖安装边界，再显式运行 `npm run prepare:native-runtime`，只执行项目已审查并记录的 `@deepseek-ai/dsh-subprocess-local`、`koffi` 和 `node-pty` native install scripts。Windows 与 Linux 的 Node release staging 都从根 lock 安装完整、平台匹配的 DSH rc.7 exact graph，不能混用 rc.6/rc.7。Linux 需要 Python 3、Make 和 C++ toolchain；Alpine 还需要 Linux headers。

standalone Bun Linux 归档携带 Starter Bundle，可运行 default 和普通 Profile，但不携带 Harness 的 Node 动态依赖，因此 DeepSeek Harness 明确为 `UNSUPPORTED`，不会返回伪兼容结果。需要 DSH 时必须使用 Node.js 源码发行。Linux ARM64 和 glibc 发行版仍待真实验证，不能从 x64 musl 结果推断为已验收。

### Windows 安装器

Release 提供两个 Windows 10 build 19041+ / Windows 11 x64 安装器：

- `Meldra-Setup.exe`：面向未预装 Node.js 的机器，内置官方 Node.js 24.19.0；
- `Meldra-Setup-NodeJS.exe`：使用机器已有 Node.js。缺少 Node/npm 或版本低于 22.19.0 时显示真实提示，但不阻止用户完成安装。

两版都内置官方 Windows Terminal 1.24.11911.0 x64 unpackaged distribution，并使用 `.portable` 模式。安装器把 `metapi` 加入当前用户 PATH，所以 CLI 可以在 PowerShell、cmd、Git Bash、Windows Terminal、VS Code terminal 等任意新开的终端中运行。桌面 `Meldra` 快捷方式默认使用内置 Windows Terminal，但不把 Meldra 绑定到该终端，也不修改 Windows 的系统默认终端设置。

安装器使用同一个 `AppId`，两版可以原位互相升级。安装位置默认为 `%LOCALAPPDATA%\Programs\Meldra`，不要求管理员权限。升级保留 `~/.metapi`；卸载删除程序、快捷方式和 Meldra 自己的 PATH 项，但保留 Profile、凭据、模型和 Session。

### npm Bootstrap

计划中的 npm Bootstrap 使用 Meldra organization 下的 scoped package。organization、scope、包名、registry、版本和发布权限尚未确认，因此当前只保留能力位置，不写入猜测名称。

普通 `meldra install` 继续属于 Pi Package manager，不承担 Meldra 产品安装职责。

## Setup service

当前源码发行已经提供共享 Setup service。干净的首次 Meldra 用户初始化会 provision Starter Profile Bundle；已有用户可显式运行：

```text
meldra setup
```

检测到可迁移的原始 Pi 状态时，交互终端沿用现有迁移选择；非交互调用必须显式传入 `--migrate` 或 `--start-fresh`。重复运行会恢复项目维护的 Bundle，并保留其他 Profile packages、plugin config、Provider、模型、凭据与 Session。

进入 `default` Profile 后运行 `/setup`。向导始终按 Provider → 模型 → Scout 顺序展示三个步骤，不因已有配置而跳过；每一步明确标注“已配置 / 部分配置 / 未配置”。已配置步骤可以保留并继续或重新配置；未完成步骤复用并等待对应原生命令。一步真实完成后进入下一步；取消或失败时留在当前步骤，可重试、仅跳过本轮或退出。缺少配置时状态区保留 `/setup` 提示，不伪造成功。

共享 Setup service 当前负责：

1. 初始化 Meldra 用户目录；
2. 安装或恢复项目维护的 Meldra Starter Profile Bundle；
3. 引导用户完成 Provider 登录和模型选择；
4. 引导配置 Scout 使用的模型与 thinking level；
5. 在状态区显示未完成项和最短下一步。

Windows installer 已调用同一个 Setup service；未来的 npm Bootstrap 也必须复用它。当前用户桌面快捷方式由 installer 创建。

## Starter Profile

Meldra 默认 Profile 定位为由项目组持续调校的极简 Starter Profile，以少量默认能力提供稳定、直接的日常开发体验。

当前 Starter Bundle 声明项目维护的 Provider Manager、Scout、工作流插件和 `/setup` onboarding；`/config` 继续由 Meldra 内建 Profile Config Host 提供，不在 Bundle 中复制。它不携带 API key、OAuth token、环境变量当前值、Session 或机器本地目录绑定。用户自己的凭据只通过本机 credential service 或 Provider 支持的认证路径提供。

## 桌面快捷方式

Windows Setup 只在当前用户桌面创建一个快捷方式，不写入开始菜单，也不要求管理员权限。重复运行会更新同一个快捷方式，不创建重复项。快捷方式使用内置 portable Windows Terminal；`metapi` 命令仍通过当前用户 PATH 在其他终端可用。

快捷方式的产品启动语义是：

```text
meldra --profile default --workspace
```

它直接进入 Meldra Starter Profile，并创建或绑定一个独立 WorkSpace，避免把桌面目录或系统目录误当成项目目录。

## Profile 分享

Portable Profile Bundle 可以携带 Profile 配置、模型选择、Provider 声明、插件、Scout、WorkSpace 工作流和界面体验。其他用户导入后获得同一套可分享配置；Meldra 专属 metadata 保持附加在 Pi-compatible `package.json` 中，官方 Pi 可以读取该 Package 并忽略不认识的 Meldra metadata。

凭据、Session 和机器本地路径不随 Bundle 分享。导入后的首次引导负责提示用户补充自己的 Provider 凭据。

Profile export 会列出实际导出的文件和明确排除项，并对疑似硬编码凭据只报告脱敏路径、行号和类型。发现不会阻止导出或自动改写文件；用户应把硬编码值迁移到 credential service 或环境变量后重新导出。

## DSH 恢复工作流

DeepSeek Harness 是外部兼容 Agent Runtime。它保留自己的 Agent loop、Session、Preset、工具、Settings 和持久化权威，同时接入 Meldra 的 Pi TUI 设计语言、Profile 生命周期和模型选择体验。

DSH 出错时，用户可以在同一 WorkSpace 中切换到默认 Pi Agent，检查项目与集成状态并实施修复，再切回 DSH。这是人工恢复工作流，不是两个 Agent 的自动编排、自动委派或共享可写 Session。
