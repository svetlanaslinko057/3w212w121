# Полный аудит — развёртывание ATLAS DevOS / EVA-X (2026-05-24)

**Источник:** `https://github.com/svetlanaslinko057/123231231231` (branch `main`)
**Снимок развёрнут в:** `/app` на 2026-05-24
**Среда:** Emergent preview (`expo-project-deploy-1.preview.emergentagent.com`)
**Сессия:** новая (E1), пустой стартовый шаблон → полный graft репозитория.

---

## 1. Состояние развёртывания

| Сервис | Статус | Порт | Проверка |
|---|---|---|---|
| `backend` (FastAPI + Socket.IO) | ✅ RUNNING | 8001 | `/api/healthz` → `{status:"ok"}` · `/api/readyz` → `{ready:true}` |
| `expo` (Metro tunnel + web bundle) | ✅ RUNNING | 3000 | HTTP 200, `/auth` рендерится с брендом **EVA-X** |
| `mongodb` | ✅ RUNNING | 27017 | seeded (users, projects, modules, validations) |
| `web` (CRA admin bundle) | ✅ SERVED | `/api/web-ui/` | HTTP 200 (prebuilt в `web/build/`) |
| `code-server` / `nginx-code-proxy` | ✅ RUNNING | — | infra |

**Зарегистрировано API маршрутов:** **701** (источник: `/openapi.json`).

### Шаги развёртывания (выполнены)
1. Бэкап `/app/backend/.env` и `/app/frontend/.env`.
2. `rsync` репо → `/app/`, исключив `.git`, `.emergent`, `node_modules`, `.expo`, `.metro-cache`, `__pycache__`, `.env`.
3. Восстановлены protected `.env` (MONGO_URL, EXPO_PACKAGER_PROXY_URL, EXPO_PACKAGER_HOSTNAME, EXPO_PUBLIC_BACKEND_URL).
4. `pip install -r backend/requirements.txt --no-cache-dir` (≈90 пакетов, включая `litellm`, `emergentintegrations`, `sentence-transformers`, `motor`, `stripe`, `slowapi`, `python-socketio`, `resend`).
5. `yarn install` в `frontend/` (Expo SDK 54, RN 0.81, react 19, expo-router 6).
6. `supervisorctl restart backend expo` → оба сервиса зелёные.
7. Smoke-проверка: `POST /api/auth/login` (`admin@atlas.dev`/`admin123`) → 200 OK, возвращает корректный объект пользователя.

### Артефакты
- Идентификаторы пользователей вынесены в `/app/memory/test_credentials.md`.
- Образ среды `expo_mongo_base_image_cloud_arm:release-22052026-1`.
- Свободно на `/app`: ≈ 2.8 GB из 9.8 GB (после установки зависимостей).

---

## 2. Архитектура продукта

**Что это:** «ATLAS DevOS / EVA-X» — мультиролевой Development OS. Сквозной поток: лид→идея→оценка→скоуп→контракт→разработка (модули)→QA→доставка→биллинг→саппорт, поверх ролей **client / developer / tester / admin**.

### 2.1 Backend (FastAPI, 701 маршрутов)
- **Корневой файл:** `backend/server.py` (≈ 27 400 строк, монолит). Регистрирует роутеры из 94 Python-модулей.
- **Слои бизнес-логики (доменные модули в `backend/`):**
  - `assignment_engine`, `acceptance_layer`, `time_tracking_layer`, `event_engine`, `decomposition_engine` (ядро разработки).
  - `admin_*` (8 модулей): control, integrations, llm_settings, mobile, production, risk, system, team, users_layer.
  - `client_*` (7 модулей): acceptance, costs, escrow, operator, transparency, workspace.
  - Биллинг/деньги: `money_substrate`, `payouts_v2_api`, `payment_providers/`, `client_escrow`, `dev_payment_profiles`.
  - QA/Тестирование: tester+validation API (5+8 эндпойнтов).
  - **Aggregation Backend Authority (WEB-P4):** `web_p4_summaries.py` отдаёт `/api/client/billing/invoices-summary`, `/api/developer/performance/summary`, `/api/admin/users-v2/summary` — без клиентской агрегации.
