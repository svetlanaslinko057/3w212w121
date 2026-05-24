# Substrate Governance Charter

**Companion to**
- `MONEY_SUBSTRATE_COMPLETION_MILESTONE.md` (technical boundary — *what*)
- `SUBSTRATE_SEALING_REVIEW_SIGNOFF.md` (review verdict — *who & why*)

**Purpose**: Encode the **governance boundary** that sits above the
technical seal. The technical artefacts say *the substrate is sealed*;
this document says *how future changes around the seal are classified
and authorised*.

Together the three documents form the architectural memory of the
Phase 2C-B closeout. They are designed to survive:

- 3 months of feature work without anyone re-reading them
- 2 new engineers joining without context transfer
- 1 urgent hotfix attempt against the substrate
- And — most importantly — the loss of the original mental model

---

## 1. Why a governance layer exists

Migrations don't fail when they ship. They fail later, usually after
all of the following have happened in sequence:

1. The implementing team rotated off
2. Onboarding documentation summarised the seal but lost its *reasoning*
3. A new feature looked "adjacent enough" to justify touching sealed code
4. An urgent production issue created pressure to "just fix the
   divergence" or "just write the balance directly"
5. The fix shipped, the team learned the wrong lesson, the seal
   silently degraded

The three-document architecture (milestone + signoff + this charter)
exists to give each of those failure points a **specific artefact to
collide with** before the seal degrades. The milestone document
collides with point 2; the signoff collides with points 3-4; this
charter collides with point 5 by making the classification rule
**explicit and formal**, not implicit and intuitive.

---

## 2. The single governance question

Every proposed change in the vicinity of the substrate must answer
exactly one question before implementation begins:

> **Does this amend correctness assumptions?**
>
> &nbsp;&nbsp;&nbsp;&nbsp;**YES** → reopen ceremony (full closeout with AST guard + audit doc + review verdict)
> &nbsp;&nbsp;&nbsp;&nbsp;**NO**  → hygiene / product evolution (normal PR review with passing 75-test suite)

Everything in this charter exists to make that question answerable
formally, not emotionally.

### Operational test: "is this a correctness-class change?"

A change is **correctness-class** if and only if it touches at least
one of:

- The shape, idempotency, or invariants of `money_ledger_events`
- The conservation equation: `Σ ac_dev + Σ ac_reserved + Σ ac_ext = Σ ledger credits`
- The reader facade's source-of-truth selection (`dev_wallet_reader`)
- Any state in the withdrawal lifecycle (earn / request / reject /
  rollback / cancel / paid)
- Any of the 8 AST guard tests (`test_dev_wallets_diagnostic_only_b4_4.py`,
  `test_divergence_passive_observer_b4_5.py`)
- The frozen-mirror set, by **adding** a writer (removing the
  orphan canary is its own separate phase, not part of this rule)
- The passive-observer envelope (`mode`, `legacy_dev_wallets_status`)
- The severity policy for frozen-by-design drift classes

A change is **hygiene-class** if it touches anything outside that list.

When in genuine doubt: **treat as correctness-class.** False positives
cost a small review ceremony; false negatives cost the seal.

---

## 3. The mode shift this charter formalises

| Aspect | Migration Mode (closed) | Platform Evolution Mode (current) |
|---|---|---|
| **Velocity** | Each step required full closeout + AST guard + audit doc | Hygiene changes flow through normal PR review |
| **Review strategy** | Every PR is correctness-class by default | Default is hygiene-class; correctness-class requires the §2 test to flip |
| **Observability expectations** | Drift = signal of incomplete work | Drift = classified observational phenomenon; only *unclassified* anomalies are signals |
| **Severity semantics** | WARN = migration debt; ERROR = active bug | WARN/ERROR = real anomalies only; frozen-by-design drift is INFO |
| **Contributor onboarding** | "Help us finish the migration" | "The substrate is sealed; here's what you build on top of it" |
| **AST guard treatment** | "Lock these in as we go" | "These are load-bearing structural invariants; do not weaken without §2 review" |
| **Authority of `money_divergence`** | Migration confidence engine | Passive observer; never gates business logic |

The single line that captures all of the above:

> **Authority lives in conserved event topology, not mutable balance arithmetic.**

