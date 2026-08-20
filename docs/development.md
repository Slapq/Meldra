# Meldra 开发文档

[中文](development.md) | [English](development.en.md) | [返回首页](../README.md)

本文说明如何在 Meldra 仓库中开发、定位修改位置并完成验证。Pi API 的逐项参考保留在 `packages/coding-agent/docs/`；这里集中说明 Meldra 的架构与交付流程。

## 1. 开发原则

Meldra 使用“精确 Pi baseline + 可审计 patch layer”：

- 保留完整 Pi 源码、普通 Pi Runtime、CLI、TUI、Session 和 Extension 行为；
- Meldra-owned 功能通过小而清晰的提交叠加在已知 upstream baseline 上；
- 产品专属逻辑不能进入通用 Pi core；
- 外部 Runtime 保持其 Agent loop、Session、协议、模型、工具和持久化权威；
- 默认行为、公开接口和已有数据格式在没有明确批准时保持不变。

开始工作前阅读：

1. [AGENTS.md](../AGENTS.md)；
2. 当前 WorkSpace/Profile 的更具体 Agent instructions；
3. [CONTEXT.md](../CONTEXT.md)；
4. 相关 [ADR](adr/)；
5. 当前实现、调用方和测试。

## 2. 环境准备

需要 Node.js `>= 22.19.0`、npm 和 Git。Linux 上准备 DSH native modules 还需要 Python 3、Make 和 C++ toolchain；Windows 还需要 Git Bash，修改原生 TUI 时需要 Visual Studio C++ Build Tools 与 Windows SDK。

```bash
npm install --ignore-scripts
npm run prepare:native-runtime
npm run build
```

源码运行：

```bash
./pi-test.sh                 # Linux / macOS
.\pi-test.ps1               # Windows PowerShell
```

脚本保留调用目录。验证项目级行为时，应从对应 fixture 或项目目录调用，而不是假设仓库根就是用户 cwd。

构建后的 CLI：

```bash
node packages/coding-agent/dist/cli.js --profile default
```

当前仓库没有正式 Meldra 发行身份。开发文档不把全局本机 launcher、官方 Pi npm 包或本地 checkout 当作可互换发行物。

## 3. 架构概览

```text
Meldra CLI / Pi TUI
        |
        +-- Profile service -------- Profile、绑定、Bundle、agentDir
        +-- Pi AgentSession -------- 普通 Pi agent path
        +-- Profile Runtime host --- 通用 construction/lifecycle boundary
                    |
                    +-- DSH provider/runtime --- Harness subprocess + native API

Profile Extensions consume the active host/runtime capability.
External Runtime state remains outside Pi Session state.
```

主要所有权：

| 模块 | 负责 | 不负责 |
|---|---|---|
| Pi core | Session host、Extension API、TUI、通用 Runtime boundary | DSH RPC、Preset、模型或业务状态 |
| Meldra Profile domain | Profile 解析、绑定、Bundle、Profile 环境 | 外部 Runtime 内部状态 |
| Profile Runtime provider | 匹配、构造、teardown、可选原生 package capability | 普通 Pi 默认行为 |
| DSH Runtime adapter | Harness 进程、ApiProxy、事件边界和原生生命周期 | 复制 Harness Agent loop |
| DSH Extension | 命令、renderer、dialog、状态展示 | Harness 子进程或 Session ownership |
| WorkSpace | Session 工作目录 | Profile 设置或 Runtime plugin |
| Config Host | 统一插件字段 TUI 与 Profile-local JSON | Meldra Settings 替代品或 Config Service |

详细边界见 [Profile Runtime providers](../packages/coding-agent/docs/profile-runtimes.md) 和 [DSH
Runtime](../packages/coding-agent/docs/deepseek-harness.md)。

## 4. 仓库结构

