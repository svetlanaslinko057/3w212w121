# Полный аудит и развёртывание — 2026-02 (FEB)

**Репозиторий:** `svetlanaslinko057/c3dx3c3xx3`
**Кодовое имя проекта:** **ATLAS DevOS** (брендинг фронтенда — **EVA-X**)
**Платформа Emergent — workspace `/app`**
**Дата отчёта:** 2026-02-FEB
**Автор:** E1 (полный re-deploy + audit pass)

---

## 0. TL;DR (Резюме для бизнеса)

| Слой               | Состояние          | Комментарий |
|--------------------|--------------------|-------------|
| Backend (FastAPI)  | ✅ RUNNING (200)   | 688 endpoint'ов, lifespan ok, MongoDB подключён |
| Mobile (Expo)      | ✅ RUNNING (200)   | Туннель активен, web preview рендерится (EVA-X лендинг) |
| Web (CRA + craco)  | ⚠️ NOT BUILT       | Код есть в `/app/web`, но `build/` отсутствует; не сервится |
| MongoDB            | ✅ RUNNING         | Сидинг (6 девелоперов, 89 модулей, 81 QA, 5 валидаций) проходит |
| Все ключи          | 🔶 MOCK MODE       | `INTEGRATIONS_LIVE_ENABLED` не выставлен — все интеграции в безопасном mock |
| Тесты              | ⚠️ ЧАСТИЧНО        | 32 файла, нужен `pytest-asyncio` для async тестов |
| Disk               | ⚠️ TIGHT           | `/dev/nvme0n3` = 9.8GB, после установки осталось ~3.3GB |

**Готово к продолжению разработки.** Все три критических потока (auth, money, escrow) запускаются. Дальнейший продакшен-flip (`INTEGRATIONS_LIVE_ENABLED=1`) гейтится только наличием реальных ключей.

---

## 1. Что было сделано в этой сессии

### 1.1. Развёртывание из GitHub
- В `/app` был только стартовый Expo-шаблон. Содержимое репозитория **не было загружено**.
- Клонировал `svetlanaslinko057/c3dx3c3xx3` в `/tmp`, синхронизировал в `/app` через `rsync`, сохранив:
  - `/app/backend/.env` (`MONGO_URL`, `DB_NAME`)
  - `/app/frontend/.env` (`EXPO_PACKAGER_*`, `EXPO_PUBLIC_BACKEND_URL`)
  - `/app/.git`, `/app/.emergent`
- Перенесены: `audit/`, `backend/`, `docs/`, `frontend/`, `memory/`, `packages/`, `scripts/`, `test_reports/`, `tools/`, `web/`, корневые `design_guidelines.json`, `test_result.md`.

### 1.2. Зависимости
- **Backend:** `pip install -r /app/backend/requirements.txt` — 136 пакетов, включая `litellm`, `emergentintegrations`, `sentence-transformers`, `torch`, `motor`, `slowapi`, `stripe`, `python-socketio`, `resend`, `google-genai`. Все импорты успешно резолвятся.
- **Frontend:** clean `yarn install` (lockfile отсутствовал) — 47 dependencies, ~495 MB node_modules. Все expo-* пакеты (audio, auth-session, blur, clipboard, location, notifications, router 6.0.23, splash-screen и т.д.) установлены.

### 1.3. Решённые проблемы дискового пространства
- `/dev/nvme0n3` (9.8 GB) — общий volume для `/app`, `/root`, `/var/log`, `/data/db`, `/etc/supervisor`.
- После полной установки бэкенда + фронтенда диск был 100% заполнен.
- Очищено: `/root/.cache/pip` (2.9 GB), `/root/.npm` (362 MB), `/root/.cache/node-gyp` (54 MB). Освобождено **~3.3 GB**.
- Это критично для того, чтобы `sentence-transformers` (`all-MiniLM-L6-v2`, ~91 MB) мог скачаться при первом обращении — иначе семантический поиск шаблонов проектов падает в lifespan startup.

