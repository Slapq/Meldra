# Allow Profiles to carry complete Pi resources

A Profile may directly include Extensions, Skills, Prompts, Themes, settings, and workflow material so that another user's Pi environment can be reproduced as a unit. Meldra will reuse Pi's package loading and trust behavior rather than add per-resource approval, custom scanning, signing, sandboxing, or policy enforcement; the previously agreed separation still excludes credentials, sessions, environment-variable values, and machine-local bindings from exported Profiles.
