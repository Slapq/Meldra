# Use Profile as the single environment and workflow concept

> Amended by ADR 0030: model authentication and the custom provider/model catalog are shared User Model Assets rather than Profile-isolated state.

Meldra will expose only Profile, not a separate Preset concept. A Profile is an importable Pi environment that allows extension sets and workflows to coexist; its portable configuration may describe settings, resources, workflow instructions, compatibility, required environment-variable names, and Profile-specific model preferences, while shared User Model Assets, Profile-local sessions, environment values, and directory bindings are never exported. This preserves a simple user model without allowing shared Profiles to carry secrets or another user's history.
