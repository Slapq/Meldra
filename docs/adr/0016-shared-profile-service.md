# Share one Profile Service between CLI and TUI

Meldra exposes Profile operations through both CLI commands and Pi TUI commands, with shared Profile services owning discovery, directory binding, import, naming conflicts, update snapshots, session metadata, and activation resolution. The CLI and TUI remain presentation layers; `/profile` switches the current session, while explicit bind/unbind operations control the directory's next-launch default.
