# Phase 2C-B2 — dev_wallets projection stability probe
**Date:** 2026-05-23
**Status:** ✅ STABLE
**Base URL:** `http://localhost:8001`
**Runs:** 5 (repeatable, not calendar-bound)

## Outcome

Every invariant from the 2C-B2 acceptance grid held across 5 consecutive runs. The projection is repeatable, idempotent, and observation-stable; the mock-seed payout orphan is preserved and visible.

**Gate for 2C-B3 (switch reads) is satisfied.**

## Invariants

| Invariant | Status |
|---|---|
| projection checksum stable across runs | ✅ |
| classification histogram stable across runs | ✅ |
| `diverged` count is zero every run | ✅ |
| `mock_orphan` count stable (orphan preserved) | ✅ |
| `matches` count monotone non-decreasing | ✅ |
| legacy `dev_wallets` not mutated by probe | ✅ |
| rebuild idempotent after run 1 (`unchanged == rows_total`) | ✅ |

## Per-run summary

| run | rows | checksum | rebuild.counts | classifications |
|---:|---:|---|---|---|
| 1 | 193 | `b311bd5b5902…` | computed=193/written=111/unchanged=82/errors=0 | `{"ledger_only": 166, "legacy_only": 5, "matches": 5, "mock_orphan": 7, "pending_post_b4_3_d1": 5, "pending_pre_b4_3_d": 5}` |
| 2 | 193 | `b311bd5b5902…` | computed=193/written=0/unchanged=193/errors=0 | `{"ledger_only": 166, "legacy_only": 5, "matches": 5, "mock_orphan": 7, "pending_post_b4_3_d1": 5, "pending_pre_b4_3_d": 5}` |
| 3 | 193 | `b311bd5b5902…` | computed=193/written=0/unchanged=193/errors=0 | `{"ledger_only": 166, "legacy_only": 5, "matches": 5, "mock_orphan": 7, "pending_post_b4_3_d1": 5, "pending_pre_b4_3_d": 5}` |
| 4 | 193 | `b311bd5b5902…` | computed=193/written=0/unchanged=193/errors=0 | `{"ledger_only": 166, "legacy_only": 5, "matches": 5, "mock_orphan": 7, "pending_post_b4_3_d1": 5, "pending_pre_b4_3_d": 5}` |
| 5 | 193 | `b311bd5b5902…` | computed=193/written=0/unchanged=193/errors=0 | `{"ledger_only": 166, "legacy_only": 5, "matches": 5, "mock_orphan": 7, "pending_post_b4_3_d1": 5, "pending_pre_b4_3_d": 5}` |

## Legacy `dev_wallets` mutation check

- Before probe: rows=27, checksum=`e0db1cd18baf6096…`
- After probe:  rows=27, checksum=`e0db1cd18baf6096…`
- Verdict: ✅ legacy untouched

## What this probe deliberately did NOT do

- ❌ Switch any UI reader from `dev_wallets` to projection
- ❌ Remove or modify any legacy `dev_wallets` writer
- ❌ "Repair" the mock-seed payout orphan
- ❌ Modify `money_divergence.py`, `pricing_engine.py`, or HVL
- ❌ Edit any source file outside `/app/scripts` and `/app/audit`

## Next

Advance to **2C-B3 — switch developer wallet reads to the projection**.
