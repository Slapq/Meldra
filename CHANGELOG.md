# MetaPi 更新日志

## v0.1.1

本版本面向 MetaPi Starter Profile、插件配置和 Provider 管理流程，重点提升首次配置、模型发现和运行时排错体验。

### 新增

- 新增 MetaPi Starter 插件开发指南，补充 Profile Config、Provider Manager、Scout、Workflows、Setup、打包和验收说明。
- Profile Config 的字符串字段支持运行时模型候选补全。候选值只用于当前运行时，不写入 Profile 配置文件。
- Scout 配置支持从当前 Model Registry 补全 `provider/model-id`，同时保留手动输入自定义模型的能力。
- 系统提示增加 MetaPi、Starter Profile 和外部 Agent Runtime 的文档边界说明。

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
- 增加 MetaPi 系统提示边界测试。
- 已验证 coding-agent 构建、MetaPi Config focused tests、Starter tests 和 OllamaWebSearch 插件测试。

### 发布边界

- Windows x64 安装器仍提供内置 Node.js 和使用系统 Node.js 两个版本。
- 安装器当前未签名，Windows 可能显示 Unknown publisher 或 SmartScreen 提示。
- scoped npm Bootstrap 尚未发布。
- DeepSeek Harness 仍固定使用 `0.1.0-rc.7`。