### 1.4. Sentence-transformer модель (HF)
- При первом старте бэкенд лениво загружает `sentence-transformers/all-MiniLM-L6-v2` через `huggingface_hub`. При нехватке места — `Embedding error for template …` циклически.
- После очистки кэша backend стартует чисто и `GET /api/healthz` отвечает `{"status":"ok"}` за <50 ms.

### 1.5. Сидинг данных
При старте бэкенд автоматически создаёт:
- Mock payment providers, portfolio cases, admin user
- 5 quick-access пользователей: `admin@`, `john@`, `client@`, `multi@`, `tester@` (все `@atlas.dev`)
- 6 dev pool девелоперов (alice, marco, priya, luka, sara, diego) разных грейдов
- 89 модулей, 81 QA-решение, 6 канонических money-state
- Демо-проект `Acme Analytics Platform` для client@atlas.dev (3 модуля)
- `mock_seed`: 2 проекта, 7 модулей, 6 earnings, 6 invoices, 2 deliverables, 3 tickets, 3 notifications, 7 cognition_actions
- `seed_replay` boot_replay_v1: 14 дней / medium intensity / 70 событий (16 overrides, 14 qa_fail, 19 reassign, 12 overload, 9 suppression)
- Tester seed: 5 валидаций + 1 issue
- L0/L1 backfill для модулей и users

---

## 2. Архитектура — что есть в кодовой базе

### 2.1. Backend (`/app/backend`, **91 .py файл, 27 373 строки в `server.py`**)

Основная точка входа — гигантский `server.py` + модульные слои:

| Группа | Модули |
|--------|--------|
| **Auth / Identity** | `auth_otp.py`, `two_factor.py`, `google_auth.py`, `account_layer.py` |
| **Money substrate (Phase 2A/2B/2C)** | `money_runtime.py`, `money_ledger.py`, `money_bridge.py`, `money_replay.py`, `money_projections.py`, `money_divergence.py`, `escrow_layer.py`, `escrow_api.py`, `client_escrow.py`, `payout_layer.py`, `earnings_layer.py`, `dev_wallet_reader.py` |
| **Domain organization** | `domains/money/` (`models.py`, `policies.py`, `events.py`, `service.py`) |
| **Acceptance / assignment** | `acceptance_layer.py`, `assignment_engine.py`, `decision_layer.py`, `decomposition_engine.py`, `client_acceptance.py` |
| **Work execution** | `work_execution.py`, `module_execution.py`, `module_motion.py`, `dev_work.py`, `event_engine.py`, `time_tracking_layer.py` |
| **Intelligence / brains** | `developer_brain.py`, `developer_intelligence.py`, `team_intelligence.py`, `intelligence_layer.py`, `intelligence_api.py`, `revenue_brain.py`, `revenue_brain_lib.py`, `execution_intelligence.py`, `competitor_analyzer.py` |
| **Admin (cockpit + full)** | `admin_actions.py`, `admin_control.py`, `admin_integrations.py`, `admin_llm_settings.py`, `admin_mobile.py`, `admin_production.py`, `admin_risk.py`, `admin_system.py`, `admin_team.py`, `admin_users_layer.py` |
| **Client surface** | `client_workspace.py`, `client_operator.py`, `client_operator_opportunities.py`, `client_costs.py`, `client_transparency.py` |
| **Team / operator** | `team_api.py`, `team_balancer.py`, `team_layer.py`, `operator_engine.py` |
| **Pricing / market** | `pricing_engine.py`, `market_bootstrap.py`, `validation_campaigns.py` |
| **Integrations (boundary)** | `integrations/` (base, registry, mocks, live_adapters, ai, mail, oauth, payment, storage), `cloudinary_service.py`, `email_service.py`, `stt_service.py`, `push_sender.py` |
| **Payment providers** | `payment_providers/` (base, mock, stripe_provider, wayforpay) |
| **Compat / mobile bridge** | `compat_routes.py`, `mobile_adapter.py`, `etap3_routes.py` |
| **Background daemons** | `overdue_daemon.py`, `overdue_engine.py`, `auto_guardian.py`, `reputation_decay.py`, `flow_control.py` |
| **API surface** | `api/adapters/web_adapter.py` |
| **Shared kernel** | `shared/` (config, constants, errors, events, logging), `middleware/` (request_id, error_shape, compat_observability) |
| **Infra** | `infrastructure/db/` (repositories: base, users, projects, modules, money) |

