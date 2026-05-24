# WEB-P3 Closeout — Runtime Consolidation (2026-02-FEB)

> **Phase:** `WEB_STABILIZATION_LINE` → WEB-P3
> **Status:** ✅ CLOSED 2026-02-FEB
> **Executor:** E1 (main agent)
> **Scope:** Eliminate the fragmented transport layer of the web client (2 runtime-client copies + 45 raw axios + 4 raw fetch files) and consolidate everything behind a single `runtime` singleton.
>
> This is the structural equivalent of the money substrate migration applied to the web frontend transport layer.

---

## 1. Acceptance criteria — verification

| # | Criterion | Target | Actual | Status |
|---|-----------|--------|--------|--------|
| P3.1 | runtime-client sources | 1 canonical | 1 (`/app/packages/runtime-client/src/`); `web/src/runtime-client/` is a symlink | ✅ |
| P3.2 | Request facade | unified API + cookie/session in one place | `runtime.{get,post,put,patch,delete,request}` + middleware chain (token-prime → telemetry → auth-expired → dedup → capability-gate → retry → transport) | ✅ |
| P3.3 | Migrate pages | 0 raw axios + 0 raw fetch in `web/src/pages/` | 45 axios files migrated + 4 fetch files migrated = 49 pages | ✅ |
| P3.4 | Error semantics | every request returns normal error shape | `ApiError` thrown on non-2xx with `.status / .code / .message / .request_id / .retryable`; existing try/catch left untouched (compat) | ✅ |
| P3.5 | Guards | architectural tests prevent regression | `/app/web/scripts/audit/web_p3_guards.py` exits 0 (G1+G2+G3 ✓) | ✅ |
| Build | `yarn build` without `DISABLE_ESLINT_PLUGIN` | green | green (`main.*.js` 530 KB gzip; bundle hash rotates each build) | ✅ |
| Smoke | admin/client/developer routes | 200 | 200/200/200 (login + protected endpoints) | ✅ |
| Auth | flow unchanged | session cookie still works | `POST /api/auth/login` 200 + cookie → `GET /api/auth/me` 200 | ✅ |
| Regression | `/api/web-ui/` still served | 200 | 200 (fresh CRA bundle) | ✅ |

**8 of 8 hard acceptance criteria met. WEB-P3 closed.**

---

## 2. Diff summary

### 2.1 P3.1 — Single runtime-client source

**Before:**
```
/app/packages/runtime-client/src/      ← canonical (claimed)
/app/web/src/runtime-client/            ← static copy (1 line diverged in adapters/expo.ts)
```

**After:**
```
/app/packages/runtime-client/src/      ← canonical (sole source of truth)
/app/web/src/runtime-client/  ─symlink→ ../../packages/runtime-client/src
```

How:
- removed `/app/web/src/runtime-client/` static copy (`rm -rf`)
- recreated as `ln -snf ../../packages/runtime-client/src web/src/runtime-client`
- preserved existing craco config (`webpackConfig.resolve.symlinks = false`, `ModuleScopePlugin` removed) so the symlinked source is processed by babel-loader as part of `paths.appSrc`
- fixed the 1-line divergence in `adapters/expo.ts` (overly-specific ESLint disable rule that CRA's ESLint config doesn't know about)

Webpack alias attempt was reverted — CRA's babel-loader scope rules made a pure alias unworkable across `paths.appSrc`. The symlink approach was the original design (documented in `craco.config.js:43-47`); it just hadn't been wired.

### 2.2 P3.2 — Request facade

The facade existed before WEB-P3 but was used by only a handful of pages. WEB-P3 didn't need to write new transport code — the canonical facade was already in place:

```ts
// /app/web/src/runtime/index.ts
export const runtime = createWebRuntimeClient({
  baseURL: process.env.REACT_APP_BACKEND_URL || '',
  defaultTimeoutMs: 20_000,
  defaultRetries: 2,
  onTelemetry,
});
```

Surface: `runtime.{get, post, put, patch, delete, request}`. Middleware chain provides:
- `x-request-id` header generation
- cookie auth (`credentials: 'include'`) via web adapter
- 401/session-expired auth handling
- GET deduplication
- capability gating
- retry on idempotent + retryable errors
- canonical `ApiError` envelope on failure

### 2.3 P3.3 — Page migration (49 files)

