# MetaPi Starter 插件开发指南

本文是 MetaPi Starter Profile 插件的源码级开发手册，面向维护 Extension、Profile Config、Provider Manager、
Scout、工作流和 Setup 的开发者。

用户只需要了解命令时，先阅读 [Starter README](README.md)。Pi Extension API 的完整参考见
[Extensions](../docs/extensions.md)，自定义终端组件见 [TUI Components](../docs/tui.md)。

## 1. 维护范围

Starter Bundle 声明以下运行时入口：

| 入口 | 用户表面 | 主要职责 |
|---|---|---|
| `extensions/provider-manager.ts` | `/provider` | Provider 和模型目录管理 |
| `extensions/scout.ts` | `scout`、`/scout` | 隔离的只读侦察子进程 |
| `extensions/metapi-workflows.ts` | `/commands`、`/preset`、`/tools`、`/handoff` | 当前 Session 工作流 |
| `extensions/setup.ts` | `/setup` | Provider → 模型 → Scout 连续配置向导 |
| `extensions/questionnaire.ts` | `questionnaire` 工具 | Workflows 内嵌的结构化问询能力 |

`questionnaire.ts` 由 Workflows 直接导入，不是 `package.json` 中的独立 Extension 入口。

Profile Config Host 不属于 Starter Bundle。它是普通 MetaPi Profile 自动加载的 hidden inline Extension：

```text
packages/coding-agent/src/extensions/metapi-config/index.ts
```

它提供 `/config` 和 `config:*` 事件协议。保留的 `pi` Compatibility Profile 不加载该 Host。

### 不在本手册维护范围内的对象

- `packages/coding-agent/examples/extensions/` 中的官方示例不是默认安装插件；
- Skills、Prompt Templates 和 Themes 不是可执行 Extension；
- DSH、llama.cpp、Profile 和 WorkSpace 是独立产品能力；
- 当前机器额外安装的第三方 Package 以各自 README 和源码为准。

完整 Extension 术语和库存见 [Extension Index](../../../docs/extensions/README.md)。

## 2. 源码、部署副本与加载关系

### 2.1 权威源码

Starter 权威源码位于：

```text
packages/coding-agent/starter-profile/
├── package.json
├── README.md
├── DEVELOPMENT.md
└── extensions/
    ├── provider-manager.ts
    ├── scout.ts
    ├── metapi-workflows.ts
    ├── questionnaire.ts
    └── setup.ts
```

`package.json.pi.extensions` 只声明四个顶层入口。不要把 `questionnaire.ts` 再声明为入口，否则会重复注册工具。

### 2.2 Profile 部署副本

`metapi setup` 将 Starter 复制到默认 Profile 的本地 Package 存储，并在 Profile settings 中保留一个相对 Package
条目。典型部署位置是：

```text
<profile-agentDir>/packages/metapi-starter/
```

源码修改不会自动进入已部署 Profile。开发者需要明确区分：

```text
仓库源码修改
→ build / focused tests
→ metapi setup 恢复部署副本
→ 启动新的 MetaPi 进程进行真实 TUI 验证
```

直接修改部署副本只适合本机诊断；后续 `metapi setup` 可能用 Starter 权威源码重新恢复它。最终修复必须回到仓库源码。

### 2.3 Extension 生命周期

Starter Extension factory 在 Runtime 加载时执行并注册命令、工具、事件和配置。`/reload` 会销毁旧 Session Runtime、
重新加载可热重载 Extension，并重新触发 `session_start`。

开发规则：

- factory 只做注册和轻量同步初始化；
- 长生命周期进程、timer、watcher 在 `session_start` 或实际操作时创建；
- 在 `session_shutdown` 中进行幂等清理；
- 调用 `await ctx.reload()` 后立即 `return`，不要继续使用旧 Runtime 状态；
- TUI 专属命令先检查 `ctx.mode === "tui"`；
- 没有 UI 的模式不得假装交互操作成功。

## 3. 配置归属和优先级

不同文件属于不同状态域，不能因为都位于 `agentDir` 就互相替代。

