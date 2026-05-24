# `dev_wallets` Diagnostic-Only Contract (Phase 2C-B4.4)

**Status**: ✅ **GREEN** — formalised 2026-02-FEB. `dev_wallets` is no
longer a write source for any operational money axis. AST guard
enforces the contract on every test run.

---

## 1. The contract

After Phase 2C-B4.4 the `dev_wallets` collection has the following
contractual status:

| Aspect | Pre-B4.4 | Post-B4.4 |
|---|---|---|
| **Operational writer** for `available_balance` | `earnings_layer._credit_module_reward` legacy mirror | **none** (canonical via `money_ledger_events` only) |
| **Operational writer** for `earned_lifetime` | `earnings_layer._credit_module_reward` legacy mirror | **none** |
| **Operational writer** for `pending_withdrawal` | `request_developer_withdrawal` + admin reject + cancel + mark-paid | **none** (removed by B4.1, B4.3-D1, B4.3-D2, B4.3-D4) |
| **Operational writer** for `withdrawn_lifetime` | admin mark-paid `$inc` | **none** (removed by B4.1) |
| **Diagnostic writer** (orphan canary) | `mock_seed.py:266` | **`mock_seed.py:266`** (intentionally preserved) |
| **User-facing read source** | `dev_wallet_reader` facade routes via projection (since B3.1) | **same** (no change) |
| **Diagnostic compare surface** | `money_projections.compare_dev_wallet_projection` | **same** (no change) |
| **Divergence engine** | `scripts/money_divergence.py` + `dev_wallet_reader._log_compare` | **same** (no change; `ledger_only` promoted to INFO whitelist) |

### TL;DR

`dev_wallets` is now a **read-only diagnostic mirror**. The only
producer is the deliberately-seeded `mock_seed_orphan_canary_v1` fixture
in `mock_seed.py`, which exists solely to keep the divergence engine's
self-test alive (it proves the legacy-vs-canonical compare can still
detect a legacy-only writer). Every other dev who earns money
post-B4.4 will have no `dev_wallets` row at all — they live entirely on
the canonical `money_ledger_events` → `dev_wallets_projection` chain.

---

## 2. Why this took multiple phases (not one big delete)

The collection couldn't be removed in a single phase because it had
multiple operational responsibilities that required *separate*
migrations to disentangle:

| Phase | What it removed from `dev_wallets` |
|---|---|
| 2C-B3.1 | (no writer removal — flipped READ source to projection so removals could begin safely) |
| 2C-B4.0.1 | Seed writers (demo + mock seeds canonicalised) |
| 2C-B4.1 | Admin mark-paid `pending → withdrawn` `$inc` |
| 2C-B4.2 | `_credit_module_reward` legacy mirror `earned_lifetime + available_balance` `$inc` |
| 2C-B4.2.1 | `module_qa_decision` canonical chain coverage |
| 2C-B4.3-D1 | Admin reject `pending_withdrawal` `-=` mirror |
| 2C-B4.3-D2 | Developer request `available -= / pending +=` mirror |
| 2C-B4.3-D3 | Insert-failure compensating release (replaced legacy `$inc` rollback) |
| **2C-B4.3-D4** | Developer cancel `pending -= / available +=` mirror |
| **2C-B4.4** (this phase) | **Formalisation** — AST guard + INFO-suppression for the new `ledger_only` steady state + this contract document |

By B4.4, *no production writer remained*. The work of this phase is
not code-removal but **invariant declaration**: an AST-based test
locks in the property, a log-level adjustment removes the false-WARN
noise that the new steady state would otherwise create, and this
document records why `dev_wallets` is allowed to stay around despite
having no operational role.

---

## 3. Why we keep `dev_wallets` (instead of dropping it)

Three reasons, in priority order:

1. **Migration evidence.** Every prior phase's stability probe and
   divergence engine produces a checksum / classification histogram
   that depends on the legacy collection's contents. Dropping the
   collection would invalidate every audit artifact in `/app/audit/`.
2. **Divergence visibility canary.** The
   `mock_seed_orphan_canary_v1` row proves that
   `money_divergence.py` is still capable of detecting a
   legacy-only writer. If we delete `dev_wallets` *or* the canary,
   the divergence engine loses its self-test and a regression could
   silently disable it.
3. **Historical mirror.** Pre-bridge demo and seed users still have
   real (intentionally lagging) rows in `dev_wallets` — these
   surface as `legacy_only` / `pending_pre_b4_3_d` / `mock_orphan`
   classifications in the stability probe (4 + 2 + 4 rows respectively
   at the time of writing). They are the *expected* shape for any
   pre-B4 substrate state and prove the projection-vs-legacy compare
   still works.