**Automated migration** via `/app/web/scripts/audit/migrate_axios_to_runtime.py`:

| Operation | Count |
|-----------|-------|
| Files where axios import removed | 45 |
| `axios.METHOD()` calls converted to `runtime.METHOD()` | 149 (79 GET + 63 POST + 2 PUT + 2 PATCH + 3 DELETE) |
| `${API}/x` template segments rewritten to `/api/x` | 147 |
| `, { withCredentials: true }` config blocks stripped | 137 |
| Unused `API` import removed from `@/App` | 35 |

**Manual migration** for the 4 fetch files (fetch semantics differ — `res.ok` check, `await res.json()` unwrap):
- `DeveloperDashboard.js` (1 site)
- `DeveloperLeaderboard.js` (1 site)
- `DeveloperProfileEnhanced.js` (3 sites, Promise.all → settle helper)
- `DeveloperTimeControl.js` (1 site)

Each fetch migration:
- imports `runtime` from `@/runtime` and `ApiError` from `@/runtime-client`
- `await fetch(url, { credentials: 'include' })` → `await runtime.get(url)`
- `if (res.ok) { const data = await res.json(); ... }` → `try { const { data } = await runtime.get(url); ... } catch (err) { ... }`
- error handlers updated to suppress noise for ApiError network-class failures (already telemetered by middleware)

### 2.4 P3.4 — Error semantics

The runtime client raises `ApiError` (`/app/packages/runtime-client/src/errors.ts`) on non-2xx. Shape:

```ts
class ApiError extends Error {
  status: number;       // HTTP status code
  code: string;         // backend error_shape `code` (e.g., 'not_found', 'invalid_credentials')
  message: string;      // backend `message` or generic
  request_id: string;   // x-request-id from response, propagated for log correlation
  retryable: boolean;   // backend `retryable` hint
  data?: unknown;       // backend response body (e.g., validation errors)
}
```

**What WEB-P3.4 does NOT do (intentionally):**
- Does not refactor each page's `try/catch` block. Existing local error handling continues to work because ApiError exposes the same `.status` and `.message` axios used.
- Does not add toast UI / global error overlays / retry buttons. That entire concern is the scope of **WEB-P5 (Error & UX Reliability)**.
- Does not enforce error contract types (Zod / runtime validators). That is **WEB-P4 (Backend Authority)**.

The foundation is in place. WEB-P5 can now build unified UX on top with confidence the wire shape is uniform.

### 2.5 P3.5 — Guards

Created `/app/web/scripts/audit/web_p3_guards.py`:

```
============================================================
WEB-P3.5 — runtime architecture guards
============================================================
[G1] Raw axios imports in web/src/pages/: 0
[G2] Raw fetch( calls in web/src/pages/: 0
[G3] ✓ single canonical runtime-client source (symlink /app/web/src/runtime-client → ../../packages/runtime-client/src)
SUMMARY
  ✓  G1 — zero raw axios in pages/
  ✓  G2 — zero raw fetch in pages/
  ✓  G3 — single runtime-client source
```

This script is the architectural test that prevents regression. WEB-P6 (Build Governance) will wire it into pre-commit / CI alongside the WEB-P2 tooling (orphan scanner, nav-route check, nested route parser).

---

## 3. What this closes structurally

| Risk class | Before WEB-P3 | After WEB-P3 |
|------------|---------------|--------------|
| API client generations | 3 (runtime-client + raw axios + raw fetch) | 1 |
| runtime-client source copies | 2 (with 1-line drift) | 1 |
| Cookie/auth policy locations | 49 (per page) | 1 (web adapter) |
| Error envelope formats | 3 (axios `.response`, fetch `.ok`, custom) | 1 (ApiError) |
| x-request-id header generation | unimplemented | universal |
| GET dedup | unimplemented | universal |
| Retry policy | per-page (none in practice) | universal (idempotent + retryable only) |
| Capability gating | per-page (none) | universal |
| Compat-route observability | per-page (none) | universal (telemetry) |
| Session-expired handling | per-page (mostly absent) | universal (auth-expired middleware) |

The web client now has **one transport boundary**. Every business page above that boundary speaks the same wire protocol.

---

## 4. Sequencing — why this had to come before WEB-P4

Per user's 2026-02-FEB verdict:

> *"WEB-P3 — это САМЫЙ важный этап. После него: web stops being 'many apps accidentally connected' и становится single governed runtime surface."*

WEB-P4 (Backend Authority Contract) eliminates `.reduce / .filter / .sort / Math.max / useMemo` business derivations from pages. That work requires:
1. Consistent error envelopes (so backend's "authoritative" responses can be trusted without per-page defensive logic) — ✅ done by P3.4
2. Single fetch path (so the new backend endpoints can be introduced without touching axios → fetch → runtime-client variants) — ✅ done by P3.1 + P3.3
3. Telemetry (so we can see which pages still derive client-side and target them next) — ✅ done by P3.2 middleware

WEB-P5 (Error & UX Reliability) builds toast / retry / loading states. That requires:
1. Uniform error shape across all requests — ✅ done by P3.4
2. Predictable retry behaviour (no double-retry chaos when fetch had its own retry and runtime-client had another) — ✅ done by P3.5 (raw fetch eradicated)

So WEB-P3 is the structural prerequisite for the rest of the line. Without it, P4/P5 would have to migrate the transport layer themselves — exactly the split-brain risk the user called out.

---

## 5. Smoke verification — post-P3

| Check | Result |
|-------|--------|
| `GET /api/healthz` | 200 OK |
| `GET /api/web-ui/` (serves fresh CRA bundle) | 200 OK |
| `GET /` (Expo Metro bundle, EVA-X landing) | 200 OK |
| `POST /api/auth/login admin@atlas.dev/admin123` | 200 + session cookie |
| `POST /api/auth/login client@atlas.dev/client123` | 200 + session cookie |
| `POST /api/auth/login john@atlas.dev/dev123` | 200 + session cookie |
| `GET /api/admin/users` (admin cookie) | 200 |
| `GET /api/client/workspace` (client cookie) | 200 |
| `GET /api/developer/dashboard/summary` (dev cookie) | 200 |
| Backend background loops | all running (Guardian / Event Engine / Module Motion / Autonomy / Team Balancer / Intelligence / Operator Scheduler) |
| Money substrate invariants | intact (no changes to `dev_wallets` / `money_divergence` / `payouts` / `earnings`) |
| Integrations | all remain MOCK (unchanged) |

---

## 6. Files touched

```
/app/web/craco.config.js                          — kept original config (symlink-aware), no functional change
/app/web/tsconfig.json                            — kept original paths
/app/web/src/runtime/index.ts                     — relative import preserved (already worked through symlink)
/app/web/src/runtime-client/                      — replaced with symlink → /app/packages/runtime-client/src
/app/packages/runtime-client/src/adapters/expo.ts — relaxed unknown ESLint rule to plain `eslint-disable-next-line`
/app/web/src/pages/*.js                           — 49 files migrated (45 axios + 4 fetch)
/app/web/scripts/audit/migrate_axios_to_runtime.py  — created (250 LOC) — reusable migration tool
/app/web/scripts/audit/web_p3_guards.py             — created (110 LOC) — wired in WEB-P6
```

**Zero changes to:** backend (`/app/backend/`), money substrate, integrations, seed state, Expo frontend, App.js, App.css.

---

## 7. Next phase — WEB-P4 (Backend Authority Contract)

**Why P4 unblocked now:** the universal `runtime` facade gives every page the same wire shape. Backend can now expose canonical aggregations (e.g., `/api/developer/profile/summary` returning the EXACT UI-rendered shape) and pages migrate from client-side `.reduce/.filter/.sort/Math.max/useMemo` derivations to authoritative reads.

**P4 scope (per WEB_STABILIZATION_LINE.md §6):**
1. Inventory the 172 architecture violations (count from audit baseline)
2. Group by domain (developer money / acceptance / leaderboard / admin marketplace / client portfolio)
3. Add backend `/api/<domain>/summary` endpoints that compute the UI-shaped aggregate
4. Migrate pages: delete client-side derivation, render from authoritative response
5. CI guard: ESLint rule `no-business-derivation-in-pages` (regex on `.reduce(`, `.filter(...).length`, `Math.max(...prices)`, `useMemo([prices])`)

**P4 is the next obligatory step. Per user's hard rule: no new product features until the whole line is closed.**

---

**WEB-P3: ✅ CLOSED 2026-02-FEB.**
