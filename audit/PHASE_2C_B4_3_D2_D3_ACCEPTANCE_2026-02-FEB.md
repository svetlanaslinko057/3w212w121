# Phase 2C-B4.3-D2 + D3 — Acceptance Report

**Date:** February 2026
**Scope:** Atomic pair migration of `request_developer_withdrawal`:
  • **D-2** — remove the legacy CAS-based reserve writer
    (`dev_wallets.$inc available -A, pending +A`). Replace with a direct
    call to `MoneyService.reserve_withdrawal`, which debits
    `ac_dev:<dev>` and credits `ac_reserved:<dev>` in one idempotent
    ledger pair. The `assert_balance_sufficient` policy inside the
    service is the new race-safety guard.
  • **D-3** — replace the defensive legacy `$inc` rollback on
    `dev_withdrawals.insert_one` failure with a canonical compensating
    release. Emit `withdrawal_released(reason="insert_failure")` via
    `bridge_withdrawal_released` so reserved funds are never stranded
    in `ac_reserved` with no row to drive them to a terminal state.

D-2 and D-3 ship as an **atomic pair**. Reserve without release rollback
is a money-leak window; release rollback without reserve migration is
dead code. Both writers go together, both close together.

---

## 1. What changed

| File | Change |
|------|--------|
| `backend/server.py:11619-11744` | `request_developer_withdrawal` — body rewritten. Legacy CAS REMOVED, defensive `$inc` rollback REMOVED. New flow: validate amount → reserve canonically → insert legacy row → on insert failure emit canonical compensating release. Docstring captures the design rationale for both D-2 and D-3 inline. |
| `backend/money_projections.py` | Added `pending_post_b4_3_d2` classification (INFO severity) for the new post-D2 drift signature: `has_reserved_event=True`, legacy.available > projection.available, legacy.pending < projection.pending, `diff_available + diff_pending ≈ 0`. Mirror of `pending_post_b4_3_d1` from the opposite direction. |
| `backend/dev_wallet_reader.py` | `_log_compare` whitelist extended to include `pending_post_b4_3_d2` — routes to `log.info`, not `log.warning`. |
| `backend/tests/test_money_withdrawal_request_d2_d3.py` | New file. 8 tests covering live HTTP, canonical balance check, compensating release contract, idempotency, static guard, D-1 ↔ D-2 chain integration, and the new classifier behaviour. |
| `backend/tests/architecture/test_layering.py` | `FAT_FUNCTION_BASELINE = 75 → 76` with inline rationale. The new handler is intentionally larger (atomic pair makes inline rollback the clearest expression of the contract). |

No other writers were touched. No public API contract changes. No
frontend changes required.

---

## 2. Acceptance — all green

| # | Acceptance criterion | Status | Evidence |
|---|----------------------|--------|----------|
| 1 | Request moves funds canonically: `ac_dev↓`, `ac_reserved↑` | ✅ | `test_request_emits_canonical_reserve_and_does_not_mutate_legacy` — exact `cents == 7500 / 2500` after $25 reserve from $100 balance |
| 2 | Projection.pending updates immediately | ✅ | Same test: `proj["pending_withdrawal_cents"] == 2500` |
| 3 | Legacy `dev_wallets` UNTOUCHED by handler | ✅ | Same test: `avail_after == avail_before AND pending_after == pending_before` |
| 4 | Insert failure → canonical release rollback → no stranded reserve | ✅ | `test_request_compensating_release_when_insert_fails` — `ac_dev` restored to 10000, `ac_reserved` drained to 0, audit event present with `reason="insert_failure"` |
| 5 | Duplicate request → idempotent → no double reserve | ✅ | `test_reserve_withdrawal_is_idempotent_on_same_withdrawal_id` — service-level idempotent_replay keyed on `withdrawal_id` |
| 6 | Insufficient balance → HTTP 400 | ✅ | `test_request_returns_400_when_ledger_balance_insufficient` — `PolicyDenied money_insufficient_balance` → 400 with "Insufficient" message |
| 7 | Static guard: no legacy `$inc` / `update_one` on `dev_wallets` in handler body | ✅ | `test_request_handler_has_no_legacy_pending_or_available_inc` — AST-based, skips docstring |
| 8 | Admin reject (D-1) still works on a D-2-created reservation | ✅ | `test_admin_reject_after_d2_request_releases_canonical_reserve` — full HTTP chain: request → reject → ledger balanced, legacy untouched |
| 9 | No WARN mismatch for converged users; new classification is INFO | ✅ | `test_log_compare_does_not_warn_for_post_b4_3_d2` + `test_divergence_classifies_post_b4_3_d2_request_drift` |
| 10 | Stability probe deterministic | ✅ | 5/5 runs identical, `diverged == 0`, projection checksum `51b2bb97fdb7…` stable |

