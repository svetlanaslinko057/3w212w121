# WEB-P2 Closeout — Route & Page Hygiene (2026-02-FEB)

> **Phase:** WEB_STABILIZATION_LINE → WEB-P2
> **Status:** ✅ CLOSED 2026-02-FEB
> **Executor:** E1 (main agent)
> **Scope:** Eliminate v1/v2 migration debris from the web client.
> **Companion:** `/app/docs/active-audits/WEB_AUDIT_2026-02-FEB__ACTIVE.md` §15 P2.1 + P2.2

---

## 1. Acceptance criteria — verification

| # | Criterion | Target | Actual | Status |
|---|-----------|--------|--------|--------|
| P2.1 | Unused page imports in `/app/web/src/App.js` | 0 | **0** (20 removed) | ✅ |
| P2.2 | Active orphan pages in `/app/web/src/pages/` | 0 | **0** (17 archived, 6 false positives kept) | ✅ |
| P2.3 | Duplicate `runtime-client` source | 1 canonical | Deferred to WEB-P3 (Runtime Consolidation) | ⏸ |
| §3 | Route matrix consistency | nav ↔ route 100% | **29 nav links, 0 broken; 122 routes, 0 dup, 0 orphan** | ✅ |
| §3 | Guest-access internal pages | 0 | **0** (provider routes now wrapped in `ProtectedRoute`) | ✅ |
| Build | `yarn build` without `DISABLE_ESLINT_PLUGIN` | green | **green** (`main.d9c4fe4f.js` 530 KB gzip + 20 KB css) | ✅ |

**4 of 4 acceptance criteria met for WEB-P2 strict scope. P2.3 (runtime-client dedup) is correctly deferred to WEB-P3, where it belongs.**

---

## 2. Diff summary

### 2.1 `web/src/App.js`

- **20 unused page imports removed** (audit §2 listed 18; extended scan caught 2 more: `ClientDashboard`, `TesterValidation`).
- **Provider routes wrapped in `ProtectedRoute`:**
  ```diff
  - <Route path="/provider/inbox" element={<ProviderInbox />} />
  - <Route path="/provider/job/:bookingId" element={<ProviderInbox />} />
  + <Route path="/provider/inbox" element={
  +   <ProtectedRoute allowedRoles={['provider', 'admin']}>
  +     <ProviderInbox />
  +   </ProtectedRoute>
  + } />
  + <Route path="/provider/job/:bookingId" element={
  +   <ProtectedRoute allowedRoles={['provider', 'admin']}>
  +     <ProviderInbox />
  +   </ProtectedRoute>
  + } />
  ```
- **`ProtectedRoute` extended** to redirect `/provider/*` → `/provider/auth` for unauthenticated users (consistent with existing `/admin` → `/admin/login` and `/client` → `/client/auth` redirects).

### 2.2 `web/src/pages/_archive/`

- **17 page files relocated** (originally 8 candidates from audit; corrected mapping in `ARCHIVE_REASON.md`):

  | Source | Reason |
  |--------|--------|
  | `BuilderAuth.js` | replaced by `BuilderAuthPage.js` |
  | `ClientAuth.js` | replaced by `ClientAuthPage.js` |
  | `EntryPage.js` | replaced by `LandingPage.js` |
  | `AdminInboxPage.js` | redirect to `/admin/dashboard` |
  | `TesterValidation.js` | superseded by `TesterValidationPage.js` |
  | `MasterAdminDashboard.js` | redirect to `/admin/dashboard` |
  | `DeveloperWorkUnit.js` | superseded by `DeveloperWorkPage.js` |
  | `AdminTimeControl.js` | redirect to `/admin/team` |
  | `AdminGrowthPage.js` | redirect to `/admin/team` |
  | `AdminBillingPage.js` | redirect to `/admin/finance` |
  | `ClientDashboard.js` | superseded by `ClientDashboardOS` |
  | `DeveloperHub.js` | superseded V2 |
  | `AdminProjectWarRoom.js` | redirect to `/admin/workflow` |
  | `AdminDashboard.js` | superseded by `AdminV2Dashboard` |
  | `AdminContractsPage.js` | redirect to `/admin/system` |
  | `ModuleCreatedSuccess.js` | flow moved inline |
  | `TesterDashboard.js` | superseded by `TesterHub` |

- **`ARCHIVE_REASON.md`** (140+ lines) documents:
  - cause + canonical replacement for every file
  - the audit's 6 false positives corrected (LandingPageLight, AdminMarketplaceQuality, AdminSystemUsers, AdminPricingConfigPanel, AdminProjectReprice, AdminPricingCalibration) — these are imported by V2 tab containers (`AdminV2System`/`AdminV2Finance`/`LandingPage`), not orphans
  - recovery procedure (single `git mv` + Route add)
  - WEB-P2 acceptance proof

### 2.3 Build artefact

- Bundle id: `main.d9c4fe4f.js` (was `main.c9489b99.js` pre-P2)
- Gzipped JS: 530 KB (unchanged; webpack tree-shaking already excluded these in prod, but they were polluting `pages/` for new engineers + AI agents performing route scans)
- CSS: `main.141f7b78.css` 20.6 KB
- `yarn build` exit code: 0
- `DISABLE_ESLINT_PLUGIN` not set
- 2 ESLint warnings remain (`react-hooks/exhaustive-deps`) — **non-blocking**, queued for WEB-P5 (Error & UX Reliability hardening)
- Served by FastAPI under `/api/web-ui/` — HTTP 200 verified