- **Реальное время:** Socket.IO mounted at `api/socket.io` с ACL-фильтрацией комнат (user / role / project), проверка ассайнментов для dev/tester.
- **Системные режимы:** `manual / assisted / auto` + `CRITICAL_ACTIONS` (delete_project, payment_release, force_delete_user, cancel_invoice) — критика всегда требует ручного подтверждения.
- **Boundary layer:** `backend/integrations/registry.py` маршрутизирует `payment` / `ai` / `mail` / `storage` через провайдеры. Бизнес-код не типизирует `stripe_session_id` напрямую — единый контракт `CheckoutRequest`/`MailMessage` (Этап 5.1).
- **Observability:** `middleware/request_id.py` + `middleware/error_shape.py` — каноничная форма ошибок `{ok:false,code,...}` + `x-request-id` propagation.
- **Rate limiting:** `slowapi` на auth эндпойнтах.
- **CORS:** preview = `*` без `credentials`, prod = whitelist через `CORS_ORIGINS` + regex для `*.preview.emergentagent.com`.

### 2.2 Frontend Expo (`/app/frontend`)
- **Стек:** Expo SDK 54, React Native 0.81.5, React 19, **expo-router 6** (file-based).
- **Файлов экранов:** 93 в `frontend/app/**`.
- **Ролевые поверхности (по `app/`):**
  - `client/` — заказчики (workspace, billing-OS, project, deliverables).
  - `developer/` — модули, очередь, performance.
  - `tester/` — Stage 4 (validations / history).
  - `admin/` — операционный cockpit (5 экранов: alerts, QA-actions, withdrawal-approve, payout-batch-approve, profile/mobile-config). **Не дублирует web-админку** — это policy (см. `docs/product-scope-freeze.md`).
  - `operator/`, `lead/`, `contract/`, `project/`, `help/`, `workspace/`.
- **Транспорт:** axios через `frontend/src/runtime-client/` с дедупом, retry, Bearer-токеном из AsyncStorage.
- **`expo-router` typedRoutes:** включены.

### 2.3 Web admin (`/app/web` — CRA + Radix UI)
- 228 JS/JSX файлов, шипится как статический бандл из `web/build/` через FastAPI route `/api/web-ui/`.
- **Дизайн-система:** общая с мобильным через `packages/design-system` + `packages/runtime-client` (typed HTTP client).
- **WEB Stabilization Line SEALED (2026-FEB-24)** — три фазы:
  - **P4** — Backend Authority: 3 страницы (ClientBillingOS, DeveloperPerformance, AdminUsersPage) полностью отказались от клиентской агрегации.
  - **P5** — `RootErrorBoundary` + `ToastBridgeMount` (request_failed / render_error → каноничные тосты).
  - **P6** — Master guard: 0 raw axios/fetch в `pages/`, 0 дублирующих runtime-client, 0 внутренних путей в `<Routes>`.
- **Master guard live:** `python3 web/scripts/audit/web_p6_master.py` → ✅ зелёный.

### 2.4 Shared packages
- `packages/design-system/` — токены, motion, theme, типографика.
- `packages/runtime-client/` — единый HTTP-клиент (TypeScript) для web + Expo (с адаптерами).

---

## 3. Активная работа (по `memory/active_issues.md`)

Текущая эра — **MONETIZATION + OPERATIONAL SCALE**. Открытый трек:

### 🟡 PAYOUTS_V2 (Stripe Connect + PayPal Payouts)
- **P0 + P1 deployed:** SettlementProvider ABC, MockSettlementProvider, 5 Mongo collections, 10-state item state-machine, hybrid-cadence scheduler, 10 эндпойнтов `/api/payouts-v2/*`, dev profile self-service.
- **Verified end-to-end:** approved earning → batch proposed → released → 4 ручных перехода → settled $250.
- **Phases pending (~10 дней):** P2 live rails · P3 worker · P4 reconciliation · P5 UI.
- **Guard:** `python3 backend/scripts/audit/pay_v2_master.py` → ✅ зелёный (текущие фазы пройдены).

### Lifted scope (можно браться после seal Stabilization Line)
AI/automation · Analytics · Payout v2 · Billing v2 · Forecasting · Growth/referral · Operator systems.

