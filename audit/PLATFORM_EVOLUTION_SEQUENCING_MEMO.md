# Platform Evolution Sequencing — Decision Memo

**Status**: Strategic ranking, **not** a committed roadmap.
**Authored**: 2026-02-FEB, immediately after Phase 2C-B substrate seal.
**Companion to**: governance charter, milestone, signoff.
**Purpose**: Record the strategic logic for ordering growth vectors at
the moment of substrate closeout. Future sessions can amend the
sequencing, but should do so deliberately rather than by accident.

---

## 1. The operational fact this memo captures

The seal of Phase 2C-B produced a property that didn't exist before
and is qualitatively different from "code works":

> **New features no longer require substrate anxiety.**

Specifically:

- payout batching does not require wallet rewrite
- FX does not require reconciliation hacks
- subscriptions do not require a new balance layer
- analytics do not require shadow tables
- automation does not require mutable-state patching

Every new line reduces to one or more of:

- a **new canonical event type** on the existing ledger
- a **new projection** over the existing event stream
- a **new operational workflow** consuming existing primitives
- a **new observer layer** reading existing classifications

This is the post-seal evolution surface. The decision memo below
orders growth vectors **by leverage on that surface**, not by
"what's interesting".

---

## 2. Tier 1 — Substrate-adjacent (highest leverage)

These four lines directly capitalise on the sealed substrate. Each
one is essentially **one new event type + one new projection**, with
no operational coupling to existing balance arithmetic.

### 1. payouts v2

Why first: it's the closest line to the seal — same event topology,
same conservation invariant, just richer transitions.

What it adds:
- Batching multiple `ac_reserved → ac_ext` transitions into a single
  settlement event
- Scheduling (deferred payouts, scheduled releases)
- Partial paids (split a single reserve across multiple settlements)
- Payout policies per developer / per tier

Substrate impact: zero. Adds new event subtypes
(`withdrawal_batch_settled`, `withdrawal_partial_paid`, etc.) on the
existing `ac_ext` axis.

### 2. provider settlement

Why second: validates the event-authoritative model against external
truth (Stripe / Wise / crypto rails). Forces the cleanest possible
boundary between **internal ledger** and **external provider state**.

What it adds:
- Stripe / Wise / bank rail adapters as new event sources
- External-id reconciliation events (provider settlement ID ↔ internal
  withdrawal ID)
- Provider-specific timing semantics (instant / next-day / batched)

Substrate impact: zero. Each provider becomes an event source that
mutates `ac_ext` only. Reconciliation happens via event correlation,
not balance comparison.

### 3. multi-currency / FX

Why third: the substrate already supports it structurally (every
ledger entry is currency-tagged), but the **read model** needs a
canonicalisation layer for display + reporting.

What it adds:
- Multi-currency event entries (already structurally supported)
- FX conversion events (a new event type that emits a paired debit/credit
  across currency-tagged accounts)
- Display normalisation in the projection

Substrate impact: zero. The conservation invariant
`Σ ac_dev + Σ ac_reserved + Σ ac_ext` already holds per-currency
trivially; cross-currency conservation is enforced by FX events being
balanced pairs.

### 4. analytics over ledger

Why fourth (still Tier 1): the ledger is the right substrate to build
analytics on, but the value is *derived* — it doesn't itself unlock
new monetization, it informs decisions about the other three.

What it adds:
- Cohort earnings reports (read-only over event stream)
- Payout SLA dashboards
- Escrow age analysis
- Anomaly detection (orthogonal to divergence engine — different
  signal class)

Substrate impact: zero. Pure read layer.

### Why these four are Tier 1 together

Each one is:
- Buildable **independently** of the other three
- Buildable **in parallel** with the other three (no shared mutable
  state)
- A **direct leverage** on the seal (each adds value that was
  structurally impossible pre-seal)
- **Hygiene-class** under governance charter §2 (no correctness
  amendment needed)

