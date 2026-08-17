# Offer Pi-to-MetaPi migration on first start

> Amended by ADR 0035: Pi's global Theme setting migrates as a normal shared User Experience Preference.

When an ordinary MetaPi Profile starts and MetaPi-owned user storage has not yet been initialized, MetaPi will detect whether eligible original Pi state exists and ask the user whether to migrate it. Accepting copies Pi's model authentication, custom model catalog, and model catalog state into MetaPi-owned User Model Assets; copies eligible user experience fields, including Pi's global `theme` setting, into the shared MetaPi preference layer; and uses Pi's `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `enabledModels` values to fill otherwise unset model choices in the MetaPi `default` Profile. Declining initializes MetaPi independently. The prompt is not shown for the reserved `pi` compatibility Profile, initialized MetaPi values are not overwritten, and migration does not establish continued synchronization or write-back to original Pi.

Theme resources remain governed by Pi's existing resource directories, Package declarations, project trust, configured paths, and CLI inputs. MetaPi does not introduce a separate Theme resource migration or ownership system.
