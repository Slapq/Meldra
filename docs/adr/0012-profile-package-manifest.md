# Extend Pi package.json for Profile metadata

Profile Bundles will use the existing Pi `package.json` manifest and resource declarations. MetaPi adds a `metapi` field for Profile metadata such as the Profile schema version and portable defaults; the existing `pi` field remains authoritative for Extensions, Skills, Prompts, and Themes. Ordinary Pi can load the same package and ignore the unknown MetaPi field, avoiding a parallel resource format.
