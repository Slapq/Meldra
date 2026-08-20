# Meldra Hook 编写与开发

[中文](hooks.md) | [English](hooks.en.md) | [返回首页](README.md)

Meldra Hook 是跨 Agent Runtime 的 out-of-band 干预。它由用户配置触发，不是 Extension，也不是模型选择的工具。Native Pi 和 DeepSeek Harness (DSH) 使用同一套 Hook 配置与 Decision 协议，但各自在自己拥有的 Agent loop 内执行生命周期映射。

Hook Handler 的 stdout、stderr、reason 和结构化输出不会成为模型 Prompt 内容。Hook Decision 可以阻止用户输入或工具执行、修改 Native Pi 工具参数，或者通过 Meldra 固定的 Runtime-owned 控制消息请求一次 Stop continuation。

工作实现位于 [`packages/coding-agent/examples/hooks/`](../packages/coding-agent/examples/hooks/)。低层字段、事件输入和兼容矩阵见 [Meldra Hooks 协议参考](../packages/coding-agent/docs/hooks.md)。

## 目录

- [Quick Start](#quick-start)
- [配置位置与作用域](#配置位置与作用域)
- [Command Handler](#command-handler)
- [事件](#事件)
- [Matcher](#matcher)
- [if 条件](#if-条件)
- [输入协议](#输入协议)
- [Decision 与退出码](#decision-与退出码)
- [Prompt 输出隔离](#prompt-输出隔离)
- [常用 Handler 模式](#常用-handler-模式)
- [/hooks 管理器](#hooks-管理器)
- [热重载](#热重载)
- [Native Pi 与 DSH](#native-pi-与-dsh)
- [安全](#安全)
- [调试](#调试)
- [开发 Hook 协议](#开发-hook-协议)
- [开发 Runtime Adapter](#开发-runtime-adapter)
- [测试与验证](#测试与验证)
- [参考](#参考)

## Quick Start

### 1. 创建 Handler

在受信项目中创建 `.pi/hooks/audit.mjs`：

```js
#!/usr/bin/env node

const MAX_INPUT_CHARS = 1_000_000;
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > MAX_INPUT_CHARS) throw new Error("Hook input is too large");
}

const input = JSON.parse(raw);
console.error(`[hook] ${input.hook_event_name} session=${input.session_id}`);
```

Handler 必须从 stdin 读取一个 JSON 对象。不要从命令行参数猜测 Session、事件或工具输入。

### 2. 添加配置

将以下内容合并到受信项目的 `.pi/settings.json`：

```json
{
  "hooks": {
    "AgentEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${MELDRA_PROJECT_DIR}/.pi/hooks/audit.mjs"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

不要覆盖文件中的其他 settings。

### 3. 检查配置

项目通过 Project Trust 后运行：

```text
/hooks
```

进入 `Agent 事件` -> `AgentEnd`。管理器会显示 Handler 来源、状态、matcher、condition 和 command。

### 4. 修改并验证

保存 `.pi/settings.json` 后，配置通常在约 600 ms 内生效。修改 `.mjs` 文件不需要 reload，下一次事件会启动新 Node 进程并读取新代码。

## 配置位置与作用域

### Profile Hook

Profile Hook 作用于该 Profile 的所有项目：

```text
<profile-agentDir>/settings.json
<profile-agentDir>/hooks/
```

Profile 配置应使用 Handler 脚本的绝对路径。

### Project Hook

Project Hook 只在 Project Trust 通过后读取和执行：

```text
<cwd>/.pi/settings.json
<cwd>/.pi/hooks/
```

普通 Meldra Profile 将这两个根级 `hooks/` 目录作为 Hook 资源目录。保留的 `pi` Compatibility Profile 不加载 Meldra Hooks，并继续把 `hooks/` 视为旧版 Pi Extension 目录。

### 合并顺序

解析顺序是：

```text
Profile handlers
-> Project handlers
-> 完全相同的 event + matcher + handler 去重
```

Project `disableAllHooks` 在显式存在时覆盖 Profile 值。Project Handler 不能通过复制声明来覆盖 Profile Handler；相同声明只执行一次。

## Command Handler

一个 command Handler 支持：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `type` | `"command"` | 必填 | 当前唯一 Handler 类型 |
| `command` | string | 必填 | 可执行文件或 shell command |
| `args` | string[] | 无 | 存在时使用 exec form，每个参数按字面量传递 |
| `timeout` | number | `600` | 正数，单位为秒 |
| `shell` | `"bash"` 或 `"powershell"` | 当前 shell | 仅 shell form 使用 |
| `if` | string | 无 | 仅工具事件支持的进程启动过滤器 |
| `disabled` | boolean | `false` | 保留配置，但不启动进程 |

Exec form：

```json
{
  "type": "command",
  "command": "node",
  "args": ["${MELDRA_PROJECT_DIR}/.pi/hooks/check.mjs"],
  "timeout": 10
}
```

Shell form：

```json
{
  "type": "command",
  "command": "./check.sh --strict",
  "shell": "bash",
  "timeout": 10
}
```

优先使用 exec form。它不会让 shell 重新解释参数，在 Windows 上也支持 `.cmd` shim。

每个 Handler 进程获得：

```text
cwd = 当前项目目录
CLAUDE_PROJECT_DIR = 当前项目目录
MELDRA_PROJECT_DIR = 当前项目目录
stdin = 一个 Hook input JSON 对象
```

`${CLAUDE_PROJECT_DIR}` 和 `${MELDRA_PROJECT_DIR}` 也会在 exec-form command 和 args 中替换。

### 执行与清理

同一 Event 的所有 matching Handler 并行执行。任意 blocking Decision 最终获胜，但不会阻止 sibling Handler 启动或完成；因此 Handler 不能依赖声明顺序或另一个 Handler 的副作用。

stdout 和 stderr 分别限制为 200,000 个字符，超出部分以 truncation marker 标记。Runner 使用 streaming UTF-8 decoder，能够正确处理跨 chunk 的多字节字符。只有 exit `0` 的 stdout JSON object 会解析为 structured output。

Timeout、AbortSignal、Session shutdown 和进程退出都会终止 tracked process tree。已经运行的进程继续使用启动时的代码与配置；配置或脚本修改只影响下一次 invocation。

## 事件

| Event | Matcher 输入 | 可以改变执行吗 | 主要用途 |
|---|---|---:|---|
| `SessionStart` | startup source | 否 | 外部初始化、通知、审计 |
| `UserPromptSubmit` | 无 | 可以阻止 | 输入预检 |
| `PreToolUse` | tool name | 可以阻止；Native 可改参数 | 工具策略和审批 |
| `PostToolUse` | tool name | 否 | 成功结果的外部审计 |
| `PostToolUseFailure` | tool name | 否 | 失败结果的外部审计 |
| `AgentStart` | 无 | 否 | Agent 执行通知 |
| `AgentEnd` | 无 | 否 | Agent 完成通知和外部自动化 |
| `TurnStart` | 无 | 否 | 模型调用开始审计 |
| `TurnEnd` | 无 | 否 | 模型调用结束审计 |
| `Stop` | 无 | 可以请求 continuation | 继续当前任务 |
| `SessionEnd` | shutdown reason | 否 | 关闭和清理 |

`AgentStart`、`AgentEnd`、`TurnStart` 和 `TurnEnd` 是 notification-only。它们的 exit `2` 不会回滚已经发生的生命周期。

## Matcher

Matcher 位于 Handler group：

```json
{
  "matcher": "Bash|Write",
  "hooks": [
    { "type": "command", "command": "node", "args": ["check.mjs"] }
  ]
}
```

规则：

- 缺省、空字符串或 `"*"` 匹配全部；
- `Bash|Write` 和 `Bash, Write` 是精确 alternatives；
- 其他字符串是 JavaScript regular expression，不自动加 anchors；
- 无效正则产生配置诊断，该 group 不执行。

内置工具映射：

| Runtime tool | Hook name |
|---|---|
| `bash` | `Bash` |
| `pwsh` | `PowerShell` |
| `read` | `Read` |
| `edit` | `Edit` |
| `write` | `Write` |
| `grep` | `Grep` |
| `find` | `Glob` |
| `ls` | `LS` |

Custom 和 MCP tool name 保持原值。

## `if` 条件

`if` 只用于减少明显无关的 `PreToolUse`、`PostToolUse` 和 `PostToolUseFailure` 进程启动：

```json
{
  "type": "command",
  "if": "Bash(git *)",
  "command": "node",
  "args": ["check-git.mjs"]
}
```

支持：

```text
Tool
Tool(*)
Tool(glob)
Tool(param:value)
mcp__github__*
```

示例：

```text
Bash(rm *)
PowerShell(Remove-Item *)
Edit(src/**)
*(.env*)
custom_tool(mode:strict*)
WebFetch(https://example.com/*)
```

文件路径使用 minimatch 风格的 `*` 和 `**`。Windows 分隔符会规范化为 `/`。

`if` 不是权限边界。复杂 shell syntax、引号、substitution、redirect、环境变量赋值和 wrapper 无法可靠解释时会 fail-open，让 Handler 继续执行。最终判断必须由 Handler 或 Runtime policy 完成。

## 输入协议

所有 Event 都接收：

```json
{
  "session_id": "session-id",
  "cwd": "/workspace",
  "hook_event_name": "PreToolUse"
}
```

工具事件增加：

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "call-id"
}
```

事件专属字段：

| Event | 字段 |
|---|---|
| `SessionStart` | `source` |
| `UserPromptSubmit` | `prompt` |
| `PostToolUse` | `tool_response` |
| `PostToolUseFailure` | `tool_response`, `error` |
| `TurnStart`, `TurnEnd` | `turn_index`, `timestamp` |
| DSH Turn events | `runtime_turn`, `runtime_step` |
| `Stop` | `stop_hook_active` |
| `SessionEnd` | `reason` |

Native Pi 在 Session 有持久文件时还提供 `transcript_path`。DSH 不伪造 Pi transcript path。

输入可能包含 prompt、工具参数和工具结果。不要原样写入日志或发送到网络。

## Decision 与退出码

### Exit `0`

表示成功。stdout 以 JSON object 开头时会解析为 structured output。Plain stdout 不构成 Decision，并由 Runtime Adapter 丢弃。

### Exit `2`

- `UserPromptSubmit`：阻止 Prompt 发送；
- `PreToolUse`：阻止工具执行；
- `Stop`：请求一次受保护 continuation；
- notification-only 和 post-tool Event：Decision 被忽略并产生诊断。

### 其他退出码

非阻塞错误。stderr 进入 TUI 或 Runtime diagnostic，不进入模型上下文。

多个 matching Handler 并行执行。任意 block/deny 获胜；allow 只表示该 Handler 没有异议，不能覆盖 sibling denial、Runtime sandbox 或 approval policy。

### Structured decisions

PreTool deny：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Protected command"
  }
}
```

DSH ask：

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "ask",
    "permissionDecisionReason": "Confirm in the Runtime approval UI"
  }
}
```

Native updated input：

```json
{
  "hookSpecificOutput": {
    "updatedInput": {
      "command": "npm test"
    }
  }
}
```

Stop continuation：

```json
{
  "decision": "continue"
}
```

Stop 也兼容 exit `2` 和 `decision: "block"`。`stop_hook_active` 用于避免 immediate continuation loop。

## Prompt 输出隔离

Handler output 与 Hook Decision 是不同对象。

Handler 可以输出私有 reason：

```text
customer policy 42 denied this command
```

该文本只进入用户 UI 或 Runtime diagnostic。模型看到的工具拒绝始终是：

```text
Tool execution blocked by a Meldra Hook.
```

Stop continuation 的模型控制文本始终是：

```text
Continue the current task.
```

Native 和 DSH 使用相同常量。Handler stdout、stderr、reason 或 JSON 字段不会插入这两个消息。

`additionalContext` 不受支持。返回该字段会产生诊断并被忽略：

```text
additionalContext ignored; Hook output cannot enter Prompt
```

需要修改 system prompt、用户 Prompt 或模型上下文时，应使用 Runtime-native Extension、Preset、Skill 或 Agent loop API，而不是 Hook。

## 常用 Handler 模式

以下模式复用同一个 bounded stdin reader：

```js
async function readHookInput() {
  const MAX_INPUT_CHARS = 1_000_000;
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > MAX_INPUT_CHARS) throw new Error("Hook input is too large");
  }
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Hook input must be an object");
  }
  return input;
}
```

### 外部通知

```js
#!/usr/bin/env node

const input = await readHookInput();

if (input.hook_event_name !== "AgentEnd") process.exit(0);
// Call an explicitly configured local notification program here.
```

### 工具阻止

```js
#!/usr/bin/env node

const input = await readHookInput();

const command = String(input.tool_input?.command ?? "");
if (/\brm\s+-rf\b/.test(command)) {
  console.error("Recursive forced removal requires manual review");
  process.exit(2);
}
```

Handler reason 会显示给用户，但模型只收到固定 generic block message。

### Stop continuation

```js
#!/usr/bin/env node

const input = await readHookInput();

if (input.stop_hook_active !== true && shouldContinueExternally()) {
  process.stdout.write(JSON.stringify({ decision: "continue" }));
}

function shouldContinueExternally() {
  return false;
}
```

不要把下一步指令放入 Handler 输出。Runtime 只使用 Meldra 固定 continuation control。

### 脱敏审计

只记录 metadata：

```js
const row = {
  timestamp: new Date().toISOString(),
  hook_event_name: input.hook_event_name,
  session_id: input.session_id,
  tool_name: input.tool_name,
  tool_use_id: input.tool_use_id,
};
```

不要默认记录 `prompt`、`tool_input`、`tool_response`、`error`、stdout 或 stderr。

## `/hooks` 管理器

`/hooks` 是专用 Hook resource manager，不是 `/config` scalar form。

导航层级：

```text
首页
-> Session / Agent / Turn / Tool 分类
-> Event
-> Handler
-> 编辑 / 禁用或启用 / 删除
-> JSON editor
```

管理操作提供：

- Profile / Project scope；
- JSON import；
- `disableAllHooks`；
- Hook shell path；
- 完整 source-local Hook JSON；
- diagnostics；
- English / 中文。

Language preference 保存在：

```text
<profile-agentDir>/plugin-configs/meldra-hooks.json
```

### Import

接受 direct Hook map：

```json
{
  "AgentEnd": [
    { "hooks": [{ "type": "command", "command": "node", "args": ["notify.mjs"] }] }
  ]
}
```

也接受 settings envelope：

```json
{
  "hooks": { "AgentEnd": [] },
  "disableAllHooks": false,
  "shellPath": "/bin/bash"
}
```

`Merge` 按 Event 追加、合并相同 matcher group，并去除相同 Handler。`Replace` 只替换 import 中出现的 Hook 字段。两者都要求确认。本地 JSON 文件上限为 1,000,000 bytes。Import 不执行脚本、不复制文件、不安装 Package，也不读取 URL。

## 热重载

Meldra 监听：

```text
<profile-agentDir>/settings.json
<trusted-project>/.pi/settings.json
```

只重新读取：

```text
hooks
disableAllHooks
shellPath
```

有效快照原子替换 last-known-good，并通过相同 RPC 推送到 active DSH worker。无效 JSON、schema、matcher 或 condition 只产生诊断，不替换当前配置。

Watcher 使用内容 fingerprint，因此识别：

- 创建；
- 删除；
- atomic rename；
- 相同文件大小的内容变化。

修改 Handler 脚本不依赖 settings watcher。每次 Event 都启动新进程。

## Native Pi 与 DSH

| 能力 | Native Pi | DSH |
|---|---|---|
| Profile/Project config | 支持 | 支持，同一 resolved snapshot |
| Prompt preflight block | exact `input` | approximate `agent/pre-step` reject |
| PreTool deny | 支持 | 支持 |
| PreTool ask | Runtime 自有权限面 | 支持 DSH ask |
| `updatedInput` | 支持 | 不支持，参数已冻结 |
| PostTool output mutation | 不支持 | 不支持 |
| Agent lifecycle | native exact | `agent/status` approximate |
| Turn lifecycle | native model turn | DSH step |
| Stop continuation | fixed hidden follow-up | fixed `agent.steer` message |
| SessionEnd | awaited shutdown | approximate disposed + drain |

Runtime Adapter 必须把 approximate 标成 approximate，把 unsupported 标成 unsupported。不能为了表面一致而修改 DSH durable log、绕过 frozen arguments 或在 Host 复制外部 Agent loop。

## 安全

Hook 是可执行配置，权限与 Meldra 进程相同。

最低要求：

1. Project Hook 只在 Project Trust 后加载。
2. 使用 exec form 和 literal args，除非确实需要 shell。
3. 不把 token、Cookie 或 API key 放在 command、args、日志或示例中。
4. 对 stdin 设置大小上限。
5. 对自己的文件和网络输出设置大小上限。
6. 使用最短合理 timeout。
7. Handler 必须可重复执行，并处理并行调用。
8. Stop Handler 必须检查 `stop_hook_active`。
9. 不把 `if` 当作安全边界。
10. 不把 Hook payload 默认发送到 HTTP endpoint。

Command Handler 默认是 foreground。当前协议不支持 detached/background Handler。

## 调试

### `/hooks` 显示 diagnostic

常见原因：

- event name 不支持；
- matcher regex 无效；
- `hooks` 不是非空数组；
- command 为空；
- args 不是 string array；
- timeout 不是正数；
- shell 不是 `bash` 或 `powershell`；
- `if` 用在非工具事件；
- `additionalContext` 被拒绝。

### Handler 没有执行

检查：

1. `/hooks` 中 effective state 是否 enabled；
2. Handler 或 Event 是否 disabled；
3. Project Trust 是否通过；
4. matcher 是否匹配 canonical tool name；
5. `if` 是否匹配输入；
6. command 路径是否相对当前 `cwd`；
7. DSH 是否支持该 Decision。

### 脚本修改没有生效

确认修改的是配置实际引用的文件。Profile script、Project script、仓库 example 和已部署副本可能是不同文件。

### Windows

- Exec form 可以启动 `.cmd` shim；
- Node args 中使用 `/` 路径分隔符；
- PowerShell shell form 使用 `shell: "powershell"`；
- timeout 和 shutdown 会终止整个 tracked process tree。

## 开发 Hook 协议

本节面向 Meldra 维护者。修改前先阅读：

- [ADR 0045](adr/0045-cross-runtime-out-of-band-hooks.md)
- [Profile Runtime 合同](../packages/coding-agent/docs/profile-runtimes.md)
- [DSH Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [低层 Hook 参考](../packages/coding-agent/docs/hooks.md)
- [Agent 治理](../AGENTS.md)

### 模块边界

| 模块 | 所有权 |
|---|---|
| `src/hooks/types.ts` | 公共事件和配置类型 |
| `src/hooks/config.ts` | schema、merge、matcher、execution filter |
| `src/hooks/condition.ts` | `if` 安全子集 |
| `src/hooks/decisions.ts` | 跨 Runtime Decision normalization 和固定控制消息 |
| `src/hooks/command-runner.ts` | 进程、stdin/stdout、timeout、cleanup |
| `src/hooks/settings-watcher.ts` | Hook-only live settings watcher |
| `src/hooks/management.ts` | import、merge、CRUD pure functions |
| `extensions/meldra-hooks/` | Native Adapter、TUI、i18n |
| `extensions/dsh/hooks.ts` | DSH Cordis Runtime Adapter |
| `core/settings-manager.ts` | Profile/Project Hook-layer storage |

不要把外部 Runtime 的 Agent loop 逻辑移动到 `src/hooks/` 或 generic Pi core。

### 添加 Event

添加 Event 需要同时完成：

1. 在 `MELDRA_HOOK_EVENTS` 添加稳定名称；
2. 定义 portable input；
3. 决定 matcher 输入；
4. 指定 Decision 类型；
5. 为 Native 找到真实 lifecycle seam；
6. 为每个外部 Runtime 标记 exact、approximate 或 unsupported；
7. 更新 TUI 分类；
8. 更新文档矩阵；
9. 增加 Native 和 DSH tests；
10. 验证 shutdown 和 hot reload。

不能仅凭事件名称推断两个 Runtime 语义相同。

### 添加 Decision

Decision normalization 必须位于 `src/hooks/decisions.ts`，Adapter 只做 Runtime mapping。

新 Decision 必须回答：

- 是否会阻止已发生的操作；
- 是否改变模型可见内容；
- Handler raw output 是否可能泄漏；
- 多个 Handler 冲突时的 precedence；
- Runtime 不支持时是 ignore、warning 还是 hard failure；
- 是否需要 loop guard；
- 是否影响 durable Session。

任何模型可见 control 都必须是固定 Runtime-owned 文本，不能插入 Handler output。

### 添加 Handler 类型

当前只有 `command`。新增 HTTP、MCP 或其他 Handler 前必须单独定义：

- ownership；
- authentication；
- SSRF 和 redirect policy；
- payload redaction；
- timeout 和 response bound；
- retry semantics；
- cancellation；
- Native/DSH consistency；
- TUI、hot reload 和 diagnostics。

不要把 command runner 包装成隐式网络 Handler。

## 开发 Runtime Adapter

一个 Runtime Adapter 最少实现：

1. 接收 resolved in-memory snapshot；
2. 在 Runtime-owned lifecycle seam 内触发 Event；
3. 构造 portable input；
4. 调用 shared matcher、condition 和 Decision helpers；
5. 保证 Handler output 不进入 Prompt；
6. 用固定 generic block/continuation control；
7. 报告 unsupported 或 approximate；
8. 串行化需要顺序的 lifecycle notifications；
9. 在 shutdown 时 drain 或终止进程；
10. 不把 Hook config 写进 Runtime credentials/settings。

### Native Adapter

Native Adapter 是 hidden inline Extension。它使用 Pi Extension events，但 Hook 仍不是用户 Extension。Tool 参数只有在 `tool_call` mutable input seam 中才能修改。

### DSH Adapter

DSH Adapter 是注入 Harness 的 Cordis plugin：

```text
meldra-command-hooks
```

它通过 `meldra/hooks.configure` 接收 snapshot。必须使用公开 DSH seams，例如：

```text
agent/pre-step
tools/pre-execute
tools/post-execute
agent/turn-stopping
agent/status
session/event
agent/disposed
```

禁止 monkey-patch `ReactLoopAgent`、修改私有 phase、劫持 `deriveMessages()` 或在 Host 创建第二个 DSH Agent loop。

## 测试与验证

### Handler 单元验证

通过 stdin 运行脚本：

```bash
printf '%s' '{"session_id":"test","cwd":"/tmp/project","hook_event_name":"AgentEnd"}' \
  | node .pi/hooks/audit.mjs
```

Windows PowerShell：

```powershell
'{"session_id":"test","cwd":"C:/work","hook_event_name":"AgentEnd"}' |
  node .pi/hooks/audit.mjs
```

不要在验证中调用真实网络、凭据、桌面程序或生产脚本，除非用户明确授权。

### Focused tests

```bash
npm --prefix packages/coding-agent test -- \
  meldra-hooks-config.test.ts \
  meldra-hooks-condition.test.ts \
  meldra-hooks-decisions.test.ts \
  meldra-hooks-runner.test.ts \
  meldra-hooks-native.test.ts \
  metapi-dsh-hooks.test.ts
```

管理和热重载：

```bash
npm --prefix packages/coding-agent test -- \
  meldra-hooks-management.test.ts \
  meldra-hooks-hot-reload.test.ts \
  meldra-hooks-directory-owner.test.ts \
  meldra-hook-examples.test.ts
```

### 完成矩阵

协议或 Adapter 修改至少验证：

- valid/invalid schema；
- Profile/Project merge 和 Trust；
- global/Event/Handler disabled；
- matcher 和 condition；
- exit `0`、`2`、error、timeout、abort；
- UTF-8 split chunks；
- stdout/stderr bound；
- Prompt output isolation；
- fixed block 和 continuation controls；
- Native/DSH Decision parity；
- DSH notification order；
- watcher create/delete/atomic replace；
- last-known-good；
- shutdown drain 和 process-tree cleanup；
- `/hooks` 60/80/120 列；
- `pi` Compatibility hooks-directory warning；
- ordinary Meldra hooks-directory ownership。

构建与全量验证：

```bash
npm --prefix packages/coding-agent run build
npm --prefix packages/coding-agent test
npm run check:pinned-deps
npm run check:ts-imports
npm run check:shrinkwrap
npm run check:install-lock:coding-agent
```

测试通过不等于真实 Runtime、真实 TUI、浏览器、网络或部署已经验证。报告必须区分这些状态。

## 参考

- [Meldra Hooks 协议参考](../packages/coding-agent/docs/hooks.md)
- [Hook examples](../packages/coding-agent/examples/hooks/)
- [Settings](../packages/coding-agent/docs/settings.md)
- [Profile Runtime provider 合同](../packages/coding-agent/docs/profile-runtimes.md)
- [DeepSeek Harness Runtime](../packages/coding-agent/docs/deepseek-harness.md)
- [Pi Extension API](../packages/coding-agent/docs/extensions.md)
- [TUI Components](../packages/coding-agent/docs/tui.md)
- [ADR 0045](adr/0045-cross-runtime-out-of-band-hooks.md)
- [HTTP Handler 安全评估](investigations/2026-08-21-meldra-http-hook-handler-evaluation.md)
