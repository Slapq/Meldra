# Share user experience preferences across Meldra Profiles

> Amended by ADR 0035: Theme remains Pi's global user preference rather than becoming a separate Meldra scope model.

Meldra will treat interface and control preferences as machine-local User Experience Preferences shared by every ordinary Meldra Profile, so switching workflows does not require users to repeat Theme, editor and terminal presentation, cursor behavior, or navigation/display settings. Theme resources continue to use Pi's existing discovery and Package mechanisms, while the selected `theme` value is shared and persisted globally across ordinary Meldra Profiles. These user preferences are never exported as Profile workflow requirements.