**688 endpoint'ов**, наиболее насыщенные ветки:

```
/api/admin/*               251 endpoint
/api/developer/*            72
/api/client/*               65
/api/modules/*              23
/api/account/*              23
/api/execution-intelligence 19
/api/auth/*                 18
/api/ai/*                   13
/api/mobile/*               10
/api/system/*               10
+ escrow/payments/billing/validation/tester/marketplace/contracts ...
```

### 2.2. Frontend Expo (`/app/frontend`)

**93 `.tsx` route файла**, организовано по ролям (expo-router file-based):

```
app/
├── _layout.tsx, +html.tsx, index.tsx
├── auth.tsx, gateway.tsx, two-factor-challenge.tsx, two-factor-recovery.tsx
├── account.tsx, profile.tsx, settings.tsx, documents.tsx
├── activity.tsx, chat.tsx, inbox.tsx, hub.tsx, operator.tsx
├── describe.tsx, estimate-improve.tsx, estimate-result.tsx, project-booting.tsx
├── admin/        (15 экранов: home, master, control, team, users, finance, qa, marketplace, contracts, templates, integrations, validation, execution-console, inbox, projects/[id], profile)
├── client/       (workspace, billing, contract, deliverable, control, activity, …)
├── developer/    (полная dev-поверхность)
├── tester/       (Stage 4 — home, validation list, detail, history)
├── operator/, lead/, contract/, project/, help/, workspace/
```

Routing: cookie-based auth через `withCredentials`, `EXPO_PUBLIC_BACKEND_URL` для API. Кастомные шрифты (Instrument Sans, JetBrains Mono).

### 2.3. Web (`/app/web` — React 18 CRA + craco + Tailwind + Radix)

- 243 файла `.js/.jsx/.tsx/.ts`
- `pages/`, `components/`, `contexts/`, `hooks/`, `layouts/`, `lib/`, `runtime/`, `runtime-client/`, `stubs/`, `theme/`
- ⚠️ **`web/build/` отсутствует.** Бэкенд сервит `/api/web-ui/*` из `WEB_BUILD_DIR`, который пуст. Пока веб-админка недоступна — нужно прогнать `cd /app/web && yarn install && yarn build`.

### 2.4. Packages / Tools

- `/app/packages/design-system` — собственная дизайн-система.
- `/app/packages/runtime-client` — клиент-рантайм, общий для web и mobile (см. `audit/RUNTIME_CLIENT_MIGRATION_COMPLETE.md`).
- `/app/scripts/` — observability и аналитика (`escrow_smoke_trace.py`, `money_divergence.py`, `dev-wallet-projection-stability.py`, `classifier-v2-probe.py`, `pr0_*.py`).
- `/app/tools/` — `stage_3_1_baseline.py`, `stage_3_2_heatmap.py` (compat-route heatmap инструменты).

### 2.5. Документация

- `/app/audit/` — **84 .md файла**: контракты, чартеры, фазовые acceptance reports (Phase 0 → 2A → 2B PR1-PR3 → 2C B1-B4 → D replay backfill), смок-трейсы (escrow, withdrawal, work execution), governance docs.
- `/app/docs/` — 12 файлов: product scope freeze + amendment 1, charters, синтетический корпус + 100 findings, runtime contracts.

---

## 3. Аудит зависимостей и интеграций

