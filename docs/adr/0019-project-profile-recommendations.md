# Let projects recommend Profiles without importing them

`.pi/metapi.json` may declare a recommended Profile source and display name for a project. After the project is trusted, MetaPi may show the recommendation, but it will not fetch, import, activate, or bind that Profile automatically. The user must choose the existing import flow, and directory binding remains a separately visible choice so project metadata cannot silently change the user's local environment.
