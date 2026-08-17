# Provide MetaPi as a separate metapi command

MetaPi will install one user-facing command, `metapi`, and will not overwrite, alias, or replace an existing `pi` command. `metapi` starts the MetaPi Starter Profile by default; `metapi --profile pi` provides explicit access to the original Pi state through the compatibility Profile. This keeps installation and removal reversible and allows direct behavior comparison.