| 状态 | 路径 | 所有者 | 生命周期 |
|---|---|---|---|
| Profile 插件 scalar config | `<agentDir>/plugin-configs/<id>.json` | 当前 Profile | 保存后持续存在 |
| Provider Manager 语言 | `<agentDir>/plugin-configs/provider-manager.json` | 当前 Profile | 持续存在 |
| Scout legacy fallback | `<agentDir>/scout.json` | 旧版 Profile | 只读兼容来源 |
| 共享用户模型目录 | `~/.metapi/user/models.json` 的实际解析路径 | MetaPi 用户资产 | 普通 Profile 共享 |
| `pi` Profile 模型目录 | `<pi-agentDir>/models.json` | Pi Compatibility Profile | 与普通 Profile 隔离 |
| 工作流 Profile Presets | `<agentDir>/presets.json` | 当前 Profile | 跨项目复用 |
| 工作流项目 Presets | `<cwd>/.pi/presets.json` | 当前可信项目 | 同名覆盖 Profile Preset |
| Preset/工具当前状态 | Pi Session custom entries | 当前 Session 分支 | 随分支恢复 |
| 一次 Scout 参数 | `scout` tool arguments | 单次工具调用 | 不持久化 |

不得把运行时读到的值静默写入另一层，也不得把 Session 选择自动升级为 Profile 持久配置。

## 4. Profile Config Host

### 4.1 职责边界

Config Host 只负责：

1. 接收插件同步注册的字段 schema；
2. 渲染统一 `/config` TUI；
3. 读取和保存 Profile-local JSON；
4. 保存完成后发送 `config:updated:<id>`。

它不负责：

- 判断某个配置何时生效；
- 测试第三方服务；
- 修改环境变量；
- 加密 `secret` 字段；
- 把配置同步到其他 Profile、项目或 Session；
- 管理 Provider、模型、文件集合等复杂资源。

完整硬合同见：

- [Profile Config 注册规范（中文）](../../../docs/extensions/profile-config-protocol.md)
- [Profile Config Registration Protocol](../../../docs/extensions/profile-config-protocol.en.md)

### 4.2 注册模板

```ts
pi.events.emit("config:register", {
  id: "my-plugin",
  label: { en: "My Plugin", zh: "我的插件" },
  icon: "P",
  fields: [
    { type: "section", label: { en: "Connection", zh: "连接" } },
    { key: "endpoint", label: "Endpoint", type: "string" },
    { key: "model", label: "Model", type: "string", completions: () => ["provider/model"] },
    { key: "token", label: "Token", type: "secret", envVar: "MY_PLUGIN_TOKEN" },
    { key: "timeout", label: "Timeout", type: "number", min: 1, max: 300 },
    { key: "enabled", label: "Enabled", type: "boolean" },
    { key: "mode", label: "Mode", type: "select", options: ["fast", "balanced"] },
  ],
  defaults: {
    endpoint: "https://example.test",
    token: "",
    timeout: 30,
    enabled: true,
    mode: "balanced",
  },
});
```

`string` 字段可以提供运行时 `completions(): string[]`。Config Host 在用户按 `Tab` 时按当前前缀补全；候选为空或不匹配时，`Tab` 仍执行下一字段导航。补全字段仍然是可编辑字符串，因此允许保存候选列表之外的显式值；函数和候选值不会写入 JSON。


```ts
let config: Record<string, unknown> = {};
pi.events.emit("config:get", {
  id: "my-plugin",
  callback(value) {
    config = value;
  },
});
```

即时应用保存值：

```ts
pi.events.on("config:updated:my-plugin", (value) => {
  config = normalizeConfig(value);
});
```

### 4.3 开发约束

- `id` 必须稳定且不得包含路径分隔符；
- 所有默认值必须可 JSON 序列化；
- `config:get` 是 defaults 与存储对象的顶层浅合并，不是深合并；
- 插件必须验证读取值，不能把 JSON 当成可信 TypeScript 类型；
- `secret` 只代表遮罩显示，不能在日志、错误、tool details 或测试 fixture 中输出真实值；
- 使用结构化 `{ en, zh }` 文案，由 Host 统一决定语言；
- Reset 只重置草稿，用户 Save 后才落盘并发送更新事件；
- 插件文档必须声明保存后是立即生效、下次操作生效、`/reload` 生效还是重启生效。

