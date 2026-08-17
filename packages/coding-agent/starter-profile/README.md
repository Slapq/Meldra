# MetaPi Starter Profile

This private distribution asset is provisioned into MetaPi's reserved `default` Profile. It is not a separately published npm package.

It provides:

- `/provider` for local Provider and model catalog management;
- `scout` and `/scout` for disposable read-only subagents;
- `/commands`, `/preset`, `/tools`, and `/handoff` Starter workflows;
- `/setup` for an always-visible Provider → model → Scout onboarding flow with configured/partial/unconfigured readiness labels.

The Profile Config Host and `/config` remain MetaPi built-ins and are not duplicated here.

## State boundary

The Bundle contains source and portable defaults only. It does not contain credentials, OAuth tokens, environment-variable values, Sessions, model selections, plugin configuration, directory bindings, or machine-local paths.

Setup copies this directory to the reserved default Profile's local package store and adds one relative package entry. Existing Profile packages and configuration are preserved.
