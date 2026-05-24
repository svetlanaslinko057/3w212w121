# Deployment Audit — Full redeploy, 20 May 2026

Repo: `svetlanaslinko057/2434343242423423`
Container: `/dev/nvme0n3` shared partition (10 GB) mounted at `/app`, `/root`, `/etc/supervisor`, `/var/log`, `/data/db`

## 0. TL;DR

Полный передеплой выполнен с нуля. Все три поверхности работают:

| Layer            | Status | URL                                                                                     |
|------------------|--------|-----------------------------------------------------------------------------------------|
| Backend (FastAPI)| ✅ UP  | `https://app-preview-mobile-35.preview.emergentagent.com/api/*` (688 роутов)            |
| Web admin (CRA)  | ✅ UP  | `https://app-preview-mobile-35.preview.emergentagent.com/api/web-ui/` (530 kB gzipped)  |
| Expo mobile      | ✅ UP  | `https://app-preview-mobile-35.preview.emergentagent.com/` (1561 модулей, tunnel)       |
| MongoDB          | ✅ UP  | `mongodb://localhost:27017/test_database` (38 коллекций засидены)                       |

Все 4 ролевые quick-access юзера логинятся: `admin/john/multi/client/tester @atlas.dev` (см. `/app/memory/test_credentials.md`).

Интеграции **MOCK** по дизайну: `payment(stripe)/mail(resend)/storage(cloudinary)/oauth(google)/ai(emergent_llm)` — манифест `GET /api/integrations/manifest` честно сообщает, какой ключ отсутствует.

## 1. Что было сделано в эту сессию

### 1.1 Sync репо в `/app`
```
git clone https://github.com/svetlanaslinko057/2434343242423423.git /tmp/repo_audit
rsync -a --exclude={.git,.emergent,node_modules,.env,__pycache__,*.pyc} /tmp/repo_audit/ /app/
```
Защищённые `.env` (backend + frontend) сохранены через бэкап → восстановление.

### 1.2 Disk pressure — резолв
**Симптом:** `df -h /app` показал `9.8G/9.8G (100%)` после первой попытки pip install.
**Причина:** `/root/.cache` (pip/yarn кэши, шарят тот же `/dev/nvme0n3`) разросся до 2.9 GB.
**Фикс:** `pip cache purge` → +2.9 GB свободно, диск стал `7.0G/9.8G (72%)`.

### 1.3 Backend deps
`pip install --no-cache-dir -r requirements.txt` — установлены `socketio`, `bcrypt`, `motor`, `emergentintegrations`, `sentence-transformers`, `boto3`, `cloudinary`, `resend`, `google-genai` и др. Boot успешный, `socketio` ImportError разрешён авто-reloader-ом.

### 1.4 Frontend (Expo) deps
`yarn install` в `/app/frontend` — все 1561 модуль Expo SDK 54, RN 0.81.5, expo-router 6.0.22. Метро bundler стартует за ~10s, tunnel поднимается.

### 1.5 Web (CRA) build
`/app/web/build` отсутствовал (gitignore). Установлены 935 пакетов через `yarn install`. Билд `DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false yarn build` падал из-за лазового `require('@react-native-async-storage/async-storage')` в shared adapter — пофикшено webpack-алиасом на стаб:

**Изменено:** `craco.config.js`
```js
alias: {
  '@': path.resolve(__dirname, 'src'),
  '@react-native-async-storage/async-storage': path.resolve(__dirname, 'src/stubs/empty.js'),
},
```
**Создано:** `/app/web/src/stubs/empty.js` (no-op экспорт).

Итог: бандл `main.bfd5f154.js = 529.9 kB gzip`. FastAPI сервит `/api/web-ui/` корректно (200).

### 1.6 Сервисы перезапущены
```
supervisorctl restart mongodb backend expo
```
Все RUNNING.

### 1.7 Background loops подняты
В логе backend видно:
```
GUARDIAN: loop started (interval 120s)
MODULE MOTION: loop started (interval 15s)
OPERATOR SCHEDULER: started (300s interval)
AUTO_BALANCER: cycle complete — overloaded=0 priority=0 moves=0
AUTONOMY: scan → {evaluated:0, created:0, executed:0}
EVENT ENGINE: Background scanner started (15 min interval)
MONEY BRIDGE: MoneyService initialised (Phase 2B PR-1)
INTELLIGENCE: periodic recompute → {recomputed: 8}
```

### 1.8 Seed данные
```
DEV POOL: seeded 6 devs, 89 modules, 81 qa decisions
MOCK SEED: 2 projects, 7 modules, 6 earnings, 6 invoices, 2 deliverables, 3 tickets, 3 notifications
SEED REPLAY: boot_replay_v1 → 70 events (overrides=16, qa_fail=14, reassign=19, overload=12, suppression=9)
SCOPE TEMPLATES: 4
INTEGRATIONS SEED: wayforpay, stripe, app, payments blocks
TESTER SEED: 5 validations + 1 issue
```

## 2. Архитектурный обзор

### 2.1 Backend (`/app/backend`, ~95k строк Python)

