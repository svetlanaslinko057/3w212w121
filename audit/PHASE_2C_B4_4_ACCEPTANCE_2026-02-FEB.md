# Phase 2C-B4.4 — Acceptance (2026-02-FEB)

**Scope**: Formal declaration that `dev_wallets` collection is diagnostic-only.
No more operational writers. AST guard + INFO-suppression for the new steady state.

**Status**: ✅ **GREEN** — 70/70 in-scope tests pass, AST guard locks the
invariant, `ledger_only` WARN noise removed, stability probe deterministic
across 5 runs, withdrawal lifecycle smoke-traced clean.

---

## 1. What changed (only this phase)

| Item | Before B4.4 | After B4.4 |
|---|---|---|
| Operational writers to `dev_wallets` | 0 (all already removed by B4.0.1, B4.1, B4.2, B4.3-D1/D2/D3/D4) | **0 — invariant now ENFORCED by AST guard** |
| Static enforcement of "no writers" | none | **`test_no_unauthorised_dev_wallets_writers_in_production`** AST walk, allow-list = `{mock_seed.py}` |
| `ledger_only` divergence logging | WARN (paged on every fresh earner) | **INFO** — post-migration steady state |
| `ledger_only` INFO contract test | none | **`test_ledger_only_mismatch_logged_at_info_post_b4_4`** locks it in |
| Public diagnostic-only contract doc | absent | **`/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md`** |

**Net code change**: ~6 lines functional (one INFO whitelist entry +
two new tests + one log docstring expansion + one contract document).
The migration *itself* was already complete from prior phases — B4.4
is the formalisation that locks the door behind those phases.

---

## 2. Acceptance — all 7 criteria green

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | grep/AST: 0 active `dev_wallets` writers (outside canary) | AST scan: 1 site `mock_seed.py:266` (ALLOWED) | ✅ |
| 2 | User-facing wallet reads projection | `dev_wallet_reader.read_dev_wallet` flag on, 9 reader tests green | ✅ |
| 3 | Earnings approval moves ledger/projection, not legacy | `_credit_module_reward` mirror removed in B4.2; only canonical bridge writes | ✅ |
| 4 | Payout lifecycle works | `withdrawal_smoke_trace.py` green end-to-end | ✅ |
| 5 | Withdrawal lifecycle works | 47/47 D1+D2/D3+D4+B4.3-C+reservation tests green | ✅ |
| 6 | WARN mismatch = 0 | `ledger_only` moved to INFO whitelist; new test locks contract; live logs confirm `INFO event=dev_wallet_read.mismatch ... classification=ledger_only` | ✅ |
| 7 | Divergence engine still compares legacy vs projection | `dev_wallets_readers_still_exist` passes; stability probe still classifies 6 buckets | ✅ |

### Stability probe (5/5 deterministic)

```
✓ legacy snapshot: 12 rows, checksum=e617d1997806…
  run 1-5: rows=82 unchanged=82
           classifications={'ledger_only': 70,
                            'pending_post_b4_3_d1': 2,
                            'matches': 2,
                            'pending_pre_b4_3_d': 2,
                            'mock_orphan': 4,
                            'legacy_only': 2}
           checksum=b806b6c0d84f…   (stable across all 5 runs)
✓ legacy snapshot after: 12 rows, checksum=e617d1997806…   (no drift)
```

The `ledger_only: 70` row count is the new steady state — 70
developers with canonical activity and no legacy mirror. Pre-B4.4 each
would have triggered a WARN on every wallet read; post-B4.4 they are
INFO-classified.

### Smoke trace (`withdrawal_smoke_trace.py`)

```json
"split_brain_summary": {
  "canonical_path_complete": {
    "withdrawal_id": "wd_961a07f96615",
    "final_status_in_dev_withdrawals": "paid",
    "wallet_pending_withdrawal_after": 0.0,
    "wallet_withdrawn_lifetime_after": 800.0,
    "expected": "pending=0, withdrawn=800 (wallet credited correctly)"
  }
}
```

End-to-end withdrawal lifecycle (request → approve → mark-paid) still
green; the canonical path serves the wallet number correctly via the
projection reader.

---

## 3. Test summary

```
$ pytest tests/test_dev_wallet_reader.py \
         tests/test_dev_wallets_diagnostic_only_b4_4.py \
         tests/test_money_withdrawal_cancel_d4.py \
         tests/test_money_admin_reject_d1.py \
         tests/test_money_withdrawal_request_d2_d3.py \
         tests/test_money_projection_b4_3_c.py \
         tests/test_money_withdrawal_reservation.py \
         tests/test_dev_wallet_projection.py
70 passed in 3.86s
```