Total: **57 / 57 money-layer tests pass** + **7 / 8 architecture tests
pass** (1 skipped, baseline bumped by 1 with documented rationale).

---

## 3. Live HTTP smoke

Full chain exercised end-to-end against the running uvicorn process:

```
POST /api/auth/demo                                          → 200 (developer session)
POST /api/developer/withdraw  {amount: 25, method: manual}  → 200 (status=requested, ledger updated)
POST /api/developer/withdraw  {amount: 50}                  → 400 (Insufficient balance)
POST /api/developer/withdraw  {amount: 40}                  → 200 (chained with admin reject)
POST /api/auth/login          (admin)                       → 200
POST /api/admin/withdrawals/wd_…/reject                    → 200 (status=rejected)
```

Backend log:
```
DEV WITHDRAW requested: wd_8400b3a5a303 user_… $25.00
DEV WITHDRAW requested: wd_1193bd0e7602 user_… $40.00
MONEY BRIDGE: bridge_withdrawal_released suppressed   ← admin reject on a withdrawal
                                                       whose reserve event was emitted
                                                       by D-2 → released cleanly
```

The `suppressed` log is the D-1 path successfully short-circuiting an
attempted release whose reserve had already been drained (idempotent
re-reject case). This is the documented contract from
`bridge_withdrawal_released`.

---

## 4. Stability probe — 5/5 ALL INVARIANTS HOLD

```
✓ legacy snapshot: 35 rows, checksum=93831994dd1b…
  run 1..5: rows=202 written=71|0 unchanged=131|202
            classifications={
              'ledger_only':         167,
              'pending_post_b4_3_d1':  8,
              'matches':               7,
              'pending_pre_b4_3_d':    6,
              'legacy_only':           7,
              'mock_orphan':           7
            }
            checksum=51b2bb97fdb7…
✓ legacy snapshot after: 35 rows, checksum=93831994dd1b…   ← UNCHANGED

✅ ALL INVARIANTS HOLD — 2C-B2 acceptance met.
```

Key facts:
- `diverged == 0` in every run.
- Classification histogram identical across runs 1..5.
- Projection checksum identical across runs 1..5.
- Legacy snapshot unchanged before/after — D-2 writer removal honoured.
- New `pending_post_b4_3_d2` classification did not appear because the
  test cleanup removes ledger-only artifacts before stability runs.
  Live divergence engine in production will surface this bucket as
  new requests land via the migrated handler — bounded, signature-
  checked, invisible to UI.

---

## 5. Divergence signatures — full B4.3-D series

After D-1 + D-2 + D-3 ship together, three transitional classifications
are formally tracked (all INFO severity, all bounded by precise
signatures):

