# XKeen UI Settings and Visual Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the interface areas shown in the user's screenshots while preserving current event hooks, API contracts, and safe router operations.

**Architecture:** Keep the existing TypeScript view functions and CSS architecture, consolidate visual overrides into explicit design tokens and focused component rules, and store browser-only preferences in a versioned localStorage object. Reuse the existing backend endpoint for router-persisted core update sources; extend APIs only when a setting has a verified backend path.

**Tech Stack:** TypeScript, Rust/Axum, plain CSS, CodeMirror, existing Vitest and Cargo setup.

**Spec:** `docs/superpowers/specs/2026-10-16-ui-settings-refactor.md`

## Global Constraints

- Preserve existing IDs, `data-*` attributes, classes, and router API behavior.
- Add no heavy dependencies.
- Validate and bound any setting passed to backend/router operations.
- Do not show nonfunctional GUI mode/plugin settings.
- Do not publish a release in this task.

## Review Focus

- Existing event listeners must still bind after settings tab changes.
- Malformed/stale localStorage values must fall back to safe defaults.
- Long connection host/source text must not shift table columns.
- Reduced-motion users must not receive animated transitions.
- DNS handoff warnings and configuration error states must remain visible and readable.

### Task 1: Settings model and tab structure

**Files:** `src/main.ts`, `src/api.ts`, `src/style.css`

- [ ] Preserve current settings IDs and existing source save flow.
- [ ] Add browser-preference defaults and safe load/save helpers.
- [ ] Organize settings into General, Mihomo, Updates; add only fields with real behavior.
- [ ] Keep core repositories saved through `/api/v1/settings/core-sources`.

### Task 2: DNS, connections, and icon alignment

**Files:** `src/dns-view.ts`, `src/mihomo-view.ts`, `src/style.css`

- [ ] Improve grid/row alignment, icon sizing and accessible labels without changing handler hooks.
- [ ] Improve DNS form/card contrast and compact secondary descriptions.
- [ ] Make connection table sizing robust against long values and narrow viewports.

### Task 3: Configuration editor palette and interaction polish

**Files:** `src/yaml-editor.ts`, `src/style.css`, `src/dialog-motion.ts`

- [ ] Align editor syntax colors and surface/status colors to the supplied palette.
- [ ] Ensure modal/hover/focus transitions are 150–250ms and respect reduced motion.
- [ ] Reduce duplicate CSS overrides where a safe, scoped consolidation is possible.

### Task 4: Verification and status

**Files:** `PLAN.md`, `PROJECT_STATUS.md`, `docs/superpowers/` (only if implementation scope changes)

- [ ] Run the frontend build and applicable existing verification commands.
- [ ] Inspect git diff for removed hooks, new dependencies, and unsupported UI controls.
- [ ] Record completed work and remaining router/runtime limitations accurately.
