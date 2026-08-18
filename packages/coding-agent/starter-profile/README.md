# Meldra Starter Profile

This private distribution asset is provisioned into Meldra's reserved `default` Profile. It is not a separately published npm package.

It provides:

- `/provider` for local Provider and model catalog management;
- `scout` and `/scout` for disposable read-only subagents;
- `/commands`, `/preset`, `/tools`, and `/handoff` Starter workflows;
- `/setup` for an always-visible Provider → model → Scout onboarding flow with configured/partial/unconfigured readiness labels.

The Profile Config Host and `/config` remain Meldra built-ins and are not duplicated here.

Developer documentation: [Meldra Starter plugin development guide](DEVELOPMENT.md). It covers Profile Config,
Provider Manager, Scout, Workflows, Questionnaire, Setup, packaging, validation, and troubleshooting.

## State boundary

The Bundle contains source and portable defaults only. It does not contain credentials, OAuth tokens, environment-variable values, Sessions, model selections, plugin configuration, directory bindings, or machine-local paths.

Setup copies this directory to the reserved default Profile's local package store, adds one relative package entry, and provisions `AGENTS.md` into the Profile agent directory when that file is missing. Existing Profile instructions, packages, and configuration are preserved.
