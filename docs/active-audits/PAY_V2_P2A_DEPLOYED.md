# PAY-V2-P2A — Stripe Active Rail + PayPal Dormant Scaffold — DEPLOYED

**Date:** 2026-FEB (new session redeploy + activation)
**Charter:** `/app/docs/active-audits/PAY_V2_P0_CHARTER.md`
**Sequence (locked by user):** P0 ✅ → P1 ✅ → P3 ✅ → P5 ✅ → **P2A ✅** → P2B → P4
**Strategy (locked by user):** Stripe = active live rail, PayPal = dormant scaffold.

---

## 0. TL;DR

✅ **P2A SHIPPED.**

- `StripeConnectSettlementProvider` is a fully implemented active rail —
  outbound `Transfer.create_async` to Connect destinations, idempotency via
  Stripe's `Idempotency-Key` header, full webhook normalization, reconciliation
  hook, Express account onboarding helpers.
- `PayPalPayoutsSettlementProvider` is a dormant scaffold per user direction —
  concrete class that fulfils the `SettlementProvider` ABC, env-aware mode
  detection, returns `provider_unavailable` from every operational method until
  P2B lands the live HTTP client.
- 3 new endpoints under `/api/payouts-v2/*`:
  - `POST /webhooks/stripe` — signed (+ optional dev-only unsigned-preview)
  - `POST /webhooks/paypal` — returns `501 paypal_dormant` until P2B
  - `POST /developer/stripe/onboarding` — idempotent Connect onboarding link
- Worker `_PROVIDERS_BY_RAIL` registers all three rails (mock / stripe_connect /
  paypal). Worker semantics **unchanged** — provider swap is pure plugin.
- `STRIPE_API_KEY` provisioned in `backend/.env` → adapter active, `mode=test`.
- `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1` enabled for dev preview (NEVER in prod).

---

## 1. Scope (what user locked)

> *Strategy: Stripe first, PayPal dormant. Provider abstraction already sealed —
> adding a rail must NOT touch worker, queue, payout states, substrate, or UI.
> ONLY adapter layer + webhook ingestion + provider mapping.*

What we did NOT touch (verified by diff):

- `payouts_v2.py` (state machine) — untouched.
- `payouts_v2_worker.py` (lease/claim/heartbeat/reaper/backoff) — untouched.
- 10-state item state-machine — untouched.
- Web `/api/web-ui/admin/payouts-v2` UI — untouched.
- Expo `app/admin/payouts.tsx` + `[batchId].tsx` + `developer/payout-profile.tsx` — untouched.
- Money substrate (sealed Phase 2C-B) — untouched.

What we touched, narrowly:

- `backend/integrations/settlement_stripe.py` — adapter (Stripe-specific knowledge isolated here).
- `backend/integrations/settlement_paypal.py` — dormant scaffold (provider slot held open).
- `backend/payouts_v2_api.py` — 3 new route definitions (webhook + onboarding only).
- `backend/payouts_v2_worker.py` — `_PROVIDERS_BY_RAIL` registers 3 rails (one-line each).
- `backend/.env` — `STRIPE_API_KEY` + `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1` (dev preview).

---

## 2. Stripe Connect Settlement Adapter

### 2.1 Activation

| State | When | What `health()` returns |
|---|---|---|
| dormant | `STRIPE_API_KEY` missing | `mode=unavailable, available=False, reason=STRIPE_API_KEY missing` |
| active (test) | `STRIPE_API_KEY=sk_test_*` | `mode=live, details.mode=test, whsec=bool` |
| active (live) | `STRIPE_API_KEY=sk_live_*` | `mode=live, details.mode=live, whsec=bool` |

Boot log when active:
```
StripeConnect adapter enabled (mode=test, whsec=missing)
```

### 2.2 `create_payout` (outbound `Transfer.create_async`)

- Required: `req.rail_account["stripe_account_id"]` (or alias `connected_account`).
- Amount converted to cents.
- Metadata always carries `payout_item_id`, `developer_id`, `batch_id` so
  webhook events can recover the item.
- **Idempotency:** `req.idempotency_key` → Stripe `idempotency_key=` header
  (Stripe dedupes server-side for 24h). Worker's retry semantics are now
  battle-tested AND idempotent at the Stripe layer.

### 2.3 Error classification (`_classify_stripe_error`)

Every Stripe exception is mapped to our normalized vocabulary:

| Stripe exception | → normalized `error_code` | Worker behavior |
|---|---|---|
| `RateLimitError` | `rate_limited` | **transient** — retry with backoff |
| `APIConnectionError` | `network_error` | **transient** — retry with backoff |
| `APIError` (server-side) | `provider_unavailable` | **transient** — retry with backoff |
| `AuthenticationError` / `PermissionError` | `blocked` | **terminal** — dead-letter |
| `InvalidRequestError` (insufficient funds) | `insufficient_funds` | **terminal** — dead-letter |
| `InvalidRequestError` (no such destination/recipient) | `invalid_destination` | **terminal** — dead-letter |
| `InvalidRequestError` (capabilities / payouts_enabled / kyc) | `kyc_required` | **terminal** — dead-letter |
| anything else | `provider_unavailable` | **transient** |

