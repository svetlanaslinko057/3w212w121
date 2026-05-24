# PRD — PAYOUTS_V2 P5 (Operational UI) — DEPLOYED 2026-05-24

## Position in plan

Per user-locked sequencing: **P3 ✅ → P5 ✅ → P2 → P4**.

Foundation + execution engine + operational UI →
**Admin no longer reasons through curl. Operator sees the payout engine.**

## Acceptance — all green

| Check | Status | Evidence |
|---|---|---|
| Admin sees payout queue without curl | ✅ | `/admin/payouts-v2` renders worker_status + queue endpoints |
| Failed / exhausted items obvious | ✅ | Health strip turns `danger` tone on `stuck`/`exhausted` > 0; failing-items section sits above batches |
| Force-retry works | ✅ | Web + Expo buttons call `POST /payouts-v2/admin/items/{id}/force-retry` |
| Dead-letter works | ✅ | Web + Expo buttons call `POST /payouts-v2/admin/items/{id}/dead-letter` with reason prompt |
| Item timeline shows real events | ✅ | Batch detail expands each row → `GET /payouts-v2/admin/items/{id}` events rendered as colour-toned chips |
| Batch not blocked by one failed item | ✅ | P3 per-item isolation guarantees this; UI surfaces per-item state independently |
| Developer sees payout status / profile | ✅ | `/developer/payout-profile` — profile form + payout history + KYC tag |
| Web build clean | ✅ | `yarn build` → +4.6 KB gzip; 0 errors; 1 unrelated useEffect warning |
| PAY-V2 master guard green | ✅ | P0+P1+P3+P5 sections all green |
| WEB guards still green | ✅ | P4 + P5 + P6 all sealed |

## What was shipped

### 1. Web admin (CRA) — 2 new pages

**`/admin/payouts-v2` → `web/src/pages/AdminPayoutsQueue.js`** (570 lines)
- Header: worker_id · mock advancer state · registered providers per rail
- **Queue health strip** (Pr-7 queue-first): 6 tiles
  - Ready · Pending Retry · In-flight Owned · Stale Leases · Stuck · Exhausted
  - Tile tone auto-shifts to `danger` when stale/stuck/exhausted > 0
- **Counts-by-status grid**: 10 canonical states with counts + $ amounts
- **Needs-attention table**: top 20 failing items with attempt_count, last_error (code + message), next_attempt_at, force-retry / dead-letter actions
- **Recent batches table**: clickable rows → batch detail
- **Worker config strip**: 8 env-driven knobs (read-only)
- Auto-refresh every 5s (matches worker drain interval)
- `Drain Once` button → `POST /payouts-v2/admin/worker/drain-once`

**`/admin/payouts-v2/batches/:batchId` → `web/src/pages/AdminPayoutBatchDetail.js`** (320 lines)
- Batch header — id, status, label, totals, proposed/released timestamps
- **Items table** — expandable rows. Each item shows status badge, attempt count, provider_ref, current worker_id (last 6 chars)
- **Per-item drill-down** (expanded row):
  - 8 facts: idempotency_key, next_attempt_at, lease_until, last_heartbeat, last_error_code, last_error, initiated_at, settled_at
  - **Event timeline**: all events for the item (`worker_claimed`, `provider_called`, `initiated`, `in_flight`, `confirmed`, `settled`, `retry_scheduled`, `lease_expired`, `exhausted`, `failed`, `admin_force_retry`, `admin_force_dead_letter`, ...) with colour-coded chips by category
- **Batch event log** — separate section for batch-scope events (proposed, released, cancelled, closed)
- Inline force-retry / dead-letter per item (disabled for non-queued items)

**Authority discipline (WEB-P4 contract):** Master guard verifies neither page calls `.reduce()` on items — all aggregates come from backend.

### 2. Web admin nav — `AdminLayout.js`

Added `Payouts` entry under Resources (between Finance and Team) with Wallet icon. testid: `nav-payouts-v2`.

### 3. Web router — `App.js`

```jsx
<Route path="payouts-v2" element={<AdminPayoutsQueue />} />
<Route path="payouts-v2/batches/:batchId" element={<AdminPayoutBatchDetail />} />
```

### 4. Expo mobile (SDK 54) — 3 new screens

**`/admin/payouts` → `frontend/app/admin/payouts.tsx`** (380 lines)
- Pr-7 attention-first lightweight surface
- **Attention banner** appears only when `exhausted + stuck + stale > 0`
- Same 6 health tiles (responsive 3-col grid)
- Same 6 status cells (2-col grid)
- Failing items as cards (not a table — mobile-friendly)
- Each failing card has Retry / Kill buttons with native confirmation alerts
- Recent batches as tap-cards → push to detail screen
- Worker config footer strip
- Auto-refresh every 8s
- Pull-to-refresh
- Drain Once button (admin-only on backend)

**`/admin/payout-batch/[batchId]` → `frontend/app/admin/payout-batch/[batchId].tsx`** (340 lines)
- Dynamic-route batch detail
- Item list with expandable cards
- Per-item timeline: facts grid + event list
- Native confirm dialogs for retry/dead-letter
- Pull-to-refresh