`dev_wallets` will be archivable when:
- All `pending_pre_b4_3_d` and `pending_post_b4_3_d{1,2}` rows have
  drained (the open reserves they describe have terminated), AND
- The divergence engine is formally a passive observer (B4.5), AND
- A new, deliberate phase ("drop divergence visibility canary") replaces
  the canary with an alternative self-test source.

That is **not B4.4 scope**.

---

## 4. AST guard

`/app/backend/tests/test_dev_wallets_diagnostic_only_b4_4.py`

Three tests:

1. `test_no_unauthorised_dev_wallets_writers_in_production` — walks
   every `*.py` file under `/app/backend/` (excluding `tests/`,
   `__pycache__/`, `_archive/`), parses to an AST, and counts every
   `Call` node whose `.func` is an `Attribute` ending in `dev_wallets`
   and whose method is one of the 13 mutation methods (`update_one`,
   `update_many`, `insert_one`, `insert_many`, `delete_one`,
   `delete_many`, `replace_one`, `find_one_and_update`,
   `find_one_and_replace`, `find_one_and_delete`, `bulk_write`, `drop`,
   `rename`). The allow-list is exactly `{mock_seed.py}`. Any
   unauthorised writer fails the test with file + line + method name.

2. `test_orphan_canary_writer_still_present_in_mock_seed` — guards
   against the *opposite* regression: if the canary disappears, the
   divergence engine loses its self-test. Asserts the canary call is
   exactly one `update_one` upsert on `dev_wallets`.

3. `test_dev_wallets_readers_still_exist` — sanity check that
   `dev_wallet_reader.py`, `money_divergence.py`, and
   `money_projections.py` still *read* from `dev_wallets`. A
   well-meaning future cleanup that rips out the readers would silently
   break the divergence comparison.

The AST approach (not regex) means comments, docstrings, and string
literals that *mention* `dev_wallets.update_one(...)` (which is common
in the historical migration documentation throughout `server.py` and
`seed_money_demo.py`) do not trigger false positives.

```
$ python tests/test_dev_wallets_diagnostic_only_b4_4.py
All dev_wallets writer call sites in production: 1
  mock_seed.py:266  .update_one(...)  (ALLOWED canary)
```

---

## 5. INFO-suppression for `ledger_only` (post-B4.4 steady state)

Before B4.4, the `ledger_only` classification meant: "ledger has
activity for this dev but legacy mirror is missing — that's
suspicious". Post-B4.4, with no operational writers to `dev_wallets`
left, `ledger_only` becomes the **expected steady state** for every
non-canary developer with canonical activity.

`dev_wallet_reader._log_compare` was therefore updated to include
`ledger_only` in the INFO whitelist (alongside `mock_orphan`,
`legacy_only`, `pending_pre_b4_3_d`, `pending_post_b4_3_d1`,
`pending_post_b4_3_d2`). The divergence engine still classifies it
and the divergence trail is still searchable — the only change is
that it stops paging on-call on every legitimate fresh earner.

The contract is locked in by
`tests/test_dev_wallet_reader.py::test_ledger_only_mismatch_logged_at_info_post_b4_4`.

---

## 6. Acceptance — all 7 criteria green

| # | Criterion | Evidence |
|---|---|---|
| 1 | grep / AST: 0 active `dev_wallets` writers outside the canary | `test_no_unauthorised_dev_wallets_writers_in_production` ✅ — only `mock_seed.py:266` reported |
| 2 | User-facing wallet reads from projection | `dev_wallet_reader.read_dev_wallet` with `MONEY_READS_FROM_PROJECTION=true` (flipped in B3.1); 9 reader-facade tests green |
| 3 | Earnings approval moves ledger/projection, not legacy | `_credit_module_reward` no longer touches `dev_wallets` (B4.2); `escrow_layer.release_escrow` emits canonical `escrow_release` event |
| 4 | Payout lifecycle works | `withdrawal_smoke_trace.py` green; admin mark-paid drains `ac_reserved → ac_ext` canonically (B4.1) |
| 5 | Withdrawal lifecycle works | 47/47 D1+D2/D3+D4+B4.3-C+reservation tests green; lifecycle entirely canonical (see `PRD.md` §"Conservation chain") |
| 6 | WARN mismatch = 0 | `ledger_only` promoted to INFO whitelist; `test_ledger_only_mismatch_logged_at_info_post_b4_4` ✅ |
| 7 | Divergence engine still compares legacy vs projection | `dev_wallets_readers_still_exist` ✅; stability probe still classifies 6 buckets (`ledger_only`, `pending_post_b4_3_d1`, `matches`, `pending_pre_b4_3_d`, `mock_orphan`, `legacy_only`) |

