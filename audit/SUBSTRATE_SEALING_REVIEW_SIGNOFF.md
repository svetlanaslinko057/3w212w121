# Substrate Sealing — Review Signoff

**Companion document to** `MONEY_SUBSTRATE_COMPLETION_MILESTONE.md`.

**Purpose**: Capture the user-side architectural review that closed
the Phase 2C-B migration line. The milestone document records *what*
was sealed; this document records *the verdict that authorised the
seal* and the operational shift it represents.

---

## 1. Reviewer verdict (verbatim)

> "Это правильный способ закрыть такую migration line — не просто
> 'закончить код', а зафиксировать: **this line is sealed unless
> correctness assumptions change**."

> "Именно terminal marker + PRD lock-in здесь критичны. Иначе через
> 2–3 месяца любой новый contributor почти гарантированно:
>   – снова начнёт писать в mirror,
>   – попробует 'быстро починить divergence',
>   – вернёт operational branching,
>   – или перепутает diagnostic lag с substrate inconsistency."

> "Сейчас у вас уже есть то, чего почти никогда нет в подобных
> системах: **formal architectural boundary**. Причём boundary не
> только документирован, а: test-enforced, AST-enforced,
> severity-enforced, authority-mapped, operationally classified."

> "Это зрелое состояние."

---

## 2. The operational shift this seal represents

The single most important consequence of B4.5 closeout, in the
reviewer's framing:

> **Drift is no longer evidence of incomplete migration.**
>
> Before seal: divergence = structural danger signal.
> After seal:  divergence = classified observational phenomenon.

This is **the** mental-model flip that distinguishes a system in
active migration from a system whose substrate is settled. It must
be reflected in:

- On-call runbooks (drift no longer pages)
- Dashboard semantics (warning ≠ migration debt)
- PR review heuristics (do not "fix" classified drift; investigate
  unclassified anomalies only)
- Hiring / onboarding (new contributors learn the post-seal model,
  not the pre-seal model)

---

## 3. Two horizons explicitly separated

The seal cleanly divides remaining work into two non-mixable
categories. The risk being avoided is **horizon drift** — the
tendency for cleanup to disguise itself as "just a bit more migration"
and re-open the very correctness questions the seal closed.

| Horizon | Rules | Examples |
|---|---|---|
| **Correctness** (closed) | AST guards, full closeout, audit doc, severity policy review | New canonical event type; conservation invariant amendment |
| **Hygiene** (open) | PR review with passing 75-test suite; no AST-guard requirement | Archival; mirror retirement; replay simplification; canary evolution; observability normalisation |

**A change is correctness-class if and only if** it touches:
- `money_ledger_events` shape, idempotency, or conservation
- The reader facade's source-of-truth selection
- The withdrawal lifecycle state machine
- Any AST guard (test_*_b4_4 / test_*_b4_5)
- The frozen mirror set (adding writers, not removing them)

Everything else is hygiene-class.

---

## 4. Final architecture (reviewer's framing)

```
canonical event stream
        ↓
deterministic projection
        ↓
compatibility mirror
        ↓
passive diagnostics
```

The reviewer's key insight on **why** this shape is extensible:

> "Больше нет mutable balance arithmetic как authority. Authority
> now lives in conserved event topology."
>
> "Это именно тот переход, который делает систему extensible без
> накопления новых reconciliation hacks."

In one sentence: **authority moved from mutable state to immutable
event history**. New money products can be added as new event types
without altering any existing balance arithmetic, because there
isn't any to alter — there is only an event stream + a projection
function.

---

## 5. The five enforcement axes (the reason the seal will hold)

The reviewer specifically named the five mechanisms that make this
seal qualitatively different from a documentation-only seal:

| Axis | Concrete mechanism | Files |
|---|---|---|
| Test-enforced | 75 acceptance tests gate the behavioural surface | `tests/test_money_*.py` |
| AST-enforced | 8 structural guards prevent regression | `tests/test_dev_wallets_diagnostic_only_b4_4.py`, `tests/test_divergence_passive_observer_b4_5.py` |
| Severity-enforced | Frozen-by-design drift logged at INFO; real anomalies still WARN/ERROR | `dev_wallet_reader._log_compare`, `money_divergence.py` severity dict literals |
| Authority-mapped | `overview()` response declares `developer_payable_canonical` = ledger, `_diagnostic_mirror` = dev_wallets | `money_divergence.overview()` |
| Operationally classified | Every HTTP response carries `mode: "passive_observer"` + `legacy_dev_wallets_status: "frozen_diagnostic"` | `money_divergence._PASSIVE_OBSERVER_ENVELOPE` |

Removing or weakening any one of the five breaks the seal. The AST
guards make several of these structurally impossible to remove
silently.

---

## 6. What this signoff authorises

After this signoff, the following are **explicitly within scope** for
future work without re-opening the migration line:

- Building new features on top of the sealed substrate
- Adding new canonical event types (new money products)
- Provider integrations (Stripe / Wise / crypto rails) as new event sources
- Analytics, reporting, and dashboards reading the ledger
- Replay & reconciliation against external systems
- Hygiene-horizon tasks from the milestone (§6)

The following are **explicitly out of scope** without a new
correctness review (because they would amend the sealed assumptions):

- Adding a new operational writer to `dev_wallets`
- Routing user-facing reads through any frozen mirror
- Making divergence engine output drive business logic
- Restructuring the conservation invariant
- Removing any AST guard

---

## 7. Signoff record

| Field | Value |
|---|---|
| Sealed at phase | 2C-B4.5 |
| Sealed on | 2026-02-FEB |
| Authorising review | This document (user verdict §1, recorded verbatim) |
| Companion artefact | `/app/audit/MONEY_SUBSTRATE_COMPLETION_MILESTONE.md` |
| PRD lock-in | `/app/memory/PRD.md` top-level "⚑ MONEY SUBSTRATE MIGRATION COMPLETE" block |
| Test gate at seal | 75/75 green |
| AST guards count at seal | 8 |
| Conservation invariant | `Σ ac_dev + Σ ac_reserved + Σ ac_ext = Σ ledger credits` |
| Lifecycle coverage at seal | earn / request / reject / rollback / cancel / paid |
| Next phase classification | platform-evolution / hygiene (not substrate-rescue) |

> **"Линия действительно может считаться закрытой."**
>
> — Final reviewer statement, 2026-02-FEB
