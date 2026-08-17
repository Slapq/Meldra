# Activate imported Profiles on the next launch

> Superseded by ADR 0036 for interactive Profile selection.

Importing a Profile Bundle originally installed it for later activation through an explicit Profile argument, nearest directory binding, or `default` fallback. ADR 0036 now permits a complete current-session runtime replacement through `/profile`; directory bindings remain the next-launch default mechanism.
