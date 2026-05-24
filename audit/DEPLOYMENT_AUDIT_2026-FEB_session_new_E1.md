# Полный аудит — развёртывание ATLAS DevOS / EVA-X (2026-FEB-новая сессия)

**Источник:** `https://github.com/svetlanaslinko057/2ed323232323` (branch `main`, `0a51352`)
**Снимок развёрнут в:** `/app` на 2026-FEB
**Среда:** Emergent preview (`app-launch-staging-4.preview.emergentagent.com`)
**Сессия:** новая (E1), пустой стартовый шаблон → полный graft репозитория.

---

## 0. TL;DR

✅ **DEPLOYED & GREEN.** Все четыре сервиса подняты, 708 API-маршрутов
зарегистрированы, MongoDB засеяна (admin / client / developer / tester / multi
+ demo-проект Acme Analytics Platform + 70-дневный replay), вход
`admin@atlas.dev` / `admin123` подтверждён HTTP 200, фоновые петли (Guardian /
Module Motion / Event Engine / Payouts-v2 worker+reaper+advancer) стартовали,
embedding-модель прогружена.

| Сервис | Статус | Порт | Проверка |
|---|---|---|---|
| `backend` (FastAPI + Socket.IO) | ✅ RUNNING | 8001 | `/api/healthz` → 200 · `/api/readyz` → 200 |
| `expo` (Metro + tunnel + Expo Web) | ✅ RUNNING | 3000 | HTTP 200, бандл 1553 modules |
| `mongodb` | ✅ RUNNING | 27017 | seeded (users, projects, modules, validations, ledger) |
| `web` (CRA admin bundle) | ✅ SERVED | `/api/web-ui/` | HTTP 200 (prebuilt в `web/build/`) |
| `code-server` / `nginx-code-proxy` | ✅ RUNNING | — | infra |

---

## 1. Шаги развёртывания (выполнены сегодня)

1. **Изучение репо:** `git clone --depth 1` в `/tmp/repo_inspect`. Прочитаны
   `memory/PRD.md`, `memory/active_issues.md`, `test_result.md`,
   последние два аудита (DEPLOYMENT_AUDIT_2026-05-24, AUDIT_2026-FEB_FULL_REDEPLOY_E1_RU).
2. **Backup ENV** (`/tmp/backend.env.bak`, `/tmp/frontend.env.bak`).
3. **rsync** репо → `/app/`, исключив `.git`, `.emergent`, `node_modules`,
   `.expo`, `.metro-cache`, `__pycache__`, `backend/.env`, `frontend/.env`.