Ordering within Tier 1 is by **convertible-monetization first**
(payouts v2 → provider settlement → FX) → **decision-quality
amplifier last** (analytics).

---

## 3. Tier 2 — Operational primitives that need maturation first

These lines are valuable, but they consume operational primitives that
are best built **after** Tier 1 matures, not in parallel with it.

| Line | Why it's Tier 2 |
|---|---|
| AI / automation | Best built on stable operational workflows. If automation is layered on top of evolving payout / settlement / FX flows, the automation has to track moving targets — slower, more fragile. |
| Forecasting | Best built on rich historical data + stable revenue model. Until payouts v2 + provider settlement ship, the data shape keeps changing. |
| Execution systems (module motion, operator engine extensions) | Already exists in mature form; extension work should follow product demand, not push it. |

**Tier 2 sequencing rule**: start a Tier 2 line only after at least
one Tier 1 line has shipped to production and stabilised for >1 month.
This prevents the "automation built on moving target" failure mode.

---

## 4. Tier 3 — Hygiene horizon (from milestone §6)

These don't compete with growth lines. They are picked up by whoever
notices them as cleanup opportunities during normal feature work:

- Archival policy for `dev_wallets`
- Shadow-deprecation flag for `users.total_earnings` (Decision 3)
- Long-tail legacy retirement (`payouts` / `earnings` / `task_earnings`)
- Replay simplification
- Canary evolution
- Observability normalisation

All are hygiene-class under governance charter §2. None block any
Tier 1 or Tier 2 line.

---

## 5. What this memo does NOT do

- It **does not commit** to a roadmap. The user can pick any Tier 1
  line in any order, or pick a Tier 2 line out-of-sequence if there's
  external pressure to do so.
- It **does not authorise** correctness amendments. Any line that
  would amend the seal still goes through governance charter §6.
- It **does not freeze priorities**. New strategic information (new
  customer, regulatory shift, competitive move) can re-rank these at
  any time. The sequencing logic is a **default**, not a constraint.

---

## 6. The mental model this memo encodes

Three layers of work, three different operational rules:

```
┌─────────────────────────────────────────────────────────────┐
│  CORRECTNESS LAYER  — SEALED                                 │
│  (substrate, ledger, projection, reader, divergence)         │
│  Rule: governance charter §2 (correctness amendment only)    │
└─────────────────────────────────────────────────────────────┘
              ▲
              │  (read-only consumption; never mutates)
              │
┌─────────────────────────────────────────────────────────────┐
│  EVOLUTION LAYER   — OPEN, TIERED                            │
│  Tier 1: payouts v2, provider settlement, FX, analytics      │
│  Tier 2: AI/automation, forecasting, execution extensions    │
│  Rule: normal product engineering with 75-test gate          │
└─────────────────────────────────────────────────────────────┘
              ▲
              │  (consumes evolution layer's outputs)
              │
┌─────────────────────────────────────────────────────────────┐
│  HYGIENE LAYER     — OPEN, OPPORTUNISTIC                     │
│  archival, deprecation, replay simplification, canary, obs   │
│  Rule: pick up during normal feature work; no ceremony       │
└─────────────────────────────────────────────────────────────┘
```

A change is **always classifiable** into exactly one of these three
layers. The classification determines the operational rule, which
determines the velocity / review weight / risk profile.

---

## 7. Signoff

| Field | Value |
|---|---|
| Memo version | 1.0 |
| Authored alongside | Substrate seal closeout, 2026-02-FEB |
| Companion documents | Governance charter, milestone, signoff |
| Re-ranking authority | Anyone with strategic context; document the new ranking as v2 of this memo |
| Re-classification authority | Governance charter §6 (for correctness amendments only) |

> **Substrate-adjacent lines first. Operational dependents follow.
> Hygiene flows in parallel with whatever's active. Correctness layer
> dormant.**
>
> — Strategic ranking, recorded at the moment of seal.
