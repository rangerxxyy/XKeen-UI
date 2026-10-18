# XKeen UI v0.4.4

Connection routes now read from left to right with a clear arrow between each hop. Service icons use crisp inline vector artwork with stronger contrast, and each route hop has its own compact label so the selected path is easier to scan.

The XKeen UI version control in the header is now a compact, sharper version chip. The update dialog keeps its version selection and install action but no longer shows the separate “Open release” button. Typography in the version and release controls has been refined.

Validation: 219 frontend tests, TypeScript typecheck, and production build passed locally. Rust backend tests, installer checks, and Linux AArch64 packaging are verified by GitHub Actions for the release commit. The interface was not tested against a live router.
