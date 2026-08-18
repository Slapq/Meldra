# Linux uses the Node.js runtime for full Meldra compatibility

Meldra treats the Linux Node.js source distribution as the full runtime path because it can preserve the locked DeepSeek Harness dependency graph and prepare the reviewed native modules explicitly. The standalone Linux Bun archive remains `PARTIAL`: it ships the Starter Bundle and supports default and ordinary Profiles, but DeepSeek Harness is explicitly `UNSUPPORTED` because Harness owns dynamic Node services and subprocess dependencies that the compiled archive does not carry.

The source bootstrap keeps `npm install --ignore-scripts` as the default boundary, then runs `npm run prepare:native-runtime` to execute only the reviewed `@deepseek-ai/dsh-subprocess-local`, `koffi`, and `node-pty` install scripts. Node release staging derives exact DSH package versions and platform-compatible service packages from the committed root lock, preserving one complete rc.7 dependency graph on Windows and Linux.
