<div align="center">

# Meldra Coding Agent

### 🧭 基于 Pi TUI、以 Profile 隔离工作环境的 AI 编程终端

<p>
  <img alt="Development" src="https://img.shields.io/badge/status-development-f59e0b?style=flat-square">
  <img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Pi baseline 0.84.2" src="https://img.shields.io/badge/Pi_baseline-v0.84.2-4f46e5?style=flat-square">
  <img alt="DeepSeek Harness 0.1.0 rc.7" src="https://img.shields.io/badge/DSH-0.1.0--rc.7-0ea5e9?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square">
</p>

[中文](README.md) · [English](README.en.md) · [完整项目首页](../../README.md) · [使用教程](../../docs/user-guide.md)

</div>

> [!IMPORTANT]
> 当前仓库尚未配置正式 Meldra npm 发行源或自更新服务。本 package manifest 提供 `metapi` 命令，
> 但开发阶段应以可信源码 checkout 和构建结果为准。

<p align="center">
  <img src="docs/images/metapi-profile-tui.png" alt="Meldra Profile 选择界面" width="100%">
</p>

## ✨ 功能

- 保留 Pi 原生交互、工具、Session、Extension、Skill、Prompt 与 Theme。
- 用独立 Profile 隔离模型、设置、Package、Session 和外部 Runtime 状态。
- 提供 `pi` Compatibility Profile 访问原始 `~/.pi/agent`。
- 支持 session-bound WorkSpace 和 Portable Profile import/export。
- 通过通用 Profile Runtime provider 接入外部 Agent 后端。
- 内建 DeepSeek Harness adapter，并保持 Harness 原生状态权威。
- 在普通 Meldra Profile 中提供统一 `/config` 插件配置界面。
- 为 `default` provision 可恢复的 Starter Bundle，并通过 `meldra setup` 与 `/setup` 引导 Provider、模型和 Scout 配置。

## 🚀 从源码运行

在仓库根目录：

```bash
npm install --ignore-scripts
npm run prepare:native-runtime
npm run build
```

Linux / macOS：

```bash
./pi-test.sh
```

Windows PowerShell：

```powershell
.\pi-test.ps1
```

构建后的入口：

```bash
node packages/coding-agent/dist/cli.js --profile default
```

## 🧰 常用命令

```bash
meldra --profile default
meldra setup
meldra profile status
meldra profile list
meldra --workspace
metapi -c
metapi -r
```

TUI 常用入口：

| 任务 | 命令 |
|---|---|
| 配置 Starter | `/setup` |
| 选择模型 | `/model` |
| 管理 Profile | `/profile` |
| 查看 WorkSpace | `/workspace` |
| 配置插件 | `/config` |
| 管理设置 | `/settings` |
| 恢复 Session | `/resume` |
| 导出 Session | `/export` |
| 重新加载资源 | `/reload` |

## 🧭 Profile 与状态

| Profile | 状态位置 | 行为 |
|---|---|---|
| `default` | `~/.metapi/profiles/default/` | Meldra 默认隔离环境 |
| 普通 Profile | `~/.metapi/profiles/<name>/` | 独立 Pi 资源与可选 Runtime |
| `pi` | `~/.pi/agent/` | 原始 Pi compatibility，不接受 Meldra 专属注入 |

Profile 选择顺序为显式 `--profile`、最近目录绑定、最后 `default`。

## 🔌 两类插件

Pi Package 管理 Extension、Skill、Prompt 和 Theme：

```bash
meldra install <source>
meldra update --extensions
meldra list
meldra config
```

外部 Profile Runtime 可以提供自己的原生 package capability：

```bash
meldra profile plugins <profile> list
meldra profile plugins <profile> add <source>
meldra profile plugins <profile> remove <package>
meldra profile plugins <profile> update
```

两者作用域不同，不能互相替代。

## ◈ DeepSeek Harness

Portable Profile 使用 `runtime.provider: "deepseek-harness"` 选择 DSH。Harness 负责 Agent
loop、Session、模型、工具、Settings、插件和持久化；Meldra 负责进程生命周期、协议适配与 Pi TUI。

```bash
meldra --profile research-harness
```

进入后使用 `/dsh` 打开管理中心。常用入口包括 `/sessions`、`/model`、`/preset`、`/settings`、`/queue`、`/plugins` 和 `/dsh trajectory`。

## ⚠️ 安全边界

> [!WARNING]
> Meldra 与 Pi 默认使用启动用户的文件、进程和网络权限，不提供内建沙箱。
> 第三方 Package、Extension 和 Runtime plugin 可能执行代码或访问网络；安装前应检查来源。

真实凭据不得写入源码、Profile Bundle、Session export、日志或测试 fixture。
需要更强隔离时参考 [Containerization](docs/containerization.md)。

## 📚 文档

- [Meldra 使用教程](../../docs/user-guide.md)
- [Meldra 开发文档](../../docs/development.md)
- [Pi 文档索引](docs/index.md)
- [Profile Runtime providers](docs/profile-runtimes.md)
- [DeepSeek Harness](docs/deepseek-harness.md)
- [Extension 开发](docs/extensions.md)
- [Pi Packages](docs/packages.md)
- [Windows](docs/windows.md)

## 🛠️ 开发

```bash
npm run build
npm run check
npm test
```

Meldra 按“精确 Pi baseline + 可审计 patch layer”维护。涉及运行时语义的修改必须先调查真实合同、确认范围，并对普通 Pi、`pi` compatibility 和受影响 Profile Runtime
进行相应验证。

## 🌱 上游与许可证

Meldra 基于 [earendil-works/pi](https://github.com/earendil-works/pi) 的完整源码，保留 MIT 许可证与上游兼容路径。
