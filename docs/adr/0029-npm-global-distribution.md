# Distribute Meldra first as an npm global package

> Superseded for Windows installer distribution by [ADR 0039](0039-dual-windows-installers.md). The historical npm-first decision remains recorded below.

The first Meldra release will be distributed as an npm package with a `metapi` bin, installed globally with npm. It will reuse the Pi source build and Node.js runtime and will not introduce a Windows installer, standalone executable, automatic update service, signing pipeline, or separate distribution mechanism in this milestone.
