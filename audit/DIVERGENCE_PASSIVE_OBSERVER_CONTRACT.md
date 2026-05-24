# Divergence Engine — Passive Observer Contract (Phase 2C-B4.5)

**Status**: ✅ **GREEN** — formalised 2026-02-FEB. All five negative
covenants of the passive-observer contract are AST-enforced via
`tests/test_divergence_passive_observer_b4_5.py`. Frozen-by-design
drifts are demoted to severity `info`. Every HTTP response carries
`mode: "passive_observer"` + `legacy_dev_wallets_status: "frozen_diagnostic"`.

---

## 1. The contract

### Five negative covenants (what the engine MUST NOT do)

| # | Covenant | How it is enforced |
|---|---|---|
| 1 | **NO writes** — engine never mutates any collection | AST walk of `money_divergence.py`: 0 sites for any of `{update_one, update_many, insert_one, insert_many, delete_one, delete_many, replace_one, find_one_and_update, find_one_and_replace, find_one_and_delete, bulk_write, drop, rename}` |
| 2 | **NO operational branching** — no business code imports any classifier/scanner from `money_divergence` for control-flow | AST import-allow-list = `{wire, router}`; any other `from money_divergence import X` or `money_divergence.X` from non-test, non-archive Python under `/app/backend/` fails the test |
| 3 | **NO payout gating** — payouts proceed on canonical ledger alone | Composite scan: any `if` / `elif` / `while` / `return` / `raise` line in production code that combines `(diverged|divergence|.classification)` with `(payout|repair|heal|fix_|gate|block|deny|approve|reject)` fails the test |
| 4 | **NO repair authority** — engine cannot heal what it observes | Same composite scan + the writers covenant — without writers, repair is structurally impossible |
| 5 | **NO source-of-truth influence** — `money_ledger_events` remains canonical | Same composite scan + authority-map update (see §3) |

### Four positive responsibilities (what the engine MUST still do)

| | Responsibility | Evidence |
|---|---|---|
| a | **Diagnostics** — render the gap between legacy frozen mirror and canonical ledger | Endpoint `/api/admin/money/divergence/overview` live (HTTP 200, 28 `legacy_drift_total_earnings` rows classified) |
| b | **Migration confidence** — the stability probe still consumes divergence classifications | `scripts/dev-wallet-projection-stability.py` green, checksum `b311bd5b5902…` stable across 5 runs |
| c | **Anomaly visibility** — real bugs still surface as warning/error | Post-B4.5 histogram: `info: 73`, `warning: 1` (`payouts_root_orphan` — real S-1 parallel-write divergence), `error: 5` (`wallet_balance_equation_broken: 4` + `ledger_missing: 1` — real substrate bugs) |
| d | **Audit evidence** — searchable trail of every drift that has ever existed | 1117-line `money_divergence.py` retains every classifier; no class deleted; no log line silenced |

---

## 2. Severity policy (post-B4.5)

After B4.4 demoted `dev_wallets` to diagnostic-only, three drift
classes operate on frozen-by-design legacy mirrors and have been
demoted to `info` severity:

| Class | Before B4.5 | After B4.5 | Rationale |
|---|---|---|---|
| `legacy_drift_total_earnings` | `warning` | **`info`** | `users.total_earnings` vs `dev_wallets.earned_lifetime` — both are now frozen mirrors. Canonical truth = `money_ledger_events`. Expected legacy lag, not loss. |
| `withdrawals_drift` | `warning` | **`info`** | `Σ dev_withdrawals(paid)` vs `dev_wallets.withdrawn_lifetime` — legacy mirror frozen post-B4.4; canonical = `ac_ext` debits in ledger. |
| `wallet_journal_drift` | `error` | **`info`** | `dev_wallets.earned_lifetime` (frozen mirror) vs `Σ dev_earning_log.amount` (active legacy journal). Both are diagnostic; canonical = `money_ledger_events`. |

Classes that **keep** their warning/error severity (intentionally):