## 5. Provider Manager

### 5.1 用户和代码入口

```text
命令：/provider
源码：extensions/provider-manager.ts
```

Provider Manager 使用多页 `ctx.ui.custom()` TUI：Provider 浏览器、Provider Overview、连接设置、模型浏览器、
模型编辑、Provider/模型高级兼容设置。

它没有注册 Profile Config 页面，因为 Provider 和模型是复杂资源，不是普通 scalar config。只有语言偏好使用
`plugin-configs/provider-manager.json`。

### 5.2 核心数据结构

`ProviderConfig` 包含：

```text
baseUrl, api, apiKey, headers, authHeader, compat, models[]
```

`ModelConfig` 包含：

```text
id, name, api, reasoning, input, contextWindow, maxTokens,
cost, compat, thinkingLevelMap
```

模型级 `api: ""` 的含义是继承当前 Provider。非空值是用户明确设置的模型级协议覆盖。

### 5.3 持久化和即时注册

保存 Provider 时：

1. 读取当前模型目录；
2. 序列化当前 Provider；
3. 写回模型目录；
4. 对编辑前的旧名称调用 `pi.unregisterProvider()`；
5. 调用 `pi.registerProvider()` 注册最新 Provider；
6. 当前 Session 立即看到新的 Provider 和模型。

普通 MetaPi Profile 使用共享用户模型目录；保留的 `pi` Profile 使用其 agent-local `models.json`。不要把两者合并。

API Key、headers 和模型目录属于真实运行时配置。测试应使用临时 `agentDir` 或脱敏 fixture，不得操作真实用户文件。

### 5.4 模型发现

只有用户显式执行 **Fetch Models from API** 时才能联网。打开页面、搜索、浏览或编辑不得发起请求。

发现流程：

```text
用户 Base URL + Provider API
→ 生成有限的模型列表候选 URL
→ 逐个请求并检查 HTTP 状态
→ 解析已知 models/data/result 形状
→ metadataFromRaw()
→ 按 ID 添加或补全本 Provider 的模型
```

合同：

- 发现是 additive，不删除本地模型；
- Escape 使用 `AbortSignal` 取消请求；
- 错误消息清理查询参数，不回显 key 或响应正文；
- ID-only 响应不能伪装成 rich metadata；
- 新发现模型的模型级 `api` 保持为空并继承 Provider；
- 已有人工模型级 API override 不因发现而改变；
- Provider API、Base URL 和显式模型 API 的含义不能由模型名称猜测；
- `google-generative-ai` 可记录实际成功的版本化发现路径，但用户显式填写的 `/v1` 或 `/v1beta` 必须保留；
- 不支持可移植模型列表端点的 API 返回明确 `UNSUPPORTED`。

模型发现和模型生成是不同协议能力。某个网关可能支持 `/v1/...:generateContent`，却只在
`/v1beta/models` 提供目录；不能仅凭目录端点推断运行时只能使用同一版本。

### 5.5 Metadata 补全

补全来源包括 Provider 响应和 Pi 内置模型目录。允许补全：

- display name；
- reasoning 标记；
- text/image input；
- context window；
- max output tokens；
- cost。

广义 ID 匹配只能提供 metadata，不能改写用户模型 ID。自动发现不能从全局目录节点复制模型级 API。
手工模型编辑页的 API Override 仍由用户控制。

### 5.6 TUI 维护规则

- 每个 `render(width)` 返回行都必须经过宽度约束；
- API Key 始终遮罩；
- 列表窗口固定高度，动态状态不能推挤导航项；
- 列表首项按上、末项按下必须允许焦点离开列表；
- 空列表也必须能到达 Add 和 Back；
- `Tab`/`Shift+Tab` 与上下键保持一致的焦点顺序；
- 异步发现期间 UI 错误必须在组件内捕获，不能让 rejected Promise 逃逸到输入调度器；
- 状态变更后调用 `tui.requestRender()`。

### 5.7 Provider Manager 验证矩阵

最低验证：

