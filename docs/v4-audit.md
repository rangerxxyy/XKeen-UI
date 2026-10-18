# XKeen UI v4.0 audit

Audit baseline: `main` at `36e49f3` / v0.3.7. Reference: [`zxc-rv/XKeen-UI`](https://github.com/zxc-rv/XKeen-UI), release `v1.3.8`, commit `14b63ca` (2026-10-17). The reference is used to compare user-facing capabilities and workflows; its code is not copied.

## Findings by priority

- **P0 — none found in the reviewed frontend paths.** Existing config writes have backend validation, backups, staged replacement and rollback paths; mutations are separated from read-only API routes and check same-origin headers.
- **P1 — log readability:** router UI events were rendered with internal `unix=`, `level=`, `component=` and `source=` fields. The journal now extracts the human message and displays the timestamp/severity in dedicated columns.
- **P1 — log usability/accessibility:** the journal had no pause or copy action and announced the entire changing log body to screen readers. It now supports pausing routine refresh (while keeping refresh active through a service/config restart), copying the filtered visible entries, and a concise live announcement. Copy is disabled when no visible rows are available.
- **P1 — DNS compatibility guidance:** `fake-ip` with the default/explicit `blacklist` filter mode can cause traffic that bypasses Mihomo to fail. The DNS page now reads the live filter mode and shows an actionable warning unless it is `whitelist` or `rule`. It does not change user configuration. Applying an active Mihomo config already validates it and restarts the XKeen service, providing a full-restart path instead of relying on Clash hot reload.
- **P1 — runtime smoke test unavailable locally:** Vite runs, but nothing is listening on its configured backend target `127.0.0.1:1001`; the dev proxy therefore returns HTTP 500 for API calls. No local browser response was fabricated and no user router was touched during this pass.
- **P2 — upstream capability gaps:** this repository has no equivalent yet for the reference's config-backup browser/restore workflow, Geo database scanner, route test suite, plugin-based multi-router config application, or HTTP subscription preview. Existing Mihomo outbound parsing, core updates, config validation, logs and DNS controls remain implemented independently. These gaps require feature-specific security and resource review before release claims.
- **P2 — authentication coverage:** the API validates same-origin for mutations, but there is no complete account/session authentication flow. Router installation binds to the detected `br0` IPv4 address; do not expose the panel through KeenDNS or the public internet without a separate VPN/authenticated gateway.

## Verification performed

- `pnpm test`: 195 frontend tests pass.
- `pnpm build`: TypeScript check and Vite production build pass.
- `git diff --check`: passes.
- Local browser: layout and journal toolbar render; backend-dependent data shows the real proxy error state. A direct probe of `/health` and `/api/v1/status` on `127.0.0.1:1001` confirmed connection refused.
- Rust tests, formatting, Linux backend CI, and the AArch64 cross-build all pass on the current branch head `960cdf5` (CI run `39115788438`).
