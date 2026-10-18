# Архитектура XKeen UI

Состояние описано по исходникам v0.4.4, а не по раннему прототипу.

```text
Браузер: TypeScript + Vite
  ├─ typed fetch API → Rust/Axum :1001 по умолчанию
  ├─ Mihomo Clash API proxy → localhost Mihomo controller
  └─ CodeMirror YAML/JSONC editor → API config operations

Rust backend
  ├─ статус XKeen и system metrics
  ├─ Mihomo read/control adapters
  ├─ логи и config file access
  ├─ transactional DNS toggle helpers
  └─ core/app updater and installer wrappers

POSIX installer
  └─ target archive → SHA256 verification → install/update/remove
```

## Frontend

- `src/main.ts`: shell, navigation, polling, dialogs and event handlers.
- `src/api.ts`: typed requests and runtime validation for backend and Mihomo response payloads.
- `src/mihomo-view.ts`: selector, connection, provider, rule and DNS query UI.
- `src/dns-view.ts`: DNS status, management, diagnostics and Mihomo resolver fields.
- `src/yaml-editor.ts` and `src/config-*`: YAML/JSONC drafts, validation, save/apply lifecycle and backup UI.
- `src/templates.ts` and `src/templates/zxc-rv`: bundled core-specific templates. Imported content begins as an editor draft.
- `src/journal-*`: log parsing, display, filtering, scroll preservation and browser-local clear markers.
- `src/preferences.ts`: UI preferences. Drafts use tab-scoped session storage; log clear markers persist in browser storage.
- Vite packages local Inter and JetBrains Mono fonts; production assets do not require an external CDN.

## Backend API

`backend/src/main.rs` registers `/api/v1/status`, `/api/v1/xkeen`, `/api/v1/logs`, `/api/v1/config/*`, `/api/v1/settings/*`, `/api/v1/mihomo/*`, `/api/v1/router/devices`, `/api/v1/cores/install`, `/api/v1/dns`, and `/api/v1/xkeen/control`, plus `/health`. Domain code lives in `config_files.rs`, `core_update.rs`, `dns_control.rs`, `installer.rs`, `logs.rs`, `mihomo.rs`, `router_devices.rs` and `xkeen.rs`.

Read APIs are not protected by a user login/session. Mutating routes run `require_same_origin`, which is a CSRF boundary, not authentication or authorization. The backend binds to `127.0.0.1` by default; `XKEEN_BIND` can change that. Expose it only behind a VPN or an independently authenticated reverse proxy until server-side panel authentication and sessions exist.

Mihomo controller requests are restricted to loopback authorities and bounded request/response handling in `mihomo.rs`. Config APIs use fixed file allowlists and limits. Mihomo apply validates/backs up before restart and uses recovery logic; Xray apply has separate fixed targets. These implementations still need device and version coverage beyond CI.

## DNS and recovery boundaries

DNS management changes router IPv4 DNS handoff to Mihomo and can return control to KeeneticOS. Static IPv6 DNS, DoH/DoT and content-filter state are not fully controlled or guaranteed to be restored. Treat device DNS, firewall, core install and config apply operations as state-changing actions; confirm the UI warning, validate inputs and keep rollback evidence. Never infer complete DNS restoration from a successful Mihomo config write alone.

## Build and verification

Frontend: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm build`. Rust backend: `cargo fmt --check`, `cargo test --locked`, `cargo build --release --locked`. Installer: `sh -n install.sh`, installer tests and ShellCheck. GitHub CI also cross-builds Linux AArch64 release artifacts. CI does not replace a controlled integration check on a named Keenetic model/OS version; v0.4.4 has not been tested on the user's router.