- TypeScript 转译或项目 type check；
- Provider 创建、编辑、复制、删除和取消；
- 模型列表有数据、单条和空列表的边界导航；
- 新发现模型继承 Provider API；
- 已有模型 API override 保留；
- API Key 在所有页面和错误中不明文显示；
- 发现取消、HTTP 错误、非 JSON、ID-only 和 rich metadata；
- Gemini 根 URL、显式 `/v1`、显式 `/v1beta`；
- 保存后当前 Session 可见，重启后持久化仍可见；
- 80 列和 120 列真实 PTY。

真实 Provider 请求会产生外部后果，必须使用明确授权的测试 endpoint 和脱敏凭据。

## 6. Scout

### 6.1 用户和代码入口

```text
工具：scout { task, cwd? }
命令：/scout（/config scout 的兼容别名）
配置 ID：scout
源码：extensions/scout.ts
```

Scout 是一次性、单回合、只读信息压缩工具。它不是主 Agent、Reviewer、产品决策者或嵌套子代理平台。

### 6.2 配置

| 字段 | 类型 | 默认值 | 生效时机 |
|---|---|---|---|
| `model` | string + runtime completions | 空，跟随主模型 | 下一次 Scout 调用 |
| `thinkingLevel` | select | `off` | 下一次 Scout 调用 |
| `injectGuidelines` | boolean | `true` | 下一次 `before_agent_start` |

新配置存储在：

```text
<agentDir>/plugin-configs/scout.json
```

`model` 字段保留任意 `provider/model-id` 输入；在字段中按 `Tab` 时，Config Host 调用 Scout 注册的运行时候选函数，从当前 `modelRegistry.getAll()` 补全。候选列表不会写入 Profile 配置，留空仍表示跟随主模型。

只有当 Profile Config 没有有效值时，才读取 legacy `<agentDir>/scout.json`；legacy 文件不会被 Scout 自动改写。

### 6.3 模型解析

配置模型格式是 `provider/model-id`。每次调用按当前 Model Registry 解析并检查凭据：

1. 配置模型存在且可认证：使用它；
2. 配置模型无效或不可认证：给出 warning，回退主模型；
3. 未配置模型：跟随主模型，并且每个 Session 最多提示一次；
4. 没有可用主模型：子进程会显式失败，不伪造报告。

显式 thinking 值必须原样传给子进程；未配置时使用 `off`。模型本身不支持 reasoning 时，Pi 可按自身能力约束为
`off`。

### 6.4 子进程合同

每次调用创建独立子进程，等价于：

```text
metapi --mode json -p --no-session --no-extensions
  --tools read,grep,find,ls,bash
  --thinking <configured-level>
  [--model provider/model-id]
```

完整 system prompt 通过权限受限的临时文件传递。子进程：

- 不创建 Session；
- 不加载其他 Extension；
- 只获得固定的读取/搜索工具；
- 获得一个自包含 task；
- 只执行一个 Agent turn；
- 将压缩报告返回父工具。

“只读”由固定工具集合和 Scout system prompt 共同约束。`bash` 仍是强能力，所以 system prompt 明确禁止写入、安装、
网络变更和递归大范围搜索。不要把 Scout 宣称为操作系统 sandbox。

### 6.5 超时、取消和清理

- 每个 Scout 有 10 分钟硬超时；
- 文件系统工具长时间无事件会触发 stall watchdog；
- 父工具的 `AbortSignal` 会中止子进程；
- Windows 使用 `taskkill /T /F` 清理整个进程树；
- `session_shutdown` 和 Node exit 都执行幂等清理；
- timeout 可返回明确标记的 partial findings；
- error 可返回诊断和已有 partial findings，但不能伪装成成功。

### 6.6 输出和 Session 边界

运行中 `onUpdate` 只保存紧凑 live details。完成后：

- 模型可见内容只包含最终压缩报告；
- 报告上限为 2000 行或 50KB；
- 父 Session details 只保存 task、cwd、模型、状态、工具 trail、usage 摘要和有限 stderr；
- 不把子 Session 的原始 messages 和完整 usage 树写入父 Session。

这条边界用于控制上下文和 JSONL 体积。修改 renderer 时不得重新持久化原始子消息。

### 6.7 Scout task 编写规范

