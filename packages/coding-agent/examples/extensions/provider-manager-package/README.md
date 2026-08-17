# MetaPi Provider Manager Example

A complete interactive TUI provider and model manager for [MetaPi](https://github.com/Slapq/MetaPi) and compatible Pi hosts.

Configure custom LLM providers and models through a visual terminal form — no manual JSON editing needed.

## Features

- **Visual form** — Configure providers with an interactive TUI instead of editing `models.json` by hand
- **Full provider lifecycle** — Create, edit, copy, import, and delete providers
- **API model discovery** — Fetch models from OpenAI-compatible, Anthropic, Gemini, Azure, and Mistral-style `/models` endpoints
- **Metadata enrichment** — Fill context window, output limit, reasoning, modalities, API type, and cost from Pi's built-in model catalog or rich provider responses
- **Model management** — Add, edit, and delete models per provider with full configuration
- **Per-model advanced options** — Cost tracking, compatibility flags (compat) per model
- **Multi-language** — English and Chinese (auto-detected from system locale, switchable in UI)
- **Instant effect** — Saves to the host's effective user model catalog and registers in the current session simultaneously
- **All Pi API types** — Includes `openai-completions`, `anthropic-messages`, `openai-responses`, `openai-codex-responses`, `azure-openai-responses`, `google-generative-ai`, `google-vertex`, `bedrock-converse-stream`, `mistral-conversations`, and `pi-messages`

## Source Example

This directory is a private monorepo example package, not a separately published npm package. To develop or install it, use Pi's documented local-package workflow and point it at this directory after cloning MetaPi. The extension entry is:

```text
extensions/provider-manager.ts
```

## Usage

In Pi, type:

```
/provider
```

### Navigation

| Key | Action |
|-----|--------|
| `↑` `↓` / `Tab` | Navigate between fields |
| `←` `→` | Switch option values |
| `Enter` | Confirm / Toggle / Open |
| Type | Filter the current provider or model browser |
| `PgUp` `PgDn` | Move through the model browser by one page |
| `Esc` | Back / Cancel; cancel an active model discovery request |
| `Del` | Delete the selected model or provider |
| `C` | Copy the selected provider |

### Pages

```
Provider Browser (search + fixed 10-row window)
 ├── Management Actions
 │    ├── + Create New Provider
 │    ├── ⇩ Import Provider JSON
 │    ├── 🧠 Thinking Budgets
 │    └── 🌐 Language
 └── Existing providers (Enter=edit, C=copy, Del=delete)
         ↓
Provider Overview
 ├── Connection & Authentication → compact connection form; API key is masked
 ├── Models → searchable fixed 5-row browser + selected-model details
 ├── Provider Compatibility → provider-wide compat settings
 ├── ✓ Save
 └── ✗ Cancel
         ↓
Models Browser
 ├── Search by model ID or name
 ├── ↻ Explicitly fetch models from API (Esc cancels)
 ├── Fixed 5-row model window with position and capability badges
 ├── Selected model API, modalities, context, output and cost details
 └── Add / Edit / Delete
         ↓
Model Edit
 ├── ID / Name / Reasoning / Input
 ├── Context Window / Max Tokens / API override
 ├── ✦ Fill Metadata from Pi catalog
 └── ⚙ Advanced Options
```

### Default Values

| Field | Default |
|-------|---------|
| `name` | Same as `id` |
| `reasoning` | `false` |
| `input` | `["text"]` |
| `contextWindow` | `1000000` |
| `maxTokens` | `32000` |
| `cost.*` | `0` |

## Persistence

MetaPi ordinary Profiles persist this package's providers in the shared user model catalog. The reserved `pi` compatibility Profile uses its native agent-local `models.json`. Saving also registers the provider in the current session, so a restart is not required.

## Discovery and import notes

- Opening `/provider`, the Provider overview, or the Models browser reads only the local configured snapshot. It never contacts a provider automatically.
- Model discovery runs only after the user explicitly selects **Fetch Models from API**. Escape aborts the active request. Discovery is additive: it adds missing IDs and enriches matching IDs, but never deletes configured models.
- Discovery reports returned, added, enriched, rich-metadata, and ID-only counts. Standard OpenAI-compatible model lists often return only IDs; those rows retain configured/Pi-catalog/default metadata instead of pretending the endpoint supplied richer facts.
- Base URL may be either the API root (`https://host/v1`), the origin (`https://host`), a `/models` URL, or a request endpoint. Discovery tries safe `/models` and `/v1/models` variants internally without changing the saved Base URL.
- Discovery errors are rendered inside the Provider form and fully caught by the extension; they do not escape into Pi's command/TUI loop.
- Metadata matching is broad: provider prefixes and longer decorated IDs containing a catalog ID can match, while the configured model ID is always preserved.
- The one-click Pi Agent header preset adds attribution/User-Agent headers while preserving existing custom headers.
- Standard OpenAI `/v1/models` responses often contain IDs only. Rich responses such as OpenRouter-style metadata can additionally populate context, max output, modalities, reasoning, and cost.
- Provider import accepts a single provider object, a `{ "providers": { ... } }` object, or the contents of an existing Pi `models.json` file.
- `bedrock-converse-stream`, `google-vertex`, and `pi-messages` do not have a portable standard model-list URL, so discovery is disabled for those API types.

## License

MIT