| Зона                       | Модуль(и)                                              | Назначение                                              |
|----------------------------|--------------------------------------------------------|--------------------------------------------------------|
| HTTP server                | `server.py` (~30k строк)                               | Главный FastAPI, монтирует все роутеры                  |
| **Money domain** (Phase 2C)| `money_bridge.py`, `money_ledger.py`, `money_runtime.py`, `money_projections.py`, `money_divergence.py`, `money_replay.py`, `domains/money/` | Single-source-of-truth для earnings/escrow/payout; проекция dev_wallets ходит через ledger events |
| Escrow / Payout            | `escrow_layer.py`, `escrow_api.py`, `payout_layer.py`, `dev_wallet_reader.py` | B-class flows (Phase 2B PR-1/2/3 — bridges)             |
| Auth                       | `server.py:auth/*` + `google_auth.py` + `auth_otp.py` + `two_factor.py` | bcrypt + cookie sessions + 4 ролей + 2FA + OTP/magic-link |
| Acceptance / Workflow      | `acceptance_layer.py`, `client_acceptance.py`, `work_execution.py` (1004 строки) | Module lifecycle: assign → in_progress → qa → done       |
| QA                         | `qa_layer.py`, `module_qa_decision`                    | Approve/reject + canonical EVENT_QA_APPROVED            |
| Intelligence               | `developer_intelligence.py`, `team_intelligence.py`, `execution_intelligence.py` (136k) | Periodic recompute scores                                |
| Autonomy / Auto-balancer   | `autonomy_layer.py`, `team_balancer.py`, `operator_engine.py`, `auto_guardian.py`, `module_motion.py` | Background loops                                         |
| Admin surfaces             | `admin_*.py` (12 файлов: actions, control, integrations, llm_settings, mobile, production, risk, system, team, users_layer) | 251 admin route                                          |
| Client surfaces            | `client_*.py` (5 файлов: acceptance, costs, escrow, operator, operator_opportunities, transparency, workspace) | 65 client routes                                         |
| Dev surfaces               | `dev_work.py`, `developer_*.py` (brain, economy, intelligence, support) | 72 developer routes                                      |
| Decomposition              | `decomposition_engine.py`, `pricing_engine.py`, `scaling_engine.py`, `competitor_analyzer.py` | Estimate flow                                            |
| Integrations               | `integrations/` (registry, live_adapters, mocks, mail, payment, storage, oauth, ai) | MOCK режим по умолчанию                                  |
| Compat / Middleware        | `compat_routes.py`, `middleware/compat_observability.py` | Legacy redirects                                          |
| Mobile adapter             | `mobile_adapter.py`                                    | 10 mobile-specific endpoints                              |

**Domain покрытие (топ-25 по числу роутов):**
- `/api/admin/*` — 251
- `/api/developer/*` — 72
- `/api/client/*` — 65
- `/api/modules/*` — 23
- `/api/account/*` — 23
- `/api/execution-intelligence/*` — 19
- `/api/auth/*` — 18
- `/api/ai/*` — 13
- `/api/system/*` — 10
- `/api/mobile/*` — 10
- `/api/projects/*`, `/api/validation/*`, `/api/provider/*`, `/api/marketplace/*`, `/api/contracts/*` — 8 каждый
- `/api/notifications/*`, `/api/validator/*`, `/api/intelligence/*` — 7 каждый
- `/api/requests/*`, `/api/billing/*`, `/api/escrow/*`, `/api/dev/*`, `/api/operator/*`, `/api/bootstrap/*` — 6 каждый

### 2.2 Frontend Expo (`/app/frontend`, ~82 экранов)

- expo-router 6 / SDK 54 / RN 0.81.5 / React 19.1
- Структура: `app/` (file-based routing), `src/runtime/` (middleware client), `src/admin/` (5-tab cockpit + 8 drill-downs).
- Storage через `@/src/utils/storage` (унифицированный API над AsyncStorage).
- Tunnel-режим (NGROK_AUTHTOKEN в supervisor env).
- Bundle metric: **1561 модулей** при первом запросе `/`.

### 2.3 Web admin (`/app/web`, CRA)

- React 19 + CRA + craco + tailwind + Radix UI (full kit).
- Symlink `/app/web/src/runtime-client` → `/app/packages/runtime-client/src` (monorepo).
- Build: **529.9 kB gzip main + 20.56 kB css**.
- Сервится FastAPI на `/api/web-ui/` (homepage в package.json).

### 2.4 Packages (`/app/packages`)

| Package           | Назначение                                                    |
|-------------------|---------------------------------------------------------------|
| design-system     | Shared Tailwind/Radix tokens + primitives                     |
| runtime-client    | Shared HTTP middleware (token-prime, telemetry, retry, capability-gate) — symlinked в web + Expo |

## 3. Состояние данных (MongoDB)

