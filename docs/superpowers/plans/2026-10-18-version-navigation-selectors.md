# Version, Navigation, and Selector Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the reported 0.5.0 backend version in the next release and bring navigation, config tabs, and selector destination cues closer to the supplied zxc-rv reference while retaining this project's visual theme.

**Architecture:** Keep the existing four main pages and config file switching behavior. Match the reference navigation order and keep config-file tabs in a separate, outlined row shown on the configuration page. Improve selector destination metadata without changing Mihomo selection semantics. Align Cargo and frontend release versions, and show update stages from the current install log while recognizing the expected release version.

**Tech Stack:** TypeScript, HTML/CSS, Rust/Tokio, Vitest, Cargo.

**Spec:** User request in the conversation dated 2026-10-18, with screenshots 163143, 165739, 165811, 165823, and 170019.

## Global Constraints

- Preserve the dark project theme and current page functionality.
- Keep config file identifiers and their order: `config`, `ip_exclude`, `port_exclude`, `port_proxying`, `xkeen`.
- Do not alter core selection or routing behavior; only clarify its displayed current destination.
- Backend and frontend release versions must agree at `0.5.2`; v0.5.1 is already published and must not be rewritten.
- Keep service restart/update diagnostics available during a self-update.

## Review Focus

- Backend reports `CARGO_PKG_VERSION`; assert it matches the release version source.
- Update completion spans a temporary backend outage; keep the existing polling/reload behavior covered.
- Switching among configuration files preserves the selected file and page state.
- Selector auto-managed groups have no manually selected node; render a clear automatic-selection label.
- Long selected-node names remain legible without expanding the layout unexpectedly.

---

### Task 1: Align the next release version

**Files:**
- Modify: `backend/Cargo.toml`
- Modify: `package.json`
- Create: `docs/release-notes-v0.5.2.md`
- Test: `backend/src/main.rs`

**Interfaces:**
- Keep `SystemStatus.app_version` sourced from `env!("CARGO_PKG_VERSION")`.

- [ ] Add a Rust test asserting the compiled backend package version is `0.5.2` for this release build.
- [ ] Run the focused Rust test and confirm it fails while Cargo metadata is `0.5.0`.
- [ ] Set frontend and backend package versions to `0.5.2`, update the lockfile, and add release notes explaining the version-reporting fix and UI changes.
- [ ] Run the focused Rust test and confirm it passes.

### Task 2: Match the main navigation order and style config tabs distinctly

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Test: `src/navigation.test.ts` (create if no navigation rendering tests exist)

**Interfaces:**
- Keep `renderNavigation()` as the single renderer for main page tabs and config file tabs.
- Keep `renderConfigFileButtons()` as the source of config file tab markup and selected state.

- [ ] Add a test that the main tabs are ordered Селекторы → Соединения → DNS → Конфигурация, and config-file tabs remain a separate row only on the configuration page.
- [ ] Run the focused test and confirm it fails against the current inline tab layout and old main-tab order.
- [ ] Render config-file tabs below the main nav only on configuration, retaining IDs, accessibility labels, and active file selection.
- [ ] Add a rounded outline around the config tab group, with `config` visually distinguished, preserving colors and responsive horizontal scrolling.
- [ ] Run the focused test and the frontend test suite.

### Task 3: Clarify selector route destinations and tighten selector card layout

**Files:**
- Modify: `src/mihomo-view.ts`
- Modify: `src/style.css`
- Test: `src/mihomo-view.test.ts`

**Interfaces:**
- Keep `renderSelectors(groups, loading, error)` and Mihomo selection event attributes unchanged.

- [ ] Add tests that selected groups show an explicit destination cue including the selected node, and auto-managed groups show the automatic-selection label.
- [ ] Run focused tests and confirm the selected-destination assertions fail before implementation.
- [ ] Update selector metadata to clearly label the current destination and keep the route line aligned in every card.
- [ ] Slightly reduce selector card width / density by tuning grid maximum width and gaps to match the reference without changing responsive breakpoints adversely.
- [ ] Run focused tests and the frontend test suite.

### Task 4: Verify update completion against the installed release

**Files:**
- Modify: `src/main.ts`
- Modify: `src/app-update.ts`
- Modify: `backend/src/installer.rs`
- Test: `src/app-update.test.ts` or focused new update-flow tests

**Interfaces:**
- Keep `requestAppUpdate(tag)` and backend `/api/v1/app/update` contract unchanged.

- [ ] Add tests for comparing the installed version with the requested tag and translating installer log entries into current progress stages.
- [ ] Run focused tests and confirm the new expectation fails against the current comparison.
- [ ] Emit installer log entries for stopping the old panel, preserving it, installing the package, and starting the new panel.
- [ ] Show progress derived from the current attempt's update log, compare normalized `appRelease.tag_name` with the reported app version, retain polling across restart, and include diagnostics on timeout.
- [ ] Run focused tests and the complete frontend suite.

### Task 5: Verify the release artifact

**Files:**
- No additional source files.

- [ ] Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [ ] Run `cargo fmt --manifest-path backend/Cargo.toml -- --check` and `cargo test --manifest-path backend/Cargo.toml --locked`.
- [ ] Build the backend and verify `/api/v1/status` reports `0.5.2` from the compiled package metadata.
- [ ] Prepare a v0.5.2 release only after all checks pass; retain v0.5.1 as published.
- [ ] Review the final diff against each user request before preparing any release.
