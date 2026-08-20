# Meldra 更新日志

## v0.2.1

本版本是一次迁移性 Fix 更新，完成当前代码、Windows 入口、Profile、Starter、Session 与 DeepSeek Harness 边界从 MetaPi 到 Meldra 的规范化，并修复迁移过程中发现的运行时问题。

### 迁移修复

- `meldra` 成为完整的主 CLI、Windows launcher、安装器和 PATH 入口，`metapi` 仅作为兼容别名保留。
- 用户资产、项目清单、源码模块、Starter Bundle、Workflow、Profile Bundle 与导出审计统一使用 Meldra 路径和标识。
- 新 Session metadata、DSH RPC、DSH Session ID、Cordis surface、模型凭据引用和 UI 状态键统一写入 `meldra-*` / `MELDRA_*`。
- 历史环境变量、Session metadata、Bundle metadata、Workflow state、RPC 方法和存储入口继续作为兼容读取路径。
- DSH 原生 Profile 切换到 `profiles/meldra`，Starter 切换到 `packages/meldra-starter` 和 `meldra-workflows`。

### 修复

- 修复 Workflow Session 恢复检查缺少回调参数导致的 `ReferenceError`，补充旧状态读取与新状态写入回归测试。
- 修复跨 Profile Session discovery 未识别新 `meldra-session-profile` metadata 的问题。
- DSH sandbox compatibility 会移除已被当前权限覆盖的冗余提权参数，避免工具调用因重复权限请求失败。
- 补充 Meldra RPC namespace、存储迁移、Starter、Workflow、DSH Profile、模型凭据与品牌兼容回归测试。

### 发布边界

- Windows x64 安装器提供内置 Node.js 和使用系统 Node.js 两个版本。
- 安装器当前未签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。
- scoped npm Bootstrap 尚未发布。
- DeepSeek Harness 仍固定使用 `0.1.0-rc.7`。

## v0.1.2

本版本改善 DeepSeek Harness 对话辨识与权限控制，并修复原生命令被错误发送给模型的问题。

### 改进

- DSH 用户消息使用独立背景消息块，Agent 消息增加明确标题和间距，连续对话更容易区分。
- DSH 待处理输入明确标注为“后续”或“引导”，保留 Harness 原生 queue/steer 语义。
- 新增 DSH 顶层 `/permission [read-only|workspace-write|danger-full-access]` 命令，可直接查询或切换当前 Session 权限预设。

### 修复

- DSH 原生命令改由 Harness `CommandRuntime.execute()` 执行，不再作为普通用户消息进入模型上下文。
- 未知命令和原生命令错误现在明确失败，不再退化为模型提示词。
- 补充原生命令桥接、权限切换、错误传播和 DSH 显示回归测试。

### 发布边界

- Windows x64 安装器提供内置 Node.js 和使用系统 Node.js 两个版本。
- 安装器当前未签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。
- scoped npm Bootstrap 尚未发布。
- DeepSeek Harness 仍固定使用 `0.1.0-rc.7`。

## v0.1.1-fix

本修复版本完成 MetaPi 到 Meldra 的品牌迁移，同时保留现有用户数据、Profile、Session、Pi compatibility 和外部 Runtime 兼容路径。

### 修复

- 主 CLI、Windows 安装器、桌面快捷方式、README、用户文档和发布资产统一使用 Meldra 品牌。
- `meldra` 成为主命令，`metapi` 继续作为兼容别名。
- 保留 `~/.metapi`、`METAPI_*`、`.pi/metapi.json`、Bundle/Session 元数据和 `metapi/*` RPC 标识，避免已有用户环境失联。
- Windows 安装器改用 Meldra 显示名称和文件名，同时保留旧 AppId、安装目录和升级路径。
- 增加 Meldra 品牌和兼容性回归测试。

### 发布边界

- Windows x64 安装器提供内置 Node.js 和使用系统 Node.js 两个版本。
- 安装器当前未签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。
- scoped npm Bootstrap 尚未发布。

## v0.1.1

本版本面向 Meldra Starter Profile、插件配置和 Provider 管理流程，重点提升首次配置、模型发现和运行时排错体验。

### 新增

- 新增 Meldra Starter 插件开发指南，补充 Profile Config、Provider Manager、Scout、Workflows、Setup、打包和验收说明。
- Profile Config 的字符串字段支持运行时模型候选补全。候选值只用于当前运行时，不写入 Profile 配置文件。
- Scout 配置支持从当前 Model Registry 补全 `provider/model-id`，同时保留手动输入自定义模型的能力。
- 系统提示增加 Meldra、Starter Profile 和外部 Agent Runtime 的文档边界说明。

### 改进

- Scout 默认 thinking level 调整为 `off`，减少未配置 Scout 模型时的额外模型推理开销。
- Scout 在 Config Host 启动后注册配置，确保配置页面能够稳定出现。
- Provider Manager 的模型发现会保留用户已有的显式 API 覆盖，不再从全局模型目录推断并写入协议覆盖。
- Provider Manager 对发现到的模型 API 地址进行规范化，并改善 Google Generative AI 版本路径处理。
- Provider Manager 的空模型列表支持通过上下键离开列表并到达其他表单项。
- Config Host 对异常或不完整的本地化标签增加运行时兜底，避免配置页面因标签不是字符串而崩溃。
- 补充 Profile Config 注册协议、Starter 文档索引和相关开发文档。

### 修复与验证

- 增加 Scout 模型补全、语言显示、异常标签渲染和配置隔离测试。
- 增加 Provider Manager 模型发现路径、API 版本识别和协议覆盖保护测试。
- 增加 Meldra 系统提示边界测试。
- 已验证 coding-agent 构建、Meldra Config focused tests、Starter tests 和 OllamaWebSearch 插件测试。

### 发布边界

- Windows x64 安装器仍提供内置 Node.js 和使用系统 Node.js 两个版本。
- 安装器当前未签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。
- scoped npm Bootstrap 尚未发布。
- DeepSeek Harness 仍固定使用 `0.1.0-rc.7`。
