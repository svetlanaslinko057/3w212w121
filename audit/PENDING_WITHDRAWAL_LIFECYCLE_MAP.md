# Phase 2C-B4.3-A — `pending_withdrawal` lifecycle map

> **Scope:** B4.3-A only. Audit-doc, **no code changes.**
> Goal: enumerate every legacy writer of `dev_wallets.pending_withdrawal`,
> describe the canonical replacement, race conditions, rollback behaviour,
> and acceptance test, so B4.3-B/C/D can be sequenced safely.
>
> **Out of scope (per user contract):**
> deleting `dev_withdrawals`, deleting `dev_wallets`, touching
> `money_divergence.py`, touching pricing/HVL, payout provider integration.

---

## 0. Current state (post-B4.2.1)

`dev_wallets.pending_withdrawal` is the **only D-class legacy money field**
still being mutated. Everything else (`available_balance`,
`earned_lifetime`, `withdrawn_lifetime`) is either ledger-derived or
intentionally drifted-by-design (mock orphan).

Audit baseline:
- B4.0 — DEV POOL boot wipe removed
- B4.0.1 — seeds canonicalised
- B4.1 — admin mark-paid legacy write removed (`pending → withdrawn`)
- B4.2 — `_credit_module_reward` legacy write removed
- B4.2.0a — composite idempotency index installed
- B4.2.1 — `module_qa_decision` canonical chain coverage

The `pending_withdrawal` field is the **last surface where legacy is the
sole source of truth.** It does not have a ledger source today — see
`money_projections.py:46` — and `dev_wallet_reader.py:107` explicitly
falls back to legacy for this field even when `MONEY_READS_FROM_PROJECTION=true`.

---

## 1. Writer inventory — 4 paths

Source: `grep -n pending_withdrawal /app/backend`. Every mutation is in
`server.py`. No other module mutates this field (verified).

### 1.1 Writer #1 — Developer withdrawal request (reserve)

| Property | Value |
|---|---|
| **Trigger** | `POST /api/developer/withdraw` |
| **File:lines** | `server.py:11618-11691` (`request_developer_withdrawal`) |
| **Legacy mutation** | `dev_wallets.$inc { available_balance: -A, pending_withdrawal: +A }` + insert `dev_withdrawals { status: "requested", amount: A }` |
| **Mutation pattern** | Atomic CAS (`available_balance: {$gte: A-0.001}`) — single conditional `update_one`. Concurrent over-withdraw gets 400, balance never goes negative. |
| **Idempotency today** | None — every successful call mints a new `withdrawal_id` and burns `available_balance` again. UI is responsible for not double-firing. |
| **Canonical replacement** | New ledger kind `withdrawal_reserved`. Movement: debit `ac_dev:<dev>` for amount, credit `ac_reserved:<dev>` for amount. `pending_withdrawal` becomes derived from `balance(ac_reserved:<dev>)`. |
| **Race condition** | Two simultaneous requests must NOT each see `available_balance >= A` and both proceed. **Today's CAS guarantees this.** The canonical write must preserve this: a single `MoneyService.reserve_withdrawal` call that fails-fast on `money_insufficient_balance` (policy denial) when `balance(ac_dev) - balance(ac_reserved) < A`. |
| **Rollback** | Today: lines 11683-11687 — if `dev_withdrawals.insert_one` raises, `$inc { available_balance: +A, pending_withdrawal: -A }` undoes the reservation. Canonical: emit a compensating `withdrawal_release` ledger event keyed to the same `withdrawal_id` with `cancelled_by="insert_failure"`. |
| **Acceptance test** | Existing balance $100. Request $40. Expected: projection `available=60, pending=40, earned=100, withdrawn=0`. Legacy `dev_wallets.pending_withdrawal` unchanged (drifted-by-design). |

### 1.2 Writer #2 — Developer cancel (release reservation)

