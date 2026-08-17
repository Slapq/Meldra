# MetaPi Setup 与发行合同

[中文](setup-and-distribution.md) | [English](setup-and-distribution.en.md) | [返回首页](../README.md)

> [!IMPORTANT]
> 本文记录已经确认的产品合同，不表示安装器或 npm Bootstrap 已经发布。当前唯一可靠入口仍是[从源码运行](user-guide.md#1-准备环境)。

## 当前状态

| 能力 | 状态 | 当前入口 |
|---|---|---|
| 从源码构建并运行 | `SUPPORTED` | `npm install --ignore-scripts`、`npm run build`、源码启动脚本 |
| Portable Profile 导入/导出 | `SUPPORTED` | `metapi profile import` / `export` |
| Profile export 脱敏审计 | `SUPPORTED` | 导出时自动生成 `METAPI_PROFILE_EXPORT_AUDIT.md` |
| Windows 独立安装器 | `PLANNED` | 尚无下载文件或正式 release URL |
| scoped npm Bootstrap | `PLANNED` | organization 和包名尚未确认，不提供假命令 |
| Starter Profile Bundle Setup | `PLANNED` | 尚未作为干净安装资产发布 |
| Provider、模型和 Scout 引导 | `PLANNED` | 当前分别使用 `/login`、`/model` 和已安装插件的设置入口 |
| Windows 桌面快捷方式 | `PLANNED` | 尚未由安装流程创建 |

## 双 Bootstrap 入口

MetaPi 计划提供两个首次安装入口，两者必须调用同一套 Setup service，不能维护两份安装语义。

### Windows 安装器

计划中的 `MetaPi-Setup.exe` 是普通 Windows 用户的主入口。它负责安装 MetaPi launcher/runtime，然后调用 Setup service。尚未发布前，README 和文档不得给出伪造下载链接。

### npm Bootstrap

计划中的 npm Bootstrap 使用 MetaPi organization 下的 scoped package。organization、scope、包名、registry、版本和发布权限尚未确认，因此当前只保留能力位置，不写入猜测名称。

普通 `metapi install` 继续属于 Pi Package manager，不承担 MetaPi 产品安装职责。

## Setup service

安装完成后，共享 Setup service 计划负责：

1. 初始化 MetaPi 用户目录；
2. 安装或恢复项目维护的 MetaPi Starter Profile Bundle；
3. 引导用户完成 Provider 登录和模型选择；
4. 引导配置 Scout 使用的模型与 thinking level；
5. 在状态区显示未完成项和最短下一步；
6. 在当前用户桌面幂等创建一个 MetaPi 快捷方式。

向导允许跳过。缺少 Provider、模型或 Scout 配置时，MetaPi 不能伪造成功；状态区应分别提示 `/login`、`/model` 或 Scout 设置入口。

## Starter Profile

MetaPi 默认 Profile 定位为由项目组持续调校的极简 Starter Profile，以少量默认能力提供稳定、直接的日常开发体验。

计划中的 Starter Bundle 应声明项目维护的 Provider 配置、`/config` 集成、Scout 和工作流插件。它不得携带 API key、OAuth token、环境变量当前值、Session 或机器本地目录绑定。用户自己的凭据只通过本机 credential service 或 Provider 支持的认证路径提供。

## 桌面快捷方式

计划中的 Windows Setup 只在当前用户桌面创建一个快捷方式，不写入开始菜单，也不要求管理员权限。重复运行应更新同一个快捷方式，不创建重复项。

快捷方式的产品启动语义是：

```text
metapi --profile default --workspace
```

它直接进入 MetaPi Starter Profile，并创建或绑定一个独立 WorkSpace，避免把桌面目录或系统目录误当成项目目录。

## Profile 分享

Portable Profile Bundle 可以携带 Profile 配置、模型选择、Provider 声明、插件、Scout、WorkSpace 工作流和界面体验。其他用户导入后获得同一套可分享配置；MetaPi 专属 metadata 保持附加在 Pi-compatible `package.json` 中，官方 Pi 可以读取该 Package 并忽略不认识的 MetaPi metadata。

凭据、Session 和机器本地路径不随 Bundle 分享。导入后的首次引导负责提示用户补充自己的 Provider 凭据。

Profile export 会列出实际导出的文件和明确排除项，并对疑似硬编码凭据只报告脱敏路径、行号和类型。发现不会阻止导出或自动改写文件；用户应把硬编码值迁移到 credential service 或环境变量后重新导出。

## DSH 恢复工作流

DeepSeek Harness 是外部兼容 Agent Runtime。它保留自己的 Agent loop、Session、Preset、工具、Settings 和持久化权威，同时接入 MetaPi 的 Pi TUI 设计语言、Profile 生命周期和模型选择体验。

DSH 出错时，用户可以在同一 WorkSpace 中切换到默认 Pi Agent，检查项目与集成状态并实施修复，再切回 DSH。这是人工恢复工作流，不是两个 Agent 的自动编排、自动委派或共享可写 Session。
