# XKeen lifecycle, config apply, and UI polish design

## Goal

Make XKeen service actions visibly verifiable, expose Mihomo configuration failures with actionable diagnostics, and make the panel typography and compact layout consistent across screens.

## Current findings

- `backend/src/xkeen.rs::control` sends `restart on`, then considers the operation successful as soon as the process is observed running. If the process was already running, this does not prove a restart occurred. Init command stdout and stderr are discarded.
- `backend/src/main.rs::control_xkeen` emits a tracing event, while the UI Journal reads a bounded allowlist of files. The `xkeen-ui.log` file is already exposed by `backend/src/logs.rs`, but lifecycle events are not appended there.
- `backend/src/config_files.rs::apply` validates a staged YAML file with the active Mihomo binary before replacing the router's current file, then backs up and atomically replaces the file. Failed validation leaves the active config untouched and the backend returns HTTP 422 with its message.
- `src/api.ts::readJson` checks `response.ok` before parsing the JSON error payload. The UI therefore discards Mihomo's validation details and shows only `HTTP 422`. The validator currently reads only stderr, so a diagnostic on stdout is lost.
- Inter Variable and JetBrains Mono Variable are bundled locally. CSS has many small 8–10 px labels and layered overrides; `.app-shell` is currently capped at 1436 px, which must be compared with the supplied reference at the same viewport before choosing a new cap.

## Design

### Service lifecycle and Journal

Keep the existing authenticated router API and init-script control path. Record one sanitized, timestamped lifecycle entry for every accepted start, stop, and restart, including command exit status, before/after observed process state, and verification result. Append these entries to the existing `xkeen-ui.log` under the existing bounded log path; never record bearer tokens, environment variables, or arbitrary request data. Do not pipe init output into the request: the init script can start a daemon that inherits stdout/stderr, so capturing those streams can make the request wait for the daemon. For restart, compare the observed process identity before and after so an already-running process cannot make a no-op command look successful. Return an error when the process transition is not verified. After an action, refresh the Journal and show the XKeen UI log so the result is immediately visible.

Retain the existing DNS safety check that blocks stopping XKeen while DNS handoff depends on it. Keep the action busy indicator active until the backend confirms the requested final state. Explain failures through the existing toast and log without implying success.

### Mihomo YAML editing and apply diagnostics

Keep the existing CodeMirror editor, per-file draft behavior, optimistic `expectedContent` check, Mihomo validation, private backup, atomic replacement, and rollback. Parse JSON error bodies on non-2xx API responses and surface a bounded backend message with the HTTP status. When Mihomo rejects a staged config, combine stdout and stderr, retain the exit code, and return the useful validation text in the existing 422 JSON response. Do not replace the active config on validation failure. Preserve local draft content and router snapshot semantics so users can correct and retry without losing work.

Add an explicit validate-only action for router mode. It runs the selected draft through the active Mihomo binary using a private temporary file in the config directory, removes that file on every completed path, and never replaces the active YAML, creates a backup, or restarts the service. This makes the validator's exact diagnostic available before apply without risking the user's active config.

Use the user's actual router config and returned Mihomo diagnostics during router verification before changing YAML semantics. Do not silently normalize or rewrite user YAML beyond edits made in the editor.

### Typography, width, motion, and ping feedback

Keep locally bundled Inter Variable for UI text and JetBrains Mono Variable for code/log text. Replace scattered tiny-size overrides with a small set of readable type tokens, improve line height and contrast for dense text, and keep numeric values aligned and crisp. Compare the application and supplied reference at the same viewport; set one shell width token to the verified target and remove contradictory max-width overrides. Animate page/modal opening and action feedback with short opacity/translate transitions, and keep ping, restart, and stop busy states visually distinct. Respect `prefers-reduced-motion`.

Avoid copying upstream source or pixel-reproducing its layout. Match the requested compactness and readability using this application's existing components.

## Error handling and safety

- Reject unknown lifecycle actions as today; preserve bearer authentication, same-origin checks, and the serialized core/DNS lock.
- Record failed operations as failures. Never mark a restart successful solely because the process was running before the action.
- Keep output capture and log reads bounded; sanitize secrets and control characters.
- Preserve existing backup, precondition, rollback, and DNS protections for config apply.
- If Mihomo diagnostics are empty, show the exit code and a clear fallback message rather than a generic unexplained 422.

## Verification

- Frontend tests cover JSON error detail preservation, HTTP status retention, and a failure response with no usable message.
- Frontend tests cover the validate-only request shape and its Mihomo error detail.
- Rust unit tests cover lifecycle transition verification and bounded/sanitized command output formatting, plus validation diagnostics sourced from stdout, stderr, or both.
- Run frontend typecheck, full test suite, and production build. Run Rust formatting, tests, and target build in CI if the local Windows host lacks Cargo.
- Inspect the UI in a browser at the reference viewport for width, text clarity, modal opening, ping feedback, and service-action busy/finished states.
- On the router, read current core and DNS handoff state first. Exercise the updated panel without changing Mihomo source/fork or DNS ownership. Apply a config only after keeping a backup and verifying the active YAML itself; inspect lifecycle and validation logs after each operation.

## Scope

This work is limited to lifecycle observability/verification, existing Mihomo config edit/apply flow, and shared visual feedback/readability. It does not change core source selection, user routing rules, DNS ownership, or the user's YAML content by default.