### 3.1. Конфигурация (`.env`)

**Backend `.env`** содержит только:
```
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
```

**Отсутствующие ключи (всё работает в MOCK)**:
- `RESEND_API_KEY` → email отключён (`email_service - WARNING - RESEND_API_KEY not set`)
- `CLOUDINARY_*` → `CLOUDINARY: MOCK mode (no API keys yet — files saved locally)`
- `STRIPE_SECRET_KEY`, `WAYFORPAY_*` → payment в mock через `payment_providers/mock.py`
- `GOOGLE_CLIENT_ID/SECRET` → google_auth dormant
- `EMERGENT_LLM_KEY` → нужен для `litellm` / `emergentintegrations` чатов (Claude, GPT, Gemini); сейчас не задан
- `HF_TOKEN` → опционально, ускоряет загрузку `sentence-transformers`
- `INTEGRATIONS_LIVE_ENABLED` → **не задан**, поэтому все live-адаптеры дормантны (контракт `Этап 5.0`)

**Frontend `.env`** настроен корректно. Защищённые переменные (`EXPO_PACKAGER_*`, `EXPO_TUNNEL_*`) на месте.

### 3.2. Граничный слой (`integrations/`)

Архитектура соответствует `audit/RUNTIME_CLIENT_MIGRATION_COMPLETE.md`:

- `integrations/base.py` — общий контракт (Capability, AvailabilityMode, CapabilityState)
- `integrations/registry.py` — единая точка получения провайдеров
- `integrations/mocks.py` — детерминированные моки (всегда доступны)
- `integrations/live_adapters.py` — wrappers вокруг Stripe / WayForPay / Cloudinary / Resend / Google OAuth / emergentintegrations
- Активация: `INTEGRATIONS_LIVE_ENABLED=1` **И** наличие ключей → live, иначе mock с честным `reason`
- Бизнес-логика не импортирует SDK напрямую — только через registry

✅ **Это правильный изоляционный шаблон**; live-flip требует только установки ключей + одной переменной.

### 3.3. LLM-слой

`server.py` импортирует:
- `litellm` (мульти-провайдерный proxy)
- `from emergentintegrations.llm.chat import LlmChat, UserMessage`
- `from emergentintegrations.llm.utils import get_integration_proxy_url`

→ для активации Universal/Emergent LLM Key понадобится:
```
EMERGENT_LLM_KEY=sk-emergent-...
INTEGRATION_PROXY_URL=https://integrations.emergentagent.com   # уже в supervisord.conf
```
Эта связка покрывает Claude (sonnet/opus/haiku), Gemini, GPT, image-gen (gpt-image-1, nano-banana), whisper-1, OpenAI TTS, Sora 2.

---

## 4. Аудит запуска и стабильности

### 4.1. Лог boot-последовательности (выдержка)

```
[email_service] WARNING - RESEND_API_KEY not set — email delivery disabled
[auth_otp]     INFO - AUTH OTP init: DEV_MODE=False mail_provider=mock-mail mail_mode=mock
[cloudinary]   INFO - CLOUDINARY: MOCK mode
[server] INFO - Seeded mock providers, portfolio cases, admin user, 5 quick-access users
[server] INFO - DEV POOL: 6 devs, 89 modules, 81 qa decisions, 6 canonical money states
[server] INFO - Seeded demo project 'Acme Analytics Platform' (3 modules)
[mock_seed]    INFO - MOCK SEED: 2 projects, 7 modules, 6 earnings, 6 invoices …
[seed_replay]  INFO - SEED_REPLAY label=boot_replay_v1 70 events
[server] INFO - TESTER SEED: 5 validations + 1 issue → tester@atlas.dev
[event_engine] INFO - EVENT ENGINE: Background scanner started (15 min interval)
[money_bridge] INFO - MONEY BRIDGE: MoneyService initialised (Phase 2B PR-1)
[server] INFO - MONEY LEDGER: indexes ensured
[server] INFO - COMPETITOR CACHE: TTL index ensured (24h)
[validation_campaigns] INFO - VALIDATION CAMPAIGNS: indexes ensured
[auto_guardian] INFO - GUARDIAN: loop started (interval 120s)
[module_motion] INFO - MODULE MOTION: loop started (interval 15s)
[operator_engine] INFO - OPERATOR SCHEDULER: started (300s interval)
INFO: Application startup complete.
```

