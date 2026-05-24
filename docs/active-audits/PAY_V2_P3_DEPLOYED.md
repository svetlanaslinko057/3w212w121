# PRD — PAYOUTS_V2 P3 (Autonomous Payout Worker) — DEPLOYED 2026-05-24

## Position in plan

Per user-locked sequencing: **P3 (execution engine) → P5 (operational UI) → P2 (live rails) → P4 (reconciliation)**.

Foundation `(P1) ✅` + execution engine `(P3) ✅` → **Autonomous Payout Engine** unlocked.

## What was shipped

### 1. Worker module — `/app/backend/payouts_v2_worker.py`

Lease-based, claim-semantics, race-proof drain loop. No `while True: find_one()`.

| Concern | Implementation |
|---|---|
| **Claim semantics** | `find_one_and_update` (Mongo-atomic). FIFO by `created_at`. |
| **Lease ownership** | `claimed_by` / `claimed_at` / `lease_until` / `last_heartbeat` on item. |
| **Heartbeat** | Mid-process call extends lease (`_heartbeat_item`). |
| **Stale recovery** | `reaper_loop` reclaims items with expired leases every 30s. Emits `lease_expired` event. |
| **Retry semantics** | Transient failures → `next_attempt_at = now + backoff`. Item stays in `queued`, lease released. |
| **Backoff** | Exponential with full jitter: `base * 2^(attempt-1)`, capped at `backoff_max_sec`, jittered in `[base, capped]`. |
| **Dead-letter** | After `max_attempts` (default 5) → terminal `failed` + `dead_lettered=True` + `exhausted` event. |
| **Per-item isolation (Pr-6)** | Every step wrapped; one bad item never breaks loop. |
| **Provider timeout** | `asyncio.wait_for(timeout=PAY_V2_WORKER_TIMEOUT_SEC)`. Timeout = transient. |
| **Idempotent provider exec** | Item's `idempotency_key` re-passed on every attempt (provider dedupes server-side). |
| **Error classification** | `TRANSIENT_ERROR_CODES` (rate_limited / provider_unavailable / timeout / network_error) vs `TERMINAL_ERROR_CODES` (invalid_destination / kyc_required / blocked / insufficient_funds). Terminal codes dead-letter immediately. |
| **Stuck detection** | Items in `initiated`/`in_flight` past `PAY_V2_WORKER_STUCK_AFTER_SEC` surface via worker_status (admin only — no auto-advance for live rails). |
| **Mock advancer** | Separate loop walks `mock`-rail items `initiated → in_flight → confirmed → settled` after `PAY_V2_MOCK_ADVANCE_DELAY_SEC`. Live rails wait for real webhooks (PAY-V2-P2 territory). |
| **Audit trail (Pr-1)** | Every action emits event in `payout_v2_events`: `worker_claimed`, `provider_called`, `retry_scheduled`, `worker_released`, `lease_expired`, `exhausted`, `admin_force_retry`, `admin_force_dead_letter`, plus standard state transitions. |

### 2. Background loops wired in `server.py` startup

```python
asyncio.create_task(_pv2_api.scheduler_loop(db))      # P1 — proposes
asyncio.create_task(_pv2_worker.worker_loop(db))       # P3 — drains
asyncio.create_task(_pv2_worker.reaper_loop(db))       # P3 — stale leases
asyncio.create_task(_pv2_worker.mock_advancer_loop(db)) # P3 — mock webhooks
```

Each loop independent; failure in one does NOT kill the others.

### 3. Admin endpoints (queue-first Pr-7)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/payouts-v2/admin/worker/status` | Operational health snapshot: config, queue_health (ready / pending_retry / in_flight_owned / stale / stuck / exhausted), counts_by_status, amount_by_status, top failing items, registered providers per rail. |
| `POST` | `/api/payouts-v2/admin/worker/drain-once` | One-shot drain + advance + reap (testing/curl smoke). |
| `POST` | `/api/payouts-v2/admin/items/{item_id}/force-retry` | Reset `next_attempt_at=now` so worker picks up immediately. Keeps `attempt_count` (no infinite loops on poison items). |
| `POST` | `/api/payouts-v2/admin/items/{item_id}/dead-letter` | Force terminal `failed` + emit `admin_force_dead_letter` + `exhausted`. |

