# Phase 2C-B4.3-D4 — Acceptance (2026-02-FEB)

**Scope**: `cancel_developer_withdrawal` — last remaining writer in the
withdrawal lifecycle migrated to canonical-only.

**Status**: ✅ **GREEN** — 9/9 D4 acceptance tests pass, 38/38 regression
suite (D1 + D2/D3 + B4.3-C projection + reservation) still green,
stability probe deterministic across 5 runs.

---

## 1. What changed (only this phase)

| Item | Before D4 | After D4 |
|---|---|---|
| `cancel_developer_withdrawal` predicate match | `find_one` + later `update_one` (race window) | **single `find_one_and_update` CAS** |
| CAS predicate | `withdrawal_id` only | **`withdrawal_id` AND `user_id` AND `status ∈ {requested, approved}`** |
| Legacy `dev_wallets.$inc {pending -A, available +A}` | YES | **NO — REMOVED** |
| Canonical release call | absent | **`bridge_withdrawal_released(reason="cancelled_by_developer")`** |
| Release amount source | (was caller-trusted in pre-D2 era) | **`dev_withdrawals.amount` from the CAS-returned row, never the request body** |
| Idempotency on double-cancel | undefined / 409 | **`{"ok": true, "already": "cancelled"}` HTTP 200, no second release event** |
| Cross-user cancel attempt | could 200 if id leaked | **404 (existence not leaked)** |
| Terminal-state cancel (`paid`, `rejected`) | could double-mutate legacy | **409 with current-status in message** |
| Dead `return` after the final return | present (orphan duplicate) | **REMOVED** |

### Code site

`/app/backend/server.py` — `cancel_developer_withdrawal` at line 11754.
112 lines total, including a long inline docstring that captures the
contract: single CAS, amount-from-row invariant, no legacy `$inc`, why
the "no document → diagnose via follow-up read" branching is the only
correct response shape.

---

## 2. Acceptance — all 12 criteria green

| # | Criterion | Test | Result |
|---|---|---|---|
| 1 | cancel `requested` → `status=cancelled` | `test_cancel_requested_withdrawal_releases_reservation_canonically` | ✅ |
| 2 | `ac_reserved` decreases by exact amount | same | ✅ |
| 3 | `ac_dev` increases by exact amount | same | ✅ |
| 4 | `projection.pending` decreases (→ 0 for full cancel) | same | ✅ |
| 5 | `projection.available` increases | same | ✅ |
| 6 | Legacy `dev_wallets` does NOT mutate (both axes identical pre/post) | same | ✅ |
| 7 | Double-cancel idempotent, no double release | `test_double_cancel_is_idempotent_and_does_not_double_release` | ✅ |
| 8 | cancel of `paid` rejected (409) | `test_cancel_of_paid_withdrawal_is_refused` | ✅ |
| 9 | cancel of `rejected` rejected (409) | `test_cancel_of_rejected_withdrawal_is_refused` | ✅ |
| 10 | WARN mismatch count == 0 (no new divergence class needed) | money_divergence + projection stability | ✅ |
| 11 | stability probe deterministic | `dev-wallet-projection-stability.py` 5 runs, checksum `ea1316de8d25…` stable | ✅ |
| 12 | tests green (this phase + regression) | `pytest tests/test_money_withdrawal_cancel_d4.py + D1 + D2/D3 + B4.3-C + reservation` | ✅ 47/47 |

### Bonus invariants verified

- **Amount-from-row invariant**: `test_cancel_releases_exactly_row_amount_ignoring_body` posts `{"amount": 999.0, "currency": "BTC"}` in the cancel body; handler ignores it; ledger drains exactly the row's $25.
- **CAS race-safety**: `test_concurrent_cancels_have_exactly_one_winner` fires 5 concurrent cancels for the same withdrawal_id; exactly one returns without `already`, the other 4 return `already=cancelled`; ledger has exactly one debit+credit pair.
- **Static guard (AST)**: handler body provably contains `find_one_and_update`, `bridge_withdrawal_released`, `cancelled_by_developer`, and provably does NOT contain `"pending_withdrawal":`, `"available_balance":`, or `dev_wallets.update_one`.

---

## 3. Test summary

```
$ pytest tests/test_money_withdrawal_cancel_d4.py -v
============================== 9 passed in 1.33s ==============================

$ pytest tests/test_money_admin_reject_d1.py \
         tests/test_money_withdrawal_request_d2_d3.py \
         tests/test_money_projection_b4_3_c.py \
         tests/test_money_withdrawal_reservation.py -v
============================== 38 passed in 2.16s ==============================
```

Total: **47/47 green** (9 D4 + 6 D1 + 8 D2/D3 + 11 B4.3-C + 12 reservation).

---

## 4. Why D4 needed no new divergence classification

The post-D4 divergence engine output was checked — no new bucket
appeared because the D2+D4 pair *cancels out* at the legacy side:

```
   D-2 reserve  : legacy untouched (avail stays at original, pending stays 0)
                  canonical: ac_dev -= A, ac_reserved += A
                  → diff: legacy ahead on `available`, projection ahead on `pending`
                  → class: pending_post_b4_3_d2

   D-4 cancel   : legacy untouched (no mirror write)
                  canonical: ac_reserved -= A, ac_dev += A
                  → projection's ac_dev now restored to where legacy.available was all along
                  → legacy == projection on both axes
                  → class: matches
```

