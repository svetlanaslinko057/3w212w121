# Phase 2C-B4.3-D1 — Acceptance Report

**Date:** February 2026
**Scope:** Remove the legacy `dev_wallets` mutation from
`admin_reject_withdrawal`. The handler is now ledger-only — it emits
`withdrawal_released` (debit `ac_reserved:<dev>`, credit `ac_dev:<dev>`)
via `bridge_withdrawal_released` and no longer touches the legacy
`pending_withdrawal` / `available_balance` mirror.

This is step 1 of B4.3-D (the "removal" half of the pending_withdrawal
lifecycle peel). D2/D3/D4 remain open and gated by their own acceptance
runs.

---

## 1. What changed

| File | Change |
|------|--------|
| `backend/server.py:11856-11906` | `admin_reject_withdrawal` — legacy `db.dev_wallets.update_one $inc {pending_withdrawal, available_balance}` REMOVED. Comments document the removal in place. `bridge_withdrawal_released(reason="rejected_by_admin")` is now the sole money mutation. |
| `backend/money_projections.py` | Added classification `pending_post_b4_3_d1` (INFO-only) for the legitimate post-D1 drift signature (legacy.pending stuck above projection.pending). Two sub-signatures supported: release-only drift, and request+reject-in-flight. |
| `backend/dev_wallet_reader.py` | `_log_compare` extended to route `pending_post_b4_3_d1` to `log.info` (not `log.warning`). |
| `backend/tests/test_money_admin_reject_d1.py` | Added 2 new tests for the classifier + log-level check (6 tests total in file). The httpx admin session helper switched from cookie-jar to `Authorization: Bearer` to be robust against `Secure` cookies on plain-HTTP localhost. |

No other writers were touched. No new endpoints introduced. No frontend
changes required (the user-facing wallet already reads through
`dev_wallet_reader` which favours the projection when
`_pending_has_ledger_source = True`).

---

## 2. Acceptance — all green

| # | Acceptance criterion | Status | Evidence |
|---|----------------------|--------|----------|
| 1 | Admin reject changes `dev_withdrawals.status` to `rejected` | ✅ | `test_admin_reject_releases_reservation_via_ledger` step 6 |
| 2 | Canonical: `ac_reserved` decreases, `ac_dev` increases | ✅ | step 7 (svc.balance_for assertions, both 0 / 10000) |
| 3 | Projection: pending decreases, available increases | ✅ | step 9 (`build_dev_wallet_projection` asserts pending=0, available=10000) |
| 4 | Legacy `dev_wallets` does NOT mutate pending/available | ✅ | step 8 (`legacy_after.pending == legacy_before.pending`, same for available) |
| 5 | User-facing wallet reflects projection result correctly | ✅ | `_pending_has_ledger_source=True` → reader returns projection value (covered by `test_money_projection_b4_3_c::test_reader_uses_projection_pending_when_ledger_has_source`) |
| 6 | Re-reject: idempotent / already handled | ✅ | `test_admin_reject_idempotent_when_already_rejected` (second reject → 200 + `already=rejected`) |
| 7 | No WARN mismatch for converged users | ✅ | `test_log_compare_does_not_warn_for_post_b4_3_d1` (asserts log.levelname == INFO) |
| 8 | `pending_pre_b4_3_d` remains INFO only for old rows | ✅ | Classifier branch unchanged. Stability probe shows 4 rows in this class, all stable across 5 runs. |
| 9 | Architecture / tests green | ✅ | 49/49 unit tests + 7/8 architecture tests (1 skipped) pass |
| 10 | Static guard: no `$inc pending_withdrawal` in handler | ✅ | `test_admin_reject_handler_has_no_pending_inc` parses server.py and asserts |

---

## 3. Stability probe — 5/5 ALL INVARIANTS HOLD

```
✓ legacy snapshot: 25 rows, checksum=985c844cb949…
  run 1..5: rows=107 written=...|0 unchanged=...|107
            classifications={
              'ledger_only':         82,
              'pending_post_b4_3_d1': 6,  ← NEW (this phase)
              'matches':              5,
              'pending_pre_b4_3_d':   4,
              'legacy_only':          5,
              'mock_orphan':          5
            }
            checksum=fd1af4ab136f…
✓ legacy snapshot after: 25 rows, checksum=985c844cb949…   ← UNCHANGED
✅ ALL INVARIANTS HOLD
```

Key facts:
- `diverged == 0` in every run (the central guard).
- Classification histogram identical across runs 1..5.
- Projection checksum identical across runs 1..5.
- Legacy snapshot unchanged before/after (`985c844cb949…`) — D-1 writer
  removal is honoured: the probe runs idempotently and does not touch
  legacy.
- The new `pending_post_b4_3_d1` bucket contains the test-seeded
  fixtures that demonstrate the new drift signature. In production this
  bucket will appear only after a real admin reject lands on a wallet
  whose legacy.pending was previously bumped — that drift is bounded,
  invisible to UI, and resolves in D-4.

---

