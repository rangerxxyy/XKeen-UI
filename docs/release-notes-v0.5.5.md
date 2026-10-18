# XKeen UI v0.5.5

## Configuration editor

- The configuration page now keeps the event journal below the editor, and the page can scroll naturally to it.
- The editor action footer stays inside the configuration card. Apply and Save remain first, followed by Format and Utilities.
- Added YAML, JSON, and JSONC formatting while preserving YAML/JSONC comments. Formatting marks the document as edited so validation and the existing save/apply flow still run.
- Reordered the main tabs to Selectors, Connections, DNS, Configuration.
- Utility actions now follow the reference order: Add connection, Import AmneziaWG, Configuration template, Useful links, and backups.

## Verification

- Frontend tests, TypeScript typecheck, and production build.
- GitHub CI: Rust formatting/tests/build, isolated installer checks, and the AArch64 package build.
- The local browser preview confirms the configuration editor and journal render together. A live Keenetic backend was unavailable for router-level verification.
