# Server Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect every router-mode API read and mutation behind a server-verified password session, with safe first-install setup, expiry, logout, password reset and a clear LAN/reverse-proxy threat model.

**Architecture:** Store only an Argon2id PHC password hash in a mode-0600 file outside the replaceable app directory. The installer generates and prints a one-time high-entropy password only when creating or migrating missing auth state; `xkeen-ui auth reset --prefix …` rotates it and restarts the service. Axum exposes unauthenticated health/session/login/logout endpoints, but all other `/api/v1/*` endpoints require a random opaque HttpOnly SameSite cookie; router mode fails closed when the auth file is absent or malformed. The frontend checks session before starting data polling, displays a login view, and returns to it when a session expires.

**Tech Stack:** Rust/Axum, Argon2id through RustCrypto `argon2`, OS entropy through `rand_core`, frontend TypeScript, Vitest and existing Rust tests/CI.

**Spec:** `PLAN.md` → “Приоритет 0 — безопасность и восстановление”, first and third bullets. No separate user-authored technical-spec file exists in the workspace; preserve the prior limitation that an HTTP LAN session is not protected from passive network interception and recommend VPN or a TLS-terminating reverse proxy.

## Global Constraints

- Never expose router-mode API data or operations before server authentication succeeds.
- Never store plaintext passwords or bearer session tokens on disk or in browser storage.
- Require exact same-origin validation for login, logout, password changes and every other unsafe HTTP method.
- Keep auth state outside the app directory so upgrades do not replace it; create files atomically with owner-only permissions.
- Missing or malformed auth state in router mode is a startup error, not an unauthenticated fallback.
- Use 256-bit random opaque session IDs, store only SHA-256 token digests in memory, and expire sessions after 30 minutes idle or 12 hours absolute.
- Rate-limit login per peer to five failed attempts per 15 minutes; cap remembered peers at 256 and prune expired entries before insertion.
- Limit login request bodies to 4 KiB; never trust forwarded client IP headers by default.
- Keep health, static frontend assets, and the minimal session/login endpoints reachable before login; do not include service, config, or device data in those responses.
- Trust no `X-Forwarded-*` header unless proxy trust is explicitly configured; document the deployment boundary.

## Review Focus

- Missing or malformed auth file on an existing router install: startup fails closed; first-install/update migration creates it and prints a one-time password exactly once.
- Invalid login bursts from one peer: requests are rate-limited without unbounded per-peer memory growth; the valid peer can authenticate after lockout expires.
- Expired, logged-out, or password-rotated sessions: every protected route returns 401 and the frontend returns to login without continuing polling.
- Reverse-proxy and browser CSRF behavior: same-origin unsafe requests succeed, mismatched/missing Origin fails, and untrusted forwarded headers do not change peer identity.
- XSS/storage inspection: session is HttpOnly, SameSite, Path-scoped, absent from localStorage/sessionStorage, and only a hash of the password exists in persisted state.

---

### Task 1: Password and session primitives

**Files:** Create `backend/src/auth.rs`; modify `backend/Cargo.toml`, `backend/Cargo.lock`, `backend/src/main.rs`; test in `backend/src/auth.rs` and `backend/src/main.rs`.

**Interfaces:** `AuthConfig::load(path)`, `AuthConfig::create_random(path)`, `AuthManager::login(peer, password)`, `AuthManager::authenticate(cookie)`, and `AuthManager::logout(cookie)`; session storage contains only hashes of 256-bit random tokens. Use the RustCrypto Argon2id PHC API with its default parameter set and constant-time password verification. Password rotation is handled only through the local recovery command in Task 2; no web password-change flow is in scope.