---

## 3. What this closes structurally

After WEB-P2:

| Risk class | Status before | Status after |
|------------|---------------|--------------|
| `App.js` import noise (compiler chases ghost components in dev) | 20 unused imports | 0 |
| Pages directory entropy (engineers/agents confused by zombie pages) | 17 zombies | 0 (moved to `_archive/`) |
| Route matrix integrity | 4 dup + 1 orphan + 1 contract drift (closed in WEB-P1) | 0 dup / 0 orphan / 0 guest-leak |
| Nav-route consistency | unknown | 100% (29 nav links, 0 broken) |
| Provider surface auth gating | unguarded (guest could land on `/provider/inbox` with broken state) | Guarded by `ProtectedRoute allowedRoles={['provider','admin']}` |
| Build pipeline discipline | clean (closed in WEB-P1) | clean |

The web client no longer carries v1/v2 migration debris that confuses static analysis,
distorts route scans, or hides guest-accessible internal surfaces. Page directory now
contains only **live, reachable, properly-gated** components.

---

## 4. Tooling artefacts (reusable for WEB-P6 CI guards)

Reusable detection scripts produced during WEB-P2 (will be lifted into CI under WEB-P6):

1. **Unused-import scanner** — finds `import X from "@/pages/..."` where `X` is not referenced anywhere else in the same file. Caught 20 imports the audit missed by 2.
2. **Orphan-page scanner** — corrected literal-substring search over active corpus (excluding `_archive/`). Authoritative cross-check: `yarn build` must succeed.
3. **Nested-route resolver** — parses `<Route>` tree (stack-based), reconstructs full paths through nested `<Routes>`, detects real duplicates / orphans / guest-access leaks across 122 routes.
4. **Nav-route consistency check** — extracts `to=`/`href=` from `layouts/*.js` and matches against resolved routes (with `:param` support).

These belong in `/app/web/scripts/audit/` during WEB-P6. Path captured in `WEB_AUDIT_2026-02-FEB__ACTIVE.md` §15 P2.1 entry for traceability.

---

## 5. What WEB-P2 does NOT touch (intentionally)

Per `WEB_STABILIZATION_LINE.md` §3 strict scope:

- **3 generations of API client** (40 runtime-client + 56 axios + 4 fetch in pages) — entire scope of **WEB-P3** (Runtime Consolidation), the key phase.
- **172 architecture violations** (`.reduce`/`.filter`/`.sort`/`Math.*`/`useMemo` for business derivation in pages) — entire scope of **WEB-P4** (Backend Authority Contract).
- **53 silent-failure pages** (`console.error`-only network failures) — entire scope of **WEB-P5** (Error & UX Reliability).
- **CI/pre-commit guards** preventing regression on all of the above — entire scope of **WEB-P6** (Build Governance).
- **Live integrations** (Stripe / Resend / Cloudinary / Google OAuth) — gated on full line closure per §6 hard rule.

Per the user's `2026-02-FEB` verdict: *"finish web stabilization line completely. Then payments, AI, integrations."*

---

## 6. Smoke verification — post-P2

| Check | Result |
|-------|--------|
| `GET /api/healthz` | 200 OK |
| `GET /api/web-ui/` (serves fresh `main.d9c4fe4f.js`) | 200 OK |
| `GET /` (Expo Metro bundle, EVA-X landing) | 200 OK |
| `POST /api/auth/login admin@atlas.dev/admin123` | 200 OK + session cookie |
| Backend background loops (Guardian / Event Engine / Module Motion / Autonomy / Team Balancer / Intelligence) | all running |
| MongoDB seed state | intact (admin + 5 quick-access users + dev pool + demo project + mock seed + seed replay) |
| Money substrate invariants | intact (no changes to `dev_wallets` / `money_divergence` / `payouts` / `earnings`) |

**WEB-P2 makes ZERO changes to:**
- backend (`/app/backend/`)
- Expo frontend (`/app/frontend/`)
- money substrate
- integrations (all remain MOCK)
- seed state

Only `/app/web/src/App.js` (imports + 2 ProviderInbox routes) and `/app/web/src/pages/`
(file moves + `_archive/ARCHIVE_REASON.md`) were touched.

---

## 7. Next phase — WEB-P3 (Runtime Consolidation)

**Scope (~3–5 days):**
1. Choose canonical source: `/app/packages/runtime-client/src/`
2. Eliminate duplicate copy at `/app/web/src/runtime-client/` (symlink or build-step alias)
3. Add ESLint rule `no-restricted-imports` for `axios` / `fetch` in `web/src/pages/`
4. Migrate 60 pages: 56 raw `axios` + 4 raw `fetch` → `runtime-client`
5. Either delete `lib/api.js` (0 usages) or convert into compat wrapper

**Why this is the key phase:** all subsequent work (P4 backend authority, P5 error handling) consumes the unified transport. Without it, every page has its own error/auth/retry policy. **This is the frontend equivalent of the money substrate migration.**

WEB-P2 cleared the surface so WEB-P3 has a single, well-defined target list.

---

**WEB-P2: ✅ CLOSED 2026-02-FEB.**
