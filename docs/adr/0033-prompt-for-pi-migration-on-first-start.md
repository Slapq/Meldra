# Offer Pi-to-Meldra migration on first start

> Amended by ADR 0035: Pi's global Theme setting migrates as a normal shared User Experience Preference.

When an ordinary Meldra Profile starts and Meldra-owned user storage has not yet been initialized, Meldra will detect whether eligible original Pi state exists and ask the user whether to migrate it. Accepting copies Pi's model authentication, custom model catalog, and model catalog state into Meldra-owned User Model Assets; copies eligible user experience fields, including Pi's global `theme` setting, into the shared Meldra preference layer; and uses Pi's `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `enabledModels` values to fill otherwise unset model choices in the Meldra `default` Profile. Declining initializes Meldra independently. The prompt is not shown for the reserved `pi` compatibility Profile, initialized Meldra values are not overwritten, and migration does not establish continued synchronization or write-back to original Pi.

Theme resources remain governed by Pi's existing resource directories, Package declarations, project trust, configured paths, and CLI inputs. Meldra does not introduce a separate Theme resource migration or ownership system.