| Property | Value |
|---|---|
| **Trigger** | `POST /api/developer/withdrawals/{wid}/cancel` |
| **File:lines** | `server.py:11702-11739` (`cancel_developer_withdrawal`) |
| **Legacy mutation** | `dev_wallets.$inc { pending_withdrawal: -A, available_balance: +A }` after `dev_withdrawals.status -> cancelled` (only allowed while `status == "requested"`). |
| **Mutation pattern** | Two-step: status-update first (no CAS — assumes the prior find_one is the source of truth), then $inc. **Potential bug today:** if two cancels race, the first cancel succeeds and $inc, the second sees status="cancelled" via `find_one` BEFORE the update_one, raises 409. But there's a window between `find_one` and `update_one` where both reads see "requested" — leading to double-release in legacy mirror. (Not B4.3 scope to fix, but worth noting.) |
| **Idempotency today** | Soft — relies on the find_one→update_one window being short. |
| **Canonical replacement** | New ledger kind `withdrawal_released`. Movement: debit `ac_reserved:<dev>` for amount, credit `ac_dev:<dev>` for amount. Idempotency key `legacy_withdrawal_release:<withdrawal_id>:cancelled` — so re-firing the cancel from any path collapses to one event. |
| **Race condition** | Same find→update window as today. Canonical fix: atomic CAS on `dev_withdrawals.status: {requested -> cancelled}` (same pattern as `admin_approve_withdrawal` at L11781) — only the winner emits the ledger release. **B4.3-D step 2** must include this CAS tightening as a side effect (legacy never had it, but canonical demands it). |
| **Rollback** | Cancel is the rollback. If the ledger release write fails, status is already `cancelled` and the reserve event stands → `pending` drifts upward by A. Surfaced by divergence engine as `withdrawal_release_missing` divergence. Operator manually re-fires release via admin endpoint (to be added in B4.3-B, optional). |
| **Acceptance test** | Reserve $40 (per Writer #1). Cancel. Expected: projection `available=100, pending=0, earned=100, withdrawn=0`. Repeat cancel → 409 (status check) AND no extra ledger event (composite idempotency). |

### 1.3 Writer #3 — Admin reject (release reservation)

| Property | Value |
|---|---|
| **Trigger** | `POST /api/admin/withdrawals/{wid}/reject` |
| **File:lines** | `server.py:11856-11889` (`admin_reject_withdrawal`) |
| **Legacy mutation** | `dev_wallets.$inc { pending_withdrawal: -A, available_balance: +A }` after CAS on `dev_withdrawals.status: {requested|approved -> rejected}`. |
| **Mutation pattern** | CAS-protected — uses `update_one(filter={status: {$in: [requested, approved]}}, ...)` with `modified_count` check. **This is the cleanest existing path.** |
| **Idempotency today** | Hard — concurrent rejects race the CAS; loser returns `{"ok": true, "already": cur["status"]}` without mutating wallet. |
| **Canonical replacement** | Same as Writer #2 — `withdrawal_released` ledger event. Idempotency key `legacy_withdrawal_release:<withdrawal_id>:rejected`. The reservation is released regardless of WHO triggered it; only the metadata (`actor`, `reason`) differs from cancel. |
| **Race condition** | Already handled by the CAS. The canonical write happens INSIDE the CAS winner's branch, so concurrent reject+mark-paid attempts can't both release. **Important:** a `requested → rejected` reject and a `requested → approved → paid` mark-paid both want to flip the row. The status CAS makes them mutually exclusive: whichever transition wins, the other gets `{"already": ...}` and emits no ledger event. |
| **Rollback** | Same as Writer #2 — if release ledger fails after status flip, divergence engine surfaces `withdrawal_release_missing`. Admin retry endpoint OPTIONAL. |
| **Acceptance test** | Reserve $40. Admin reject. Expected: projection `available=100, pending=0`. Status `rejected`. Repeat reject → 200 `{"already":"rejected"}` and NO extra ledger event. |
| **Why this is the easiest first removal** | Strongest CAS protection of all 4 writers + cheapest rollback (denial doesn't cost anything; the developer's money simply stays available). |

### 1.4 Writer #4 — Defensive refund on insert failure (rollback path)

| Property | Value |
|---|---|
| **Trigger** | `request_developer_withdrawal` → `db.dev_withdrawals.insert_one(...)` raises |
| **File:lines** | `server.py:11683-11688` (inside Writer #1 handler) |
| **Legacy mutation** | `dev_wallets.$inc { available_balance: +A, pending_withdrawal: -A }` — undoes the optimistic debit. |
| **Mutation pattern** | Unconditional `update_one` inside the `except` branch. No CAS — relies on the fact that the reservation $inc just succeeded so the inverse is safe. |
| **Idempotency today** | None — but the parent path raises after the rollback, so the caller sees a 5xx and won't retry the same `withdrawal_id` (it was never persisted). |
| **Canonical replacement** | If the new `withdrawal_reserved` ledger event went through but `dev_withdrawals.insert_one` failed, emit a compensating `withdrawal_released` with idempotency key `legacy_withdrawal_release:<reservation_id>:insert_failure`. **Subtle ordering requirement:** the canonical reserve must be written FIRST, then `dev_withdrawals.insert_one`, so a compensating release is always paired with a confirmed reserve. |
| **Race condition** | Single-handler, single-thread per request — no race. |
| **Rollback** | Self — this writer IS the rollback for Writer #1. If THIS write fails, both ledger sides may be partially consistent. Logged as a P0 ops alert (rare path; the `dev_withdrawals` insert is the only thing that can raise here and it has a unique index on `withdrawal_id`, so failure means the primary key collided — vanishingly rare). |
| **Acceptance test** | Inject `Exception` into `dev_withdrawals.insert_one`. Expected: ledger has 1 reserve + 1 release pair with same `withdrawal_id`, net zero on `ac_reserved`. Caller receives 5xx. Re-invoking the same idempotency_key (admin replay) is a no-op. |

---

## 2. Canonical model (preview — actual semantics in B4.3-B)

Pending withdrawal is NOT money earned. It is **reserved availability** —
a temporary lien on `ac_dev:<dev>` while the payout is in-flight.

Three ledger movements suffice (no new collection needed for B4.3):

| Event kind             | Debits             | Credits            | Lifecycle node                       |
|------------------------|--------------------|--------------------|--------------------------------------|
| `withdrawal_reserved`  | `ac_dev:<dev>`     | `ac_reserved:<dev>`| Writer #1 — developer requests       |
| `withdrawal_released`  | `ac_reserved:<dev>`| `ac_dev:<dev>`     | Writers #2, #3, #4 — cancel/reject/rollback |
| `withdrawal_paid`      | `ac_reserved:<dev>`| `ac_ext:<dev>`     | Existing `bridge_payout_processed` re-pathed to consume from reserved |

**Critical:** today's `bridge_payout_processed` debits `ac_dev:<dev>`
directly (via `MoneyService.process_payout` at `domains/money/service.py:542`).
B4.3-B must repath it to debit `ac_reserved:<dev>` instead, so the
`reserve → paid` chain balances. Without this change, B4.3 doesn't
actually move pending into the ledger — it would create a second
divergence.

**Why not a new collection (e.g. `withdrawal_reservations`)?**

- All state we need (`status`, `amount`, `created_at`) already lives in
  `dev_withdrawals`. Adding a parallel collection duplicates truth and
  invites the same drift we're removing.
- The ledger account `ac_reserved:<dev>` IS the projection of this state
  — its balance equals `pending_withdrawal` by construction.
- Decision: **piggyback on ledger kinds + `ac_reserved` axis**.
  Re-evaluable in B4.4 if a separate collection proves necessary for
  ops query patterns.

---

## 3. Projection formula (preview — actual implementation in B4.3-C)

`money_projections.build_dev_wallet_projection` will gain:

```python
reserved_acct = f"{PREFIX_RESERVED}:{developer_id}"  # "ac_reserved"
reserved = await _balance_cents(db, reserved_acct, currency=currency)

# Becomes the canonical source for pending_withdrawal.
"pending_withdrawal_cents": int(reserved),

# Available is unaffected by reserve (the reserve moved money OUT of
# ac_dev), but the formula stays the same:
"available_balance_cents": int(available),  # = balance(ac_dev)

# Lifetime earned stays = balance(ac_dev) + balance(ac_ext) + balance(ac_reserved)
# because money sitting in reserve was already earned (moved into ac_dev
# at qa_approval time and then sidelined into ac_reserved by request).
"earned_lifetime_cents": int(available + withdrawn + reserved),
```

**`dev_wallet_reader._projection_to_legacy_shape`** must drop the legacy
fallback at lines 107-109 once the projection covers pending. That's the
B4.3-C cutover.

---

## 4. B4.3-D removal sequencing — confirmed order

Per user's contract, four removals in this exact order:

| Step | Writer to neutralise | Why first/next | Rollback cost |
|---|---|---|---|
| **D-1** | Writer #3 (`admin_reject_withdrawal`) | Strongest CAS already in place. Denial doesn't cost money — money simply stays available. Smallest surface to verify canonical release works. | Trivial — revert one block in `server.py:11881-11888`. |
| **D-2** | Writer #1 (`request_developer_withdrawal`) the **reserve** half | The harder half. Touches the CAS at L11638-11650 (debit AND credit are atomic together). Canonical must preserve insufficient-balance failure semantics. | Medium — requires re-staging the CAS via `MoneyService.reserve_withdrawal` with policy denial. |
| **D-3** | Writer #4 (defensive refund) | Coupled to D-2 — once Writer #1 emits a ledger reserve, the rollback path must emit a ledger release. Removing D-2 without D-3 creates a money leak window. **D-2 + D-3 must ship as one PR.** | Trivial after D-2. |
| **D-4** | Writer #2 (`cancel_developer_withdrawal`) | Same shape as D-1 but the CAS at L11724 only checks `status` indirectly (via prior find_one). Tightening the CAS to `update_one(filter={status: "requested"})` is the side fix to bundle. | Trivial — same shape as D-1. |

After D-4, no `dev_wallets.pending_withdrawal` writer remains in the
backend. The field becomes drifted-by-design (same fate as
`earned_lifetime` post-B4.1). Divergence engine surfaces the drift as
`withdrawal_orphan` classifications until B4.4 demotes `dev_wallets` to
diagnostic-only.

---

## 5. Acceptance gates (the bar B4.3 must clear)

Quoted from the user's spec, expanded with verification mechanics.

| # | Acceptance | Verification |
|---|---|---|
| 1 | Request withdrawal reduces projected `available` and increases projected `pending`. | Smoke: `POST /api/developer/withdraw {amount:40}` then `GET /api/developer/wallet` (Stage-B read) — expect available -40, pending +40. |
| 2 | Reject/cancel restores projected `available` and clears projected `pending`. | Smoke: after #1, `POST /api/admin/withdrawals/{id}/reject` — expect available +40, pending −40 (net zero). |
| 3 | Mark-paid moves projected pending → withdrawn/external. | Smoke: after #1, approve then mark-paid — expect pending −40, withdrawn +40. |
| 4 | Repeated request/reject/paid is idempotent. | Composite idempotency `(event_type, idempotency_key)` already enforced post-B4.2.0a. Re-fire each endpoint — expect 200/`already=true`, ledger event count unchanged. |
| 5 | Legacy `dev_wallets.pending_withdrawal` no longer mutates. | Architecture test in `tests/architecture/` counting `$inc.*pending_withdrawal` occurrences in `server.py` post-D-4 — must be 0. |
| 6 | User-facing wallet remains correct from projection. | `GET /developer/wallet` with `MONEY_READS_FROM_PROJECTION=true` returns the projection's pending (derived from `ac_reserved`), not the legacy field. |
| 7 | `WARN dev_wallet_read.mismatch` count = 0 for real converged users. | The known `mock_orphan` (john's $3,750 legacy withdrawn) keeps its INFO classification. Any new WARN is a regression. |
| 8 | Architecture tests green. | `pytest tests/architecture/ tests/test_dev_wallet_*.py tests/test_money_*.py` — full suite must pass. |

---

## 6. What's intentionally NOT covered

Per user's contract (will NOT be touched in B4.3):

- ❌ `dev_withdrawals` collection — STAYS as the operational queue. Status row IS the lifecycle marker; the ledger merely mirrors its movements.
- ❌ `dev_wallets` collection — STAYS as diagnostic mirror (drifted-by-design). Demoted to diagnostic-only in B4.4, not here.
- ❌ `money_divergence.py` — STAYS untouched. It will see new classifications (`withdrawal_orphan`, `withdrawal_release_missing`); acceptable signal.
- ❌ `pricing_engine.py` / HVL — UNTOUCHED.
- ❌ Payout provider integration (Stripe/PayPal/crypto on-ramp) — out of scope. The bridge still mirrors a manual admin mark-paid.
- ❌ `_credit_module_reward`, `module_qa_decision` — already neutralised in B4.2/B4.2.1.
- ❌ Orphan canary in `mock_seed.py` — intentional fixture, leave alone.
- ❌ `dev_wallet_reader` Stage flag — stays at current default; B4.3 ships with `MONEY_READS_FROM_PROJECTION=true` already flipped from B3.1.

---

## 7. Risk register

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| Canonical reserve emits but `dev_withdrawals.insert_one` succeeds AFTER the reserve — partial chain on bridge failure | Low | Medium | Bridge already swallows exceptions and logs `MONEY BRIDGE: bridge_*_suppressed`. Add `bridge_withdrawal_reserved_suppressed` symmetry. Divergence engine flags `reserve_only`. |
| Existing legacy `dev_wallets.pending_withdrawal` values DRIFT — projection shows reserve=0 but legacy shows pending>0 (developer requested before B4.3-D) | Certain | Low | Same pattern as B4.1 `withdrawn_lifetime` drift. Replay `dev_withdrawals` with `status=requested` once after D-4 ships to emit historical reserve events (similar to existing `money_replay.replay_dev_withdrawals` for paid status). |
| Concurrent reject+mark-paid race emits two ledger events | Low | High | The `dev_withdrawals.status` CAS in BOTH handlers ensures only one winner. Canonical ledger write is INSIDE the CAS winner block (post-condition). Two writes can't both succeed. |
| `ac_reserved:<dev>` balance goes negative if release outpaces reserve (e.g. replay ordering bug) | Low | High | Add invariant test: `balance(ac_reserved) >= 0` for every dev at all times. Negative balance = P0 alert. |
| `MONEY_READS_FROM_PROJECTION=true` not flipped on staging | Medium | Medium | B3.1 already flipped it on production. Verify staging matches before D-2 ships. |

---

## 8. Estimated PR shape (NOT decision — preview for sequencing)

| Step | PR # | Files touched | LoC | Acceptance #s |
|---|---|---|---|---|
| B4.3-B | 1 | `money_ledger.py`, `domains/money/service.py`, `money_bridge.py` (new `bridge_withdrawal_reserved` + `bridge_withdrawal_released`), constants | ~150 | covered by tests in steps below |
| B4.3-C | 2 | `money_projections.py` (add `ac_reserved` branch), `dev_wallet_reader.py` (drop legacy pending fallback), `tests/test_dev_wallet_projection.py` | ~80 | #6 |
| B4.3-D step 1 | 3 | `server.py:admin_reject_withdrawal` only | ~10 | #2 (reject half) |
| B4.3-D steps 2+3 | 4 | `server.py:request_developer_withdrawal` + defensive refund branch | ~30 | #1, #4 (request half) |
| B4.3-D step 4 | 5 | `server.py:cancel_developer_withdrawal` (with CAS tightening) | ~15 | #2 (cancel half) |
| Replay | 6 | `money_replay.py` — add `replay_dev_withdrawals_pending` for historical `status="requested"` rows | ~30 | divergence engine convergence |
| Architecture tests | 7 | `tests/architecture/test_writer_invariants.py` — assert zero `$inc.*pending_withdrawal` in server.py | ~20 | #5 |

Total ~330 LoC + tests.

---

## 9. Open questions for user (defer to B4.3-B kickoff)

These do NOT block B4.3-A approval; flag them for the kickoff conversation:

1. **`ac_reserved` prefix string** — `ac_reserved` or `ac_hold` or `ac_pending`? `ac_reserved` chosen here for clarity; locked in B4.3-B if user concurs.
2. **Bridge auto-rebooking** — should an admin force-replay endpoint exist for stuck reservations? Or is operator manual ledger insert sufficient? (Recommend: defer until divergence engine surfaces a real stuck case.)
3. **Migration of in-flight `requested` rows on D-2 ship** — replay them as canonical reserves at boot, OR let `pending_withdrawal` drift for one cycle until they're cancelled/paid? (Recommend: replay at boot via `money_replay.replay_dev_withdrawals_pending`, same pattern as existing paid replay.)
4. **Negative-balance defensive guard** — return 500 from `MoneyService.release_withdrawal` if `balance(ac_reserved) < release_amount`, OR allow the negative balance and surface as divergence? (Recommend: hard guard at policy layer.)

---

## 10. Sign-off

This lifecycle map is the **architectural contract for B4.3**. Any
deviation requires a documented amendment, not a silent code change.

- 4 legacy writers identified, no more, no less.
- Canonical replacement defined: 3 ledger kinds + 1 new account axis.
- Projection formula defined.
- Removal order defined and justified.
- Acceptance gates defined and verifiable.
- Out-of-scope explicitly enumerated.

**Next step:** B4.3-B — canonical reservation model implementation.
Ship only after this map is signed off.

---
Author: E1 main agent
Date: 2026-05-20
Phase: 2C-B4.3-A (lifecycle map, no code)
Audit baseline: post-B4.2.1 (`/app/memory/PRD.md` v6, all writers neutralised except pending)
