# Phase 2C-B4.5 — Acceptance (2026-02-FEB)

**Scope**: Formal demotion of `money_divergence` to a **passive observer**.
Engine retains all classification + endpoints, gains AST-enforced
contract that it cannot grow operational surface area.

**Status**: ✅ **GREEN** — 75/75 in-scope tests pass, 5 AST guard
covenants enforced, severity policy correctly demotes frozen-by-design
drifts, live HTTP envelope carries passive-observer mode flag,
stability probe deterministic.

---

## 1. What changed (only this phase)

| Item | Before B4.5 | After B4.5 |
|---|---|---|
| Module docstring purpose | "read-only … no writes, no chains, no repairs" (philosophical) | **"PASSIVE OBSERVER" with 5 explicit negative covenants** |
| Authority map (`overview()` response) | declared `dev_wallets` as `developer_payable_canonical` (stale post-B4.4) | **`money_ledger_events` (read via `dev_wallets_projection`) is canonical; `dev_wallets` labeled diagnostic mirror; new key `frozen_post_b4_4` lists frozen fields explicitly** |
| HTTP envelope | bare payload | **`mode: "passive_observer"` + `legacy_dev_wallets_status: "frozen_diagnostic"` + `contract: "/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md"`** on every response |
| `legacy_drift_total_earnings` severity | `warning` | **`info`** (frozen-by-design) |
| `withdrawals_drift` severity | `warning` | **`info`** (frozen-by-design) |
| `wallet_journal_drift` severity | `error` | **`info`** (active log vs frozen mirror) |
| `wallet_balance_equation_broken` severity | `error` | `error` (kept — internal pre-B4.4 substrate inconsistency) |
| Static enforcement of passive-observer contract | none | **`tests/test_divergence_passive_observer_b4_5.py`** — 5 AST guards |
| Public contract document | absent | **`/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md`** (8 sections) |

**Net code change**: ~50 lines functional in `money_divergence.py`
(docstring expansion, envelope helper, route wrapping, three severity
flips, authority-map update) + 1 new 270-line AST guard test + 1
contract document + PRD update. Engine classification logic itself
is **untouched** — every class still fires, every endpoint still
serves the same shape.

---

## 2. Acceptance — 5 negative covenants + 4 positive responsibilities

### Negative covenants (AST-enforced)

| # | Covenant | Test | Result |
|---|---|---|---|
| 1 | NO writes | `test_divergence_engine_has_zero_writer_calls` — AST walks `money_divergence.py`, counts every `Call` whose method ∈ `{update_one, update_many, insert_one, insert_many, delete_one, delete_many, replace_one, find_one_and_update, find_one_and_replace, find_one_and_delete, bulk_write, drop, rename}` | ✅ 0 sites |
| 2 | NO operational branching | `test_no_operational_code_imports_money_divergence_for_business_logic` — import allow-list `{wire, router}`; all other prod imports/refs fail | ✅ 0 violations |
| 3 | NO payout gating | `test_no_payout_or_repair_paths_consult_divergence_output` — heuristic scan for `if/elif/return/raise` lines combining suspect tokens with operational keywords | ✅ 0 findings |
| 4 | NO repair authority | (composite of 1 + 3) — without writers, repair is structurally impossible | ✅ |
| 5 | NO source-of-truth influence | (composite of 2 + 3) + authority-map update | ✅ |

### Positive responsibilities (live verification)

| # | Responsibility | Evidence |
|---|---|---|
| a | Diagnostics still active | `/api/admin/money/divergence/overview` HTTP 200 with full classification histogram |
| b | Migration confidence | `scripts/dev-wallet-projection-stability.py` 5/5 runs deterministic, checksum `b311bd5b5902…` stable |
| c | Anomaly visibility | Post-B4.5 histogram: **info=73, warning=1, error=5** — real anomalies still surface (`payouts_root_orphan`, `wallet_balance_equation_broken`, `ledger_missing`) |
| d | Audit evidence | 1117-line module retains every classifier; no class deleted; no log line silenced |

---

## 3. Severity histogram — before vs after

```
                           Pre-B4.5   Post-B4.5
info                          39         73        ← grew (frozen-by-design lag)
warning                       2+         1         ← shrank (real anomalies only)
error                         26         5         ← shrank (real anomalies only)

By class (post-B4.5):
  legacy_drift_total_earnings    28  (info)   ← frozen-by-design
  wallet_journal_drift           27  (info)   ← frozen vs active legacy
  withdrawals_drift              11  (info)   ← frozen vs canonical
  wallet_balance_equation_broken  4  (error)  ← real internal inconsistency
  payouts_root_orphan             1  (warning) ← real S-1 parallel-write divergence
  payouts_root_drift_dev          1  (info)   ← frozen pending Decision 2
  ledger_missing                  1  (error)  ← real bug
```

The `info` bucket *grew* because more drift is correctly classified
as expected legacy lag. The `warning` + `error` buckets *shrank to
genuine substrate anomalies only* — exactly the intent of B4.5.

---

## 4. Test summary

```
$ pytest tests/test_divergence_passive_observer_b4_5.py \
         tests/test_dev_wallets_diagnostic_only_b4_4.py \
         tests/test_dev_wallet_reader.py \
         tests/test_money_withdrawal_cancel_d4.py \
         tests/test_money_admin_reject_d1.py \
         tests/test_money_withdrawal_request_d2_d3.py \
         tests/test_money_projection_b4_3_c.py \
         tests/test_money_withdrawal_reservation.py \
         tests/test_dev_wallet_projection.py
75 passed in 4.95s
```