好的 task 必须包含：

- 明确目录或文件范围；
- 可验证的问题；
- 需要返回的结构；
- 精度敏感时要求 `file:line`、symbol 和短原文；
- 所需背景，因为 Scout 没有当前对话记忆。

不要要求 Scout 评审、定风险等级、决定范围、设计修复或新增验收标准。这些判断属于主 Agent。

需要并行调查时，在同一 assistant message 发出多个独立 `scout` tool call；不要让一个 Scout 再派生 Scout。

### 6.8 Scout 验证矩阵

- Config Host 注册、读取、保存通知和 legacy fallback；
- `off` 默认值和 UI 推荐；
- 配置模型、主模型 fallback、无凭据和不存在模型；
- 相对/绝对 `cwd` 解析和不存在目录；
- 正常 JSON event stream、stderr、非零退出；
- 用户取消、硬超时、stall timeout 和 Windows process-tree cleanup；
- 50KB/2000 行截断；
- collapsed、expanded、running、timeout、error renderer；
- 父 Session 不包含原始 child messages；
- `/reload` 与 `session_shutdown` 后无残留进程。

## 7. MetaPi Workflows

### 7.1 表面和配置

Workflows 注册：

```text
/config metapi-workflows
--preset <name>
Ctrl+Shift+U
/commands [extension|prompt|skill]
/preset [name|off]
/tools [reset]
/handoff <goal>
questionnaire tool（默认 inactive）
```

配置字段：

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `commands` | `true` | 启用 `/commands` |
| `presets` | `true` | 启用 `/preset` 和快捷键 |
| `tools` | `true` | 启用 `/tools` |
| `handoff` | `true` | 启用 `/handoff` |
| `questionnaire` | `false` | 默认激活结构化问询工具 |
| `defaultPreset` | `""` | 新 Session 默认 Preset 名称 |

Boolean 开关关闭的是用户入口，不应注销命令或改变其他插件的注册。

### 7.2 Preset schema 和覆盖顺序

```json
{
  "review": {
    "provider": "provider-id",
    "model": "model-id",
    "thinkingLevel": "off",
    "tools": ["read", "grep", "find", "ls"],
    "instructions": "Review only the requested scope."
  }
}
```

加载顺序：

```text
<agentDir>/presets.json
→ <cwd>/.pi/presets.json（同名覆盖）
```

项目 Preset 只应在可信项目范围生效。Preset 中不存在的模型或工具被明确忽略/警告，不得创造虚假能力。

当前 Session 的工具优先级：

```text
Session 启动工具
→ Preset 工具基线
→ /tools 人工覆盖
```

切换 Preset 会清除旧的 `/tools` 人工覆盖；`/tools reset` 回到当前 Preset 基线。

### 7.3 Session 状态

Workflows 使用 custom entries：

```text
metapi-workflow-preset
metapi-workflow-tools
```

它在 `session_start` 和 `session_tree` 上重建当前分支的最后有效状态。不要只依赖进程内变量，否则 `/reload`、resume
或树导航后会与 Session 不一致。

### 7.4 Handoff

`/handoff <goal>`：

1. 读取当前分支；
2. 按最近 compaction 语义整理可发送消息；
3. 使用当前模型生成自包含交接草稿；
4. 允许用户编辑；
5. 创建关联的新 Session；
6. 把草稿放入新 Session 编辑器，用户确认后再发送。

取消生成、取消编辑或取消新 Session 不能显示成功。模型调用必须传递 loader 的 AbortSignal。旧 Session context 在
Session replacement 后失效，`withSession` 中只能使用 replacement context。

## 8. Questionnaire

Questionnaire 是 Workflows 内嵌工具，适合模型一次提出多项结构化问题。

开发边界：

- 参数根字段是 `questions`；
- 答案只通过 tool result 返回；
- 取消状态必须明确返回；
- 组件内状态不单独落盘；
- 默认 inactive，由 Workflows config 或显式 Preset tools 启用；
- 不得因为源码存在就自动加入 active tools；
- TUI 不可用时必须明确处理，不能假设 `ctx.ui.custom()` 有返回值。