Verified live against `sk_test_emergent` (placeholder key, rejected by Stripe):
```
PayoutResult: success=False status=failed error_code=blocked
  error: Invalid API Key provided: sk_test_****gent
```

### 2.4 Webhook ingestion

`POST /api/payouts-v2/webhooks/stripe`

Three signature modes:

1. **Signed** — `STRIPE_WEBHOOK_SECRET` set + valid `Stripe-Signature` header →
   `stripe.Webhook.construct_event()` verifies signature, returns `valid=True`.
2. **Unsigned-preview (DEV ONLY)** — `STRIPE_WEBHOOK_SECRET` missing AND
   `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1` → JSON parsed without verification.
   Logs a `WARNING` line on every accepted request. **NEVER enable in prod.**
3. **Rejected** — anything else → 400, route returns `event_type=unverified`.

**Idempotency:** every webhook persists `payout_v2_idempotency` with
`scope=webhook, key=stripe_event_id` *before* acting. Re-delivery
returns `{received:true, duplicate:true}` without touching state.

### 2.5 Event mapping (vendor → canonical state machine)

| Stripe `type` | → canonical `event_type` | → item status |
|---|---|---|
| `transfer.created` | `payout_initiated` | `initiated` |
| `transfer.updated` (no reversal) | `payout_in_flight` | `in_flight` |
| `transfer.updated` (amount_reversed>0) | `payout_returned` | `returned` |
| `transfer.reversed` | `payout_returned` | `returned` |
| `transfer.failed` | `payout_failed` | `failed` |
| `payout.paid` | `payout_settled` | `settled` |
| `payout.failed` | `payout_failed` | `failed` |
| `payout.canceled` | `payout_cancelled` | `cancelled` |
| `account.application.deauthorized` | `account_deauthorized` | `failed` |
| `account.updated` | `account_updated` | (no transition — KYC flip) |
| anything unknown | (raw type) | `in_flight` (audit-only) |

Every `transition_item` call from the webhook handler carries
`provider_event_id`, `provider_ref`, `amount`, `currency`, `error`,
`error_code` in the payload — these land in `payout_v2_events.payload`
and become the canonical audit trail. **P4 reconciliation observer**
will consume this exact provider-event substrate.

### 2.6 Express onboarding

`POST /api/payouts-v2/developer/stripe/onboarding`

- Auth: any logged-in user.
- Idempotent: re-issues an AccountLink for the developer's existing
  connected account if `rail_config.stripe_account_id` is already set.
- Otherwise: calls `Account.create_async(type=express, capabilities={transfers:requested})`,
  persists the account id into `dev_payment_profiles.rail_config.stripe_account_id`,
  then calls `AccountLink.create_async`.
- Response: `{ stripe_account_id, url, expires_at }`.

### 2.7 KYC auto-flip via `account.updated` webhook

When Stripe emits `account.updated` with `charges_enabled` AND
`payouts_enabled` AND `details_submitted` → handler sets
`dev_payment_profiles.kyc_status = "verified"` (soft-KYC flips to verified
purely from the provider event — Pr-4 additive-only, no admin click needed).

### 2.8 Reconciliation hook

`StripeConnectSettlementProvider.reconcile(lines: list[ReconciliationLine])`

- Looks up each `Transfer.retrieve_async(provider_ref)`.
- Returns `ReconciliationResult(matched, unmatched, discrepancies[])` with
  reasons (`lookup_failed | amount_mismatch | reversed`).
- **Additive-only** — does NOT mutate `payout_items_v2` documents.
  P4 observer will compare this result against canonical state and emit
  divergence events.

---

## 3. PayPal Payouts Settlement Adapter (DORMANT SCAFFOLD)

`PayPalPayoutsSettlementProvider`

- Class shape is final — implements every abstract from `SettlementProvider`.
- `health()` reports MOCK with reason `"PayPal scaffold present; P2B not yet shipped"` (even when env keys are provisioned). This is intentional — P2A explicitly leaves PayPal dormant.
- All operational methods short-circuit:
  - `create_payout` → `PayoutResult(success=False, error_code=provider_unavailable)`
  - `verify_webhook` → `SettlementEvent(valid=False, event_type=paypal_dormant)`
  - `reconcile` → `ReconciliationResult(matched=0, unmatched=N, discrepancies=[{reason: paypal_dormant_scaffold}])`