Total: **75/75 green**, including:
- **5 new B4.5 AST passive-observer guards** (covenants 1-5 + envelope + severity-policy)
- 3 B4.4 AST diagnostic-only guards
- 9 reader-facade tests (with B4.4 `ledger_only` INFO test)
- 9 D4 acceptance tests
- 6 D1 regression tests
- 8 D2/D3 regression tests
- 11 B4.3-C projection tests
- 12 reservation flow tests
- 10 dev_wallet_projection tests
- 2 baseline reader tests

---

## 5. Live HTTP envelope evidence

```
$ curl ".../api/admin/money/divergence/overview" | jq
{
  "mode": "passive_observer",
  "legacy_dev_wallets_status": "frozen_diagnostic",
  "passive_observer_contract": "/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md",
  "scanned": { "modules": 97, "developers": 79, … },
  "by_severity": { "info": 73, "warning": 1, "error": 5 },
  "authority_map": {
    "developer_payable_canonical": "money_ledger_events (read via dev_wallets_projection)",
    "developer_payable_diagnostic_mirror": "dev_wallets (frozen post-B4.4 — 1 writer = canary)",
    "frozen_post_b4_4": [
      "dev_wallets.earned_lifetime",
      "dev_wallets.available_balance",
      "dev_wallets.withdrawn_lifetime",
      "dev_wallets.pending_withdrawal"
    ],
    …
  }
}

$ curl ".../api/admin/money/divergence/developers?limit=2&only_diverged=true" | jq
{
  "mode": "passive_observer",
  "legacy_dev_wallets_status": "frozen_diagnostic",
  "contract": "/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md",
  …
}
```

All 6 endpoints (`overview`, `modules`, `module/{id}`, `developers`,
`developer/{id}`, `blast-radius`) wrap their payload in `_with_envelope()`.
`overview()` declares `mode` directly so the helper's spread is
non-destructive on collision.

---

## 6. Public API impact

**Additive only.** Existing consumers see three new top-level keys
(`mode`, `legacy_dev_wallets_status`, `contract` or
`passive_observer_contract`). Severity values for three classes shift
from `warning`/`error` to `info` — consumers that filter by severity
will see fewer warnings/errors (which is the point). No endpoint
shape changed, no class deleted, no field renamed.

---

## 7. What was explicitly NOT changed (per user's B4.5 contract)

- ❌ Did NOT delete any divergence class — every classifier still fires
- ❌ Did NOT remove any HTTP endpoint — full read surface preserved
- ❌ Did NOT change response shape beyond additive envelope keys
- ❌ Did NOT add any writer to the engine
- ❌ Did NOT touch `money_projections.py`, `dev_wallet_reader.py`, or any other module
- ❌ Did NOT remove `mock_seed.py:266` orphan canary
- ❌ Did NOT remove replay scripts
- ❌ Did NOT change pricing engine, HVL, frontend, Expo, or web

---

## 8. Architectural state (post-B4.5)

```
┌─────────────────────────────────────────────────────────────────┐
│  CANONICAL TRUTH                                                 │
│  └─ money_ledger_events  (sole source of truth)                  │
│        │                                                          │
│        ▼ derived                                                  │
│  ┌─────────────────┐                                              │
│  │ dev_wallets_    │  (operational read model)                    │
│  │ projection      │                                              │
│  └─────────────────┘                                              │
│        │                                                          │
│        ▼ served via                                               │
│  ┌─────────────────┐                                              │
│  │ dev_wallet_     │  (user-facing wallet reader)                 │
│  │ reader facade   │                                              │
│  └─────────────────┘                                              │
│                                                                   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─       │
│                                                                   │
│  DIAGNOSTIC MIRRORS (frozen, not consulted operationally)         │
│  ├─ dev_wallets  (frozen post-B4.4 — 1 writer = canary)           │
│  ├─ users.total_earnings  (frozen, Decision 3 pending)            │
│  ├─ users.escrow_earnings (frozen, Decision 3 pending)            │
│  └─ payouts, earnings, task_earnings (frozen, Decision 2 pending) │
│                                                                   │
│  PASSIVE OBSERVER                                                 │
│  └─ money_divergence  (read-only, classifies, surfaces, doesn't act) │
│        │                                                          │
│        ▼                                                          │
│   diagnostics + migration confidence + anomaly visibility +       │
│   audit evidence                                                  │
│   (NEVER: payout gating, repair authority, source-of-truth)       │
└─────────────────────────────────────────────────────────────────┘
```

**Migration is conceptually complete.** What remains is *optional*
cleanup horizon, not migration-critical path.

---

## 9. Roadmap status (post B4.5)

1-10. ✅ (all of B1 through B4.4)
11. ✅ **2C-B4.5 — divergence engine → passive observer (this phase)**

### Optional post-migration cleanup horizon (not migration-critical)

- Archival strategy for `dev_wallets` / `payouts` / `earnings` / `task_earnings`
- Shadow-deprecation flag for `users.total_earnings` (Decision 3)
- Long-tail legacy retirement
- Possible removal of mirror rebuild flows once retention window passes
- Eventual replacement of `mock_seed.py:266` canary with alternative self-test source

None of these affect substrate correctness. They are hygiene tasks
for the post-migration era.

---

## 10. Closeout signature

- AST guard test: `/app/backend/tests/test_divergence_passive_observer_b4_5.py` (5 tests, ~270 lines)
- Engine: `/app/backend/money_divergence.py` (1217 lines after expansion; docstring §1-5, envelope helper, severity demotions, authority-map update)
- Public contract: `/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md`
- This acceptance summary: `/app/audit/PHASE_2C_B4_5_ACCEPTANCE_2026-02-FEB.md`
- B4.4 contract still authoritative: `/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md`
- Stability probe artifact: `/app/audit/dev_wallet_projection_stability.json`
- PRD: `/app/memory/PRD.md` (updated)