### 4.2. Background loops (важно для аудита)

| Daemon | Интервал | Назначение |
|--------|----------|------------|
| Event engine scanner | 15 мин | Детектирование событий по модулям |
| Auto-guardian | 120 с | Money/escrow guardrails |
| Module motion | 15 с | Перемещение модулей по статусам |
| Operator scheduler | 300 с | Назначение и балансировка |
| Overdue daemon | через `overdue_daemon.py` (cron-обёртка `run_overdue_check.sh`) | Просрочки |

### 4.3. Известные warnings/ошибки

| Категория | Severity | Файл/контекст |
|-----------|----------|---------------|
| Hot-reload watch list (~150 файлов) → uvicorn `--reload` инициирует множественные релоады | INFO | dev-only, в проде убрать `--reload` |
| Sentence-transformer first-load qq downloads 91 MB | WARNING | Нужно ≥150 MB свободного места при первом запуске |
| Expo Web: `Invalid style property "borderColor" "var(--t-primary)44"` — CSS variables не поддержаны react-native-web | WARN | Не блокирует, но засоряет логи |
| Expo Web: `props.pointerEvents is deprecated`, `shadow* deprecated` | WARN | Стилевые мелочи, исправляется в RN 0.81 |
| `expo-notifications: Listening to push token changes is not yet fully supported on web` | INFO | Push работает только на нативе |
| `test_call_sites.py` — `pytest-asyncio` не установлен, тесты `@pytest.mark.asyncio` падают на ImportError | LOW | Нужно `pip install pytest-asyncio` |

### 4.4. Smoke-проверка endpoint'ов

```bash
GET  /api/healthz                          → 200 {"status":"ok"}
GET  /api/auth/me   (anonymous)            → 401 {"code":"unauthorized"}
POST /api/auth/quick {"email":"admin@..."} → 200 {full user object, role=admin, …}
GET  /api/integrations/manifest            → 200 (фронт обращается на boot)
```

Базовый поток (anonymous → quick-login → cookie-session) работает.

---

## 5. Аудит фронтенд-фаз

Сверка с `docs/product-scope-freeze.md` (FROZEN на 2026-05-09):

| Решение | Состояние |
|---------|-----------|
| **D1** — Expo admin = operational cockpit (5 экранов) | ✅ Реализовано: `admin/home, qa, validation, finance, profile`. Дополнительно — расширенный набор (15 экранов), что превышает frozen-scope (`master, control, team, users, marketplace, contracts, templates, integrations, execution-console, inbox, projects/[id]`). См. п.7. |
| **D2** — Expo tester = Stage 4 (4 экрана) | ✅ Папка `app/tester/` присутствует, бэкенд `/api/tester/* × 5` + `/api/validation/* × 8` готов, сидинг tester@atlas.dev есть |
| **D3** — Lead = conversion surface only | ✅ `app/lead/` есть, отдельной роли в auth нет |

⚠️ **Расхождение по D1**: на Expo помимо 5 «cockpit» экранов добавлены полнофункциональные admin-экраны (team, users, marketplace и т.д.). Это нарушение `Product Scope Freeze` (требуется операционное обоснование). См. рекомендации.

---

## 6. Аудит безопасности и денежного домена

### 6.1. Money substrate (Phase 2A → 2C)

