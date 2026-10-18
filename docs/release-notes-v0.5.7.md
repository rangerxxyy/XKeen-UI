# XKeen UI v0.5.7

This release carries the selector, connections, configuration workspace, status bar, and utilities polish from PR #55.

## Changes

- Selector changes remain responsive while requests are serialized; after a group switch, active connections routed through that group are closed so new traffic uses the selected node. Ping values are brighter, larger, and pinned to each node card's lower-right corner.
- Connection route icons use the selector's icon assets at 18px, matching the upstream reference.
- The configuration page keeps the event journal below the editor and reachable by scrolling the page. The `config` tab is separated and outlined. Core management no longer shows the obsolete safety paragraph or a redundant Done button.
- Utilities follow the requested order, and the backups entry is removed from the menu while backend recovery remains available.
- The service status controls are aligned and outlined, with clear running/stopped states.
- Main navigation is ordered Selectors, Connections, DNS, Configuration.

## Verification and known limits

- GitHub CI passed frontend tests/typecheck/build, installer checks, backend formatting/tests/release build/lifecycle smoke, and the AArch64 musl cross-build.
- Local verification passed 272 frontend tests, TypeScript typecheck, production build, and `git diff --check`.
- A production-preview accessibility smoke confirmed navigation and journal placement. The local preview did not have the router backend, so live API flows could not be exercised.
- RSS/PSS, selector switching latency, live DNS handoff/rollback, and subscription application have not been measured on the target Keenetic. The user will verify those after installing this release.