---

## 4. Состояние интеграций

| Capability | Текущий режим | Флипнуть в live |
|---|---|---|
| payment | **mock** (Stripe SDK установлен, тестовый ключ доступен в pod env) | `STRIPE_SECRET_KEY` |
| mail | **mock** (resend SDK установлен) | `RESEND_API_KEY` |
| storage | **mock** (cloudinary в LOCAL mode) | `CLOUDINARY_*` |
| ai/LLM | **mock** (litellm + emergentintegrations установлены) | `EMERGENT_LLM_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| oauth (Google) | unavailable | `GOOGLE_CLIENT_ID` |

> Все провайдеры маршрутизируются через единый `integrations.registry` — поднять прод-режим = добавить ключ в `backend/.env` и перезапустить backend, без правок бизнес-кода.

---

## 5. Качество / governance

- **94** Python-модулей, **701** API-маршрут, **33** unit-теста (`backend/tests/`).
- **Architectural guards (живые):**
  - `web/scripts/audit/web_p6_master.py` → ✅
  - `backend/scripts/audit/pay_v2_master.py` → ✅
  - Aggregation guards (annotation tool + p4_guards).
  - Money substrate AST guards (sealed, read-only).
- **Product scope freeze** (`docs/product-scope-freeze.md`) — три решения зафиксированы:
  1. Expo admin = operational cockpit (НЕ дублирует web).
  2. Expo tester = build mobile (Stage 4).
  3. Lead = conversion surface (НЕ отдельная роль).

### Найдено / шумит (low-severity, не блокирует)

| # | Что | Severity | Где |
|---|---|---|---|
| 1 | `GET /api/integrations/manifest` → 500 — `KeyError: Capability.SETTLEMENT` в `integrations/registry.py:250` (manifest reader не знает о новой capability) | low | `backend/integrations/registry.py:250` |
| 2 | `GET /api/portfolio` → 404 (роут переехал; smoke-тест использовал устаревший путь) | info | — |
| 3 | 3 hardcoded money literals в web (warn-only, помечены P6 как acceptable display strings) | info | `DeveloperGrowthPage.js:380`, `AdminPricingConfigPanel.js:275`, `DeveloperProfileEnhanced.js:210` |
| 4 | RN web warnings: deprecated `shadow*`, `pointerEvents`, `borderColor: var(...)` — это шум RN-web, не ломает работу | info | various screens |
| 5 | `expo-audio` peer dep `expo-asset` not pinned — warning из yarn, не ломает сборку | info | `frontend/package.json` |

---

## 6. Что готово к следующему шагу

- Полная база: 701 API + 93 Expo экрана + 228 web страниц + 2 общих пакета + 33 теста.
- Seeded users: admin/client/developer/tester/multi-role (credentials в `/app/memory/test_credentials.md`).
- Реальный demo-проект для `client@atlas.dev` («Acme Analytics Platform», 3 модуля).
- Mock-сиды: 2 проекта, 7 модулей, 6 earnings, 6 invoices, 2 deliverables, 70-day replay seed (overrides / qa_fail / reassign / overload / suppression).
- Все WEB Stabilization guards и PAY-V2 master guard — **зелёные**.

### Рекомендуемые следующие шаги (выбирай)

1. **PAYOUTS_V2 P2 — live rails** (Stripe Connect + PayPal Payouts реальные SDK). Требует `STRIPE_SECRET_KEY` + `PAYPAL_CLIENT_ID/SECRET`.
2. **Mobile Tester Stage 4** — 4 экрана (Tester Home, validations list, validation detail, history). Бэкенд готов.
3. **Lift mocks → live** — переключить mail/ai/storage режимы предоставлением ключей.
4. **Починить тривиал:** `integrations/manifest` 500 (1 строка — добавить SETTLEMENT в `_get`).
5. **Новая фича (выбор по `active_issues.md`):** AI assist · forecasting · billing v2 · analytics · multi-currency.

---

**Аудит подготовил:** E1 (Emergent main agent)
**Дата:** 2026-05-24
**Статус развёртывания:** ✅ **DEPLOYED & GREEN**
