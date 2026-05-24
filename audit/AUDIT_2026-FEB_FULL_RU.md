# EVA-X / ATLAS DevOS — Полный аудит проекта (Февраль 2026)

> Аудит составлен после полного развёртывания репозитория `svetlanaslinko057/evvevea`
> в `/app` и запуска backend + Expo frontend. Документ — на русском, ориентирован
> на дальнейшее развитие. Все цифры и ссылки — на текущее состояние main.

---

## 1. Что это за продукт

**Бренд:** EVA-X (внутреннее кодовое имя `ATLAS DevOS`, "Development OS").

**Суть:** платформа управляемой продуктовой разработки "под ключ". Клиент
описывает идею → система AI/оператор формирует scope + цену → платформа
исполняет (модули, команда разработчиков, QA, валидаторы) → клиент принимает
и платит через escrow → разработчики получают выплаты.

**Слоган с лендинга:** *"Build real products. Not tasks. No freelancers, no
chaos, one system."*

**Целевые сценарии (по `web/README.md` + `audit/CONTRACTS.md`):**
SaaS-платформы, marketplace'ы, AI-инструменты, internal systems.

### Роли пользователей (зафиксированы в `docs/product-scope-freeze.md`)

| Роль | Назначение | Поверхность |
|------|------------|-------------|
| `lead` | pre-auth конверсия (гость с идеей/estimate) | Expo + web — только лендинг/wizard |
| `client` | заказчик / владелец проекта | Expo + web (canonical) |
| `developer` | исполнитель / разработчик | Expo + web |
| `tester` (validator) | приёмка модулей | Expo (Stage 4 запланирована) + web |
| `admin` | оперативный кокпит / полный контроль | Expo cockpit + web canonical |
| `provider` | внешний поставщик | web |

---

## 2. Архитектура и стек

```
┌──────────────────────────┐    ┌──────────────────────────────────────┐
│  Expo Router mobile/web  │    │  React CRA + craco + Tailwind        │
│  /app/frontend (~330 MB) │◄──►│  /app/web (canonical web client)     │
│  100+ экранов, 6 ролей   │    │  shadcn/radix-ui, react-router v7    │
└─────────────┬────────────┘    └──────────────────┬───────────────────┘
              │                                    │
              │  axios + socket.io-client          │
              │  runtime-client (общий слой)       │
              ▼                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │  FastAPI backend on :8001 (uvicorn --reload)        │
        │  server.py = 27 247 строк (монолит)                 │
        │  + 70+ модулей доменной логики                      │
        │  + 688 API-эндпоинтов (OpenAPI)                     │
        └────────────────────────┬────────────────────────────┘
                                 │ motor (async)
                                 ▼
                       MongoDB (37 коллекций)
```

### Технологии

**Backend (Python 3.11):**
FastAPI 0.110 · motor 3.3 · pydantic 2.12 · stripe 15 · resend 2.30 · pyotp ·
emergentintegrations · litellm 1.80 · openai 1.99 · google-genai 1.71 · slowapi
(rate-limit) · sentence-transformers (для семантического поиска scope-шаблонов) ·
boto3 · cloudinary (через свой service-шим).

**Web (React 19):**
CRA 5 + craco · Tailwind 3 + `@radix-ui/*` (shadcn-стиль) · React Router v7 ·
react-hook-form + zod · recharts · socket.io-client · `@react-oauth/google` ·
`@dnd-kit/*` (kanban-перетаскивание).

**Expo (SDK 54, React Native 0.81):**
expo-router v6 · reanimated 4 · gesture-handler 2 · expo-notifications ·
expo-image-picker · expo-document-picker · expo-clipboard · expo-haptics ·
expo-auth-session · socket.io-client · axios. **Web bundle также собирается
из Expo** (Metro) — текущий preview = Expo web build.

**Общие пакеты (`/app/packages`):**
- `design-system` — токены/тема/моушн, разделение `adapter.native.ts` /
  `adapter.web.ts`.
- `runtime-client` — единый клиент API + websocket, с capability-проверками
  (см. `web/src/runtime-client/`).

### Архитектурный принцип (зафиксирован в `web/ARCHITECTURE.md`)

