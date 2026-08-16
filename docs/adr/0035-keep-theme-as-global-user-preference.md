# Keep Theme as a global MetaPi user preference

> Supersedes ADR 0032 and the withdrawn Theme Resource/Selection scope model.

Pi treats `theme` as a global user setting. Theme JSON resources may be discovered from built-ins, user or project directories, Pi Packages, configured paths, or CLI inputs, but their source does not create separate persistence scopes for the user's Theme choice. When the selected Theme is unavailable, MetaPi preserves Pi's existing load, fallback, diagnostic, and error behavior rather than adding target-scope availability rules.

Every ordinary MetaPi Profile therefore reads and writes the same MetaPi user-level `theme` preference. A Profile Bundle may carry Theme resources through Pi-compatible `pi.themes` declarations or a conventional `themes/` directory, but launching that Profile does not automatically replace the user's global Theme choice. MetaPi will not add a Profile Theme Default, Session Theme Override, or advanced three-scope Theme save menu. Pi's existing project settings layer may still override the global value through `.pi/settings.json`, and Theme resources continue to follow Pi's existing discovery rules. The reserved `pi` compatibility Profile continues to use original Pi global settings and Theme resources independently.

During one-time Pi-to-MetaPi migration, the Pi global `theme` setting is copied as a normal User Experience Preference. Theme resources themselves remain governed by Pi's existing resource and Package behavior; MetaPi does not create a separate Theme migration or ownership system.