### Stability probe (5/5 deterministic post-B4.4)

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

The `ledger_only: 70` is the new normal — 70 developers have canonical
activity and no legacy mirror. Pre-B4.4 each of these would have
logged a WARN on every wallet read; post-B4.4 they log at INFO and
the divergence trail is intact.

---

## 7. What was explicitly NOT changed

- ❌ Did NOT delete the `dev_wallets` collection (per user contract — historical mirror preserved)
- ❌ Did NOT remove `mock_seed.py` orphan canary (load-bearing for divergence self-test)
- ❌ Did NOT modify `money_divergence.py` (B4.5 territory — engine still actively classifies; the demotion to "passive observer" is the next phase)
- ❌ Did NOT touch `users.total_earnings` or `escrow_earnings` mirrors in `escrow_layer.py` — these are a *different* legacy mirror (Decision 1 territory), not `dev_wallets`
- ❌ Did NOT modify replay scripts, pricing engine, HVL, or any unrelated subsystem
- ❌ Did NOT clean up old `dev_wallets` rows (the existing 12 legacy rows are migration evidence)

---

## 8. Known pre-existing test fragility (not introduced by B4.4)

`tests/test_money_stabilization.py::test_dev_wallet_canonical_no_double_credit`
and `test_full_chain_seed_no_double_events` are pre-existing flaky
tests caused by the `seed_money_demo.MoneyService` singleton not being
wired correctly in test-subprocess context (the canonical
`hold_escrow + release_escrow` calls early-return, while the
`users.total_earnings` legacy mirror in `escrow_layer.py:230` still
gets incremented through a separate path).

This is **not B4.4 caused** — the affected code paths
(`seed_money_demo.py`, `escrow_layer.py:230`, `users.total_earnings`)
were not modified in B4.4. The user-facing runtime behaviour is
unaffected — proven by the green smoke-trace + stability probe + all
70 in-scope tests passing. Fixing the test-environment wiring is
Decision 1 territory (the `users.total_earnings` legacy mirror is
explicitly outside B4.4 scope).

---

## 9. Roadmap status (updated)

1-7. ✅ (all of B1 through B4.3-D4)
8. ✅ **2C-B4.4 — `dev_wallets` diagnostic-only formalisation (this phase)**
9. 🟡 **2C-B4.5 — divergence engine → passive observer** (NEXT)
10. 🟡 Eventual: drop `dev_wallets` collection (requires a new, deliberate phase replacing the canary with an alternative self-test source)

### B4.5 preview

Now that B4.4 has *declared* `dev_wallets` diagnostic-only and adjusted
the logging contract, B4.5 will:

- Update `money_divergence.py` comments to reflect the new mental model:
  "drift" is no longer a money-loss signal — it's "legacy mirror lag",
  which by design never converges (legacy is frozen, canonical accumulates).
- Optionally rename the existing `divergences` classes to make the
  legacy/canonical relationship explicit (e.g. `legacy_drift_total_earnings`
  → `legacy_frozen_mirror_total_earnings`).
- Replace any remaining "should be 0" assertions with "should be
  bounded by what's recorded canonically — legacy may stay below or
  above, just not zero".
- Promote the divergence engine's HTTP endpoints to return a
  `legacy_status: "frozen_diagnostic"` flag so dashboards can render
  the new mental model.

After B4.5, the divergence engine becomes a **passive observer** — it
still classifies, still emits the audit trail, but is no longer the
gatekeeper for whether the substrate is healthy.

---

## 10. File manifest

| File | Role |
|---|---|
| `/app/backend/tests/test_dev_wallets_diagnostic_only_b4_4.py` | AST guard (3 tests) — the live invariant |
| `/app/backend/dev_wallet_reader.py` | `_log_compare`: `ledger_only` added to INFO whitelist |
| `/app/backend/tests/test_dev_wallet_reader.py` | `test_ledger_only_mismatch_logged_at_info_post_b4_4` — locks in the INFO contract |
| `/app/backend/mock_seed.py:266` | Canary writer (preserved with explicit inline notice 253-265) |
| `/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md` | This document |
| `/app/audit/PHASE_2C_B4_4_ACCEPTANCE_2026-02-FEB.md` | Acceptance summary (separate file, this is the contract) |
| `/app/memory/PRD.md` | Will be updated to reflect B4.4 done |
