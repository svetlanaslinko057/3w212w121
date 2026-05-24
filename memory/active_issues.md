# 🟡 Active Issues — Monetization Era

> WEB Stabilization Line **SEALED** on 2026-FEB-24.
> Now in MONETIZATION + OPERATIONAL SCALE era.
> Active work: **Payouts v2**.

## Open work

### 🟡 PAYOUTS_V2 — P0 ✅ + P1 ✅ + P3 ✅ + P5 ✅ done; P2 → P4 pending

- **Charter:** `/app/docs/active-audits/PAY_V2_P0_CHARTER.md` (signed off 2026-FEB-24)
- **Discovery:** `/app/docs/active-audits/PAYOUTS_V2_DISCOVERY.md`
- **P3 closeout:** `/app/docs/active-audits/PAY_V2_P3_DEPLOYED.md` (2026-05-24)
- **P5 closeout:** `/app/docs/active-audits/PAY_V2_P5_DEPLOYED.md` (2026-05-24)
- **Sequence (locked by user):** P3 ✅ → P5 ✅ → P2 → P4. Foundation correctness + execution + operational visibility before live money.
- **Status:** Foundation + autonomous execution engine + operational UI deployed. Master guard: `python3 /app/backend/scripts/audit/pay_v2_master.py` → ✅ pass.
- **Decisions locked:** 1A (Stripe Connect + PayPal Payouts), 2C (Hybrid cadence), 3C (`/api/payouts-v2/*` unified namespace), 4C (Soft KYC), 5A (USD-only).
- **What's live (P0+P1+P3+P5):**
  - SettlementProvider ABC + MockSettlementProvider (capability=SETTLEMENT registered + manifest fallback added)
  - 5 Mongo collections: `payout_batches_v2`, `payout_items_v2`, `payout_v2_events`, `payout_v2_idempotency`, `dev_payment_profiles`
  - 10-state item state machine + worker tracking fields (claimed_by / lease_until / heartbeat / attempt_count / next_attempt_at / dead_lettered)
  - Hybrid-cadence scheduler loop (proposes batches)
  - **PAY-V2-P3 autonomous worker** — lease-based claim · heartbeat · stale-lease reaper · exponential backoff with jitter · dead-letter · per-item isolation · provider timeout · idempotent execution · mock advancer simulates webhooks · 13 env-driven config knobs · 9 new event kinds for audit
  - **PAY-V2-P5 operational UI** — 2 web pages (`AdminPayoutsQueue.js` + `AdminPayoutBatchDetail.js`) with queue health strip, status grid, attention table, batch drill-down with per-item event timeline; 3 Expo screens (`admin/payouts.tsx` + `admin/payout-batch/[batchId].tsx` + `developer/payout-profile.tsx`); WEB-P4 backend-authority discipline preserved (no client-side `.reduce()` aggregation — master guard enforces)
  - Admin operational queue, batch CRUD, item transitions, override path (audited)
  - Developer payment-profile self-service (soft-KYC enforced — server strips kyc_status from PUT body)
  - **14 endpoints total** under `/api/payouts-v2/*` (4 added in P3 + 10 existing)
- **Verified end-to-end:**
  - P3 happy path: 6 approved earnings → batch released → 6 items → all reach `settled` in 3 drain cycles (`test_payouts_v2_worker_e2e.py`).
  - P3 failure path: 3 attempts with forced-fail provider → 2 retry_scheduled with backoff_sec → exhausted (terminal failed, dead_lettered=True) (`test_payouts_v2_worker_failure.py`).
  - P5 web admin: `/admin/payouts-v2` renders queue health, status grid, attention, recent batches — screenshot confirmed.
  - P5 expo mobile: `/admin/payouts` renders attention-first layout with health tiles, status grid, empty states — screenshot confirmed.
  - Bonus: `/api/integrations/manifest` was 500 (KeyError: SETTLEMENT) — fixed in `backend/integrations/registry.py` fallback path. Now 200.