So a developer who requests + cancels in the same window leaves
**zero residual divergence**. The `pending_post_b4_3_d2` row exists
only while the reserve is alive; the moment cancel fires (or
admin-reject D-1 fires, or admin-mark-paid B4.1 fires), the
divergence drops to `matches` (cancel) or `pending_post_b4_3_d1`
(reject).

The pre-existing pre-D2 reserves still emit `pending_pre_b4_3_d`
(1 row in the stability probe — that's a seeded fixture, not a leak).

---

## 5. Withdrawal lifecycle — fully canonical (post D1+D2+D3+D4)

```
   request  ─▶ ac_dev → ac_reserved              (D-2: canonical writer, no legacy)
   reject   ─▶ ac_reserved → ac_dev              (D-1: canonical release)
   paid     ─▶ ac_reserved → ac_ext              (B4.1: canonical drain)
   rollback ─▶ ac_reserved → ac_dev              (D-3: insert-failure compensating release)
   cancel   ─▶ ac_reserved → ac_dev              (D-4: canonical release, reason="cancelled_by_developer")
```

Every transition is now:
- An idempotent ledger event pair (debit + credit).
- A single CAS predicate on `dev_withdrawals.status`.
- Zero `dev_wallets` mutation.

Conservation is provable from `money_ledger_events` alone. `dev_wallets`
is now a **diagnostic mirror** with no upstream contract on
`pending_withdrawal`, `available_balance`, `withdrawn_lifetime`, or
`earned_lifetime` from the withdrawal lifecycle. Earnings credits
(via `earnings_layer`) still touch it; that's B4.4 territory.

---

## 6. Public API impact

**None.** Response shapes unchanged:

```jsonc
// First-time cancel
{"ok": true, "withdrawal_id": "wd_…", "status": "cancelled"}

// Idempotent re-cancel
{"ok": true, "withdrawal_id": "wd_…", "status": "cancelled", "already": "cancelled"}

// Terminal-state cancel (paid / rejected)
HTTP 409 — {"detail": "Cannot cancel — current status is 'paid'. Only requested or approved withdrawals are cancellable."}

// Wrong owner / non-existent
HTTP 404 — {"detail": "Withdrawal not found"}
```

The `already` field is additive; pre-D4 clients ignored it; post-D4
clients can use it to suppress double-toast UX.

---

## 7. What was explicitly NOT changed (per user's D4 contract)

- ❌ Admin-side `cancel_admin_payout` (different path, `withdrawals` collection — Decision 4 territory)
- ❌ Admin-mobile reject/approve writers (admin_mobile.py — Decision 4 split-brain, separate phase)
- ❌ `earnings_layer.py` legacy writers (B4.4)
- ❌ `money_divergence` engine (D4 doesn't introduce a new bucket, see §4)
- ❌ Projection rebuild logic (behaviour identical post-D4)
- ❌ Frontend / Expo / web (reader already routes through projection)
- ❌ No "raz uzh tut" cleanup beyond removing the one orphan duplicate `return` line

---

## 8. Roadmap status (updated)

1. ✅ 2C-B4.3-A — lifecycle map
2. ✅ 2C-B4.3-B — canonical reservation methods
3. ✅ 2C-B4.3-C — projection reads `ac_reserved`
4. ✅ 2C-B4.3-D1 — admin reject legacy writer removed
5. ✅ 2C-B4.3-D2 + D3 — request reserve + insert-failure compensating release
6. ✅ **2C-B4.3-D4 — cancel flow with CAS tightening (this phase)**
7. 🟡 2C-B4.4 — `dev_wallets` collection → diagnostic-only formalisation (NEXT)
8. 🟡 2C-B4.5 — divergence engine → passive observer

### What B4.4 means now

After D4, `dev_wallets` is no longer a write source for **any** axis of
the withdrawal lifecycle. The only remaining writers are:
- `earnings_layer` — credits `earned_lifetime` / `available_balance` on module reward.
- (legacy seed code in `mock_seed.py` — fixture only.)

B4.4 will:
- formalise `dev_wallets` as diagnostic-only,
- remove `earnings_layer` legacy writes (canonical event already emitted via `bridge_module_completed`),
- update the divergence engine's pre-existing buckets (`legacy_drift_total_earnings`, `withdrawals_drift`) to recognise the new "legacy stays frozen" steady state.

Then B4.5 demotes the divergence engine to a **passive observer** —
it stops counting "drift" as drift and starts counting it as
"legacy mirror lag", which is the correct mental model once `dev_wallets`
is no longer canonical for anything.

---

## 9. Closeout signature

- Handler: `/app/backend/server.py` lines 11754–11866 (was 11867)
- Tests: `/app/backend/tests/test_money_withdrawal_cancel_d4.py` (9 tests, 580 lines)
- Stability probe: `/app/audit/dev_wallet_projection_stability.json` (checksum stable `ea1316de8d25…`)
- This document: `/app/audit/PHASE_2C_B4_3_D4_ACCEPTANCE_2026-02-FEB.md`