```text
packages/
  ai/                 Provider/model abstraction
  agent/              Native Pi agent loop
  tui/                Terminal rendering and input
  coding-agent/       CLI, Session host, Extensions, Meldra, DSH adapter
  protocol/           Shared protocol contracts
  client/             Client library
  server/             Server package
  telemetry/          Telemetry contracts
  session-backends/   Optional Session storage

docs/
  adr/                Accepted architecture decisions
  extensions/         Meldra Extension inventory and config protocol
  investigations/     Evidence records, not automatic product contracts
scripts/               Build, lock, release, and validation tools
```

`packages/coding-agent/src/` 中与 Meldra 最相关的位置：

| 路径 | 作用 |
|---|---|
| `main.ts` | composition root；只接通通用能力 |
| `meldra/profile-service.ts` | Profile 选择、目录绑定和路径 |
| `meldra/profile-bundle.ts` | Portable Profile import/export/update |
| `core/agent-session-runtime.ts` | Session replacement 与 Meldra lifecycle 连接点 |
| `core/profile-agent-runtime.ts` | 产品无关 Runtime provider/host 类型 |
| `meldra/profile-runtime-providers.ts` | bundled provider registry |
| `meldra/dsh-profile-runtime*.ts` | DSH provider 与 Runtime adapter |
| `extensions/dsh/` | DSH 的 Pi TUI surface 与 bridge |
| `extensions/meldra-config/` | inline built-in Profile Config Host |
| `meldra/profile-extension.ts` | `/profile` TUI |
| `meldra/workspace-extension.ts` | `/workspace` TUI |

## 5. 标准工作流

### 5.1 建立基线

修改前记录：

```bash
git status --short
git log -1 --oneline
npm --prefix packages/coding-agent test -- <relevant-test-file>
```

按风险补充 build、type check 或真实探针。不要把已有 Windows/environment 失败算作新回归，也不要在没有基线时声称某个失败由当前修改引入。

### 5.2 五步法

非平凡工作使用：

```text
Hypothesis -> Initial evaluation -> Information search -> Re-evaluation -> Modification
```

要求：

- 假设必须可证伪；
- 阅读实现、调用方和相关测试；
- 外部接口以当前源码、schema、官方文档或真实只读探针为准；
- 重评估必须同时记录支持与反对证据；
- 修改运行时行为前，用户批准必须覆盖具体范围；
- Scout 只用于查找与压缩事实，不负责判断缺陷或设计修复。

如果证据否决假设，停止原方案。不要为了保留计划而添加兼容层、配置或未来基础设施。

### 5.3 最小修改

- 只改完成当前目标所需文件；
- 普通 Pi 与 `pi` compatibility 必须有明确回归覆盖；
- DSH 专属逻辑留在 provider/adapter/Extension；
- 一项可运行切片一个提交；
- 不顺手重构、不迁移无关数据、不改变未批准默认值。

## 6. 选择正确的扩展点

### 普通工作流或 UI

优先实现为 Pi Extension。Extension 可以注册 command、tool、event、renderer、shortcut 和 TUI。使用 [Extension
Guide](../packages/coding-agent/docs/extensions.md) 和 [TUI Components](../packages/coding-agent/docs/tui.md)。

只有 Meldra 产品每个普通 Profile 都必须拥有的 composition capability 才进入 bundled built-in registry。`meldra-config` 是明确记录的 inline
built-in 特例；不要为它另建 provision、package-copy 或源码 hot-reload 生命周期。

### 插件字段配置

普通 scalar 配置使用 [Profile Config Registration Protocol](extensions/profile-config-protocol.md)。保持：

- 固定 registration 结构；
- 六种 field；
- `config:*` 事件；
- `<agentDir>/plugin-configs/<id>.json`；
- 一个统一 `/config` 风格。

不要增加另一种注册方言、通用 Config Service 或插件自绘的重复配置中心。产品专属 credential service、复杂资源管理和业务工作流不应伪装成普通 scalar config。

