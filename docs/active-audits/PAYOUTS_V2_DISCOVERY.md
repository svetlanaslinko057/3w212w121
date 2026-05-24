# 💰 PAYOUTS V2 — Discovery Document

> **Status:** 🟡 DISCOVERY (no implementation yet)
> **Owner:** main
> **Started:** 2026-FEB-24
> **Depends on:** ✅ WEB Stabilization Line SEALED · ✅ Money Substrate Phase 2C-B SEALED
> **Blocks:** Provider Settlement Layer → Analytics → AI/Automation
> **Mirror in active_issues.md** when this moves from DISCOVERY → ACTIVE.

---

## 0. Goal of this document

Karte what already exists, identify the gap, and phase the work so we don't
spelunk into substrate again. **No code is written in this step.** Decisions
expected from user at §6.

---

## 1. What already exists (verified in `/app/backend` on 2026-FEB-24)

### 1.1 Earnings layer (`earnings_layer.py` — 1290 lines)

Full per-task earning lifecycle with **8 statuses**:

```
draft → pending_qa → approved → batched → paid
                  ↘  held / flagged / cancelled
```

- Calculates `base_earning + time_adjustment + quality_adjustment + manual_review_adjustment`
- Confidence gate (`time_confidence_score < 0.6` → flagged)
- Revision impact (low/medium/high), revision cost, quality penalties (0/-5%/-10%)
- Explainability blob attached to every earning (audit-friendly)
- `frozen=True` on batching → immutable amount
- Bridges to `money_ledger` via `bridge_task_earning_approved/reversed`

### 1.2 Payout-batch layer (`payout_layer.py` — 563 lines)

Per-batch lifecycle with **3 statuses**:

```
draft → approved → paid
```

Functions: `create_payout_batch`, `approve_payout_batch`, `mark_batch_paid`,
`get_developer_batches`, `get_batch_details`, `get_admin_batch_overview`,
`get_approved_earnings_ready_for_batch`.

Key properties:

- SNAPSHOT amounts (computed once at `create_payout_batch`, never recalculated)
- Double-batch protection (`payout_batch_id` + `frozen` flags on earnings)
- Trust-payout link (low-confidence earnings flagged but not blocked — admin decision)
- On `mark_batch_paid` → `bridge_payout_processed` records canonical money event

### 1.3 Escrow layer (`escrow_layer.py` + `escrow_api.py` + `client_escrow.py`)

Client → escrow → developer flow:
`create_escrow → fund_escrow → release_escrow / refund_escrow`
Bridges every state change to money substrate.

### 1.4 Money substrate (Phase 2C-B SEALED)

`money_ledger.py` (canonical events), `money_projections.py`
(`dev_wallets_projection`, `client_billing_projection`), `money_bridge.py`
(every operational write also records `ledger_event`), `money_divergence.py`
(passive observer — read-only diagnostic).

After SEAL: **ledger is the source of truth for money**. Projections are
deterministic. Legacy `dev_wallets` and `client_escrows` exist but are
diagnostic-only.

### 1.5 Provider abstraction (`integrations/payment.py`)

Vendor-neutral contract for **inbound** payments (charge clients):

```python
class PaymentProvider:
    capability = Capability.PAYMENT
    async def create_checkout(req: CheckoutRequest) -> CheckoutResult
    async def verify_webhook(body, headers)  -> PaymentEvent
```

Live: `StripePaymentAdapter` (charge cards) · Mock: `MockPaymentProvider`.

### 1.6 Endpoint surface (count: 28 payout-related)

| Group | Endpoints | Surface |
|---|---|---|
| Developer earnings | `/api/developer/earnings/{summary,tasks,held,flagged}` | 4 |
| Admin earnings | `/api/admin/earnings/{overview,approved,held,flagged}` | 4 |
| Admin payout-batches | `/api/admin/payout/batches{,/{id},/{id}/approve,/{id}/mark-paid}` | 5 |
| Developer payout-batches | `/api/developer/payout/batches` | 1 |
| Admin dev-payouts (v1) | `/api/admin/dev-payouts/{create-batch,batch/{id}/approve,batches,pending-summary}` | 4 |
| Developer payouts (v1) | `/api/developer/payouts` | 1 |
| Growth payouts | `/api/admin/growth/payouts{,/{id}/approve,/{id}/cancel}` | 3 |
| Developer wallet | `/api/developer/wallet` | 1 |
| Learning-credit candidates | `/api/admin/learning/{...}` | 5 |

---

## 2. What is **missing** for Payouts v2

### 2.1 No outbound-payment provider abstraction

`PaymentProvider` is **inbound only** (charge clients). There is no:

- `SettlementProvider` abstraction (pay developers OUT)
- Stripe Connect / Stripe Transfers integration
- PayPal Payouts / Wise / SEPA / crypto rails
- Per-developer `payment_profile` (rails, account ID, country, KYC state)

`mark_batch_paid` today is **manual admin action**. The money never actually moves.

### 2.2 No per-payment status lifecycle

A batch goes `draft → approved → paid`. But **between approved and paid**, a
real-world payout has many sub-states the system can't represent:

```
queued → initiated → in_flight → confirmed → settled → reconciled
                              ↘ failed / returned / disputed
```

### 2.3 No partial / split payouts

A batch is atomic — one developer, one batch, one `final_amount`. There's no
way to:

- Pay 50% now via Stripe Connect, 50% next week
- Split a batch by currency (USD via Stripe, EUR via Wise)
- Hold-back a portion as "performance reserve"
- Net out negative adjustments from a separate earning batch

### 2.4 No payout queue / worker

Approval and mark-paid are synchronous API calls. There's no:

- Background worker consuming a queue
- Retry on provider failure with exponential backoff
- Scheduled payout windows (e.g. "every Friday 5pm UTC")
- Throttling per provider rate limit
- Idempotency keys for replay safety

### 2.5 No reconciliation against provider settlement

When Stripe Connect actually transfers $X to a developer, we never:

- Match provider transaction ID to our `batch_id`
- Detect partial settlements (provider fees, FX)
- Surface discrepancies between our books and provider books
- Handle returns / clawbacks / disputes

### 2.6 No developer-side payout self-service

Developer can see `/developer/earnings/*` and `/developer/payout/batches` but
cannot:

- Choose payment method (rails) per developer
- Set / update their bank / PayPal / wallet
- See expected payout date for an approved batch
- See the per-payment status (queued / in_flight / settled)
- Trigger / cancel an in-flight payment

### 2.7 Two parallel V1 surfaces

`/api/admin/payout/batches/*` and `/api/admin/dev-payouts/*` are **both
active** with overlapping responsibilities. This is the legacy drift the
substrate seal was designed to outlive — Payouts v2 should collapse them.

---

## 3. Phased plan — PAY-V2-P0 … PAY-V2-P5

> Each phase is 2-5 days of focused work. Each ends with a hard acceptance
> contract and a CI guard, mirroring the WEB-stabilization discipline.

### PAY-V2-P0 — Charter (1 day, NO CODE)

- Pick rails: which provider(s) for v2 launch? (Stripe Connect, Stripe
  Transfers, PayPal Payouts, Wise, crypto?)
- Pick currencies: USD-only at launch, or also EUR / UAH?
- Pick cadence: on-demand (admin clicks "pay") or scheduled (Friday 5pm)?
- Decide on `dev-payouts/*` vs `payout/batches/*` collision — which one wins?
- KYC policy: required before first payout, or threshold-based?
- Acceptance: `PAYOUTS_V2_CHARTER.md` signed off by user.

### PAY-V2-P1 — `payment_profile` per developer (2 days)

- New Mongo collection `dev_payment_profiles` (one per developer):
  - `developer_id`, `country`, `preferred_rail`, `rail_config` (JSON,
    rail-specific), `kyc_status`, `kyc_verified_at`, `last_used_at`.
- Backend CRUD endpoints — developer self-service.
- Admin override for KYC state.
- Web + mobile screens (read+write).
- Acceptance: `dev_payment_profiles` has one document per active developer
  (seeded). `/api/developer/payment-profile` GET/PUT round-trips.

### PAY-V2-P2 — `SettlementProvider` abstraction (3 days)

Mirror of `PaymentProvider` but **outbound**:

```python
class SettlementProvider:
    capability = Capability.SETTLEMENT
    async def create_payout(req: PayoutRequest) -> PayoutResult
    async def verify_webhook(body, headers) -> SettlementEvent
    async def reconcile(provider_settlement_id) -> ReconciliationResult
```

- `MockSettlementProvider` (default — moves money in `money_ledger` only).
- `StripeConnectAdapter` skeleton (live).
- `PayPalPayoutsAdapter` skeleton (live).
- `registry.py` extended with `SETTLEMENT` capability + selector.
- Acceptance: `/api/integrations/manifest` reports `settlement` capability
  with mode (`mock` / `live`).

### PAY-V2-P3 — per-payment lifecycle (3 days)

New collection `payouts` (distinct from `payout_batches`):

```
payout_id (uuid)
batch_id (FK)
developer_id
amount, currency
rail (stripe_connect | paypal | wise | crypto | bank_transfer | other)
provider_ref (opaque)
status (queued | initiated | in_flight | confirmed | settled | reconciled
        | failed | returned | disputed | cancelled)
status_history (list of state transitions with reason + actor + timestamp)
idempotency_key
created_at, initiated_at, settled_at, reconciled_at
fees_provider, fees_fx, fees_other
```

