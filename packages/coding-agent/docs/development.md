# Pi Development Reference

> Developing Meldra? Use the Chinese-first [Meldra Development Guide](../../../docs/development.md) or its [English
> version](../../../docs/development.en.md) for the patch-layer architecture, Profile Runtime boundaries, and validation
> workflow. This page documents the preserved Pi development baseline.

See [AGENTS.md](https://github.com/earendil-works/pi/blob/main/AGENTS.md) for upstream Pi guidelines and the
repository-local `AGENTS.md` for Meldra requirements.

## Setup

```bash
git clone https://github.com/earendil-works/pi
cd pi
npm install
npm run build
```

Run from source:

```bash
/path/to/pi/pi-test.sh
```

The script can be run from any directory. Pi keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable
names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.pi/agent/pi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
