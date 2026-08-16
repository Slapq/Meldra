# Profile Config 注册规范

[中文](profile-config-protocol.md) | [English](profile-config-protocol.en.md)

状态：MetaPi Extension 的强制兼容合同。

`metapi-config` 是承载 Profile 插件配置的内建特例。它是 hidden inline Extension，不是用户可编辑的 Profile Package。它的源码随 MetaPi build
和进程更新；`/reload` 会重建当前 factory 的注册，但不是该内建源码的热重载边界。

普通 Profile 插件只要提供可由统一字段表达的配置，就必须使用本协议，使 `/config` 保持一致的字段、交互、持久化和变更通知。插件不得为这些字段另建通用配置中心或第二份配置存储。复杂资源管理、原生 credential
service 和产品专属工作流不属于普通 scalar config。

`pi` Compatibility Profile 不注入 `metapi-config`，原始 Pi 资源和行为保持权威。

## 注册

Extension factory 执行时同步注册：

```ts
pi.events.emit("config:register", {
  id: "my-plugin",
  label: "My Plugin",
  icon: "P",
  fields: [
    { key: "endpoint", label: "Endpoint", type: "string" },
    { key: "token", label: "Token", type: "secret", envVar: "MY_PLUGIN_TOKEN" },
    { key: "timeout", label: "Timeout", type: "number", min: 1, max: 300, step: 1 },
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

注册对象固定为：

- `id: string`：非空、稳定的插件 ID，同时用于 JSON 文件名和更新事件后缀；不得包含路径分隔符。
- `label: string`：面向用户的配置页名称。
- `icon?: string`：可选展示信息，不得承载状态。
- `fields: ConfigField[]`：只允许下文六种字段。
- `defaults: Record<string, JSONValue>`：与字段类型相符、可 JSON 序列化的默认值。

约束：

- 非 section 字段的 `key` 在一次注册中必须唯一；
- 两个已加载插件不得注册相同 `id`；重复 ID 不是 override 机制；
- Extension factory 每次执行时都必须重新注册；注册 catalog 只存在于当前 Runtime，不单独持久化；
- 未在本规范中定义的字段类型和 renderer metadata 不属于兼容合同。

## 字段

所有可编辑字段包含：

- `key: string`
- `label: string`
- `hint?: string`
- `envVar?: string`

`envVar` 只用于显示对应环境变量当前生效。环境变量的优先级和解释仍由注册插件负责，Config Host 不改写进程环境。

| `type` | 必要/可选属性 | 保存值 |
|---|---|---|
| `string` | `placeholder?` | string |
| `secret` | `placeholder?` | string |
| `number` | `placeholder?`, `min?`, `max?`, `step?` | number |
| `boolean` | 无额外属性 | boolean |
| `select` | `options: string[]` | `options` 中的一个 string |
| `section` | 只有 `label`，没有 `key` | 不保存值 |

`secret` 仅表示 TUI 中的遮罩输入与展示，不表示加密，也不把 Profile JSON 变成 credential vault。需要原生 credential service 的插件必须保持独立的产品合同。

## 事件

### 注册

```ts
pi.events.emit("config:register", registration);
```

payload 必须符合本规范的注册对象。

### 注销

```ts
pi.events.emit("config:unregister", "my-plugin");
```

payload 必须是准确的注册 `id`。

### 读取

```ts
pi.events.emit("config:get", {
  id: "my-plugin",
  callback(config) {
    // 使用当前 Profile 的有效配置
  },
});
```

callback 是同步调用。插件已注册时，返回值是 `defaults` 后由存储 JSON 顶层字段覆盖的浅合并结果；插件未注册时返回 `{}`。插件不得把空对象当作成功注册的证据。

### 监听保存

```ts
pi.events.on("config:updated:my-plugin", (config) => {
  // 应用刚保存的完整字段值
});
```

后缀必须是准确的注册 `id`。只有用户保存并完成 Profile-local JSON 写入后才发送事件。Cancel 不发送；Reset 只把表单草稿恢复为默认值，仍需 Save。

配置是立即生效、下次操作生效、`/reload` 生效还是重启生效，由注册插件负责并在自身文档中说明，Config Host 不伪造 apply 结果。

## 持久化与作用域

保存位置固定为：

```text
<profile-agentDir>/plugin-configs/<id>.json
```

文件保存完整的非 section 字段值。读取时，持久化的顶层字段浅覆盖注册默认值。

该状态：

- 归一个 MetaPi Profile 所有；
- 不同 Profile 互相隔离；
- 不是项目 `.pi` 配置；
- 不是 Session override；
- 不会自动成为 Portable Profile Bundle 配置；
- 不与 `pi` Compatibility Profile 共享。

插件不得静默把值同步到其他 Profile、项目 settings、用户偏好、环境变量或 Session。

## 兼容规则

以下内容属于硬合同：

- 注册对象；
- 六种字段；
- 事件名与 payload；
- 存储路径；
- 默认值浅合并；
- 保存后通知时机。

修改这些内容需要显式版本化决定、旧插件与旧文件的兼容处理、回归测试和用户批准。新增平行 Config Service、第二注册方言或另一套通用配置 TUI，不属于兼容扩展。
