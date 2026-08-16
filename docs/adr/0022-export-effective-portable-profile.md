# Export the portable base plus local overrides

Exporting a Profile produces a new Pi-compatible Profile Bundle from the imported portable base merged with Local Profile Overrides, representing the user's reusable environment. The export excludes project `.pi` configuration, one-run CLI arguments, credentials, sessions, environment values, directory bindings, and package caches. Export writes a local artifact only; it neither modifies the active Profile nor publishes the result to Git or npm.
