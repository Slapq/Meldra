# Inject the simple config host into ordinary Profiles

Meldra will automatically inject a hidden inline `metapi-config` Extension into every ordinary Meldra Profile, preserving pi-config's existing `config:*` event protocol, TUI, and `<agentDir>/plugin-configs` files. This makes the same small configuration surface available to more Profile plugins without introducing a parallel core Config API, changing Meldra settings formats, or moving configuration into project `.pi`; the `pi` Compatibility Profile remains untouched.

`metapi-config` is an explicit built-in exception, not a user-editable Profile Package. `/reload` may recreate its registrations but is not required to re-import this built-in's source. It must not gain a separate provision, package-copy, update, or hot-reload lifecycle.

The registration shape, six supported field variants, event payloads, Profile-local persistence, and save notification semantics in `docs/extensions/profile-config-protocol.en.md` are a hard compatibility contract for ordinary Profile plugin configuration. Plugins must use that contract to preserve one configuration style; changing it requires a versioned compatibility decision rather than an additional Config Service or registration dialect.