### 4. Config (13 env-driven knobs, no hardcoded literals)

```
PAY_V2_WORKER_ENABLED            1
PAY_V2_WORKER_INTERVAL_SEC       5
PAY_V2_WORKER_BATCH_SIZE         10
PAY_V2_WORKER_LEASE_SEC          60
PAY_V2_WORKER_HEARTBEAT_SEC      20
PAY_V2_WORKER_MAX_ATTEMPTS       5
PAY_V2_WORKER_TIMEOUT_SEC        30
PAY_V2_WORKER_BACKOFF_BASE_SEC   10
PAY_V2_WORKER_BACKOFF_MAX_SEC    600
PAY_V2_WORKER_STUCK_AFTER_SEC    900
PAY_V2_MOCK_ADVANCE_ENABLED      1
PAY_V2_MOCK_ADVANCE_DELAY_SEC    2
PAY_V2_REAPER_INTERVAL_SEC       30
```

### 5. Indexes (additive, no migration)

Added to `payouts_v2.ensure_indexes`:
- `[(status, 1), (next_attempt_at, 1)]` — claim filter
- `[(claimed_by, 1), (lease_until, 1)]` — reaper filter

### 6. Tests (both PASS)

- `/app/backend/tests/test_payouts_v2_worker_e2e.py` — 6 approved earnings → propose → release → 3 drain cycles → all 6 items reach `settled`. Validates full event chain: `queued → worker_claimed → provider_called → initiated → in_flight → confirmed → settled`. Plus admin_force_retry + admin_force_dead_letter coverage.
- `/app/backend/tests/test_payouts_v2_worker_failure.py` — `AlwaysFailProvider` injected → 3 attempts → 2 retry_scheduled (with backoff_sec, next_attempt_at, attempt #) → exhausted (terminal failed, dead_lettered=True, attempt_count==max_attempts).

### 7. Master guard updated

`backend/scripts/audit/pay_v2_master.py` P3 section now validates (real checks, not placeholder):
- worker module present + 11 required functions/symbols
- 13 env-driven config knobs on CFG
- server.py wires worker / reaper / mock_advancer
- 4 admin endpoints mounted

→ all green: `python3 backend/scripts/audit/pay_v2_master.py` exits 0.

## What's now possible (architectural unlock)

Substrate (P1) + execution engine (P3) =

```
developer earns money
→ funds become payable (existing money_substrate)
→ payout batch proposed (P1 scheduler)
→ admin releases  (P1 hybrid cadence — Pr-8)
→ items queued
→ worker drains queue (P3 — claim · lease · retry · backoff · isolation)
→ provider executes payout (currently MOCK; live rails come in P2)
→ retries happen automatically (P3 exponential backoff)
→ failures isolated (P3 per-item; one bad item ≠ batch failure)
→ items settled (or dead-lettered after max_attempts)
→ admin only supervises exceptions (P5 UI will surface this)
```

The phrase "admin руками платит" no longer applies. System operates payouts; admin supervises exceptions.

## Why P3 before P2

If P2 (live Stripe/PayPal) shipped before P3, every provider failure (real ones happen daily — rate limits, KYC blocks, network blips) would have to be debugged simultaneously with building execution semantics. Now retry/backoff/isolation/exhaustion are exercised against a deterministic mock — when P2 plugs in, the only new variable is the provider adapter.

## Why P5 next, not P2

UI must reflect REAL queue states (claimed, retry_scheduled, exhausted, stuck). Building UI against fake transitions = guaranteed rewrite. Now that worker emits real events, P5 can render them.

## Status

`python3 /app/backend/scripts/audit/pay_v2_master.py` → ✅
`python3 /app/backend/tests/test_payouts_v2_worker_e2e.py` → ✅
`python3 /app/backend/tests/test_payouts_v2_worker_failure.py` → ✅

## Next: PAY-V2-P5 (operational UI)

Per locked sequencing — admin operational queue + per-item drill-down (web + Expo), developer payment-profile self-service screen. Backend authority for all aggregations (no client-side derivation — sealed by WEB-P4 contract).
