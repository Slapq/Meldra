# Layer local Profile changes above imported configuration

Imported Portable Profile Configuration is a base layer rather than an immutable environment or a directly edited snapshot. Pi-compatible settings and package operations write Local Profile Overrides; project `.pi` configuration and one-run CLI arguments retain their higher precedence. Updating an imported Profile replaces only its portable base, preserving local authentication, sessions, environment state, bindings, and local configuration overrides.
