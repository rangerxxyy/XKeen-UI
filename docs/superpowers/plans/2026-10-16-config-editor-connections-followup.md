# Configuration editing and connection table follow-up

> Implement the listed changes in order; keep the live router configuration untouched during UI QA.

**Goal:** Stabilize the connections table and make Mihomo/Xray editor actions operate on the actual router files with clearly separate save and apply behavior.

**Architecture:** Keep the current CodeMirror editor and router APIs. Add explicit backend save-only/apply contracts with fixed paths, optimistic concurrency, backups and rollback; use the existing XKeen restart control after an applied configuration. Tighten table column layout and update editor status/actions without a page reload.

**Tech Stack:** TypeScript, CodeMirror, Rust, Axum, Vitest, Cargo.

**Spec:** User request and supplied screenshots, 2026-10-16.

## Global Constraints
- Mihomo active config: `/opt/etc/mihomo/config.yaml`.
- Xray config directory: `/opt/etc/xray/configs`; only edit explicitly allowed, verified filenames.
- Keep saves version-checked, backed up, and atomically replaced.
- Save-only must never restart a service; apply validates, writes, restarts the active core through XKeen, and reports the outcome.
- Do not publish or install a config that has not been verified.

## Review Focus
- Router file changed externally between read and save: return conflict and keep editor draft.
- Invalid Mihomo YAML/schema: reject without touching active file.
- Xray uses a directory of files: never pretend a local JSON template is an active router file.
- Long chain/host/source fields: ellipsize on one line; traffic stays in two aligned lines.
- Narrow screens: allow table horizontal scroll without wrapping cell text.

---

### Task 1: Pin the table and editor contracts with tests
- [ ] Add UI/API tests for stable connection cells and separate save/apply endpoint contracts.
- [ ] Run the focused tests and verify the new assertions fail first.

### Task 2: Add safe configuration save/apply operations
- [ ] Add fixed-path Xray config discovery/read/write for the selected real files in `/opt/etc/xray/configs`.
- [ ] Add Mihomo save-only operation with validation, optimistic comparison, private backup, atomic replacement, and no restart.
- [ ] Keep apply as validate, backup, atomic replace, restart through XKeen, rollback on restart failure.
- [ ] Add matching frontend API types and preserve detailed server errors.

### Task 3: Update the editor actions and status
- [ ] Remove the manual read action; retain first-open router reads and in-session drafts.
- [ ] Provide `Сохранить` and `Применить и перезапустить` for active core config; keep list files save-only.
- [ ] Replace draft line-count status with live syntax validation and high-contrast valid/invalid state.
- [ ] Add readable syntax colors for YAML/JSON and improve global typography/scrolling.

### Task 4: Fix connection layout
- [ ] Allocate columns with explicit stable widths and prevent wrapping in route/host/type/source/time cells.
- [ ] Keep traffic values vertically stacked and make dense rows consistently readable.

### Task 5: Verify
- [ ] Run focused UI tests, full test suite, typecheck, production build, Rust fmt and tests.
- [ ] Inspect desktop and narrow viewport in browser; verify scroll reaches Journal.
- [ ] Verify router API path/status read-only; do not modify live config during QA.