- Backend orchestration: `approve_batch` no longer marks the batch paid; it
  enqueues a `payout` per developer per currency.
- Acceptance: every state transition writes a `money_ledger` event AND a
  `payouts.status_history` entry. No status mutates without a reason.

### PAY-V2-P4 — payout queue + worker (2 days)

- Background loop (alongside `auto_guardian` / `module_motion` / `operator`).
- Reads `payouts` where `status=queued`, calls
  `provider.create_payout(req)`, transitions to `initiated` or `failed`.
- Exponential-backoff retry on `failed` (max 5 attempts).
- Webhook endpoint `/api/webhooks/settlement/{provider}` consumes
  `SettlementEvent` and transitions `in_flight → confirmed → settled`.
- Throttling per provider (configurable RPS).
- Idempotency: `idempotency_key` rejects duplicates inside same window.
- Acceptance: integration test — `seed_money_demo` enqueues 6 payouts → all
  reach `settled` within 60s in mock mode.

### PAY-V2-P5 — Reconciliation + governance (2 days)

- New collection `settlement_reconciliations` (per provider settlement file).
- Endpoint `/api/admin/payouts/reconcile` matches provider line-items to
  `payouts.provider_ref`, transitions matches to `reconciled`, surfaces
  unmatched.
- `money_divergence` extended to compare `payouts.amount_total` (per status)
  against `dev_wallets_projection` balances — passive observer, alarm-only.
- Self-service developer view: `/api/developer/payouts/{id}` shows full
  `status_history`.
- Admin view: payouts queue with filters by status / rail / developer.
- CI guard: `pay_v2_guards.py` — every `payout` must be reachable from a
  `payout_batch.batch_id` (no orphan payouts).
- Acceptance: SEAL Payouts v2 with `pay_v2_master.py` (P1+P2+P3+P4+P5 green).

---

## 4. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Schema drift between `task_earnings`, `payout_batches`, new `payouts` | Bridge functions in `money_bridge.py`; AST guards similar to WEB-P6 |
| R2 | Stripe Connect onboarding (KYC) blocks first payout | Mock-first; live rail toggled per-developer via `payment_profile.kyc_status` |
| R3 | Webhook signature drift between providers | `SettlementProvider.verify_webhook` returns normalised `SettlementEvent`; UI never sees vendor payload |
| R4 | Double-pay risk on retry | `idempotency_key` enforced by Mongo unique index; rejected duplicates logged but not re-attempted |
| R5 | Currency / FX | At P0 lock to USD-only; deferred unless user opts in at charter |
| R6 | Reconciliation lag (T+2 settlement) | `payouts.status = confirmed` for ≤72h is normal; alarm only after > 7 days |

---

## 5. Dependencies (gates)

✅ **Money substrate sealed** (Phase 2C-B B4.5) — required for P3 to record
canonical events.

✅ **Web stabilization sealed** (P4+P5+P6) — required for admin / developer UI
to render payout state without local derivation.

✅ **Single runtime-client** — required for typed `payouts` API consumption
on web + mobile.

🟡 **`SettlementProvider` charter** — needs P0 decision (which rails).

🟡 **KYC policy** — needs P0 decision.

---

## 6. Decisions needed from user (before PAY-V2-P0 → P1 starts)

1. **Rails for v2 launch**
   - A) Stripe Connect (US-friendly, KYC required) **+** PayPal Payouts (global)
   - B) Stripe Connect only
   - C) Wise + bank transfer manual
   - D) Crypto rails (USDC on Polygon/Solana)
   - E) Mock only at launch — go live later

2. **Cadence**
   - A) On-demand (admin clicks "pay" per batch)
   - B) Scheduled (every Friday 5pm UTC, or per-developer cycle)
   - C) Hybrid (auto-schedule + admin override)

3. **Collision resolution**
   - Two parallel admin surfaces exist (`/api/admin/payout/batches/*` and
     `/api/admin/dev-payouts/*`).
   - A) Make `payout/batches/*` the canonical surface and `dev-payouts/*` deprecate
   - B) Other way around
   - C) Merge under new `payouts-v2/*` namespace and archive both

4. **KYC**
   - A) Required before any payout (hard gate)
   - B) Required above a threshold (e.g. `$500/lifetime`)
   - C) Soft — collect later, allow first payout in mock mode

5. **Currencies**
   - A) USD-only at v2 launch (recommended)
   - B) USD + EUR
   - C) Multi-currency from day one (USD + EUR + UAH)

---

## 7. Deliverables after this discovery

If user signs off on §6 answers, the next step is **PAY-V2-P0 Charter doc**
(short, 1-page), then PAY-V2-P1 starts coding `payment_profile`.

Until then this discovery doc is read-only.