- **Phases remaining (locked sequence):**
  - **P2** Live rails (Stripe Connect + PayPal Payouts adapters + webhook endpoints). Plugs into existing provider abstraction — worker semantics already battle-tested against mock. UI surfaces will reflect REAL failures from day one. Requires: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` + `PAYPAL_WEBHOOK_ID`.
  - **P4** Reconciliation + divergence observer. Becomes meaningful only after P2 (real settlement events from live providers).

- **Charter:** `/app/docs/active-audits/PAY_V2_P0_CHARTER.md` (signed off 2026-FEB-24)
- **Discovery:** `/app/docs/active-audits/PAYOUTS_V2_DISCOVERY.md`
- **P3 closeout:** `/app/docs/active-audits/PAY_V2_P3_DEPLOYED.md` (2026-05-24)
- **Sequence (locked by user):** P3 → P5 → P2 → P4. Foundation correctness before live money.
- **Status:** Foundation + autonomous execution engine deployed. Master guard: `python3 /app/backend/scripts/audit/pay_v2_master.py` → ✅ pass.
- **Decisions locked:** 1A (Stripe Connect + PayPal Payouts), 2C (Hybrid cadence), 3C (`/api/payouts-v2/*` unified namespace), 4C (Soft KYC), 5A (USD-only).
- **What's live (P0+P1+P3):**
  - SettlementProvider ABC + MockSettlementProvider (capability=SETTLEMENT registered)
  - 5 Mongo collections: `payout_batches_v2`, `payout_items_v2`, `payout_v2_events`, `payout_v2_idempotency`, `dev_payment_profiles`
  - 10-state item state machine (queued→initiated→in_flight→confirmed→settled→reconciled, + failed/returned/disputed/cancelled terminals)
  - Hybrid-cadence scheduler loop (proposes batches)
  - **PAY-V2-P3 autonomous worker** (`backend/payouts_v2_worker.py`):
    - Lease-based claim semantics (Mongo-atomic `find_one_and_update`, FIFO)
    - Per-item heartbeat extends lease; stale-lease reaper recovers crashed workers (separate loop, default 30s)
    - Exponential backoff with full jitter on transient failures
    - Dead-letter after `max_attempts` → terminal `failed` + `exhausted` event
    - Per-item isolation (Pr-6) — one bad item never breaks the loop
    - Provider call wrapped in `asyncio.wait_for(timeout)` — timeout is transient
    - Idempotent provider execution (item's `idempotency_key` re-passed each attempt)
    - Mock advancer simulates webhooks for mock rail (`initiated→in_flight→confirmed→settled`)
    - Stuck-item detection (items past `stuck_after_sec` in `initiated`/`in_flight` surface for admin)
    - Full audit trail: 9 new event kinds (worker_claimed, provider_called, retry_scheduled, worker_released, lease_expired, exhausted, admin_force_retry, admin_force_dead_letter, plus existing transitions)
    - 13 env-driven config knobs (no hardcoded literals)
  - Admin operational queue, batch CRUD, item transitions, override path (audited)
  - **4 new admin endpoints (P3):** `GET worker/status`, `POST worker/drain-once`, `POST items/{id}/force-retry`, `POST items/{id}/dead-letter`
  - Developer payment-profile self-service (soft-KYC enforced)
  - **14 endpoints total** under `/api/payouts-v2/*`
- **Verified end-to-end:**
  - Happy path: 6 approved earnings → batch released → 6 items → all reach `settled` in 3 drain cycles, full event chain confirmed (`test_payouts_v2_worker_e2e.py`).
  - Failure path: 3 attempts with forced-fail provider → 2 retry_scheduled with backoff_sec → exhausted (terminal failed, dead_lettered=True, attempt_count==max_attempts) (`test_payouts_v2_worker_failure.py`).
  - Idempotency: same key returns same batch_id (P1 verified earlier).
- **Phases remaining (locked sequence):**
  - **P5** UI surface (web + Expo) — admin operational queue, batch detail, item history, payment-profile self-service. UI now has REAL events to render (no synthetic stubs).
  - **P2** Live rails (Stripe Connect + PayPal Payouts adapters + webhook endpoints). Plugs into existing provider abstraction — worker semantics already battle-tested against mock.
  - **P4** Reconciliation + divergence observer. Becomes meaningful only after P2 (real settlement events).

## Closed Audits

### ✅ WEB_STABILIZATION_LINE — SEALED 2026-FEB-24

All 6 phases closed. Master guard: `python3 /app/web/scripts/audit/web_p6_master.py` (0 failures).

### ✅ WEB_AUDIT_2026-02-FEB — SEALED 2026-FEB-24

Folded into WEB-P4 closeout.

### ✅ MONEY_SUBSTRATE Phase 2C-B — SEALED (pre-existing)

Canonical ledger + projections + passive divergence observer. AST guards locked.

## Rules

1. Run `python3 /app/web/scripts/audit/web_p6_master.py` before merging frontend changes.
2. Once Payouts v2 charter is signed (§6), move this entry from "DISCOVERY" → "ACTIVE" and add the phase checklist.
3. Do not touch sealed substrates (money substrate, web stabilization) — extend, don't refactor.

## Index of audit folders

| Папка | Назначение | Файлов |
|-------|------------|--------|
| `/app/docs/active-audits/` | 🟡 1 — `PAYOUTS_V2_DISCOVERY.md` | 1 |
| `/app/audit/` | 📚 Исторические артефакты Phase 2A/2B/2C — read-only | 85 |
| `/app/docs/closed-audits/` | ✅ Закрытые аудиты | (per file) |