| Class | Severity | Why it stays |
|---|---|---|
| `wallet_balance_equation_broken` | `error` | Asserts INTERNAL consistency of the frozen `dev_wallets` row at the moment of freeze. If broken, it's a real pre-B4.4 substrate inconsistency worth investigating. |
| `ledger_missing` | `error` | Canonical mutation present but no ledger event — real bug. |
| `escrow_payouts_orphan` | `error` | Parallel-write divergence (S-1) — real bug. |
| `wallet_not_credited` | `error` | Escrow released but no journal entry — real bug. |
| `release_mismatch` | `warning` | `escrow.released_amount != Σ escrow_payouts` — substrate inconsistency. |
| `payouts_root_orphan` | `warning` | Frozen collection with no log mirror — likely pre-bridge legacy artifact, worth surfacing but not gating. |
| `earnings_root_orphan` | `warning` | Same as above for `earnings` (root). |
| `double_credit_suspected` | `error` | Anomaly: wallet > expected by > 50%. |
| `escrow_missing` | `warning` | Invoice paid but no escrow — pre-bridge legacy artifact. |
| `escrow_unfunded` | `info` | Legitimate transient (escrow exists, locked=0). |
| `payouts_root_drift_dev` | `info` | Frozen collection drift (Decision 2 pending). |

---

## 3. Authority map (post-B4.4)

The `overview()` endpoint now returns the updated authority map:

```jsonc
"authority_map": {
  "developer_payable_canonical": "money_ledger_events (read via dev_wallets_projection)",
  "developer_payable_diagnostic_mirror": "dev_wallets (frozen post-B4.4 — 1 writer = canary)",
  "client_billing_canonical": "invoices",
  "locked_funds_canonical": "escrows",
  "audit": "money_ledger_events, escrow_payouts",
  "frozen_pending_decision_2": ["payouts", "earnings", "task_earnings"],
  "frozen_post_b4_4": [
    "dev_wallets.earned_lifetime",
    "dev_wallets.available_balance",
    "dev_wallets.withdrawn_lifetime",
    "dev_wallets.pending_withdrawal"
  ],
  "legacy_pending_decision_3": ["users.total_earnings", "users.escrow_earnings"]
}
```

Pre-B4.5 this map declared `dev_wallets` as `developer_payable_canonical`
— **that was stale**. Post-B4.4, `dev_wallets` is the diagnostic mirror;
the canonical is `money_ledger_events` served via `dev_wallets_projection`.

---

## 4. HTTP envelope contract

Every HTTP response from `money_divergence` carries the passive-observer
envelope so dashboards render results with the correct mental model:

```jsonc
{
  "mode": "passive_observer",
  "legacy_dev_wallets_status": "frozen_diagnostic",
  "contract": "/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md",
  // ...rest of payload
}
```

The envelope is non-destructive: caller's keys win on collision.
`overview()` declares the same `mode` directly so the spread doesn't
double-write.

### Endpoints

| Path | Purpose | Envelope |
|---|---|---|
| `GET /api/admin/money/divergence/overview` | Dashboard pulse | ✅ |
| `GET /api/admin/money/divergence/modules` | Paginated per-module rows | ✅ |
| `GET /api/admin/money/divergence/module/{module_id}` | Drill-down | ✅ |
| `GET /api/admin/money/divergence/developers` | Paginated per-developer rows | ✅ |
| `GET /api/admin/money/divergence/developer/{developer_id}` | Drill-down | ✅ |
| `GET /api/admin/money/divergence/blast-radius` | Stage 7A measurement | ✅ |

All endpoints are **GET-only, admin-only, read-only**. No POST/PATCH/DELETE
exist — by design.

---

## 5. Live evidence (post-B4.5)

### Overview HTTP response