修改该工具时同时验证 Workflows 的 active-tool 逻辑，避免出现重复注册或默认启用回归。

## 9. Setup

### 9.1 Setup 的两个阶段

CLI：

```text
metapi setup
```

负责安装或恢复 Starter Bundle，不执行 Provider 登录、模型选择或 Scout 配置。

TUI：

```text
/setup
```

负责连续编排：

```text
/login → /model → /scout
```

Setup 只调用已有命令，不复制这些命令的业务逻辑、UI 或持久化代码。

### 9.2 Readiness

Provider ready：至少一个可用模型具有已配置认证。

Model ready：当前 Session 已选择模型，并且该模型具有可用认证。

Scout ready：`scout.model` 能在当前 Model Registry 中解析且具有认证，同时 `thinkingLevel` 是合法枚举值。

状态只能是：

```text
configured | partial | unconfigured
```

`ctx.executeCommand()` 返回 `true` 只表示命令存在并已调度，不表示用户完成了配置。每步结束后必须重新读取权威状态。

### 9.3 交互和生命周期

- 仅 TUI 模式支持 `/setup`；
- 已配置步骤仍显示，并允许保留或重新配置；
- 未完成步骤允许重试、当前向导跳过或退出；
- 最终汇总可打开 `/config`；
- `session_start` 显示未完成提示和 keyed status；
- `model_select` 后刷新 readiness；
- Setup 不写凭据、模型选择或 Scout 配置；目标命令继续拥有这些写入。

## 10. 添加新的 Starter 插件

只有用户批准新的产品能力后才扩展 Bundle。最小流程：

1. 定义插件的用户路径、状态所有者、失败语义和不支持模式；
2. 在 `extensions/` 中创建默认 factory；
3. 若是普通 scalar config，使用 Profile Config 协议；
4. 若是复杂资源管理，明确自己的存储和 UI 边界；
5. 在 `package.json.pi.extensions` 增加唯一入口；
6. 更新 `README.md` 和本开发指南；
7. 更新 Setup 只在该能力属于已批准 onboarding 时进行；
8. 增加 focused tests；
9. 检查 Bundle 不含凭据、Session、机器路径或本地状态；
10. 运行 Setup 恢复并做真实 TUI 验证。

不要通过复制 `/config`、`/provider`、`/model` 或 `/login` 实现来增加入口。

## 11. TUI 开发规则

Starter 的复杂页面遵循 Pi TUI 合同：

- Component 实现 `render(width)`、`handleInput(data)` 和 `invalidate()`；
- 带输入光标的容器实现 `Focusable` 并向子 Input 传播 `focused`；
- 使用 `matchesKey()` 和 `Key.*`，不要解析原始 escape sequence；
- 每条输出行不得超过 `width`，使用 `truncateToWidth()`；
- 状态改变后调用 `tui.requestRender()`；
- `invalidate()` 清除主题相关缓存；
- 异步操作提供 Escape/AbortSignal；
- 固定格式列表定义稳定高度，避免状态文字导致布局跳动；
- 所有可聚焦区域都必须有可达的进入和退出路径；
- 80 列下不能重叠或隐藏 Save、Cancel、Back 等关键操作。

通用选择使用 `SelectList`，设置使用 `SettingsList`，可取消异步操作使用 `BorderedLoader`。只有产品交互超出这些组件
能力时才实现自定义状态机。

## 12. 错误、凭据和外部后果

- 工具失败通过 throw 或明确 error result 表达，不返回空成功；
- 命令取消和失败不得显示“已保存”“已安装”“已切换”；
- API key、token、Cookie 和 secret 不进入源码、README、日志、截图、fixture 或 tool details；
- 错误可包含脱敏 endpoint、HTTP 状态和稳定错误码，不包含认证查询参数和远端响应正文；
- 网络发现、模型调用、安装、删除和 Session replacement 必须保留真实取消/失败状态；
- 文档中的 key 一律使用占位符；
- `secret` 字段不是加密存储；
- 不要为普通功能自动增加锁、事务发布、崩溃恢复或扫描系统。

## 13. 验证

### 13.1 静态检查

在仓库根目录执行：

```bash
npm run check
npm run build
```

只验证 coding-agent 时：

