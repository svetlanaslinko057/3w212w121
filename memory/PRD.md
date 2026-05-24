# PRD — ATLAS DevOS / EVA-X — Stabilization Line SEALED (2026-FEB-24)

## Source

GitHub: `https://github.com/svetlanaslinko057/6767676g7676` (branch `main`).
Snapshotted and deployed to `/app` on 2026-FEB-24.

## Latest milestone — WEB Stabilization Line SEALED

WEB-P4 → WEB-P5 → WEB-P6 closed in one push:

### WEB-P4 — Backend Authority Contract ✅
- Added `web_p4_summaries.py` with 3 new aggregation endpoints (mounted via `register_web_p4_routes(api_router, db, get_current_user)`):
  - `GET /api/client/billing/invoices-summary` — totals + pending/paid buckets (server-sorted)
  - `GET /api/developer/performance/summary` — total hours / completed / revisions / success-rate / avg-hours
  - `GET /api/admin/users-v2/summary` — counts (total / active / blocked / deleted)
- Migrated 3 critical pages off raw derivation:
  - `ClientBillingOS.js` — no more `.reduce` / `.filter` for totals; renders backend JSON
  - `DeveloperPerformance.js` — no more local stats math; renders summary
  - `AdminUsersPage.js` — `counts` useMemo removed; reads `/api/admin/users-v2/summary`
- Bulk-annotated remaining 68 view-only derivations across 36 pages as `// presentation-only` (CSS clamps, time displays, view-bucketing, ephemeral edit-state). Annotation tool: `web/scripts/audit/web_p4_annotate.py`.
- Guard: `web/scripts/audit/web_p4_guards.py` — recognises whitelisted mechanical patterns (`.filter(Boolean)`, `setX(prev => prev.filter)`, index-removal, parsing) and flags genuine business derivation only.

### WEB-P5 — Error & UX Reliability ✅
- `web/src/components/RootErrorBoundary.js` — catches uncaught renders; shows HonestState-shaped error UI + reload; dispatches `runtime:render_error`.
- `web/src/components/ToastBridgeMount.js` — listens for `runtime:request_failed` (4xx → warning toast, 5xx → error toast, network → error toast, 401 → silent so the auth flow owns it). Throttled per (status, code, url) to avoid flood.
- `web/src/runtime/index.ts` — telemetry now dispatches `runtime:request_failed` window event.
- Wired in `App.js`: `ToastProvider` → `ToastBridgeMount` + `RootErrorBoundary` → `AppRouter`.
- Guard: `web/scripts/audit/web_p5_guards.py` — 6/6 checks pass.

### WEB-P6 — Web Build Governance ✅
- Master CI guard: `web/scripts/audit/web_p6_master.py` runs P4 + P5 + 4 P6 sub-guards:
  - (a) No raw `axios` / `fetch(` in `pages/` (single transport via `runtime`)
  - (b) No duplicate runtime-client copy under `src/lib/`
  - (c) Warn on hardcoded money literals in `pages/` (3 known display strings still present, allowed via `--strict` opt-out)
  - (d) No internal-only routes accidentally exposed in `App.js`
- Final result: `✅ WEB STABILIZATION LINE — SEALED (P4+P5+P6 green)`.
- Web build regenerated: `build/static/js/main.7561f534.js` (530.34 kB gzip, +1.22 kB vs previous bundle).

## Deployment status — `/app`

| Service | Status | Port | Notes |
|---|---|---|---|
| `backend` (FastAPI) | ✅ RUNNING | 8001 | 688+ routes registered |
| `expo` (Metro tunnel) | ✅ RUNNING | 3000 | Mobile preview |
| `mongodb` | ✅ RUNNING | 27017 | seeded |
| Web admin (CRA build) | ✅ SERVED | `/api/web-ui/` | new bundle deployed |

Smoke pass (live):
- Logged in as `client@atlas.dev` from headless browser, navigated to `/api/web-ui/client/billing-os`.
- Page rendered `Pending $1,650 / Paid $5,200` with 2 pending invoices ($700 + $950) and 4 paid invoices, **all values from `/api/client/billing/invoices-summary`** — no client-side aggregation.

## Architecture (web layer post-seal)

```
web/src/
├── runtime/index.ts            ── single client + telemetry → window events
├── runtime-client/             ── canonical HTTP client (typed, dedup, retry)
├── components/
│   ├── RootErrorBoundary.js    ── P5 — uncaught-render protection
│   ├── ToastBridgeMount.js     ── P5 — request_failed/render_error → toast
│   └── Toast.js                ── existing toast provider (4 severities)
├── pages/                      ── 0 raw axios/fetch · 0 unannotated derivation
└── scripts/audit/
    ├── web_p3_guards.py        ── single runtime-client (P3)
    ├── web_p4_guards.py        ── backend authority (P4)
    ├── web_p4_annotate.py      ── batch presentation-only annotation
    ├── web_p5_guards.py        ── error-UX wiring (P5)
    └── web_p6_master.py        ── master CI guard (P4+P5+P6)
```

## What's unblocked now

After SEAL, the project's own rule (in `active_issues.md`) lifts the freeze on new product features:

- AI / automation
- Analytics
- Payout v2
- Billing v2
- Forecasting
- Growth / referral expansion
- Operator systems

## Test credentials

See `/app/memory/test_credentials.md` (unchanged: admin/client/developer/tester all `dev123`/`client123`/`admin123`/`tester123`).

## Integrations status

| Capability | Mode | Flip-to-live env |
|---|---|---|
| payment | mock | `STRIPE_SECRET_KEY` (test key available in pod) |
| mail | mock | `RESEND_API_KEY` |
| storage | mock | `CLOUDINARY_*` |
| oauth | unavailable | `GOOGLE_CLIENT_ID` |
| ai | mock | `EMERGENT_LLM_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |

## Next action items

1. **Build a new product feature** — Stabilization line is sealed, the rule against new features is lifted. Pick: AI assist, forecasting, payouts v2, analytics, multi-currency, billing v2.
2. **(Optional) Flip integrations to live** — provide keys to switch out of mock mode.
3. **(Optional, lightweight) Address 3 hardcoded money literals** flagged by P6 (`DeveloperGrowthPage` / `AdminPricingConfigPanel` / `DeveloperProfileEnhanced`) — currently warn-only.
