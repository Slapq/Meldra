# Resolve Profile name conflicts interactively

When importing a Profile whose chosen display name already exists, interactive MetaPi will let the user replace the existing Profile, save under another name, or cancel. It will not silently overwrite local authentication, sessions, or workflow state. In non-interactive modes, an explicit replacement or alternate name is required; otherwise import fails clearly.
