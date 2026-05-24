# Money Substrate — Completion Milestone

**Date sealed**: 2026-02-FEB
**Authority**: User contract acknowledged at B4.5 closeout
**Status**: ✅ **COMPLETE** — migration line terminated at correctness floor

---

## What this document is

This is the **terminal marker** for the Phase 2C-B money-substrate
refactor. Everything below was migration-critical; everything that
comes after is **platform-hygiene**, not migration. The two have
different operational rules — see §5.

If a future session, fork, or new contributor finds themselves about
to do "one more migration step" on `dev_wallets` / `money_divergence` /
`users.total_earnings` / `payouts` / `earnings` / `task_earnings` — pause
and read §6 first. The substrate is finished. Adding "one more step"
in the migration mindset risks re-introducing the dual-write / drift
class of bugs that B1–B4.5 eliminated.

---

## 1. Sealed architecture

```
┌──────────────────────────────────────────────────────────────┐
│  CANONICAL TRUTH                                              │
│  └─ money_ledger_events    (sole source of truth)             │
│         │                                                      │
│         ▼ deterministic projection                             │
│  ┌──────────────────┐                                          │
│  │ dev_wallets_     │   (operational read model)               │
│  │ projection       │                                          │
│  └──────────────────┘                                          │
│         │                                                      │
│         ▼ served by                                            │
│  ┌──────────────────┐                                          │
│  │ dev_wallet_      │   (user-facing wallet reader)            │
│  │ reader facade    │                                          │
│  └──────────────────┘                                          │
│                                                                │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│                                                                │
│  DIAGNOSTIC MIRRORS (frozen — not consulted operationally)    │
│  ├─ dev_wallets                  (frozen post-B4.4)            │
│  ├─ users.total_earnings         (frozen, Decision 3 pending)  │
│  ├─ users.escrow_earnings        (frozen, Decision 3 pending)  │
│  └─ payouts / earnings /         (frozen, Decision 2 pending)  │
│     task_earnings                                              │
│                                                                │
│  PASSIVE OBSERVER (read-only, classifies, NEVER acts)         │
│  └─ money_divergence                                           │
│         │                                                      │
│         ▼                                                      │
│   diagnostics + migration confidence + anomaly visibility     │
│   + audit evidence                                             │
│   (NEVER: payout gating, repair authority, source-of-truth)    │
└──────────────────────────────────────────────────────────────┘
```

## 2. The withdrawal lifecycle is now conservation-preserving

Every operation on a developer's payable funds reduces to a
balanced pair of ledger entries that conserves the invariant:

    Σ ac_dev + Σ ac_reserved + Σ ac_ext  =  Σ earned ledger credits

| Operation | Ledger transform |
|---|---|
| earn      | `ac_escrow → ac_dev`              (B4.2) |
| request   | `ac_dev → ac_reserved`            (D-2) |
| reject    | `ac_reserved → ac_dev`            (D-1) |
| rollback  | `ac_reserved → ac_dev`            (D-3) |
| cancel    | `ac_reserved → ac_dev`            (D-4) |
| paid      | `ac_reserved → ac_ext`            (B4.1) |

Conservation is **provable** from `money_ledger_events` alone — no
secondary table needed. Every event is a balanced debit + credit pair
with an idempotency key. Replay is deterministic.

## 3. Why this is the correctness floor

The substrate is "finished" in the precise sense that:

1. **There is no operational dependency on any legacy mirror.**
   Removing the legacy collections (after retention) would change
   nothing about correctness; only diagnostic visibility.

2. **There is no dual-write business logic.** Every money-mutating
   path emits exactly one canonical ledger event pair. The legacy
   mirrors are written only by the explicitly-preserved orphan canary
   (`mock_seed.py:266`) for self-test purposes.

3. **The divergence engine cannot evolve back into an operational
   participant.** Five AST-enforced negative covenants block every
   regression vector: writes, operational imports, payout gating,
   repair authority, source-of-truth influence.

4. **The legacy mirror cannot accidentally become a source of truth.**
   Reader facade (`dev_wallet_reader`) routes through the projection;
   diagnostic compare logs the legacy delta at INFO, not WARN, so it
   never paged on-call and never drove decisions.

5. **New dual-writes are structurally blocked.** Any future PR that
   adds a `dev_wallets.update_one(...)` outside the canary file fails
   `test_no_unauthorised_dev_wallets_writers_in_production` before it
   reaches review.

## 4. What this state unlocks (without re-touching the substrate)

Each of these can be built on top of the sealed substrate without
re-opening the migration line:

- Scaling payout logic (multi-currency, batching, partial paids)
- New money products (subscriptions, retainers, escrow holds with
  custom release rules)
- Analytics over the ledger (cohort earnings, payout SLA, escrow age)
- Replay & reconciliation against external settlement providers
- Multi-ledger flows (separate book per business unit / jurisdiction)
- Provider settlement layers (Stripe / Wise / crypto rails) — each
  becomes another canonical event type, not a new mirror