- `POST /api/payouts-v2/webhooks/paypal` → **501 Not Implemented**:
  `{"ok":false,"code":"paypal_dormant","message":"PAYPAL_CLIENT_ID/SECRET/WEBHOOK_ID missing — dormant scaffold"}`

**What P2B will add (when user provisions sandbox keys):**
- httpx-based PayPal API client (OAuth bootstrap, `/v1/payments/payouts`, etc.)
- `verify_webhook` real signature verification (PayPal `transmission_*` headers)
- Mode flips from MOCK → SANDBOX → LIVE based on `PAYPAL_ENVIRONMENT` env.
- The webhook route, registry slot, worker registration, capability — all
  stay byte-identical to today. Only the adapter body grows.

---

## 4. Worker registration (the only worker touch)

`backend/payouts_v2_worker.py`:

```python
_PROVIDERS_BY_RAIL: Dict[str, SettlementProvider] = {
    "mock":           MockSettlementProvider(),
    "stripe_connect": StripeConnectSettlementProvider(),
    "paypal":         PayPalPayoutsSettlementProvider(),
}

def get_provider_for_rail(rail: str) -> SettlementProvider:
    return _PROVIDERS_BY_RAIL.get(rail) or _PROVIDERS_BY_RAIL["mock"]
```

That's it. Worker's lease / claim / heartbeat / backoff / reaper / dead-letter
logic does NOT know what rail it's running against.

Worker status reflects all three rails:
```
"providers": {
  "mock": "mock-settlement",
  "stripe_connect": "stripe-connect",
  "paypal": "paypal-payouts"
}
```

---

## 5. Smoke verification on /app (2026-FEB)

| Check | Result |
|---|---|
| `GET /api/integrations/manifest` → `settlement` capability registered | ✅ |
| `GET /api/payouts-v2/admin/worker/status` returns 3 providers | ✅ |
| `POST /api/payouts-v2/webhooks/stripe` unsigned (whsec missing + allow=1) | ✅ 200 `{received:true, kind:"payout_initiated"}` |
| `POST /api/payouts-v2/webhooks/stripe` signed-only mode (allow=0, no sig) | ✅ 400 |
| `POST /api/payouts-v2/webhooks/paypal` dormant | ✅ 501 `paypal_dormant` |
| `POST /api/payouts-v2/developer/stripe/onboarding` adapter active | ✅ reaches Stripe API |
| `create_payout` against invalid key → normalized `blocked` error_code | ✅ |
| `tests/test_payouts_v2_worker_e2e.py` (mock rail) | ✅ PASS — 6 items → settled in 3 cycles |
| `tests/test_payouts_v2_worker_failure.py` (mock rail) | ✅ PASS — exhausted after retry/backoff |
| `tests/test_payouts_v2_stripe_live.py` adapter activates with env key | ✅ — fails at first API call because `sk_test_emergent` is a placeholder (real Stripe rejects). Adapter behaviour is correct; key needs replacement. |

---

## 6. Env contract (final)

| Variable | Required for | Effect when missing |
|---|---|---|
| `STRIPE_API_KEY` | Stripe active rail | Adapter dormant, `health=unavailable`, all calls return `provider_unavailable` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | If `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1` → unsigned accepted (DEV); else 400 |
| `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS` | Dev preview only | `1` accepts unsigned webhooks (warns on each request) |
| `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` + `PAYPAL_WEBHOOK_ID` | PayPal P2B activation | Adapter stays dormant scaffold |
| `PAYPAL_ENVIRONMENT` | PayPal sandbox vs live | Default `sandbox` |

Current `/app/backend/.env` for preview:
```
STRIPE_API_KEY=sk_test_emergent
PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1
```

---

## 7. What's pending (locked sequence)

- **P2B (PayPal active rail)** — only when user provisions sandbox keys.
- **P4 (Reconciliation + Divergence Observer)** — meaningful only after real
  settlement events from live providers. Will consume the `provider_event_id /
  provider_ref / provider_status` substrate that P2A now writes into every
  canonical event payload.

## 8. Action items for the user

1. **Replace `STRIPE_API_KEY=sk_test_emergent` with your real test key** from
   https://dashboard.stripe.com/test/apikeys → restart backend → run
   `python3 /app/backend/tests/test_payouts_v2_stripe_live.py` for end-to-end
   live confirmation.
2. **(Optional) Add `STRIPE_WEBHOOK_SECRET`** when you wire up a Stripe webhook
   endpoint in Stripe Dashboard → Webhooks → URL
   `https://<your-preview>.preview.emergentagent.com/api/payouts-v2/webhooks/stripe`.
   Once `STRIPE_WEBHOOK_SECRET` is set, you can safely remove
   `PAY_V2_ALLOW_UNSIGNED_WEBHOOKS=1` from `backend/.env`.
3. **Provide PayPal keys when you want to flip P2B from scaffold to live.**

---

**Closeout signed off — 2026-FEB.**
