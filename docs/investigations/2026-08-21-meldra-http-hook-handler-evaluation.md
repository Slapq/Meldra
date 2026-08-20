# Meldra HTTP Hook Handler Evaluation

Date: 2026-08-21
Status: Evaluation complete; implementation deferred
Baseline: `30a8d3552` on `release/meldra-v0.2.1`

## 1. Hypothesis

An HTTP Hook handler could reuse the command Hook input and decision protocol while replacing the local child process with an HTTP POST. The proposed benefit is integration with centralized policy, audit, CI, and notification services without requiring a local executable.

## 2. Initial evaluation

The current command runner already defines useful transport-independent behavior: bounded timeouts, cancellation, parallel sibling execution, structured JSON decisions, non-blocking diagnostics, and Runtime-specific decision adaptation. The repository also has an Undici dispatcher and abort-aware management HTTP helper.

The opposing evidence is stronger than a simple transport substitution:

- Hook inputs may contain raw prompts, tool arguments, file contents, tool results, errors, Session IDs, working directories, and transcript paths.
- A project Hook URL can target localhost, private networks, or cloud metadata services after Project Trust, creating an SSRF and internal-network pivot.
- Authentication headers need a credential reference and redaction contract; plaintext headers in project settings are not acceptable secret storage.
- Retrying a webhook can duplicate non-idempotent external actions.
- A slow `PreToolUse` or `UserPromptSubmit` endpoint extends the critical Agent path.
- An unbounded or infinite response stream is a memory and shutdown risk.

## 3. Information search

### Current Meldra guarantees

- `packages/coding-agent/src/hooks/command-runner.ts` caps stdout and stderr, propagates cancellation, applies a timeout, and terminates the process tree.
- `packages/coding-agent/src/extensions/meldra-hooks/index.ts` and `packages/coding-agent/src/extensions/dsh/hooks.ts` interpret the same normalized result inside the Runtime that owns the lifecycle.
- Project Hooks remain behind Project Trust, but Project Trust is not a network-destination allowlist and does not make arbitrary endpoints safe.
- `packages/coding-agent/src/utils/management-http.ts` retries transient failures for idempotent management reads/writes. That retry policy is not suitable as a default for webhooks.

### External compatibility evidence

The current Claude Code Hook reference defines HTTP handlers as JSON POST requests and requires explicit controls around header environment interpolation. Its managed settings can restrict allowed HTTP Hook URLs and allowed environment variables. This confirms that HTTP Hook execution needs policy beyond ordinary Hook configuration.

Reference: <https://code.claude.com/docs/en/hooks>

## 4. Re-evaluation

### Conclusion

**Insufficient information for a safe HTTP Hook implementation.** The transport code is straightforward, but the required security, credential, retry, response, and policy contracts are not currently owned by Meldra Hooks. Implementing `type: "http"` without those contracts would create a data-exfiltration and SSRF feature rather than a safe integration point.

### Required contract before implementation

1. `allowedHttpHookUrls` with deterministic URL normalization and matching, applied to Profile and project sources.
2. Explicit localhost, link-local, private-network, redirect, DNS-rebinding, proxy, and IPv6 policy.
3. `allowedEnvVars` for header interpolation; no plaintext credential persistence or diagnostic echo.
4. Event-level payload projection/redaction, with full prompt/tool/result forwarding requiring explicit opt-in.
5. POST-only first version, `Content-Type: application/json`, and no automatic retries.
6. Linked turn/shutdown cancellation and a finite timeout.
7. Streaming response byte/character limits before JSON parsing, plus body cancellation on overflow.
8. Exact status and response mapping to the existing normalized Hook decision protocol.
9. Native Pi and DSH parity tests, including DSH's immutable tool arguments.
10. Project Trust, Profile ownership, `/hooks` inspection, diagnostics, hot reload, and shutdown behavior documented and tested together.

## 5. Decision and rollback

This investigation does not add an HTTP/Webhook handler, network call, credential field, dependency, or setting. Command Hooks remain the only executable handler type. No runtime rollback or data migration is required.
