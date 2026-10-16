# Execution ledger

- Base: `66dea88` (`codex/connection-table-reference-layout`, clean at start).
- Spec/plan commit: `1e298d3`.
- Task 1: complete. Added three failing regression cases for Mihomo 422 detail, non-JSON fallback, and malformed/empty error bodies. Red run: 3 failed, 86 passed. Green run after `src/api.ts` fix: 91 passed; `pnpm typecheck` exit 0.
- Rulings: Treat the user's repeated “делай, не останавливайся” and “полный доступ, да” as authorization to proceed with the recommended incremental design and execute the task inline. Router mutation/release remain governed by the project's existing safety rules and prior explicit authorization.
- Ruling: Keep init-script stdout/stderr detached rather than capturing it — the existing init command can spawn a daemon that inherits those descriptors, and waiting for pipe EOF can block until the daemon exits. The journal will record the command exit code and verified state transition; Mihomo's finite `-t` validator output will still be captured for the YAML diagnostic.
- Latest workspace verification: `pnpm test` passes 95/95, `pnpm typecheck` exits 0, `pnpm build` exits 0, and `git diff --check` is clean. Windows has no `cargo`, `rustc`, or `rustfmt`; the GitHub CI run is required before claiming Rust compilation/tests pass.
- Router read-only observation: panel v0.2.18, XKeen running, Mihomo v1.19.32-r4, DNS Override and DNS Mihomo active, runtime config loaded as 622 lines. The active config content was not displayed or modified. Stop remains prohibited while DNS handoff is active; lifecycle restart awaits installing the candidate.
- Follow-up: add a validate-only API/UI action so the current or edited YAML can be checked by the router's active Mihomo binary without replacing the active config, writing a backup, or restarting the core. Frontend red run: 2 new tests failed with missing export; green run after API implementation: 95/95.