If a proposed change reintroduces mutable balance arithmetic *as authority* (not just as a derived projection), it is correctness-class regardless of how small the diff is.

---

## 4. What this substrate now naturally grows

The reviewer named these as the natural growth vectors that *event-authoritative* substrates support without recursive repair logic. They are listed here not as a roadmap, but as **proof that the seal opens more doors than it closes**:

- **Batching** — group multiple withdrawals into a single settlement event without altering any wallet
- **Provider settlement** — Stripe / Wise / crypto rails enter as new event types on `ac_ext`
- **FX conversion** — multi-currency ledger entries with conversion events; no balance-side arithmetic
- **Reserve accounting** — multi-tier reserves (per project, per provider, per regulator) as new accounts in the ledger
- **Accrual systems** — earned-but-unsettled bookkeeping by deriving from existing events
- **Tax / regulatory event exports** — derived from immutable event stream; export logic never touches balances
- **Audit replay** — full reconstruction of any wallet at any historical moment by replaying events up to a timestamp
- **Dispute reconstruction** — exact provable answer to "what did this developer's wallet look like on date X" without database point-in-time recovery
- **Multi-tenant ledgers** — separate event streams per tenant / jurisdiction / business unit, each with its own projection

Each of these is a **new canonical event type**, never a new mirror. Each preserves the conservation invariant. Each can be added without going through correctness ceremony (it's hygiene-class / product evolution, not substrate amendment) **as long as** it doesn't reintroduce mutable balance arithmetic as authority.

---

## 5. How the three-document set is meant to be used

| If you are about to… | Read first |
|---|---|
| Build a new feature unrelated to money | None of these — substrate is invisible to you |
| Build a new money product (subscriptions, retainers, …) | This charter §4 to confirm it's hygiene-class; then proceed |
| Touch any file under `money_*` / `dev_wallet_*` / `escrow_*` | This charter §2 to classify; if correctness-class, the milestone document + signoff |
| Investigate a divergence report from on-call | Milestone §3 (correctness floor) and signoff §2 (operational shift). It is almost certainly classified drift, not a bug |
| Onboard a new engineer | All three, in order: charter → milestone → signoff |
| Fork the codebase | All three, plus the AST guard test files; preserve them verbatim |
| Disagree with the seal | This charter §6 (the amendment process) — do not silently bypass |

---

## 6. Seal amendment process

The seal is not immutable, but it is not informally amendable either.
Future amendment requires:

1. **A written proposal** that explicitly identifies which correctness
   assumption is being amended (referencing §2 of this charter).
2. **A review** that produces a verdict-grade artefact in the style of
   `SUBSTRATE_SEALING_REVIEW_SIGNOFF.md` — recording the *why*, not
   just the *what*.
3. **An updated milestone document** that records the new sealed
   state, with a fresh AST guard suite that captures the amendment.
4. **A re-signing** of this charter (or a successor) reflecting the
   new operational mode if applicable.

Steps 1-4 are heavyweight by design. The seal is meant to be load-bearing for years. Anyone proposing to amend it is implicitly proposing to absorb that cost — which is the right incentive structure.

If a proposal can be reformulated to not amend the seal (e.g. as a new event type, a new projection, a new hygiene task), prefer that path. The substrate is intentionally expressive enough that most proposed amendments turn out to be unnecessary on closer reading.

---

## 7. Signoff

| Field | Value |
|---|---|
| Charter version | 1.0 |
| Authored alongside | B4.5 closeout + milestone + review signoff |
| Authority | User-acknowledged "institutionalized architectural memory" verdict, 2026-02-FEB |
| Companion documents | milestone, signoff (see header) |
| Enforcement layer | 8 AST guards + 75 acceptance tests + this charter's §2 classification rule |
| Amendment process | §6 of this document |

The seal will hold for as long as future contributors honour the §2 classification rule. It is the most important single sentence in this document:

> **Does this amend correctness assumptions? YES → reopen ceremony. NO → hygiene / product evolution.**

Everything else in this charter exists to make that question answerable.

> **"Линия действительно закрыта корректно и профессионально."**
>
> — Final review statement, recorded 2026-02-FEB

---

*End of governance charter. Phase 2C-B substrate refactor line: sealed, signed, and governed.*