По документам в `/app/audit/` substrate **завершён** (`PHASE_2A_MONEY_DOMAIN_CLOSEOUT_2026-05-19.md`, `MONEY_SUBSTRATE_COMPLETION_MILESTONE.md`, `SUBSTRATE_SEALING_REVIEW_SIGNOFF.md`):
- Single source of truth: `domains/money/service.py`
- Канонические money_states (escrow / earnings / payout) сидируются для 6 dev pool пользователей.
- Bridges: `PHASE_2B_PR1_ESCROW_BRIDGE`, `PR2_EARNINGS_BRIDGE`, `PR3_PAYOUT_BRIDGE` зафиксированы.
- Phase 2C B-серия: dev_wallets projection (B1) → stability (B2/B3) → read switch (B3) → acceptance (B4.0 → B4.5) → writer removal plan.
- Divergence Observer (B4.5, passive): `money_divergence.py` + `DIVERGENCE_PASSIVE_OBSERVER_CONTRACT.md`.

### 6.2. Authentication

- `auth_otp.py`: email/OTP + password fallback. Mock-mail активен.
- `two_factor.py`: TOTP/QR via `pyotp`. Endpoints `/api/auth/two-factor/*`.
- `google_auth.py`: OAuth, dormant без `GOOGLE_CLIENT_ID/SECRET`.
- Сессии — cookie-based, fastapi через httpx-style cookie.
- `password_hash` использует `bcrypt` (видно в дампе admin-объекта: `$2b$12$3w79…`).

### 6.3. Risk / compliance

- `admin_risk.py`, `admin_production.py` — слои для оценки рисков и продакшен-флагов.
- `MONEY_BLAST_RADIUS.md` + `MONEY_AUTHORITY_CHARTER.md` уже зафиксированы.

✅ Дизайн отделён правильно, бизнес-логика не вызывает SDK напрямую.

---

## 7. Найденные проблемы и рекомендации

### 7.1. КРИТИЧЕСКИЕ (блокируют next milestone)

| # | Проблема | Файл/контекст | Рекомендация |
|---|----------|---------------|---------------|
| C1 | Веб-клиент не собран — `/app/web/build/` отсутствует | `web/`, backend ищет `WEB_BUILD_DIR` | `cd /app/web && yarn install --network-timeout 600000 && yarn build`. Понадобится ~1.5–2 GB free disk + ключи в `web/.env` (если нужны) |
| C2 | Диск `/dev/nvme0n3` (9.8 GB) почти полный после установки. Любая дополнительная зависимость или web-build может вызвать ENOSPC | df = 67% после очистки кэшей | (1) Не возвращать удалённые pip/npm caches; (2) монтировать `node_modules`/HF-кэш на другой volume; (3) до web-build освобождать ещё |

### 7.2. ВАЖНЫЕ (нужно решить до live-flip)

| # | Проблема | Рекомендация |
|---|----------|---------------|
| W1 | Все интеграции в MOCK (`RESEND`, `CLOUDINARY`, `STRIPE`, `WAYFORPAY`, `GOOGLE`, `EMERGENT_LLM_KEY`) | Перед прод-флагом — собрать ключи у клиента и заполнить `backend/.env`. Live-flip управляется единственной переменной `INTEGRATIONS_LIVE_ENABLED=1` — соответствует контракту в `integrations/live_adapters.py` |
| W2 | Expo admin превышает frozen-scope D1 | (1) Либо оформить amendment в `docs/product-scope-freeze.md` с операционным обоснованием; (2) либо feature-flag-гейт лишние экраны на mobile и оставить их только в web-админке |
| W3 | `pytest-asyncio` не в `requirements.txt`, async-тесты не запускаются | Добавить `pytest-asyncio==0.23.*` в `backend/requirements.txt` через `pip install ... && pip freeze > requirements.txt` |
| W4 | `server.py` = 27 373 строки — монолит | По `ARCHITECTURE_DECOMPOSITION_AUDIT_2026-05-19.md` уже стартовала декомпозиция (`domains/`, `infrastructure/`, `services/`). Продолжать вытаскивать роуты в APIRouter'ы — обещано в `PR0_ACCEPTANCE_REPORT_2026-05-14.md` |

