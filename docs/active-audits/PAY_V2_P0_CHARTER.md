# 📜 PAY-V2-P0 — Payouts v2 Charter

> **Status:** ✅ SIGNED OFF 2026-FEB-24
> **Scope:** locks decisions + principles for all subsequent PAY-V2-Pn phases
> **Authority:** this document — not chat history, not "intent" — is the contract.

---

## 1. Decisions (from §6 of `PAYOUTS_V2_DISCOVERY.md`)

| # | Decision | Choice |
|---|---|---|
| D1 | Rails for v2 launch | **1A** — Stripe Connect **+** PayPal Payouts |
| D2 | Cadence | **2C** — Hybrid (scheduler proposes, admin releases, override explicit + audited) |
| D3 | Surface collision | **3C** — unified `/api/payouts-v2/*` namespace; legacy `/payout/batches/*` and `/dev-payouts/*` deprecated (kept in code, hidden from new UI) |
| D4 | KYC policy | **4C** — Soft (no launch friction, architecture supports later escalation) |
| D5 | Currencies | **5A** — USD-only at v2 launch |

---

## 2. Hard architectural principles (locked, not negotiable)

### Pr-1 — Canonical authority is the ledger

- Payout state authority = `money_ledger_events` + `payout_batch_events`.
- Stripe / PayPal **never** the source of truth.
- Provider APIs = settlement rails only.
- All UI reads must trace back to canonical events (no derivation from provider response).

### Pr-2 — Batch immutability

- A submitted (`proposed → released`) batch is immutable.
- Corrections only via **compensating events** (new event entries with `kind=adjustment` or `kind=reversal`).
- No in-place mutation of historical batch documents.

### Pr-3 — Provider abstraction

- `SettlementProvider` ABC mirrors `PaymentProvider`.
- Stripe Connect + PayPal Payouts behind the same interface.
- No provider-specific logic in operational routes — only in adapters.

### Pr-4 — Replayability

- Full payout state must be reconstructable from events alone.
- Provider reconciliation is **additive-only** (records a new event, never mutates an existing one).
- Adding a new projection must not require backfill scripts that mutate events.

### Pr-5 — Idempotency everywhere

- `batch.create`, `payout.submit`, provider callbacks, retry flows.
- Mongo unique index on `(idempotency_key, scope)` rejects duplicates.
- Duplicate submission returns the prior result, not an error.

### Pr-6 — Failure isolation

- One failed `payout_item` does **not** invalidate the batch.
- Batch-level state and item-level state are **separate domains**.
- Batch `released` ≠ items `settled`. Batch tracks intent, item tracks reality.

### Pr-7 — Admin UX philosophy

- Queue-first: "what needs action now" above charts/finance-dashboard cosmetics.
- Default landing screen for admin payouts = the queue, not analytics.
- Charts are P5-or-later; operational clarity is P1.

### Pr-8 — Hybrid cadence semantics

- Scheduler creates **proposed** batches (status=`proposed`).
- Admin approves to transition `proposed → released` (or `proposed → cancelled`).
- Admin override path (skip scheduler, create-and-release in one action) MUST emit an `event_kind=admin_override` audit event.

### Pr-9 — Soft KYC

- No launch friction — first payout works in mock without KYC.
- Architecture already carries `payment_profile.kyc_status` field + `kyc_required_above_amount` config (default: `null` for v2 launch).
- When policy escalates (post-launch), no schema migration — just config flip.

### Pr-10 — FX deferred

- All v2 accounting is canonical in **USD**.
- Non-USD support = **new settlement layer**, not a rewrite of v2 substrate.
- v2 schemas store `currency` field but constrain to `"USD"` at write-time.

---

## 3. Out-of-scope for PAY-V2 (explicit)

To prevent scope creep:

- ❌ Multi-currency / FX (deferred per Pr-10).
- ❌ Hard KYC gates (deferred per Pr-9).
- ❌ Provider-specific webhooks beyond Stripe Connect + PayPal Payouts (P0 decision: 2 rails).
- ❌ Analytics dashboards (P5+, separate audit).
- ❌ AI-driven payout decisions (post-stabilization era, separate audit).
- ❌ Real-money tests against live Stripe/PayPal (live-mode toggle off until env keys provided).

---

## 4. Phased plan (locked)

| Phase | Scope | Days |
|---|---|---|
| **PAY-V2-P0** | Charter (this doc) | ✅ done |
| **PAY-V2-P1** | Foundation — batch_v2 + payout_item + SettlementProvider ABC + Mock + scheduler skeleton + admin queue + idempotency + guards | 3 |
| **PAY-V2-P2** | Live rails — `StripeConnectSettlementAdapter` + `PayPalPayoutsSettlementAdapter` + webhook endpoints | 3 |
| **PAY-V2-P3** | Per-item lifecycle worker — background loop drains queue, drives state transitions, reconciles webhooks | 2 |
| **PAY-V2-P4** | Reconciliation + divergence — passive observer comparing `payouts_v2` projection to `dev_wallets_projection` | 2 |
| **PAY-V2-P5** | UI surface — admin operational queue + developer payment_profile self-service + per-batch & per-item drill-down | 3 |

Total: ~13 working days (matches the original discovery estimate).

---

## 5. Definition of "SEALED" for Payouts v2

When all 5 of these are true:

1. `python3 /app/backend/scripts/audit/pay_v2_master.py` exits 0
2. `seed_money_demo.py` end-to-end demo: 6 developers, 6 approved earnings → 6 proposed batches → admin releases → 6 payout_items → all reach `settled` in ≤60s (mock mode)
3. `/api/payouts-v2/admin/queue` returns 0 items in `queued` or `failed` state after demo run
4. Divergence observer reports 0 deltas between `money_ledger` and `payouts_v2_projection`
5. UI (web + mobile) renders queue, batch detail, item history, payment_profile self-service — all read backend-authored JSON, no client-side derivation

---

## 6. What happens after seal

Three audits queue behind PAY-V2 seal:

1. **Provider Settlement Layer expansion** — Wise, SEPA, crypto rails.
2. **Analytics Layer** — payout cohorts, settlement-time histograms, fee analysis.
3. **AI/automation** — anomaly detection on payout patterns, auto-flagging.

None of these start until PAY-V2 is sealed.