> **UI renders JSON. Backend is the source of truth.**

Жёсткие правила:
- UI не считает агрегаты — все суммы/счётчики приходят с бэка.
- UI не фильтрует/сортирует данные локально (только query-параметры эндпоинта).
- Один экран → N независимых GET-запросов → N независимых setState.
- POST → success → refetch (не локальный merge).

---

## 3. Структура репозитория

```
/app
├── backend/               # FastAPI монолит + 70+ модулей доменной логики
│   ├── server.py          # 27 247 строк (главная точка входа, все роуты)
│   ├── admin_*.py         # 11 файлов (actions, control, system, team, …)
│   ├── client_*.py        # 7 файлов (acceptance, costs, escrow, …)
│   ├── developer_*.py     # 4 файла (brain, economy, intelligence, support)
│   ├── money_*.py         # 5 файлов (ledger, bridge, divergence, replay, projections)
│   ├── escrow_*.py + payout_layer.py + earnings_layer.py
│   ├── domains/money/     # новый чистый домен (Phase 2C, ledger)
│   ├── services/, shared/, infrastructure/, integrations/, middleware/
│   ├── payment_providers/ # stripe-шим
│   ├── api/, config/      # модульные роутеры
│   └── tests/             # pytest, в т.ч. architecture/ — invariant-тесты
│
├── frontend/              # Expo Router (мобильный + web preview)
│   ├── app/               # 100+ tsx-экранов, дерево по ролям
│   │   ├── admin/ (14)   client/ (13)  developer/ (16)  tester/ (5)
│   │   └── + lead/, project/, contract/, workspace/, etc.
│   ├── src/               # 60+ компонентов, design-system, runtime
│   │   ├── admin/ui.tsx + useAdminResource.ts (single source of truth)
│   │   └── runtime-client/ (shim)
│   └── assets/
│
├── web/                   # Канонический web (CRA + Tailwind + shadcn)
│   └── src/
│       ├── pages/         # 100+ страниц (AdminV2*, ClientCabinet, DeveloperDashboard, …)
│       ├── components/    # UI-секции, admin/, client/, developer/, …
│       ├── runtime-client/ (canonical) и runtime/ (агрегатор)
│       └── theme/, layouts/, hooks/, lib/
│
├── packages/              # design-system, runtime-client (shared)
├── audit/                 # 80+ md-документов аудитов всех фаз
├── docs/                  # PRD, scope-freeze, runtime-contracts, charters
├── scripts/               # smoke-traces, stability-probes, replay-инструменты
├── memory/                # PRD.md (Phase 2C-B4.2 closeout)
└── tests/, tools/, test_reports/
```

---

## 4. Покрытие API (по OpenAPI runtime)

**Всего 688 публичных путей.** Топ-области:

| Префикс | Endpoint'ов | Назначение |
|---|---:|---|
| `/api/admin/*` | 251 | контроль платформы, QA, finance, team, integrations, system |
| `/api/developer/*` | 72 | работа, портфолио, earnings, validation, поддержка |
| `/api/client/*` | 65 | проекты, billing, acceptance, escrow, workspace |
| `/api/modules/*` | 23 | сущность "модуль работ" |
| `/api/account/*` | 23 | профиль, 2FA, восстановление |
| `/api/execution-intelligence/*` | 19 | analytics-слой |
| `/api/auth/*` | 18 | OTP, session, demo, password reset |
| `/api/ai/*` | 13 | LLM фичи |
| `/api/mobile/*` | 10 | спец-эндпоинты для Expo |
| `/api/system/*` | 10 | health, config, status |
| `/api/escrow/*`, `/api/billing/*` | 12 | деньги |
| прочее | 174 | provider, validation, marketplace, contracts, notifications, … |

`/api` корень возвращает: `{"message":"Development OS API","version":"1.0.0"}`.

---

## 5. Денежный слой (самая сложная и зрелая часть)

Состояние формализовано в `memory/PRD.md` + закрытиях фаз в `audit/PHASE_2C_*`.

**Архитектура:**
1. `money_ledger_events` (immutable event log, единственный источник правды).
2. Composite index `(event_type, idempotency_key)` — единственный idempotency-guard
   (избыточный `idempotency_key_1` дропнут в B4.2.0a).
