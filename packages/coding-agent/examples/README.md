# Examples

Example code for pi-coding-agent SDK and extensions.

## Directories

### [sdk/](sdk/)
Programmatic usage via `createAgentSession()`. Shows how to customize models, prompts, tools, extensions, and session management.

### [extensions/](extensions/)
Example extensions demonstrating:
- Lifecycle event handlers (tool interception, safety gates, context modifications)
- Custom tools (todo lists, questions, subagents, output truncation)
- Commands and keyboard shortcuts
- Custom UI (footers, headers, editors, overlays)
- Git integration (checkpoints, auto-commit)
- System prompt modifications and custom compaction
- External integrations (SSH, file watchers, system theme sync)
- Custom providers (Anthropic with custom streaming, GitLab Duo)

### [hooks/](hooks/)
Standalone Meldra command Hook scripts for safety gates, project context, and metadata-only auditing. Includes a complete project settings example and runner-backed tests.

## Documentation

- [SDK Reference](sdk/README.md)
- [Meldra Hooks](../docs/hooks.md)
- [Extensions Documentation](../docs/extensions.md)
- [Skills Documentation](../docs/skills.md)
