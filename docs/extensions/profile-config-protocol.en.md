# Profile Config Registration Protocol

Status: normative MetaPi Extension contract.

`metapi-config` is the one built-in exception that hosts Profile plugin configuration. It is an inline hidden Extension,
not a user-editable Profile Package. Its source is refreshed with the MetaPi build and process lifecycle; `/reload`
re-registers the same loaded factory and is not a source-code hot-reload boundary for this built-in.

Plugins that expose ordinary Profile configuration MUST use this protocol so `/config` keeps one interaction model,
field vocabulary, persistence layout, and update notification path. A plugin MUST NOT add a parallel general-purpose
configuration form or a second configuration store for values representable by this contract. Product-specific
management workflows that are not ordinary scalar configuration remain outside this protocol.

The reserved `pi` Compatibility Profile does not receive `metapi-config`; original Pi resources and behavior remain
authoritative there.

## Registration

A plugin registers synchronously during Extension factory execution:

```ts
pi.events.emit("config:register", {
  id: "my-plugin",
  label: "My Plugin",
  icon: "P",
  fields: [
    { key: "endpoint", label: "Endpoint", type: "string", placeholder: "https://example.test" },
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

The registration object has this fixed shape:

```ts
interface PluginConfigRegistration {
  id: string;
  label: string;
  icon?: string;
  fields: ConfigField[];
  defaults: Record<string, unknown>;
}
```

Requirements:

- `id` MUST be a non-empty, stable plugin identifier. It is also the JSON filename stem and event suffix, so it MUST NOT
  contain path separators.
- `label` MUST be the human-facing page name.
- `icon` is optional presentation metadata. It MUST NOT carry state or affect behavior.
- `fields` MUST contain only the field variants below. Unknown field types or product-specific renderer metadata are
  outside the contract.
- Each non-section `key` MUST be unique within one registration.
- `defaults` MUST contain JSON-serializable values compatible with the corresponding fields.
- Two loaded plugins MUST NOT register the same `id`. Duplicate-ID behavior is not a supported override mechanism.
- A plugin MUST register again whenever its Extension factory runs. Registration is runtime-local and is not persisted
  as metadata.

## Fields

Shared optional metadata for editable fields:

```ts
interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  envVar?: string;
}
```

`envVar` displays that the named environment variable is active. Environment precedence and interpretation remain owned
by the registering plugin; the Config Host does not rewrite process environment variables.

Supported variants:

```ts
type ConfigField =
  | {
      type: "string";
      key: string;
      label: string;
      hint?: string;
      envVar?: string;
      placeholder?: string;
    }
  | {
      type: "secret";
      key: string;
      label: string;
      hint?: string;
      envVar?: string;
      placeholder?: string;
    }
  | {
      type: "number";
      key: string;
      label: string;
      hint?: string;
      envVar?: string;
      placeholder?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "boolean";
      key: string;
      label: string;
      hint?: string;
      envVar?: string;
    }
  | {
      type: "select";
      key: string;
      label: string;
      hint?: string;
      envVar?: string;
      options: string[];
    }
  | {
      type: "section";
      label: string;
    };
```

The value representation is fixed:

| Field type | Stored value |
|---|---|
| `string` | string |
| `secret` | string |
| `number` | number |
| `boolean` | boolean |
| `select` | one string from `options` |
| `section` | no value; presentation only |

`secret` means masked TUI entry and display. It does not declare encryption or a credential-store migration. Plugins
that require a native credential service must keep that product-specific credential contract separate and must not claim
that the Profile JSON file is a credential vault.

## Event Contract

### Register

```ts
pi.events.emit("config:register", registration);
```

The payload MUST follow `PluginConfigRegistration`.

### Unregister

```ts
pi.events.emit("config:unregister", "my-plugin");
```

The payload MUST be the exact registration `id`.

### Read

```ts
pi.events.emit("config:get", {
  id: "my-plugin",
  callback(config) {
    // Use the effective Profile-local values.
  },
});
```

The request shape is fixed:

```ts
interface PluginConfigGetRequest {
  id: string;
  callback: (config: Record<string, unknown>) => void;
}
```

The callback is synchronous. For a registered plugin, the host returns a shallow merge of `defaults` followed by the
stored JSON object. For an unknown registration it returns `{}`. Plugins MUST NOT infer successful registration from an
empty object.

### Observe Saves

```ts
pi.events.on("config:updated:my-plugin", (config) => {
  // Apply the newly saved complete field-value object.
});
```

The suffix MUST be the exact registration `id`. The host emits this event only after the user saves the form and the
Profile-local JSON write completes. Cancel does not emit it. Reset changes the draft to defaults and still requires
Save.

A plugin owns whether a saved value applies immediately, on its next operation, on `/reload`, or after process restart.
That policy must be stated in the plugin's own documentation and must not be misrepresented by the Config Host.

## Persistence and Scope

Values are stored without migration or reinterpretation at:

```text
<profile-agentDir>/plugin-configs/<id>.json
```

The file contains the complete saved non-section field-value object. On read, persisted top-level keys shallowly
override registration defaults.

This state is:

- owned by one MetaPi Profile;
- independent between Profiles;
- not project `.pi` configuration;
- not a Session override;
- not automatically portable Profile Bundle configuration;
- not shared with the reserved `pi` Compatibility Profile.

Plugins MUST NOT silently mirror these values into another Profile, project settings, user preferences, environment
variables, or Session state.

## Compatibility Rule

The registration object, six field variants, event names and payloads, storage path, shallow default merge, and
save-notification timing are a hard compatibility contract. Changes require an explicit versioned protocol decision,
compatibility handling for existing plugins and files, regression coverage, and user approval. Adding an unrelated
Config Service or silently accepting a second registration dialect is not a compatible extension of this contract.