- Forensic queries over divergence history (already classified, still
  emitted, just no longer gating)

None of these require:
- Writing to `dev_wallets` operationally
- Reading divergence output for business decisions
- Adding new mirror collections
- Re-introducing dual-write paths

## 5. Operational mode shift

**During migration (Phase 2C-B1 → B4.5):**
- Every change touched correctness — needed full closeout + AST guard + audit doc
- "Drift" was a signal of incomplete migration
- Severity escalations meant a real bug

**After completion (this milestone forward):**
- Changes touch features / hygiene, not correctness
- "Drift" is expected legacy lag — already classified, already INFO
- Severity escalations mean either (a) a new feature has a real bug
  to investigate, or (b) one of the explicitly-preserved diagnostic
  surfaces is reporting a known frozen-by-design class

The dashboards, alerting thresholds, and on-call runbooks should be
updated **once**, now, to reflect this shift. Don't keep treating
post-completion drift like in-flight migration drift.

## 6. The hygiene horizon (NOT migration-critical)

These tasks would improve cleanliness or reduce surface area, but
**none of them affect substrate correctness**. They can be picked
up at any time, in any order, by any contributor, **without** going
through a full closeout-with-AST-guard ritual unless they touch
canonical paths.

| Task | What it does | When to consider |
|---|---|---|
| Archival policy for `dev_wallets` | Move rows older than N days to `*_archive` collection | When the cost of carrying frozen rows in working set is measurable |
| Shadow-deprecation flag for `users.total_earnings` | Add `deprecated: true` metadata + dashboard banner | When Decision 3 is resolved by ops/product |
| Long-tail legacy retirement | `payouts` / `earnings` / `task_earnings` collections | When Decision 2 is resolved |
| Replay simplification | Drop pre-B4 replay branches now that nothing reads from them | Whenever the replay scripts are next opened |
| Canary evolution | Replace `mock_seed.py:266` orphan with synthetic event-stream fixture | When the divergence engine's self-test is being refactored anyway |
| Observability normalisation | Move all classifier logs to a structured sink + dashboard | When a new dashboarding tool is adopted |

## 7. Sealed test suite

**75 tests** lock the post-completion state. Running this suite is the
post-completion correctness contract:

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
```

Of these:
- **8 are AST guards** (5 passive-observer + 3 diagnostic-only).
  These are the structural enforcement that the substrate cannot
  silently regress.
- **67 are behavioural acceptance** of the canonical paths.

A green run of these 75 = substrate is still sealed correctly.

## 8. Sealed audit trail (forensic provenance)

In chronological order of phase closeout — the migration trail is
preserved in full so any future investigation can reconstruct
**why** the substrate is shaped the way it is:

- `/app/audit/PHASE_2C_B2_DEV_WALLETS_STABILITY_2026-05-23.md`
- `/app/audit/PHASE_2C_B3_*` (dual-read facade + flag flip)
- `/app/audit/PHASE_2C_B4_0_*` (seed canonicalisation)
- `/app/audit/PHASE_2C_B4_1_*` (admin mark-paid)
- `/app/audit/PHASE_2C_B4_2_*` (`_credit_module_reward`)
- `/app/audit/PHASE_2C_B4_2_1_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/PHASE_2C_B4_3_*` (lifecycle A → D4)
- `/app/audit/PHASE_2C_B4_3_D1_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/PHASE_2C_B4_3_D2_D3_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/PHASE_2C_B4_3_D4_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/PHASE_2C_B4_4_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/DEV_WALLETS_DIAGNOSTIC_ONLY_CONTRACT.md`  ← B4.4 contract
- `/app/audit/PHASE_2C_B4_5_ACCEPTANCE_2026-02-FEB.md`
- `/app/audit/DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md`  ← B4.5 contract
- `/app/audit/MONEY_AUTHORITY_CHARTER.md`               ← original Charter
- `/app/audit/MONEY_SUBSTRATE_COMPLETION_MILESTONE.md`  ← this document

## 9. Closeout signature

| Field | Value |
|---|---|
| Substrate state | sealed |
| Canonical authority | `money_ledger_events` |
| Operational read model | `dev_wallets_projection` |
| Diagnostic mirror status | frozen, not consulted operationally |
| Divergence engine status | passive observer (5 AST covenants enforced) |
| Conservation invariant | `Σ ac_dev + Σ ac_reserved + Σ ac_ext = Σ ledger credits` |
| Lifecycle coverage | earn / request / reject / rollback / cancel / paid |
| Test gate | 75/75 (8 AST + 67 behavioural) |
| Public API impact of full migration | additive-only (no breaking change since B2) |
| Decision authority closed | Decision 1 (signed Option D), Decision 4 (avoided — Decision 2/3 remain optional hygiene) |

**Stopping point declared by user, 2026-02-FEB.**

Future work on this codebase: feature development, platform hygiene,
new money products — all of which build *on top of* the sealed
substrate, not into it.