### 7.3. КОСМЕТИКА

| # | Проблема | Рекомендация |
|---|----------|---------------|
| M1 | RN-web warnings (`var(--t-primary)44`, `shadow*`, `pointerEvents`) | Прогнать дизайн-систему через линтер, заменить CSS-vars в `borderColor` на статический hex |
| M2 | uvicorn `--reload` смотрит ~150 файлов → череда reloads | На staging — выключить `--reload`, использовать gunicorn (`gunicorn_conf.py` уже готов) |
| M3 | `/api/auth/me` для гостя возвращает 401 — корректно, но фронт лога́ет это как ошибку | Перевести на silent-401 |

---

## 8. Тест-credentials

Записаны в `/app/memory/test_credentials.md` для testing-agent и fork-agents.

Quick-login (без пароля): `POST /api/auth/quick {"email":"<one of>"}`

```
admin@atlas.dev      (admin)        — полный admin
john@atlas.dev       (developer)
client@atlas.dev     (client)       — демо-проект Acme Analytics Platform
multi@atlas.dev      (developer)
tester@atlas.dev     (tester)       — 5 валидаций + 1 issue
alice.kim@atlas.dev  (dev senior)
marco.rossi@atlas.dev (dev senior)
priya.shah@atlas.dev  (dev middle)
luka.horvat@atlas.dev (dev middle)
sara.chen@atlas.dev   (dev junior)
diego.silva@atlas.dev (dev senior)
```

---

## 9. Сервисы и порты (production runtime)

| Сервис | Порт | Команда (supervisor) | Логи |
|--------|------|----------------------|------|
| backend | 8001 | `uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1 --reload` | `/var/log/supervisor/backend.{err,out}.log` |
| expo (Metro) | 3000 (tunnel) | `yarn expo start --tunnel --port 3000` | `/var/log/supervisor/expo.{err,out}.log` |
| mongodb | 27017 | `mongod --bind_ip_all` | `/var/log/mongodb.{err,out}.log` |
| nginx-code-proxy | 80 | (Kubernetes ingress: `/* → :3000`, `/api/* → :8001`) | — |
| code-server | (опц.) | dev IDE | — |

**External URL:** `https://mobile-app-staging-5.preview.emergentagent.com`

---

## 10. Что готово к следующей итерации

✅ Backend поднимается, отвечает, сидит данные, фоновые daemon'ы крутятся
✅ Expo Metro собирает bundle, web preview рендерится (EVA-X лендинг визуально корректен)
✅ MongoDB подключён, 89 модулей + 6 dev wallets + 5 валидаций в DB
✅ Auth quick-login работает
✅ Все 688 API endpoint'ов зарегистрированы (`GET /openapi.json` ok)
✅ Интеграционный boundary-layer (registry/mocks/live_adapters) готов к live-flip
✅ Test_credentials.md обновлён

## 11. Что нужно от вас, чтобы продолжить

1. **Подтверждение области работ** для следующей фазы — например:
   - Web-сборка и Web-админка online?
   - Подключаем live-интеграции (какие ключи у вас уже есть)?
   - Стабилизация frozen-scope (D1 amendment)?
   - Что-то конкретное из roadmap `audit/PHASE_*` ?
2. **Ключи** (опционально, по приоритету):
   - `EMERGENT_LLM_KEY` — для AI chat / image / TTS (через Universal Key)
   - `STRIPE_SECRET_KEY` (или test-key из pod env есть — будет использован)
   - `RESEND_API_KEY` / SendGrid — для transactional email
   - `CLOUDINARY_CLOUD_NAME/API_KEY/SECRET` — для медиа
   - `GOOGLE_CLIENT_ID/SECRET` — для OAuth (или Emergent-managed Google Auth)

---

**Развёртывание завершено. Аудит зафиксирован.**
Готов продолжать по вашему сигналу.