### 新 Profile Runtime provider

只有真实外部 Runtime 需要在 construction-time 接管 Agent 后端时才使用 provider seam。实现时：

1. 定义稳定且产品明确的 provider identity；
2. 只在 provider 模块中匹配 portable `runtime.provider`；
3. 在 `attach()` 后通过 host 发送通用 live event 或 display snapshot；
4. 实现 prompt、abort、idle、dispose 的真实语义；
5. 将协议翻译集中在 adapter boundary；
6. 只在真实需要时提供 package snapshot/restore/verify；
7. 为 native Pi 未匹配路径和真实 provider 路径都添加测试；
8. 更新 Runtime 文档、ADR 和 rollback。

不要在 `main.ts`、generic interface 或普通 Pi TUI 中加入 provider 名称、RPC 方法、Preset 或业务默认值。

### 扩展通用 Pi core

只有至少一个真实 provider 使用、普通 Pi 兼容测试存在、所有权与 teardown 已写清楚时，才增加通用 host capability。接口必须使用产品无关名称，并保持 omission 时的 Pi 默认行为。

## 7. DSH 开发边界

DSH 固定为 `0.1.0-rc.7`。开发时以当前安装包类型、Harness 源码、ApiProxy、事件和真实 runtime probe 为依据。

必须保持：

- Harness owns Session、Agent loop、Preset、模型、工具、Settings、queue 和 ledger；
- `DshProfileRuntime` owns subprocess/cursor/listener lifecycle；
- DSH Extension owns Pi command、renderer、dialog 和 compact status；
- Pi Session 只保存必要 display snapshot，不成为 Harness model context；
- Profile switch、Session replacement 和退出必须等待 Runtime teardown；
- provider/model/effort 使用 Harness 原生精确值，不映射为 Pi 替代状态；
- Runtime plugin 使用 native DSH/pnpm 命令，并用 Loader Inventory 验证激活。

新增 DSH surface 前，先查 native Web/CLI 的真实 service chain、交互和错误路径。没有 RPC 的能力必须明确标记 unavailable，不返回空值冒充兼容。

## 8. 测试与验证

### 聚焦测试

```bash
npm --prefix packages/coding-agent test -- test-file.test.ts
npm --prefix packages/tui test -- input.test.ts
```

Vitest 参数可以是文件名或匹配 pattern。测试应无网络、无真实 Provider、无用户凭据，并使用临时目录。

### 构建

```bash
npm --prefix packages/coding-agent run build
npm run build
npm run build:offline
```

修改 shared package 时运行根 build。只改 coding-agent 时可以先跑 package build，但最终验证按影响面扩大。

### 仓库检查

```bash
npm run check
```

它会运行 Biome、固定依赖检查、TypeScript import 检查、shrinkwrap、installer lock、全树类型检查和 browser smoke。Biome 带 `--write`，运行后必须再次检查 `git
diff`，不能把无关格式化混入提交。

### 全量测试

```bash
./test.sh
npm test
```

`test.sh` 使用隔离环境并清除常见 Provider credentials。Windows 已知 path、permission、Unix socket、terminal image、fswatch 和 symlink
差异应单独记录；不能把“聚焦测试通过”写成“全平台验收完成”。

### 真实验证

涉及 TUI、Profile switch、外部 Runtime、package activation 或 teardown 时，仅单元测试不够。按范围验证：

- 构建后的真实 CLI/TUI；
- default 与 `pi` compatibility；
- 受影响的外部 Runtime Profile；
- 实际 Session resume/export；
- Runtime/plugin mutation 后 fresh Loader；
- 退出后的子进程、cursor 和 listener；
- Windows 与至少一个目标终端尺寸。

没有真实 Provider、Browser、Docker 或 host 时，明确写“未验证”，不要声称完成。

## 9. 依赖与生成锁

根 `package-lock.json` 是依赖 ground truth。coding-agent 还发布生成的：

