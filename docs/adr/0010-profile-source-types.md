# Reuse Pi local, Git, and npm source forms for Profiles

Meldra Profile imports will accept Pi-compatible local-path, Git, and npm source forms rather than inventing a separate download protocol. A completed import records a local content digest or resolves remote input to a concrete Git tag or commit or npm version together with content identity; floating remote references may be previewed but are not the installed snapshot identity, arbitrary bare HTTP downloads are unsupported, and offline mode permits only local or already cached content.