## 4. Live smoke (production endpoint)

The acceptance test suite hits the real endpoint:

```
POST /api/admin/withdrawals/wd_4c2503eddc/reject  → 200
POST /api/admin/withdrawals/wd_6c99f5611c/reject  → 200
POST /api/admin/withdrawals/wd_6c99f5611c/reject  → 200 (re-reject idempotent)
POST /api/admin/withdrawals/wd_99f59951dc/reject  → 200 (no prior reserve)
POST /api/admin/withdrawals/wd_dd89ca5111/reject  → 200
POST /api/admin/withdrawals/wd_f4495fa7c8/reject  → 200
POST /api/admin/withdrawals/wd_f4495fa7c8/reject  → 200 (re-reject idempotent)
POST /api/admin/withdrawals/wd_a31304a838/reject  → 200
```

Backend log:
```
2026-05-23 10:11:00,408 - money_bridge - WARNING - MONEY BRIDGE: bridge_withdrawal_released suppressed
2026-05-23 10:11:07,404 - money_bridge - WARNING - MONEY BRIDGE: bridge_withdrawal_released suppressed
```

These suppressions are from the `test_admin_reject_without_prior_reserve_event`
case — the bridge correctly surfaces a `money_reserved_insufficient`
PolicyDenied as a suppressed event (not a money-loss). This is the
exact contract from `bridge_withdrawal_released` docstring: "Failure
modes: `PolicyDenied money_reserved_insufficient` — no prior reserve
event. Surfaced as divergence: the lifecycle state machine got skipped."
Handler still returns 200; status flips; legacy is not corrupted.

---

## 5. Single divergence introduced (by design)

Legacy `dev_wallets.pending_withdrawal` and `available_balance` now
drift-by-design for any withdrawal rejected via admin path post-D1.
The drift is surfaced by the divergence engine and stability probe as
`pending_post_b4_3_d1`-classification rows. This is the controlled
proof that:

- Projection lives independently of legacy pending mirror.
- Canonical truth (ledger) no longer depends on legacy decrement.
- Divergence engine actually sees the drift.
- Drift is localised, signature-bounded, and explainable.
- UI is unaffected (`dev_wallet_reader` prefers projection).

---

## 6. Public API impact

None. `admin_reject_withdrawal` response shape unchanged:
`{"ok": true, "withdrawal_id": "...", "status": "rejected"}` on first
hit, `{"ok": true, "already": "<status>"}` on idempotent re-hit.

`/api/admin/money/projections/dev-wallets/compare-all` now reports
`pending_post_b4_3_d1` as a new valid classification. Existing admin
diagnostics dashboards that group on `classification` will simply gain
a new visible bucket. No removed buckets, no renamed fields.

---

## 7. What was explicitly NOT changed

- ❌ `request_developer_withdrawal` writer (D-2 territory)
- ❌ `cancel_developer_withdrawal` writer (D-4 territory)
- ❌ defensive rollback writer in the `request` `except` branch (D-3)
- ❌ `admin_mark_withdrawal_paid` (already migrated in B4.1)
- ❌ `dev_wallets` collection (still authoritative for legacy fields)
- ❌ divergence engine (only its classifier got a new bucket; engine itself is untouched)
- ❌ projection rebuild logic (only classification → no behaviour change)
- ❌ payout bridge / escrow bridge / earning bridge
- ❌ `pricing_engine.py` / HVL
- ❌ `mock_seed.py` orphan canary (intentional fixture preserved)
- ❌ frontend (UI already routes through reader; no contract change)

---

## 8. Roadmap — what's next

| Step | Status | Description |
|------|--------|-------------|
| **2C-B4.3-D1** | ✅ **DONE (this phase)** | admin reject — legacy writer removed |
| 2C-B4.3-D2 + D3 | 🟡 next, paired | `request_developer_withdrawal` reserve writer + defensive rollback writer. MUST ship together — otherwise an insert-failure between reserve and insert opens a money-leak window. |
| 2C-B4.3-D4 | 🟡 after D2+D3 | cancel flow with CAS tightening |
| 2C-B4.4 | 🟡 | `dev_wallets` collection → diagnostic only (formalise) |
| 2C-B4.5 | 🟡 | divergence engine → passive observer |

---

## 9. Rollback path

If a regression surfaces:

1. Re-insert the legacy `$inc` block at `server.py:11883` (the exact
   removed shape is preserved in the comment above the removal site).
2. Add the classification `pending_post_b4_3_d1` back to the
   "untouched" exclusion list in `_log_compare` (or remove it entirely,
   it will simply not appear once both writers are again active).
3. Run `scripts/replay-seed-money-bridge.py` to rebuild ledger
   reservations from legacy.

No ledger rollback is required — `withdrawal_released` events are
append-only and rollback-safe by construction. Running the legacy
writer again on top of an already-released ledger reserve produces
a `pending_post_b4_3_d1` row → `matches` (because legacy converges
back). No data corruption.

---

*Signed off in repo: this acceptance file is the change-log.*