- `packages/coding-agent/npm-shrinkwrap.json`；
- `packages/coding-agent/install-lock/package.json`；
- `packages/coding-agent/install-lock/package-lock.json`。

更新依赖后：

```bash
npm run shrinkwrap:coding-agent
npm run install-lock:coding-agent
npm run check
```

直接外部依赖使用精确版本。新增 lifecycle script dependency 必须先审查并更新显式 allowlist。提交 lockfile 时遵守 pre-commit gate，不绕过供应链检查。

## 10. 文档与 ADR

修改以下内容时同步文档：

- Profile/WorkSpace/Session 语义；
- Runtime provider ownership 或 lifecycle；
- public command、protocol 或 storage；
- import/export 与 portable manifest；
- DSH native capability 或限制；
- validation/rollback 要求。

长期产品决定写入 ADR；领域术语更新 `CONTEXT.md`；复杂证据链放入 `docs/investigations/`。调查文档不能替代 ADR。

用户文档保持中文默认、英文镜像。首页和教程写工作流，不堆内部接口；类型与协议细节链接 reference 页面。

## 11. Upstream 同步

Meldra 维护精确 upstream Pi baseline 与可审计 patch commits。升级时：

1. 确认 upstream tag/commit；
2. 记录干净工作树和测试 baseline；
3. 使用 merge 保留历史，不用复制覆盖 Meldra 文件；
4. 解决冲突时保护普通 Pi 合同和 Meldra ownership boundary；
5. 重新生成 lock/shrinkwrap/install lock；
6. 运行普通 Pi、default Profile、`pi` compatibility 和 DSH 聚焦验证；
7. 记录 upstream baseline 与 patch commits。

不要把 Meldra identity、自更新源或 Profile 行为机械改回 `pi`。

## 12. 调试

常用入口：

- `meldra --verbose`：显示启动信息；
- `/debug`：写 TUI 渲染和最后模型消息到当前 agentDir 的 debug log；
- `meldra profile status`：确认 Profile、agentDir、cwd 与 binding；
- `/session` 或 DSH `/session`：查看当前状态域；
- `/dsh trajectory`、`/dsh evidence`：查看 Harness 原生事实；
- `git diff --check`：提交前检查 whitespace。

日志中不得输出完整 credential。外部 Runtime 错误保留 stable code 与必要 redacted context，不转换为假成功。

## 13. 本地发行与发布边界

本地打包验证：

```bash
npm run release:local
```

它执行模型数据、检查、构建、隔离测试、pack 和隔离安装 smoke。选项见 `scripts/local-release.mjs --help`。

当前没有权威 Meldra package name、latest-version source 或 changelog 服务，因此：

- 不启用 self-update；
- 不用 Pi npm 包作为 Meldra 更新目标；
- 不在未经批准时 publish、tag 或 push；
- 本地 launcher 只代表当前 checkout，不代表发行验收。

## 14. 完成清单

提交前确认：

- 用户批准范围已实现，没有邻接扩张；
- 普通 Pi、default、`pi` compatibility 和受影响 Runtime 的合同保持；
- 聚焦测试、build、`npm run check` 和 `git diff --check` 结果已记录；
- 需要的真实 TUI/Runtime 验证已完成；
- 文档、ADR、Todo 与实现一致；
- rollback 是明确 commit/file/state 操作；
- 没有真实 credential、用户 Session、cache 或临时 fixture 进入提交；
- 每个可运行切片单独提交。

## 相关参考

- [Meldra 使用教程](user-guide.md)
- [Pi Development](../packages/coding-agent/docs/development.md)
- [Extension API](../packages/coding-agent/docs/extensions.md)
- [Profile Runtime providers](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness](../packages/coding-agent/docs/deepseek-harness.md)
- [Profile Config 注册规范](extensions/profile-config-protocol.md)
- [贡献说明](../CONTRIBUTING.md)
