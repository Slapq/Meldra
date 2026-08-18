# Create the Meldra project manifest only on explicit request

Meldra may store versioned, non-secret, repository-shareable project intent in `.pi/metapi.json`, alongside Pi's existing project resources. Normal startup will never create or modify this file; only `metapi init` or another explicit user operation may do so, and reading or acting on it remains subject to Pi's project-trust boundary. Credentials, sessions, environment values, user paths, and machine-local Profile bindings are excluded from the manifest.