- [ ] **Step 1: Write failing Rust tests** for valid/invalid password verification, random-password entropy/format, random session token issuance, token hash-only storage, idle/absolute expiry, logout revocation and bounded per-peer login throttling.
- [ ] **Step 2: Run `cargo test --manifest-path backend/Cargo.toml auth::` and confirm expected failures.**
- [ ] **Step 3: Implement auth config, Argon2id password hashing, OS-random token/salt generation, idle/absolute session expiry and bounded per-peer rate limiter.** Persist only the PHC hash and versioned metadata.
- [ ] **Step 4: Run the auth tests and confirm all pass.**

### Task 2: Router API authentication and recovery command

**Files:** Modify `backend/src/main.rs`, `backend/src/installer.rs`; test route guards in `backend/src/main.rs` and install/reset helpers in `backend/src/installer.rs`.

**Interfaces:** Public routes are `/health`, `/api/v1/auth/session`, `/api/v1/auth/login`, and `/api/v1/auth/logout`; all other `/api/v1/*` routes use one authentication middleware. `xkeen-ui auth reset --prefix DIR` rotates auth state, restarts only the managed XKeen UI service, and prints the new password once.

- [ ] **Step 1: Write failing integration-style router tests** that request representative status, DNS, config and mutation endpoints without a cookie, with an invalid cookie, and with a valid cookie; assert only auth endpoints/health remain public and protected paths return 401.
- [ ] **Step 2: Run the focused Rust tests and confirm the current unprotected routes fail the new assertions.**
- [ ] **Step 3: Implement global API auth middleware, login/logout/session endpoints, same-origin enforcement on all unsafe methods, cookie issuance/clearing and fail-closed router startup.** Keep simulation behavior explicitly defined in tests.
- [ ] **Step 4: Write failing installer migration tests** for new install, upgrade with existing auth state, upgrade without legacy auth state, rollback, and password reset.
- [ ] **Step 5: Implement atomic 0600 auth-file creation outside the app directory; preserve existing hash on upgrade; generate/print a one-time password only after successful first install/migration; restart the managed service on reset. If installation or reset rolls back, restore the prior auth file and never print the candidate password.**
- [ ] **Step 6: Run all focused backend tests and installer tests.**

### Task 3: Login lifecycle in the frontend

**Files:** Modify `src/api.ts`, `src/main.ts`; create `src/auth-view.ts` and `src/auth-view.test.ts`; modify frontend tests for startup/polling as needed.

**Interfaces:** `getAuthSession()`, `login(password)`, and `logout()` use same-origin credentials. App startup awaits session state before `render`, refresh, DNS/config/log requests, or timers. On protected API 401, stop requests/timers and switch to login once; after successful login reload the app so all initialization follows the authenticated path.

- [ ] **Step 1: Write failing frontend tests** for escaped login markup, submitting credentials, no protected calls before session, authenticated startup, and session-expiry transition.
- [ ] **Step 2: Run focused Vitest tests and confirm expected failures.**
- [ ] **Step 3: Implement session API helpers, login view, startup gate, logout control and 401 transition without storing credentials/tokens in web storage.**
- [ ] **Step 4: Run focused frontend tests, typecheck and full frontend suite.**

### Task 4: Threat model, end-to-end CI and release evidence

**Files:** Create `docs/security/authentication-threat-model.md`; update `PLAN.md`, `PROJECT_STATUS.md`, and `.github/workflows/ci.yml` only where test coverage needs extension.

- [ ] **Step 1: Document assets, trust boundaries, password/session lifecycle, CSRF/XSS mitigations, proxy assumptions, HTTP LAN interception risk, recovery command and safe deployment requirements.**
- [ ] **Step 2: Extend CI installer smoke test** to complete authenticated status access and assert unauthenticated reads and writes are rejected; ensure generated test password does not enter artifacts/logs.
- [ ] **Step 3: Run frontend tests/typecheck/build, `cargo fmt`, Rust tests/build and all installer/AArch64 CI jobs on the exact release commit.**
- [ ] **Step 4: Download and inspect the CI archive and SHA-256, publish the release, download assets again and record remaining deployment limitations.**
