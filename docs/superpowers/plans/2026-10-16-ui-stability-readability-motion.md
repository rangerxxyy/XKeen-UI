# UI Stability, Readability, and Motion Plan

**Goal:** Keep Mihomo selectors stable between polls and make typography and dialogs clearer and smoother across XKeen UI.

**Architecture:** Status polling updates only the header/footer data it owns; it never remounts the current page or refetches selector/connection data. Runtime views keep their current data while explicit navigation or user actions fetch fresh records. Shared design tokens define readable type; one dialog-motion helper handles enter/exit behavior and respects reduced-motion settings.

**Reference review:** The upstream status bar uses component-local state for service stats, while page data is managed separately. Its global styles bundle Inter Variable and use short control transitions. Apply those separation principles to this codebase without copying upstream implementation or layout.

## Steps

1. Remove the manual status-refresh control and its bindings; retain background status polling.
2. Stop status polls from rendering the whole app or refetching selectors/connections. Keep cached data visible during explicit reloads.
3. Add dialog exit motion for buttons, submit, and Escape; preserve reduced-motion preferences.
4. Normalize typography and small-label sizes across all sections using the already bundled Inter Variable and JetBrains Mono fonts.
5. Verify with unit tests, production build, browser visual inspection, then router update and runtime observation.

## Progress

- Steps 1–4 implemented: status polling updates the header in place, selector refresh is decoupled from status polling, modal close transitions honor reduced motion, and shared Inter typography is tuned for legibility.
- Flag rendering uses local SVGs because the router browser lacks the regional emoji glyphs. Prefix matching is covered by regression tests.
- Verification so far: `pnpm test` 99/99, `pnpm typecheck`, `pnpm build`, and `git diff --check` all pass. Local production browser confirms there is no status-refresh control and the settings dialog opens/closes. Router is still v0.2.19; update and live post-install verification remain.