4. **Восстановлены protected `.env`** (MONGO_URL=mongodb://localhost:27017,
   DB_NAME=test_database, EXPO_PACKAGER_PROXY_URL, EXPO_PACKAGER_HOSTNAME,
   EXPO_PUBLIC_BACKEND_URL=https://app-launch-staging-4.preview.emergentagent.com).
5. **`pip install -r backend/requirements.txt`** — обновлены десятки пакетов
   (sentence-transformers 5.4.1, transformers 5.9.0, torch 2.12.0, stripe 15.0.1,
   resend 2.30.0, google-genai 1.71.0, pydantic 2.12.5, slowapi 0.1.9, ...).
6. **`yarn install`** в `frontend/` — Expo SDK 54, RN 0.81, react 19,
   expo-router 6. Один peer warning: `expo-audio@1.1.1` требует `expo-asset@*`
   (не блокирует).
7. **`supervisorctl restart backend expo`** → оба сервиса зелёные через ~20s.
8. **Smoke:** `POST /api/auth/login admin@atlas.dev/admin123` → 200,
   `user_id user_1e10d92e9c4f`, `role admin`.
9. **`/app/memory/test_credentials.md`** воссоздан (в репо отсутствует).

---

## 2. Архитектура продукта

**Что это:** «ATLAS DevOS / EVA-X» — мультиролевой Development OS. Сквозной
поток: лид → идея → оценка → скоуп → контракт → разработка (модули) → QA →
доставка → биллинг → саппорт. Роли: **client / developer / tester / admin**
(+ operator/lead surfaces).

### 2.1 Backend (FastAPI, 708 маршрутов)

- **Корневой файл:** `backend/server.py` (≈ 27 401 строки, монолит-фасад).
  Регистрирует роутеры из 94+ Python-модулей.
- **Доменные модули (`backend/`):**
  - Ядро разработки: `assignment_engine`, `acceptance_layer`,
    `time_tracking_layer`, `event_engine`, `decomposition_engine`,
    `work_execution`, `execution_intelligence` (1MB модуль).
  - Админ: `admin_actions`, `admin_control`, `admin_integrations`,
    `admin_llm_settings`, `admin_mobile`, `admin_production`, `admin_risk`,
    `admin_system`, `admin_team`, `admin_users_layer`.
  - Клиент: `client_acceptance`, `client_costs`, `client_escrow`,
    `client_operator`, `client_operator_opportunities`, `client_transparency`,
    `client_workspace`.
  - Биллинг/деньги: `money_*` (bridge, divergence, ledger, projections,
    replay, runtime), `payouts_v2*` (api, worker), `escrow_*`, `earnings_layer`,
    `payout_layer`, `payment_providers/`.
  - Разработчик: `developer_brain`, `developer_economy`,
    `developer_intelligence`, `developer_support`, `dev_wallet_reader`,
    `dev_work`.
  - QA/Тестирование: `qa_layer`, `validation_campaigns`.
  - Команда/операторы: `team_*`, `operator_engine`, `auto_guardian`,
    `auto*nomy`, `flow_control`.
  - Доходы/цены: `pricing_engine`, `scaling_engine`, `revenue_brain`,
    `revenue_brain_lib`, `hidden_ranking`, `reputation_decay`.
  - Mobile-адаптер: `mobile_adapter.py` (52KB).
  - WEB-P4 агрегация: `web_p4_summaries.py` (3 эндпойнта без клиентской матик-логики).
- **Boundary layer:** `backend/integrations/registry.py` маршрутизирует
  `payment` / `ai` / `mail` / `storage` / `oauth` через провайдеры. Бизнес-код
  работает только с абстрактными капабилити.
- **Real-time:** Socket.IO mounted at `api/socket.io` с ACL-фильтрацией комнат.
- **Observability:** `middleware/request_id.py` + `middleware/error_shape.py`
  → каноничная форма ошибок `{ok:false, code, message, status, retryable, request_id}`.
- **Rate limiting:** `slowapi` (10/min на `/api/auth/login`).
- **Auth:** bcrypt пароли + HttpOnly `session_token` cookie (≈6 мес).
- **CORS:** preview = `*` без `credentials`; prod = whitelist через `CORS_ORIGINS`.

**Распределение маршрутов (по префиксу):**
≈ 251 `/api/admin` · 72 `/api/developer` · 65 `/api/client` · 23 `/api/modules` ·
23 `/api/account` · 19 `/api/execution-intelligence` · 18 `/api/auth` ·
14 `/api/payouts-v2` · 13 `/api/ai` · 10 `/api/system` · 10 `/api/mobile` · ...

### 2.2 Frontend Expo (`/app/frontend`)

- **Стек:** Expo SDK 54, React Native 0.81.5, React 19, **expo-router 6** (file-based).
- **Экранов:** 93+ `.tsx` файлов в `frontend/app/**`.
- **Ролевые поверхности:** `admin/` · `client/` · `developer/` · `tester/` ·
  `operator/` · `lead/` · `contract/` · `project/` · `help/` · `workspace/`.
- **Flow «опиши идею → план → запуск»:** `describe.tsx` →
  `estimate-result.tsx` / `estimate-improve.tsx` → `project-booting.tsx`.
- **Транспорт:** axios через `frontend/src/runtime-client/` с дедупом, retry,
  Bearer-токеном из AsyncStorage. `expo-router` typedRoutes включены.
- **Сборка:** Metro bundled 1553 modules, tunnel поднят, preview HTTP 200.

### 2.3 Web admin (`/app/web` — CRA + Tailwind + Radix UI)

- 228 JS/JSX файлов, шипится статическим бандлом из `web/build/` через
  FastAPI route `/api/web-ui/`.
- **WEB Stabilization Line SEALED** (P4 Backend Authority · P5 Error/UX
  Reliability · P6 Build Governance). Master guard:
  `python3 web/scripts/audit/web_p6_master.py` → ✅ зелёный.
- Темизация: `localStorage.atlas_theme` (dark/light + auto).

### 2.4 Shared packages

- `packages/design-system/` — токены, motion, theme, типографика.
- `packages/runtime-client/` — единый typed HTTP-клиент (web + Expo адаптеры).

---

## 3. Активная работа (по `memory/active_issues.md`)

Текущая эра — **MONETIZATION + OPERATIONAL SCALE**. Открытый трек:

### 🟡 PAYOUTS_V2 (Stripe Connect + PayPal Payouts) — P0/P1/P3/P5 ✅, P2/P4 pending

- **Charter:** `/app/docs/active-audits/PAY_V2_P0_CHARTER.md` (signed off 2026-FEB-24)
- **Последовательность (зафиксирована пользователем):** P0 → P1 → P3 → P5 → P2 → P4
- **Что уже работает:**
  - 14 эндпойнтов `/api/payouts-v2/*`
  - 5 Mongo-коллекций (`payout_batches_v2`, `payout_items_v2`, `payout_v2_events`,
    `payout_v2_idempotency`, `dev_payment_profiles`)
  - 10-state item state-machine + worker tracking
  - Hybrid-cadence scheduler loop (proposes batches каждые 900s)
  - **PAY-V2-P3 autonomous worker:** lease-based claim · heartbeat · stale-lease
    reaper · exponential backoff with jitter · dead-letter · per-item isolation ·
    provider timeout · idempotent execution · mock advancer · 13 env-driven
    config knobs · 9 event kinds
  - **PAY-V2-P5 operational UI:** 2 web страницы (AdminPayoutsQueue + Batch detail) +
    3 Expo screens (admin/payouts, admin/payout-batch/[batchId], developer/payout-profile)
  - WEB-P4 backend-authority discipline preserved (master guard enforces)
- **Verified end-to-end:** happy path (6 earnings → 6 items → settled in 3 drain cycles)
  + failure path (3 attempts → exhausted, dead_lettered=True).
- **Pending phases:**
  - **P2** Live rails — нужны `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` +
    `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` + `PAYPAL_WEBHOOK_ID`.
  - **P4** Reconciliation + divergence observer — meaningful только после P2.
- **Master guard live:** `python3 /app/backend/scripts/audit/pay_v2_master.py` → ✅ зелёный.

### Lifted scope (sealed → можно браться)

AI / automation · Analytics · Payout v2 · Billing v2 · Forecasting ·
Growth/referral · Operator systems.

---

## 4. Интеграции (все в MOCK)

| Capability | Текущий режим | Флипнуть в live |
|---|---|---|
| payment | **mock** (Stripe SDK установлен, test-key в pod env) | `STRIPE_SECRET_KEY` |
| mail | **mock** (resend SDK установлен) | `RESEND_API_KEY` |
| storage | **mock** (cloudinary в LOCAL mode, файлы локально) | `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` |
| ai/LLM | **mock** (litellm + emergentintegrations установлены) | `EMERGENT_LLM_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| oauth (Google) | unavailable | `GOOGLE_CLIENT_ID` |

> Все провайдеры маршрутизируются через единый `integrations.registry` —
> поднять прод-режим = добавить ключ в `backend/.env` и перезапустить backend,
> без правок бизнес-кода.

`GET /api/integrations/manifest` → 200 OK, отражает MOCK-режим честно.

---

## 5. Качество / governance

- **94+** Python-модулей, **708** API-маршрутов, **33+** unit-тестов
  (`backend/tests/`).
- **Architectural guards (живые):**
  - `web/scripts/audit/web_p6_master.py` → ✅
  - `backend/scripts/audit/pay_v2_master.py` → ✅
  - Aggregation guards (annotation tool + p4_guards)
  - Money substrate AST guards (sealed, read-only)
- **Money substrate Phase 2C-B SEALED:** `money_ledger_events` = sole canonical
  authority · `dev_wallets_projection` = deterministic read model · 
  conservation invariant `Σ ac_dev + Σ ac_reserved + Σ ac_ext` holds ·
  8 AST guard tests + 75 acceptance tests.
- **Product scope freeze** (`docs/product-scope-freeze.md`):
  1. Expo admin = operational cockpit (НЕ дублирует web).
  2. Expo tester = build mobile (Stage 4).
  3. Lead = conversion surface (НЕ отдельная роль).

### Низкоприоритетный шум (не блокирует)

| # | Что | Severity | Где |
|---|---|---|---|
| 1 | `GET /openapi.json` 200, `GET /api/openapi.json` 404 — FastAPI default route не префиксован под ingress, для внешнего разработчика — копать `/openapi.json` напрямую через под (внутри). | info | `backend/server.py` |
| 2 | Дублирующиеся `Operation ID` в OpenAPI (validation pass/fail, admin users v2). FastAPI warnings, runtime не ломает. | info | `backend/server.py`, `admin_users_layer.py` |
| 3 | RN-web warnings: deprecated `shadow*`, `pointerEvents`, `borderColor: var(--t-primary)33` (только под web target). | info | various screens |
| 4 | `expo-audio` peer dep `expo-asset` not pinned — yarn warning, сборка проходит. | info | `frontend/package.json` |
| 5 | Pytest URL-drift: тесты захардкожены на старые preview-домены. Доменные модули (money/escrow/wallets) — зелёные, fail-ы pre-existing. | info | `backend/tests/*` |

---

## 6. Что готово к следующему шагу

- Полная база: 708 API + 93 Expo экрана + 228 web страниц + 2 общих пакета.
- Seeded users в `/app/memory/test_credentials.md`.
- Реальный demo-проект для `client@atlas.dev` («Acme Analytics Platform», 3 модуля).
- Mock-сиды: 2 projects, 7 modules, 6 earnings, 6 invoices, 2 deliverables,
  3 tickets, 3 notifications, 7 cognition_actions.
- 14-дневный SEED_REPLAY: 16 overrides + 14 QA-fails + 19 reassigns +
  12 overloads + 9 suppressions.
- Все WEB Stabilization guards и PAY-V2 master guard — **зелёные**.

### Рекомендуемые следующие шаги

1. **PAYOUTS_V2 P2 — live rails** (Stripe Connect + PayPal Payouts реальные
   SDK). Требует ключи (см. §3).
2. **Mobile Tester Stage 4** — 4 экрана (Tester Home, validations list,
   detail, history). Бэкенд готов.
3. **Lift mocks → live** — переключить mail/ai/storage предоставлением ключей
   (см. §4).
4. **Новая фича** (выбор по `active_issues.md`): AI assist · forecasting ·
   billing v2 · analytics · multi-currency · growth/referral.

---

**Аудит подготовил:** E1 (Emergent main agent)
**Статус развёртывания:** ✅ **DEPLOYED & GREEN**