3. `dev_wallets_projection` — read-model, перестраивается из ledger (idempotent rebuild).
4. `dev_wallets` (legacy) — после Phase 2C-B4.2 в режиме "diagnostic only",
   намеренно расходится → divergence engine это видит и логирует.
5. Bridges: `bridge_escrow`, `bridge_earning_approved`, `bridge_earning_reversed`,
   `bridge_payout`, `bridge_refund` — не тронуты, продолжают эмитить события.
6. Feature-flag `MONEY_READS_FROM_PROJECTION = true` (B3.1) — все чтения уже идут
   через projection.

**Закрытые фазы (по `memory/PRD.md`):**
- ✅ 2C-B1 — projection shadow
- ✅ 2C-B2/B2.5 — стабилизация, seed convergence
- ✅ 2C-B3/B3.1 — dual-read + flip на projection
- ✅ 2C-B4.0/0.1 — DEV POOL boot wipe убран, demo/mock seeds канонизированы
- ✅ 2C-B4.1 — admin mark-paid legacy write убран
- ✅ 2C-B4.2 — `_credit_module_reward` legacy write убран
- ✅ 2C-B4.2.0a — substrate-fix индексов
- ✅ 2C-B4.2.1 — `module_qa_decision` canonical chain (`_record_module_approval_canonical`)

**Открытые фазы (следующие на очереди):**
- 🟡 2C-B4.3 — `pending_withdrawal` lifecycle peel (state machine + temporal
  consistency + concurrent flows) — *"the harder half"*.
- 🟡 2C-B4.4 — `dev_wallets` collection → diagnostic only (формализация).
- 🟡 2C-B4.5 — divergence engine → passive observer.

**Acceptance критерии последней фазы (B4.2.1) — все зелёные:**
5/5 stability runs, `accrual_pending_cents` invariant, 19 passed projection tests,
`WARN dev_wallet_read.mismatch = 0`.

---

## 6. Состояние интеграций (из `/api/integrations/manifest`)

| Capability | Mode | Policy | Что нужно для прод |
|---|---|---|---|
| **payment** | `mock` | hard | `STRIPE_SECRET_KEY` (тест-ключ доступен в env пода) |
| **mail** | `mock` | soft | `RESEND_API_KEY` |
| **storage** | `mock` | soft | `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` |
| **oauth** | `unavailable` | hard | Google OAuth client_id / secret (или Emergent Google Auth) |
| **LLM** | — | — | `EMERGENT_LLM_KEY` (есть встроенная поддержка через `emergentintegrations`) |
| **2FA** | работает | — | `pyotp` встроен, секрет генерится in-app |
| **embeddings** | `sentence-transformers/all-MiniLM-L6-v2` | — | Скачивается в `/root/.cache` (требует ~91 MB) |

> ⚠️ Все интеграции работают через **capability-шимы**: backend сам определяет
> mock vs real по наличию ключа. То есть продукт развивается без них, но
> для боевого режима их нужно добавить (см. блок "следующие шаги").

---

## 7. Сидинг и demo-данные (mock_seed.py + seed_replay.py)

После загрузки backend автоматически наполняет MongoDB:

| Коллекция | Документов | Что внутри |
|---|---:|---|
| `users` | 13 | admin@atlas.dev, client@atlas.dev, dev*@…, tester@… |
| `projects` | 3 | demo-проекты разной зрелости |
| `modules` | 99 | работы по проектам, разные статусы QA |
| `qa_decisions` | 105 | история приёмок (включая seed-replay) |
| `money_ledger_events` | 30 | escrow/earning/payout events |
| `invoices` | 6 | для billing-страницы |
| `dev_earning_log` | 6 | начисления исполнителям |
| `payouts` | 3 | выплаты |
| `cognition_overrides` | 34 | seed-replay автогенерация (14 дней) |
| `system_actions_log` | 51 | следы automation/operator |
| `validation_tasks` | 5 | для tester-роли |

Все demo-пользователи доступны через `POST /api/auth/demo {role}`. UI-режим
`is_demo: true` помечен в JWT, ничего не ломает прод.

---

