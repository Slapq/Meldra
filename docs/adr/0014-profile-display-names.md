# Derive Profile names from manifests with user overrides

A Profile Bundle may provide `metapi.displayName`; otherwise Meldra derives a default from `package.json.name`. The user may override the display name during import. Display names are local labels and are not the source or version identity used for update checks. Meldra must not silently replace an existing local Profile merely because the derived name matches.