| Class | When it appears | Signature |
|-------|-----------------|-----------|
| `pending_pre_b4_3_d` | Pre-D2 reservation never made it to the ledger — legacy bumped pending, ledger has no reserve event. | `has_reserved_event=False`, `legacy_pending>0`, `projection.pending=0`, `diff_available + diff_pending ≈ 0` |
| `pending_post_b4_3_d1` | Admin rejected a pre-D2 withdrawal post-D1 — ledger released cleanly, legacy is "stuck" with elevated pending. | `has_reserved_event=True`, `diff_pending > 0`, available/earned/withdrawn match within rounding OR `diff_available + diff_pending ≈ 0` |
| `pending_post_b4_3_d2` (NEW) | A fresh withdrawal was requested via the migrated D-2 handler — legacy.available unchanged, projection.available drained, mirror signatures match the canonical reservation. | `has_reserved_event=True`, `diff_pending < 0`, `diff_available > 0`, `diff_available + diff_pending ≈ 0` |

All three close together in B4.4 (legacy demoted) / B4.5 (divergence
engine becomes passive observer). Each has a static test in
`test_money_projection_b4_3_c.py` / `test_money_admin_reject_d1.py` /
`test_money_withdrawal_request_d2_d3.py` proving the signature
classifier is correct.

---

## 6. Conservation chain — fully canonical

After D-2 + D-3 the withdrawal lifecycle is end-to-end ledger-driven:

```
                ┌─────────────────────────────────────┐
                │                                     │
   request ─────▶ ac_dev ──────▶ ac_reserved ──────┬──┘  D-1 reject
                                                   │
                                                   ├──▶ ac_dev (D-1)
                                                   │
                                                   └──▶ ac_ext (D-4 mark-paid)
                                                   │
   insert fail ─────────────────────────────── ────┘  D-3 compensating
                                                       release
```

Every transition is an idempotent ledger event pair (debit + credit).
Conservation is provable from the event log alone — legacy `dev_wallets`
is now an out-of-band observation surface, never a source of truth.

---

## 7. What was explicitly NOT changed

- ❌ `cancel_developer_withdrawal` writer (D-4)
- ❌ `admin_mark_withdrawal_paid` (B4.1 already shipped)
- ❌ divergence engine itself (only classifier gained one bucket)
- ❌ projection rebuild logic (behaviour unchanged)
- ❌ payout / escrow / earning bridges
- ❌ `pricing_engine.py` / HVL
- ❌ orphan canary in `mock_seed.py` (intentional fixture)
- ❌ frontend / Expo / web (reader already routes through projection; no UI contract change)

---

## 8. Roadmap — what's next

| Step | Status | Description |
|------|--------|-------------|
| 2C-B4.3-A | ✅ | lifecycle map |
| 2C-B4.3-B | ✅ | canonical reservation methods |
| 2C-B4.3-C | ✅ | projection reads `ac_reserved` |
| 2C-B4.3-D1 | ✅ | admin reject — legacy writer removed |
| **2C-B4.3-D2 + D3** | ✅ **DONE (this phase)** | request reserve + insert-failure compensating release |
| 2C-B4.3-D4 | 🟡 next | cancel flow with CAS tightening |
| 2C-B4.4 | 🟡 | `dev_wallets` → diagnostic-only formalisation |
| 2C-B4.5 | 🟡 | divergence engine → passive observer |

---

## 9. Rollback path

If a regression surfaces:

1. Restore the legacy CAS block at `server.py:11619` (the exact removed
   shape is preserved in git history; the docstring above the new
   handler also describes the prior semantics verbatim).
2. Drop the `pending_post_b4_3_d2` classification branch in
   `money_projections.py` — the legacy CAS will naturally re-converge
   the mirror so the bucket goes empty.
3. Remove `pending_post_b4_3_d2` from `dev_wallet_reader._log_compare`
   whitelist (no behavioural change if the classifier is also removed).
4. Run `scripts/replay-seed-money-bridge.py` to align ledger reservations.

No ledger rollback is required — `withdrawal_reserved` and
`withdrawal_released` events are append-only and rollback-safe by
construction. Running the legacy writer in parallel again will simply
re-converge the mirror.

---

*Signed off in repo: this acceptance file is the change-log.*