## 8. Что РАБОТАЕТ прямо сейчас (после `git clone` + установки)

✅ **Backend** на `localhost:8001`, через ингресс на `EXPO_PUBLIC_BACKEND_URL`.
✅ **Expo frontend** на `localhost:3000`, рендерит лендинг EVA-X (см. скриншот).
✅ **MongoDB** наполнена demo-данными (37 коллекций).
✅ **OpenAPI** 688 путей, схема валидируется.
✅ **Health-чек** `/api/integrations/manifest` отдаёт корректный capability-снимок.
✅ **Auth demo** — `POST /api/auth/demo` создаёт пользователя и возвращает сессию.
✅ **Money ledger** — все события идемпотентны, projection rebuild идемпотентен,
   stability probe зелёная.
✅ **Tests** — `tests/test_dev_wallet_projection.py` + `tests/test_dev_wallet_reader.py`
   проходят (19 passed согласно последнему closeout).

---

## 9. Известные риски и долги (важно знать до развития)

### Архитектурные

1. **`server.py` — 27 247 строк.** Монолит, который начинал декомпозироваться
   (см. `audit/ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md`), но процесс
   не завершён. Любой большой merge сюда — высокий риск конфликтов.
2. **Параллельно два frontend'а** (`/app/web` и `/app/frontend`), у которых:
   - Разные роутинги (react-router-v7 vs expo-router-v6).
   - Разные дизайн-системы (Tailwind+radix vs StyleSheet+@expo/vector-icons).
   - Общий слой только через `packages/runtime-client` + `packages/design-system`.
   - Закон scope-freeze: **Expo admin — только кокпит + 8 read-only drill-down**;
     полный admin-UX живёт **только на web**.