```jsonc
{
  "mode": "passive_observer",
  "legacy_dev_wallets_status": "frozen_diagnostic",
  "passive_observer_contract": "/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md",
  "scanned": {
    "modules": 97, "modules_ok": 90, "modules_diverged": 7,
    "developers": 79, "developers_ok": 52, "developers_diverged": 27
  },
  "by_severity": { "info": 73, "warning": 1, "error": 5 },
  "by_class": {
    "ledger_missing": 1,
    "payouts_root_orphan": 1,
    "wallet_journal_drift": 27,
    "legacy_drift_total_earnings": 28,
    "withdrawals_drift": 11,
    "wallet_balance_equation_broken": 4,
    "payouts_root_drift_dev": 1
  },
  "authority_map": { /* …see §3… */ }
}
```

| Before B4.5 | After B4.5 |
|---|---|
| info=39, warning=2+, error=26 | **info=73, warning=1, error=5** |

The `info` bucket *grew* (more drift correctly classified as expected
legacy lag), and the `warning`+`error` buckets *shrank to genuine
substrate anomalies only*.

### Stability probe (5/5 deterministic, classifications still active)

```
rows=193 unchanged=193
classifications={
  'ledger_only': 166,            # post-B4.4 steady state for fresh earners
  'pending_post_b4_3_d1': 5,     # transient withdrawal-reject lag
  'matches': 5,                  # full agreement
  'pending_pre_b4_3_d': 5,       # pre-D-era seeded reserves
  'mock_orphan': 7,              # canary fixtures
  'legacy_only': 2 + 3 = 5       # pre-bridge demo rows
}
checksum=b311bd5b5902…   (stable across all 5 runs)
```

The engine still classifies every dev. The classifications still feed
the stability probe (B-b above). Only the *meaning* changed:
classifications are now interpreted as state-of-the-world signals, not
loss-of-money alerts.

---

## 6. What was explicitly NOT changed (per B4.5 contract)

- ❌ Did NOT delete any divergence class — every classifier still fires
- ❌ Did NOT remove any HTTP endpoint — full read surface preserved
- ❌ Did NOT change response shape beyond the additive envelope keys
- ❌ Did NOT add any writer to the engine — invariant 1 holds strictly
- ❌ Did NOT touch `money_projections.py`, `dev_wallet_reader.py`, or any other module
- ❌ Did NOT remove the `mock_seed.py:266` orphan canary (still load-bearing for divergence self-test)
- ❌ Did NOT remove replay scripts (`scripts/money_divergence.py` CLI runner still works)
- ❌ Did NOT change pricing engine, HVL, frontend, or Expo

---

## 7. Roadmap status (updated)

1-10. ✅ (all of B1 through B4.4)
11. ✅ **2C-B4.5 — divergence engine → passive observer (this phase)**

**Migration is conceptually complete.** What remains is *optional*
cleanup horizon, not migration-critical path:

- Archival strategy for `dev_wallets` / `payouts` / `earnings` / `task_earnings`
- Shadow-deprecation flag for `users.total_earnings` (Decision 3)
- Long-tail legacy retirement
- Possible removal of mirror rebuild flows once retention window passes
- Eventual replacement of the orphan canary with an alternative self-test source

None of those are required for the substrate to be correct. They are
hygiene tasks for the post-migration era.

---

## 8. File manifest

| File | Role |
|---|---|
| `/app/backend/money_divergence.py` | Engine — now carries B4.5 contract in module docstring (§1-5), passive-observer envelope helper, updated authority_map, demoted severities |
| `/app/backend/tests/test_divergence_passive_observer_b4_5.py` | 5 AST guards enforcing the 5 negative covenants + 1 positive sanity + 1 severity-policy lock-in |
| `/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md` | This document |
| `/app/audit/PHASE_2C_B4_5_ACCEPTANCE_2026-02-FEB.md` | Acceptance summary (separate file) |
| `/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md` | B4.4 contract (still authoritative on `dev_wallets`) |
| `/app/audit/MONEY_AUTHORITY_CHARTER.md` | Long-form authority map (pre-migration document — kept as historical reference) |
| `/app/memory/PRD.md` | Will be updated to reflect B4.5 done |