Total: **70/70 green**, including:
- 9 reader-facade tests (with new `test_ledger_only_mismatch_logged_at_info_post_b4_4`)
- 3 new B4.4 AST guards
- 9 D4 acceptance tests
- 6 D1 regression tests
- 8 D2/D3 regression tests
- 11 B4.3-C projection tests
- 12 reservation flow tests
- 10 dev_wallet_projection tests
- 2 baseline reader tests

---

## 4. Known pre-existing issue (out of B4.4 scope)

`tests/test_money_stabilization.py::test_dev_wallet_canonical_no_double_credit`
and `test_full_chain_seed_no_double_events` are **pre-existing flaky
tests** caused by the `seed_money_demo.MoneyService` singleton not
being wired correctly in test-subprocess context. The affected code
paths (`seed_money_demo.py`, `escrow_layer.py:230` `users.total_earnings`
mirror) were NOT modified in B4.4 — this is Decision 1 territory (the
`users.total_earnings` legacy mirror is a *separate* legacy field from
`dev_wallets`). Documented in detail in the contract document §8.

---

## 5. Public API impact

**None.** No endpoint shape changed. The user-facing wallet was
already reading from projection (since B3.1). The only observable
difference is in log volume: the post-migration steady-state divergence
(class = `ledger_only`) is now logged at INFO instead of WARN —
on-call dashboards will see *zero* unexpected WARN-level divergence
events for normal traffic.

---

## 6. What was explicitly NOT changed (per user's B4.4 contract)

- ❌ Did NOT delete the `dev_wallets` collection (per contract — historical mirror preserved)
- ❌ Did NOT remove the `mock_seed.py:266` orphan canary (load-bearing for divergence self-test)
- ❌ Did NOT modify `money_divergence.py` (B4.5 territory)
- ❌ Did NOT remove replay scripts
- ❌ Did NOT change pricing / HVL
- ❌ Did NOT clean up old `dev_wallets` rows
- ❌ Did NOT touch `users.total_earnings` / `escrow_earnings` mirrors (Decision 1 territory, different collection)

---

## 7. Roadmap status (updated)

1. ✅ 2C-B4.3-A — lifecycle map
2. ✅ 2C-B4.3-B — canonical reservation methods
3. ✅ 2C-B4.3-C — projection reads `ac_reserved`
4. ✅ 2C-B4.3-D1 — admin reject legacy writer removed
5. ✅ 2C-B4.3-D2 + D3 — request reserve + insert-failure compensating release
6. ✅ 2C-B4.3-D4 — cancel flow with CAS tightening
7. ✅ **2C-B4.4 — `dev_wallets` collection → diagnostic-only formalisation (this phase)**
8. 🟡 **2C-B4.5 — divergence engine → passive observer** (NEXT)

### B4.5 preview

After B4.4, `dev_wallets` is contractually diagnostic-only. B4.5 will
demote the divergence engine to match: stop counting "drift" as drift
and start counting it as "expected legacy mirror lag" (the legacy
mirror is now intentionally frozen at its pre-B4 shape; canonical keeps
growing). Specifically:
- Update `money_divergence.py` mental model in docstrings.
- Rename/reframe `legacy_drift_total_earnings` etc. to make the
  "frozen by design" relationship explicit.
- Replace any "should converge" assertions with "may stay bounded".
- Add an HTTP-surface flag (`legacy_status: "frozen_diagnostic"`) so
  dashboards can render the new mental model.

After B4.5, the substrate is in its final shape: canonical ledger as
sole source of truth, projection as derived read model, legacy as
read-only diagnostic mirror, divergence engine as passive observer.

---

## 8. Closeout signature

- AST guard test: `/app/backend/tests/test_dev_wallets_diagnostic_only_b4_4.py`
- `ledger_only` INFO contract test: `/app/backend/tests/test_dev_wallet_reader.py::test_ledger_only_mismatch_logged_at_info_post_b4_4`
- `dev_wallet_reader._log_compare` whitelist updated (line 270)
- Public contract document: `/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md`
- This acceptance summary: `/app/audit/PHASE_2C_B4_4_ACCEPTANCE_2026-02-FEB.md`
- Stability probe artifact: `/app/audit/dev_wallet_projection_stability.json`
- Stability closeout: `/app/audit/PHASE_2C_B2_DEV_WALLETS_STABILITY_2026-05-23.md`
- PRD: `/app/memory/PRD.md` (will be updated next)