```bash
npm --workspace @earendil-works/pi-coding-agent run build
npm --workspace @earendil-works/pi-coding-agent test -- --run
```

独立 Profile 部署副本可能无法解析 monorepo 类型；这种情况下可用仓库 TypeScript 的 `transpileModule` 做纯语法检查，
但不能把它报告成完整 type check。

### 13.2 Focused tests

至少覆盖：

```text
packages/coding-agent/test/metapi-config-extension.test.ts
packages/coding-agent/test/metapi-starter-setup.test.ts
packages/coding-agent/test/metapi-starter-wizard.test.ts
packages/coding-agent/test/agent-session-dynamic-provider.test.ts
```

修改特定插件时增加该插件的直接行为测试，不用全仓库通过替代 focused regression。

### 13.3 Bundle 审计

验证：

- `package.json` 可解析；
- manifest 声明的每个入口存在；
- `questionnaire.ts` 没有被重复声明；
- 没有凭据、Session fixture、绝对机器路径或 `node_modules`；
- README 和 DEVELOPMENT 的相对链接有效；
- Setup 重复执行保持幂等并保留已有 `plugin-configs`。

### 13.4 真实验收

仓库测试不等于真实 TUI。发布前至少在隔离 HOME/Profile 中验证：

- 80 和 120 列终端；
- `/config` 保存、取消、Reset；
- `/provider` 全页面和列表边界；
- `/scout` 配置与一次无副作用读取任务；
- `/commands`、`/preset`、`/tools`；
- `/handoff` 的取消路径；
- `/setup` 3 步连续流程；
- `/reload` 后无重复命令、工具或残留 Scout 子进程；
- 退出码和进程清理。

真实认证、Provider 请求和 handoff 模型调用只有在明确获准时执行。

## 14. 常见问题

### `/config` 看不到插件

检查：

1. 当前 Profile 不是保留的 `pi` Profile；
2. 插件 factory 是否执行；
3. `config:register` 是否同步发送；
4. `id` 是否为空或重复；
5. 插件是否在 Config Host 之前错误读取但未在 `session_start` 重新注册。

### 保存配置后没有生效

Config Host 只负责写文件和发送事件。检查插件是否监听 `config:updated:<id>`，或者文档是否明确声明要等下一次操作、
`/reload` 或重启。

### `/scout` 配置正确但仍使用主模型

检查配置模型是否使用准确的 `provider/model-id`、Model Registry 是否能找到它、认证是否可用，以及保存位置是否是当前
Profile 的 `plugin-configs/scout.json`。

### Scout 退出后仍有进程

检查 `session_shutdown`、Node exit cleanup、Windows `taskkill /T /F`、父 AbortSignal 和 pid 集合删除路径。不要只杀直接
child 而留下其工具进程。

### Provider 发现成功但模型调用失败

分别验证模型目录 endpoint 和真实生成 endpoint。检查 Provider API 类型、Base URL 版本路径、认证 header、响应
Content-Type 和流格式；不要根据发现成功推断生成协议正确。

### 自动获取后模型走错协议

检查模型节点是否存在非空 `api` override。新发现模型应为空并继承 Provider；已有非空 override 可能是历史自动值或用户
显式值，插件不能在缺少来源记录时自动清理。

### 修改源码后 `/reload` 没变化

确认修改的是当前 Runtime 实际加载的文件。仓库 Starter 源码和已部署 Profile Package 是两份文件；先 build，运行
`metapi setup` 恢复部署副本，再启动新进程。内建 `metapi-config` 随 build/process 更新，不是普通源码热重载边界。

## 15. 文档维护清单

插件行为变化时同步更新：

- 本文件对应章节；
- [Starter README](README.md) 的用户入口；
- Profile Config 合同发生版本化变化时，同步中英文规范；
- Extension 数量或加载关系变化时，更新 [Extension Index](../../../docs/extensions/README.md)；
- 命令、配置字段、默认值、存储路径、生效时机和真实验证状态；
- `Todo.md` 中的批准范围、验证结果和回滚方法。

文档不得把“代码存在”“测试通过”“真实 TUI 通过”“外部服务验收完成”写成同一个状态。