3. **Frontend имеет ~17 000 файлов** (включая зависимости из commit'а) — это
   и почему `git clone` копирует ~330 MB. Это нормально для CRA + Expo
   stack'а, но снижает скорость операций.

### Технические долги, помеченные в аудите

| Долг | Источник | Серьёзность |
|------|---------|-------------|
| `pending_withdrawal` lifecycle ещё на legacy `dev_wallets` | PRD §B4.3 | 🔴 High — следующая фаза |
| sentence-transformers скачивается в runtime (нужно ~91 MB на `/root`) | live-логи | 🟡 Med — фикс: pre-bake в образ или отключить семантический поиск шаблонов |
| 0 OAuth-ключей → social login не работает | manifest | 🟡 Med — нужно подключить (или Emergent Google Auth) |
| Stripe в mock-режиме | manifest | 🟡 Med — для прода нужен реальный ключ |
| RESEND для писем — mock | manifest | 🟢 Low — emails отключены, но не критично для dev |
| `/api/system/health` отдаёт 404 (нет такого пути) | curl test | 🟢 Low — есть `/api/integrations/manifest` как замена |
| `POST /api/auth/demo` без body даёт 405 — нужен `{role}` | curl test | 🟢 Low — это by design |

### Disk pressure

В контейнере `/root` имеет лимит 9.8 GB. После установки `yarn install` +
sentence-transformers cache место может закончиться. Я очистил `pip cache`
и `npm cacache` (освобождено ~3.2 GB). Для прода — переменная `HF_HOME`
вынесет model cache в `/app/.cache` (на overlayfs 95 GB).

---

## 10. Где смотреть документацию

| Что | Файл |
|-----|------|
| Текущий статус (1 страница) | `/app/memory/PRD.md` |
| Скоупный freeze v1 | `/app/docs/product-scope-freeze.md` |
| Скоупный freeze, Amendment 1 (admin Operations grid) | `/app/docs/product-scope-freeze-amend-1.md` |
| Архитектурные правила фронта | `/app/web/ARCHITECTURE.md` |
| Backend-контракты | `/app/backend/CONTRACTS.md` |
| Архитектура декомпозиции backend | `/app/audit/ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md` |
| API карта | `/app/audit/API_CONTRACT_MAP.md`, `contract_map.json` |
| Endpoint registry | `/app/audit/ENDPOINT_FAMILY_REGISTRY.md` |
| Денежный слой (state machine) | `/app/audit/MONEY_STATE_MACHINE.md`, `MONEY_AUTHORITY_CHARTER.md` |
| Runtime-client migration | `/app/audit/RUNTIME_CLIENT_MIGRATION.md` |
| Все 80+ закрытий фаз | `/app/audit/PHASE_*` |

---

## 11. Рекомендуемые следующие шаги

Предлагаю двинуть проект в этом порядке (от меньшего риска к большему):

### Шаг 1 — Стабилизировать dev-окружение (1-2 итерации)
- Подключить **EMERGENT_LLM_KEY** в `/app/backend/.env` (бесплатно через
  Emergent Universal Key) — это разблокирует `/api/ai/*` и AI-фичи scope-builder.
- Пробросить sentence-transformers cache в `/app/.cache` через `HF_HOME`,
  чтобы не упираться в лимит `/root`.
- Поднять реальный health-check эндпоинт (`/api/health` сейчас отдаёт 404).

### Шаг 2 — Подключить production-интеграции (по приоритету)
1. **Stripe** (тестовый ключ уже доступен в env пода — `STRIPE_SECRET_KEY`)
   → разблокирует реальный escrow / billing / payout flow.
2. **Emergent-managed Google Auth** или собственный Google OAuth → разблокирует
   social login, `/api/auth/exists` уже готов работать с этим.
3. **Resend** → email-уведомления (восстановление пароля, QA-нотификации).
4. **Cloudinary** → загрузка артефактов модулей (картинки, видео, документы).

### Шаг 3 — Закрыть финансовые фазы
- **Phase 2C-B4.3** — `pending_withdrawal` lifecycle peel (state machine +
  concurrent flows). Это последний кусок, после которого `dev_wallets` можно
  объявить полностью legacy.
- **Phase 2C-B4.4-4.5** — `dev_wallets` → diagnostic only, divergence engine →
  passive observer.

### Шаг 4 — Завершить разбиение монолита
Подвинуть оставшиеся ~27k строк из `server.py` в `domains/*` (по плану из
`ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md`).

### Шаг 5 — Мобильная фаза Stage 4
По freeze v1: **Tester surface на Expo** (4 экрана) — Home / Validation list /
Detail / History. Backend уже готов (`/api/tester/*` × 5 + `/api/validation/*` × 8).

### Шаг 6 — Усиление production
- 2FA-flow (есть в коде, нужна проверка end-to-end).
- Rate-limiting (slowapi подключён, нужны корректные limits на чувствительные эндпоинты).
- Sentry / observability.
- Backup-стратегия для money_ledger_events (append-only, критичная коллекция).

---

## 12. Готовность к работе

| Компонент | Статус | Комментарий |
|---|---|---|
| Backend (FastAPI) | 🟢 Working | 688 endpoints, demo data, money ledger green |
| Expo frontend | 🟢 Working | Лендинг EVA-X отдаётся, остальные роуты собраны |
| Web frontend | 🟡 Source-only | Нужно `cd /app/web && yarn install && yarn build` для подачи через `/api/web-ui/*` |
| MongoDB | 🟢 Seeded | 37 коллекций, 13 пользователей, demo-проекты |
| Money ledger | 🟢 Phase 2C-B4.2.1 closed | 5/5 stability runs зелёные |
| Auth | 🟡 Demo-only | OTP/2FA-код есть, OAuth не подключён |
| Платежи | 🔴 Mock | Нужен STRIPE_SECRET_KEY |
| Email | 🔴 Mock | Нужен RESEND_API_KEY |
| Storage | 🔴 Mock | Нужны CLOUDINARY_* |
| LLM | 🔴 Off | Нужен EMERGENT_LLM_KEY |

---

## 13. Резюме одной строкой

**EVA-X — это зрелая (~145k LOC), функционирующая платформа управляемой
продуктовой разработки с тщательно задокументированным финансовым слоем,
двумя frontend'ами и 688 API. Развёрнута и работает. Следующий логический
шаг — подключить production-интеграции (Stripe / Resend / Cloudinary / OAuth /
LLM) и закрыть Phase 2C-B4.3.**

---

*Подготовил: E1 (Emergent main agent), February 2026*
*Документ хранится в `/app/audit/AUDIT_2026-FEB_FULL_RU.md`*
