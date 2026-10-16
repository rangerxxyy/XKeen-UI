# XKeen lifecycle, YAML apply, and UI polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make XKeen lifecycle actions verifiable and visible in Journal, diagnose Mihomo YAML apply failures, and improve the interface's compactness, typography, and action feedback.

**Architecture:** Keep the existing Rust API, init-script control, Mihomo validator, CodeMirror editor, and Journal log endpoint. Add bounded lifecycle diagnostics and process-transition verification; preserve API error payloads in TypeScript; then refine shared CSS and action state rendering.

**Tech Stack:** Rust, Tokio, Axum, TypeScript, Vitest, CodeMirror, CSS, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-16-lifecycle-yaml-and-ui-polish-design.md`

## Global Constraints

- Preserve user's Mihomo core source/fork, YAML, routing, DNS ownership, and existing backups.
- Keep router control authenticated, same-origin protected, serialized, bounded, and sanitized.
- Do not copy upstream code or reproduce its layout pixel-for-pixel.
- Keep UI fonts local; do not add external font/CDN dependencies.
- The user explicitly authorized publishing the finished update and installing it on the router in this ongoing task; retain the active Mihomo fork and do not alter live YAML unnecessarily.

## Review Focus

- Restart when the old process remains running: must not report success unless the process identity changes.
- Start/stop init script error output: bounded, sanitized, useful, and secret-free.
- Mihomo prints validation details only to stdout: UI must display them instead of only HTTP 422.
- Mihomo returns malformed/empty non-JSON error: UI must preserve HTTP code and show a useful fallback.
- Reduced-motion preference and narrow viewport: actions remain perceivable and layout remains usable.

---

### Task 1: Preserve actionable API error responses

**Files:**
- Modify: `src/api.ts`
- Test: `src/api.test.ts`

**Interfaces:**
- Add an internal bounded error-body reader used by `readJson` for non-2xx responses.
- Preserve `ApiError.status`; include safe backend `error` string when available.

- [ ] Write Vitest cases for JSON `{error: ...}`, malformed JSON, and empty body with non-2xx status.
- [ ] Run `pnpm test -- src/api.test.ts`; verify new cases fail because current code drops backend detail.
- [ ] Implement bounded parsing and fallback message without changing successful response parsing.
- [ ] Run the focused test and then `pnpm test`.

### Task 2: Verify XKeen lifecycle transitions and persist operation logs

**Files:**
- Modify: `backend/src/xkeen.rs`, `backend/src/main.rs`, `backend/src/logs.rs`
- Test: Rust unit tests in `backend/src/xkeen.rs` and log sanitizer tests in `backend/src/logs.rs`

**Interfaces:**
- Add private `ProcessIdentity` snapshot data for the allowed Mihomo/Xray process name and Linux process start time.
- Keep public control endpoint request shape unchanged; success still returns `XkeenStatus`.
- Add a private append helper targeting only `/opt/var/log/xkeen-ui.log`, with bounded line length and sanitized content.

- [ ] Add tests showing a running-before/running-after identical identity is not a verified restart and changed identity is.
- [ ] Add tests showing lifecycle log formatting strips secrets/control chars and truncates long output.
- [ ] Run the relevant Rust tests; verify the missing behavior fails first.
- [ ] Capture init command output with a size limit; combine stdout/stderr in diagnostics and retain exit code.
- [ ] Record requested action, command result, before/after state, and verification result to the allowlisted log. Do not log request secrets or arbitrary environment.
- [ ] Make restart verification require a changed process identity when the old process was running; keep start/stop state checks and DNS block behavior.
- [ ] Run `cargo fmt --check` and `cargo test` when Cargo is available; otherwise verify the corresponding CI workflow has the required commands.

### Task 3: Show lifecycle outcomes in Journal

**Files:**
- Modify: `src/main.ts`
- Create: `src/service-feedback.ts`
- Test: `src/service-feedback.test.ts`

**Interfaces:**
- After a completed lifecycle action, select `xkeen-ui` as the Journal source, refresh the log, and retain existing toast/status behavior.
- Busy state remains set until action verification completes.

- [ ] Extract and test a helper that selects the XKeen log after success and failure.
- [ ] Run focused test and confirm the current action flow lacks Journal refresh behavior.
- [ ] Implement action completion flow and ensure render does not clear a user draft or current config editor state.
- [ ] Run typecheck and frontend tests.

### Task 4: Improve Mihomo validation diagnostics without weakening safe apply

**Files:**
- Modify: `backend/src/config_files.rs`, `src/yaml-editor.ts`
- Test: Rust unit tests in `backend/src/config_files.rs` for diagnostic selection; add a focused frontend test only if editor state is extracted.

**Interfaces:**
- Validation errors include exit status and bounded useful stdout/stderr text.
- The existing `ApplyResult` and HTTP 422 `{error: string}` contract remain unchanged.

- [ ] Add tests for stderr-only, stdout-only, combined, and empty Mihomo diagnostics.
- [ ] Run the config test and confirm stdout-only/empty diagnostics are currently reduced to an unhelpful error.
- [ ] Combine output with deterministic ordering and a strict cap; preserve status code and active-config-on-failure guarantee.
- [ ] Ensure the editor retains draft and expected-content snapshot after 422, while continuing to invalidate snapshot after 409.
- [ ] Run frontend and Rust tests; verify no active config write occurs on validation failure through testable apply boundary.

### Task 5: Readability, verified compact width, and motion feedback

**Files:**
- Modify: `src/style.css`, `src/main.ts`, `src/mihomo-view.ts` only where action feedback requires markup hooks.
- Test: focused UI tests for rendered busy state if existing helpers support it; otherwise browser verification.

**Interfaces:**
- Define root typography/spacing tokens and one authoritative app-shell width variable.
- Respect `prefers-reduced-motion` for new transitions.

- [ ] Record viewport dimensions and measure the current panel and reference screenshot; set the shell width token to the measured reference target and remove duplicate shell caps.
- [ ] Replace tiny scattered labels with the shared readable scale while preserving compact cards and table density.
- [ ] Add short enter transitions for modals/pages and distinct pending/success/error feedback for ping and XKeen controls.
- [ ] Verify reduced-motion disables added motion and keyboard focus remains visible.
- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm build`; inspect the rendered browser UI at the reference viewport and mobile width.

### Task 6: Router verification and release preparation

**Files:**
- Modify: `PLAN.md`, `PROJECT_STATUS.md`, and release metadata only after all implementation checks pass.

**Interfaces:**
- No router source/core or DNS behavior changes. A config apply remains opt-in and uses the currently loaded router file as `expectedContent`.

- [ ] Read current router XKeen/Mihomo/DNS handoff state before any action.
- [ ] Install the candidate build through the authorized panel update path; verify version, API health, and logs.
- [ ] Test XKeen restart/start/stop only in states permitted by DNS safeguards; verify each Journal result against backend status and process identity.
- [ ] Reproduce the YAML 422 with the user's active config or provided failing draft; verify the actual diagnostic is displayed. Do not apply different YAML content without a matching user request; preserve validation, backup, expected-content, and rollback protections.
- [ ] Update status/plan documents with exact test, build, router, and CI evidence. Publish the update and install it on the router as previously authorized.

## Execution order

Complete Tasks 1 and 2 first because UI Journal and editor behavior depend on their response/log contract. Then Tasks 3 and 4, followed by visual refinement and router verification. Do not change DNS ownership or core source during verification.
