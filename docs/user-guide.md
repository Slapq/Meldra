# MetaPi 使用教程

[中文](user-guide.md) | [English](user-guide.en.md) | [返回首页](../README.md)

本教程面向日常使用者，说明如何从源码启动 MetaPi、选择工作环境、管理 Session 与插件，以及使用 DeepSeek Harness Profile。Pi 原有命令的完整参考见 [Pi
文档](../packages/coding-agent/docs/index.md)。

## 1. 准备环境

需要：

- Node.js `>= 22.19.0`
- npm
- Git
- 可用的终端
- Windows 上可用的 Bash，推荐 Git for Windows

当前仓库没有正式的 MetaPi npm 发行源，因此不要使用官方 Pi 包代替 MetaPi。`metapi update --self` 已禁用。Windows 独立安装器、scoped npm Bootstrap、Starter Bundle Setup、Provider/模型/Scout 向导和桌面快捷方式均为 `PLANNED`，当前不可用；已确认的产品边界见 [Setup 与发行合同](setup-and-distribution.md)。

克隆仓库后安装并构建：

```bash
npm install --ignore-scripts
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

脚本可以从其他目录调用，并以调用目录作为工作目录。后文统一写作 `metapi`；源码运行时替换为对应脚本即可。

Windows 的 shell 和终端要求见 [Windows](../packages/coding-agent/docs/windows.md) 与 [Terminal
setup](../packages/coding-agent/docs/terminal-setup.md)。

## 2. 理解状态边界

开始前先区分四类状态：

| 状态 | 默认位置 | 谁拥有 |
|---|---|---|
| MetaPi Profile | `~/.metapi/profiles/<name>/` | 对应 Profile |
| MetaPi 用户偏好 | `~/.metapi/user/preferences.json` | 当前 MetaPi 用户 |
| Pi compatibility | `~/.pi/agent/` | 原始 Pi |
| WorkSpace | `~/.metapi/workspaces/` 或显式目录 | 当前 MetaPi Session |
| DSH Runtime | `<profile>/agent/dsh-runtime/` | 对应 Profile 的 Harness |

普通 Profile 不共享 Profile 工作流设置、插件配置、Session 或 Runtime 状态。主题、终端显示、编辑器和导航等界面与控制偏好属于 User Experience Preferences，由普通 Profile 共享，并写入 `~/.metapi/user/preferences.json`。`pi` Profile 是保留的兼容入口，继续使用原始 Pi 状态，不读取这份 MetaPi 用户偏好，也不接受 MetaPi 专属配置宿主或 DSH surface。

WorkSpace 只是会话的工作目录。它不会自动获得 Profile 的模型、插件、设置或 Harness 状态。

## 3. 完成第一个普通 Pi 会话

启动默认 Profile：

```bash
metapi --profile default
```

`default` 定位为由项目组持续调校的极简 MetaPi Starter Profile，以少量默认能力提供稳定、直接的日常开发入口。当前干净源码启动自动获得 MetaPi 的 Profile、WorkSpace 和 `/config` 内建 surface；项目维护的 Provider manager、Scout 与工作流 Starter Bundle 仍属于计划中的 Setup 交付，不应被误认为已经随干净安装提供。

如果 Provider 尚未配置，在 TUI 中运行：

```text
/login
```

也可以使用 Provider 支持的环境变量。完整列表见 [Providers](../packages/coding-agent/docs/providers.md)。不要把真实 API key 放入仓库、Profile
Bundle、命令历史或 Session 分享内容。

选择模型：

```text
/model
```

输入任务并按 Enter：

```text
读取 README，说明项目结构，并运行不会修改业务状态的基础检查。
```

MetaPi 继承 Pi 的文件与 shell 工具。工具使用启动进程的权限；MetaPi 不提供内建沙箱。需要隔离时参考
[Containerization](../packages/coding-agent/docs/containerization.md)。

## 4. 使用编辑器与资源

常用操作：

- 输入 `@` 选择文件；只有从 completion 中选中的路径才按对应 Runtime 的附件规则处理。
- 输入 `!command` 执行命令并把输出交给模型。
- 输入 `!!command` 执行命令但不加入模型上下文。
- 使用 `/model` 切换模型。
- 使用 `/hotkeys` 查看当前快捷键。
- 使用 `/reload` 重新加载磁盘 Extension、Skill、Prompt、Theme、keybinding 和 context files。

`metapi-config` 是 inline built-in 特例。`/reload` 会重建其运行时注册，但不是重新导入该内建源码的开发热重载入口。

完整编辑器与快捷键说明见 [Using Pi](../packages/coding-agent/docs/usage.md) 和
[Keybindings](../packages/coding-agent/docs/keybindings.md)。

## 5. 管理 Profile

### 查看状态

```bash
metapi profile status
metapi profile list
```

选择顺序：

1. 当前命令的 `--profile <name>`；
2. 当前目录或最近父目录的绑定；
3. `default`。

显式启动原始 Pi 状态：

```bash
metapi --profile pi
```

### 绑定目录

```bash
metapi profile bind research
metapi profile bind D:/Projects/team-a research
metapi profile unbind
metapi profile unbind D:/Projects/team-a
```

绑定适用于该目录及其后代目录。更近的绑定优先。绑定只影响新启动时的默认 Profile，不会自动导入或更新 Profile。

### 在 TUI 中切换

```text
/profile
```

普通 MetaPi Profile 之间的切换会重建当前 Profile 的设置、模型、Extension 和可选 Runtime。当前 MetaPi Session 与 WorkSpace 保留，旧 Runtime 必须先完成 teardown。`pi` compatibility 使用独立的原始 Pi Session 存储，不能从普通 Profile 在当前会话内进入或离开；请退出后使用 `metapi --profile pi`，返回普通 Profile 时也应显式新启动。两侧都不会移动、复制或发现对方的 Session 文件。

### 导入、导出和更新

```bash
metapi profile import <source> --name research --no-bind
metapi profile import <source> --name research --bind-current
metapi profile export research ./research-profile
metapi profile update research
```

非交互 import 必须明确选择 `--bind-current` 或 `--no-bind`。已有同名 Profile 时使用交互选择，或显式 `--replace`。

Portable Profile 使用 Pi-compatible `package.json`，可以携带 Pi 资源、公开设置、模型选择、Provider 声明、插件、Scout、工作流和 Runtime 声明。官方 Pi 可以读取该 Package，并忽略不认识的 MetaPi metadata。其他用户导入后获得同一套可分享配置，但不会获得作者的：

- 真实凭据；
- Pi 或 Harness Session；
- 环境变量的当前值；
- package cache；
- Loader inventory；
- 活动进程状态。

导入包含 registry、Git、tarball 或其他远程 package source 的 Bundle 可能访问网络并运行 package lifecycle scripts。只导入可信来源。

## 6. 使用 WorkSpace

创建默认位置的 WorkSpace：

```bash
metapi --workspace
```

使用显式目录：

```bash
metapi --workspace D:/WorkSpaces/release-audit
```

查看当前绑定：

```text
/workspace
```

`metapi-workspace` 是普通 MetaPi Profile 自动获得的内建插件。计划中的 Windows Setup 会在当前用户桌面创建一个快捷方式，以 `metapi --profile default --workspace` 进入干净的 Starter Profile + WorkSpace；该安装流程当前尚未发布。

WorkSpace 与 Profile 是正交的：

- Profile 决定用户环境、Pi 资源、模型和 Runtime；
- WorkSpace 决定当前会话在哪个目录工作；
- 只有显式选择 Current WorkSpace scope，资源才写入该目录的 `.pi`；
- 切换 Profile 不会替换 WorkSpace。

## 7. 项目推荐 Profile

在当前项目中创建 manifest：

```bash
metapi init
```

生成 `.pi/metapi.json`。项目可以在其中声明 Profile Bundle 推荐：

```json
{
  "schemaVersion": 1,
  "profile": {
    "source": "./profiles/team-profile",
    "displayName": "Team Profile"
  }
}
```

推荐不会自动导入、绑定或激活 Profile。用户仍需执行独立操作，项目也不能通过该文件修改已安装 Profile 的 Runtime plugin。

## 8. 安装 Pi Package

Pi Package 可以提供 Extension、Skill、Prompt Template 和 Theme：

```bash
metapi install <source>
metapi list
metapi update --extensions
metapi remove <source>
```

使用 `-l` 时，目标是当前 WorkSpace/项目的 `.pi` 设置，不是 Profile：

```bash
metapi install <source> -l
metapi config -l
```

项目级资源需要项目受信任。`metapi config` 是 package resource selector，用于启用或禁用 Package 中的资源。

来源语法、信任和更新行为见 [Pi Packages](../packages/coding-agent/docs/packages.md)。

## 9. 配置插件与 Settings

### `/config`

普通 MetaPi Profile 自动提供：

```text
/config
/config <plugin-id>
```

它编辑注册插件的普通字段，保存到：

```text
<profile-agentDir>/plugin-configs/<plugin-id>.json
```

不同 Profile 互不共享。`pi` compatibility Profile 不注入这个 MetaPi host；如果原始 Pi 自己安装了 `pi-config`，则继续使用原始安装。

### `/settings`

在普通 Pi Runtime 中，`/settings` 使用 Pi 的 Settings。在 DSH Runtime 中，同名命令由 DSH surface 接管，使用 Harness 原生模型、reasoning
effort、Settings、Provider 与 credential service。

### `metapi config`

这是 Package resource selector，与 `/config` 不是同一功能。

## 10. Session、恢复与分支

MetaPi Session 自动保存。常用启动方式：

```bash
metapi -c
metapi -r
metapi --session <path-or-id>
metapi --fork <path-or-id>
metapi --no-session
metapi --name "release audit"
```

TUI 中常用：

- `/resume`：选择 Session；
- `/new`：创建 Session；
- `/name`：设置名称；
- `/tree`：在一个 Pi Session 文件内切换分支；
- `/fork`：从较早消息创建新 Session；
- `/clone`：复制当前活动分支；
- `/compact`：压缩上下文。

在使用原生 Pi Agent 的 Profile 中，`/resume` 会跨普通 MetaPi Profile 的物理目录查找 Session，但只显示最新 Profile metadata 归属于当前 Profile 的对话；没有 metadata 的旧 Session 回退到其物理 Profile 目录。这样，切换过 Profile 的同一 Session 仍可恢复，而 default Pi Agent 与 DSH 对话不会互相混入。`metapi --profile pi` 仍只发现 `~/.pi/agent` 下的原始 Pi Session。

详细行为见 [Sessions](../packages/coding-agent/docs/sessions.md)。

## 11. 导出与分享

```text
/export
/export output.html
/share
```

`/export` 可以写 HTML 或 JSONL。`/share` 使用同一活动 Session HTML，并执行真实远程上传；运行前确认内容可以离开本机。

DSH 活动 Session 的 HTML 使用已注册的 custom-entry renderer，包括可呈现的用户、assistant、tool、信息和错误快照。独立 CLI HTML export 没有活动 Extension
runtime，因此不会假装能渲染未知 custom metadata。

Profile export 与 Session export 不同：

```bash
metapi profile export research ./research-profile
```

前者迁移环境声明，后者保存会话记录。

Profile export 会先提醒：Bundle 源文件按原样复制。MetaPi 管理的凭据、Session、Runtime Settings、cache、Loader 状态、项目 `.pi`、目录绑定和单次 CLI 覆盖不会被自动加入；但已经硬编码在 Bundle 源文件中的 Key 或 token 仍可能随文件导出。

每次导出都会生成 `METAPI_PROFILE_EXPORT_AUDIT.md`，其中列出：

- 本次包含的配置类别和完整文件清单；
- 明确未自动导出的托管状态；
- 疑似硬编码凭据的文件路径、行号和类型。

审计报告永不写入匹配值，也不会阻止导出或自动修改文件。发现提示后，将硬编码值迁移到 MetaPi credential service 或环境变量，再重新导出并检查报告。

## 12. 使用 DeepSeek Harness Profile

Profile Bundle 通过 `runtime.provider: "deepseek-harness"` 选择 Harness。Profile 名称是用户拥有的显示/选择标识，不决定 Runtime。

启动：

```bash
metapi --profile research-harness
```

打开管理中心：

```text
/dsh
```

日常入口：

| 任务 | 命令 |
|---|---|
| Session | `/resume`、`/sessions`、`/new`、`/history`、`/rewind` |
| 模型与 Agent | `/model`、`/preset`、`/settings` |
| 运行控制 | `/queue`、`/cancel`、`/compact` |
| 计划与目标 | `/plan`、`/goal`、`/dsh todo` |
| 子任务 | `/dsh subagents`、`/dsh jobs` |
| 原生命令与 Skill | `/dsh commands`、`/dsh skills` |
| 诊断 | `/dsh context`、`/dsh evidence`、`/dsh trajectory` |
| Plugin | `/plugins`、`/plugin` |

DSH 运行时规则：

- Harness Session 与 Pi Session 独立；
- Harness 保持 Agent loop、队列、实际模型 route、Preset、工具、Settings 和 ledger 权威；
- `/model` 使用 Pi 原生选择器读取当前 MetaPi Profile 的 Provider 与模型；只有确认选择后，MetaPi 才把该单个模型注册到 DSH `llm-pi-ai` Settings、通过 credential reference 提供凭据，并请求 Harness 切换；取消选择不会写入；
- `/dsh model` 继续查看和选择 Harness 原生 catalog；
- 当前 rc.6 可桥接 `openai-completions`、`openai-responses` 和 `anthropic-messages`；Anthropic endpoint 使用 Pi 原生约定的服务根地址，由 SDK 追加 `/v1/messages`；其他 API 会在写入 DSH Settings 前明确拒绝，不会猜测转换协议；
- `/tree`、`/clone`、`/scoped-models`、`/import`、`/login`、`/logout` 等不符合 DSH 状态域的 Pi 命令会隐藏或拒绝；
- `/copy` 使用当前 DSH Runtime 的最终 assistant 文本；
- DSH `/resume` 与 `/sessions` 使用同一个 Pi-native cursor Session browser 和 Harness `session.list` 数据；
- `/rewind`、`/dsh rewind` 与启用状态下的双击 `Esc` 使用同一个 Pi cursor message selector，再由 Harness 执行 native fork；
- Profile 切换和退出必须释放 Harness 进程与 listener。

DSH 出错时，可在同一 WorkSpace 中切换到默认 Pi Agent，检查项目与 MetaPi/DSH 集成状态、实施修复，再切回 DSH。这是人工恢复工作流；当前没有自动多 Agent 编排、自动委派或共享可写 Session。

完整命令和能力见 [DeepSeek Harness Profile Runtime](../packages/coding-agent/docs/deepseek-harness.md)。

## 13. 管理 DSH Plugin

终端：

```bash
metapi profile plugins research-harness list
metapi profile plugins research-harness add <source>
metapi profile plugins research-harness remove <package>
metapi profile plugins research-harness update
```

TUI：

```text
/plugins
/plugin list
/plugin add <source>
/plugin remove <package>
/plugin update
```

MetaPi 将 source 原样交给 DSH/pnpm。写操作可能访问网络并运行 lifecycle scripts；TUI 会先确认。命令成功不等于 Loader 已激活，MetaPi 还会通过 fresh
Runtime/Loader Inventory 验证。

`list` 是只读操作，不会为了缺失的 pnpm 自动下载工具。显式 mutation 在 PATH 没有 pnpm 时可以通过 Corepack 获取固定版本。

## 14. 非交互与自动化

普通 Pi Runtime 支持：

```bash
metapi -p "总结这个仓库"
metapi --mode json -p "运行静态检查"
metapi --mode rpc
```

非交互模式不会显示项目 trust prompt。使用已保存 trust、全局 `defaultProjectTrust`，或本次命令的 `--approve` / `--no-approve`。

外部 Profile Runtime 是否支持某种模式取决于 provider 的当前合同。不要根据命令名称推测 DSH 或其他 Runtime 的 print/RPC 行为。

## 15. 常见问题

### 启动的是错误 Profile

```bash
metapi profile status
```

检查显式 `--profile` 和最近父目录绑定。必要时 `metapi profile unbind <directory>`。

### `/config` 中没有插件

确认插件已加载并在 factory 执行时发送 `config:register`。`/reload` 后再检查。`pi` compatibility 不注入 MetaPi Config Host。

### `metapi config` 没有打开插件字段

这是正常的。`metapi config` 管理 Package resources；插件字段使用 TUI `/config`。

### DSH 命令不可用

检查当前 Profile 是否选择 `deepseek-harness`：

```bash
metapi profile status <name>
```

Profile 名称本身不是 Runtime provider 声明。

### DSH plugin 缺少 pnpm 或 Corepack

只读 `list` 不下载工具。执行明确的 add/remove/update，或安装 pnpm/Corepack。失败时查看原生 DSH/pnpm 输出。

### `/reload` 没有加载内建源码修改

磁盘 Extension 会清模块 cache 并重新 import。inline built-in 的 factory 来自当前进程；修改 MetaPi 内建源码后需要重新 build 并重启进程。

### Windows 测试或 shell 失败

确认 Git Bash、PowerShell、PATH 和 Windows SDK/Build Tools。区分已记录的 symlink `EPERM`、Unix socket、终端图片等平台基线与当前功能回归。

### Self update 不可用

这是当前设计。MetaPi 没有权威发行源，不能使用 Pi 更新源冒充 MetaPi。通过源码 checkout/build 更新当前开发环境。

## 16. 数据备份与退出

退出使用 `/quit`；DSH 也可以使用 `/dsh exit`，两者都走 MetaPi 的 graceful teardown。

备份前先退出相关进程。主要目录：

```text
~/.metapi/
~/.pi/agent/            # only for the pi compatibility Profile
```

不要只复制活动中的单个 JSONL 并声称完成 Runtime 备份。Portable Profile export、Session export 和目录级备份解决的是不同问题。

## 下一步

- [开发文档](development.md)
- [Pi 使用参考](../packages/coding-agent/docs/usage.md)
- [Profile Runtime provider](../packages/coding-agent/docs/profile-runtimes.md)
- [Extension 开发](../packages/coding-agent/docs/extensions.md)
- [Profile Config 注册规范](extensions/profile-config-protocol.md)
