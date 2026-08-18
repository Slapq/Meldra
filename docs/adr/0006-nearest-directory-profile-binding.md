# Resolve Profiles by nearest directory binding

Meldra will select a Profile from user-local directory bindings rather than from the last-used Profile. An explicit command-line Profile wins; otherwise Meldra canonicalizes the current working directory, searches it and its ancestors, uses the nearest binding, and falls back to `default` when no binding exists. Bindings remain under the Meldra user directory so machine-specific Profile names and absolute paths are not written into project repositories.