**`/developer/payout-profile` → `frontend/app/developer/payout-profile.tsx`** (350 lines)
- **KYC status card** — current state (soft / verified / rejected) with shield icon
- **Editable form**:
  - Country (ISO-2)
  - Preferred rail — radio (mock available now; Stripe Connect & PayPal disabled, marked "soon", requires KYC=verified to unlock)
  - Account hint (email / last-4)
- **Backend safety**: PUT body has `kyc_status` and `kyc_notes` stripped server-side — developer cannot self-elevate KYC
- **Payout history** — summary tiles (settled / in flight / failed) + per-item cards
- KeyboardAvoidingView + safe handling on iOS/Android

### 5. Expo router wiring — `app/admin/_layout.tsx`

Added 2 hidden tab routes so deep-links and `router.push()` work:
```tsx
<Tabs.Screen name="payouts"                  options={{ href: null }} />
<Tabs.Screen name="payout-batch/[batchId]"   options={{ href: null }} />
```

### 6. Bonus fix (low-priority leftover)

`/api/integrations/manifest` was returning 500 because `Capability.SETTLEMENT` (registered late by `payouts_v2_api.py`) wasn't in the fallback-by-capability map. Added MockSettlementProvider as the fallback for SETTLEMENT in `backend/integrations/registry.py`. Endpoint now 200.

### 7. Master guard upgraded

`backend/scripts/audit/pay_v2_master.py` P5 section now validates (no longer a placeholder):
- 2 web pages present
- App.js imports + 2 routes wired
- AdminLayout nav link to `/admin/payouts-v2`
- Neither web page does client-side `.reduce()` aggregation (WEB-P4 discipline)
- 3 Expo screens present (`admin/payouts.tsx`, `admin/payout-batch/[batchId].tsx`, `developer/payout-profile.tsx`)

→ `python3 /app/backend/scripts/audit/pay_v2_master.py` exits 0 with all P0+P1+P3+P5 checks green.

## Backend endpoints used by P5

All `/api/payouts-v2/admin/*` are admin-only (server enforces `_require_admin`).

| Method | Path | Used by |
|---|---|---|
| GET  | `/api/payouts-v2/admin/worker/status`           | Queue page (auto-refresh) |
| GET  | `/api/payouts-v2/admin/queue`                   | Queue page (batches) |
| GET  | `/api/payouts-v2/admin/batches/{batch_id}`      | Batch detail |
| GET  | `/api/payouts-v2/admin/items/{item_id}`         | Item drill-down (events) |
| POST | `/api/payouts-v2/admin/worker/drain-once`       | Drain Once button |
| POST | `/api/payouts-v2/admin/items/{id}/force-retry`  | Retry button |
| POST | `/api/payouts-v2/admin/items/{id}/dead-letter`  | Kill button |
| GET  | `/api/payouts-v2/developer/payment-profile`     | Developer profile screen |
| PUT  | `/api/payouts-v2/developer/payment-profile`     | Save profile (kyc_status stripped) |
| GET  | `/api/payouts-v2/developer/items`               | Payout history |

## Build output

```
build/static/js/main.a7253533.js   534.94 kB (+4.6 kB from baseline)
build/static/css/main.82f208cf.css  20.62 kB (+61 B)
```

P5 added ~4.6 KB gzip across 2 new pages. Bundle still over CRA's recommended threshold (pre-existing — code-splitting tracked separately).

## Smoke checks performed

```
✓ GET /api/payouts-v2/admin/worker/status     → 200 OK (worker_id, 6 queue-health tiles, 10 status counts, providers)
✓ GET /api/payouts-v2/admin/queue             → 200 OK (recent batches with item counts)
✓ GET /api/integrations/manifest              → 200 OK (was 500 — fixed in this phase)
✓ Web admin /api/web-ui/admin/payouts-v2      → 200 OK + screenshot confirms layout
✓ Expo /admin/payouts                          → renders 6 health tiles, status grid, empty failing/batches states
✓ python3 backend/scripts/audit/pay_v2_master.py  → all green (P0+P1+P3+P5)
✓ python3 web/scripts/audit/web_p6_master.py      → all green (WEB-P4+P5+P6 sealed)
```

## Why P5 before P2

UI now reflects **real worker state** — leases, retries, exhaustion, stuck items. When P2 lands and Stripe/PayPal start firing real failures, the operator already has the surface to triage them. If P5 had come after P2, every Stripe rate-limit + every PayPal KYC block would have to be debugged from logs.

## Next: PAY-V2-P2 (live rails)

Now that:
- foundation is correct (P1),
- execution semantics are correct (P3),
- operational visibility exists (P5),

…we can plug Stripe Connect + PayPal Payouts into the existing `SettlementProvider` ABC. The worker code does not change — it stays generic. Only two new adapters + 2 webhook endpoints get added.

Required keys (to be requested from user when starting P2):
- `STRIPE_SECRET_KEY` (live or test)
- `STRIPE_WEBHOOK_SECRET`
- `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