| Collection                | Count | Notes                                                   |
|---------------------------|-------|--------------------------------------------------------|
| users                     | 12    | 4 quick-access + 6 seeded devs + 2 extras              |
| projects                  | 3     |                                                        |
| modules                   | 99    | 89 dev pool + 7 mock + 3 Acme demo                     |
| qa_decisions              | 105   | 81 dev pool + 24 replay                                |
| invoices                  | 6     | inc. `inv_e0e0a556e9be` paid $1200                     |
| dev_earning_log           | 6     | Canonical earnings (idempotent on module_id)           |
| money_ledger_events       | 30    | Single source of truth                                  |
| dev_wallets               | 1     | Legacy orphan canary (john) — drifted-by-design        |
| portfolio_cases           | 5     |                                                        |
| scope_templates           | 4     |                                                        |
| validation_tasks          | 5     |                                                        |
| validation_issues         | 1     |                                                        |
| cognition_overrides       | 34    | Replay seed                                            |
| support_tickets           | 3     |                                                        |
| auto_actions              | 5     |                                                        |
| system_actions_log        | 51    |                                                        |
| developer_scores          | 8     |                                                        |
| client_notifications      | 3     |                                                        |
| payouts                   | 3     |                                                        |
| ... (всего 38 коллекций)  |       |                                                        |

## 4. Integration manifest snapshot

| Capability | Mode         | Policy | Provider       | Reason for mock                                            |
|------------|--------------|--------|----------------|-----------------------------------------------------------|
| payment    | mock         | hard   | mock-payment   | `STRIPE_SECRET_KEY` отсутствует                            |
| mail       | mock         | soft   | mock-mail      | `RESEND_API_KEY` отсутствует                               |
| storage    | mock         | soft   | mock-storage   | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` отсутствуют |
| oauth      | unavailable  | hard   | mock-oauth     | `GOOGLE_CLIENT_ID` отсутствует                             |
| ai         | mock         | soft   | mock-ai        | `EMERGENT_LLM_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` отсутствуют |

Чтобы поднять реальные — добавить соответствующие переменные в `/app/backend/.env` и рестартнуть backend. Никаких хардкодов, никаких фолбеков — fail-fast при отсутствии ключа.

## 5. Что нужно знать перед следующим шагом

### 5.1 Pre-existing warnings (НЕ баги, подтверждено в PRD)
- `Invalid borderColor` warning от RN-Web на первой загрузке (CSS-vars в hex)
- WS auth-token 401 до логина
- `[expo-notifications] Listening to push token changes is not yet fully supported on web` — невозможно фиксить
- `"shadow*" style props are deprecated. Use "boxShadow"` — будет полечен на стороне expo

### 5.2 Что НЕ установлено / в mock-режиме
- Все 5 capabilities интеграций (см. секцию 4).
- HuggingFace token не задан → sentence-transformers скачивает model unauthenticated (без rate limit issue пока).
- Stripe test key есть в pod env, но не подключён в `.env` (нужно явно).

### 5.3 Disk usage
```
/dev/nvme0n3   9.8G   7.3G  2.5G  75%  (после полного билда)
```
Запас 2.5 GB. Когда понадобится повторный билд web — может снова упереться в лимит, рекомендую периодически `pip cache purge && yarn cache clean`.

### 5.4 Что покрыто и доступно (smoke)
- ✅ `POST /api/auth/login` для всех 4 ролей
- ✅ `GET /api/integrations/manifest`
- ✅ `GET /api/web-ui/` (CRA build)
- ✅ `GET /` (Expo welcome screen — `Build real products. Not tasks.`)
- ✅ Background loops логируются

### 5.5 Что НЕ покрыто smoke-ом сегодня (отложено до следующей итерации)
- E2E flow: гость → describe → estimate → project-booting (mobile + web)
- Admin cockpit drill-down (8 экранов в Expo)
- Documents screen → `/contracts/my` + `/client/invoices`
- Money flow: client approve module → dev_earning_log → projection rebuild
- Validator surface (tester role)

## 6. Ключевые изменения файлов в эту сессию

| Файл                                   | Изменение                                                          |
|----------------------------------------|-------------------------------------------------------------------|
| `/app/web/craco.config.js`             | Добавлен alias для `@react-native-async-storage/async-storage` → стаб |
| `/app/web/src/stubs/empty.js`          | Создан стаб для лазового require в RN-only коде                     |
| `/app/web/build/*`                     | Создан билд (529.9 kB gzip)                                         |
| `/app/memory/test_credentials.md`      | Создан с 4 ролями и паролями                                        |
| `/app/audit/DEPLOYMENT_AUDIT_2026-05-20_full_redeploy.md` | Этот документ                                  |

## 7. Готовность к следующему шагу

Система **готова к продолжению разработки**. Можно:

1. Добавлять/менять Expo экраны — Metro в watch (CI=true) mode → нужен restart на новый screen.
2. Добавлять/менять backend роуты — uvicorn `--reload` подхватит hot.
3. Менять web admin — пересобирать `cd /app/web && yarn build` + `supervisorctl restart backend` (FastAPI кэширует статику в памяти на boot).
4. Подключать реальные интеграции — добавить ключи в `/app/backend/.env`, рестарт backend, проверить manifest.

---
Автор: E1 main agent
Дата: 2026-05-20
Sha сессии: redeploy после полной потери `/app` post-rollback
