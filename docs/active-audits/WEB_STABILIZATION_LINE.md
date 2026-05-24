# ✅ Web Platform Stabilization Line — SEALED

> **Status:** ✅ SEALED
> **Phase:** Stabilization (post-substrate-sealed) — completed
> **Created:** 2026-02-FEB
> **Sealed:** 2026-FEB-24
> **Companion audit:** `WEB_AUDIT_2026-02-FEB__ACTIVE.md` (also closed)
> **Mirror:** `/app/memory/active_issues.md`
> **CI guard:** `python3 /app/web/scripts/audit/web_p6_master.py` → 0 failures

## ✅ Closeout summary (2026-FEB-24)

| Phase | Status | Artifact |
|---|---|---|
| WEB-P1 — Foundation | ✅ closed 2026-02-FEB | imports clean, dead pages archived |
| WEB-P2 — Route topology | ✅ closed 2026-02-FEB | 0 dup / 0 orphan / 0 guest-leak / 100% nav-route consistency |
| WEB-P3 — Single runtime-client | ✅ closed 2026-02-FEB | `web/scripts/audit/web_p3_guards.py` green |
| WEB-P4 — Backend Authority Contract | ✅ closed 2026-FEB-24 | `web_p4_guards.py` + 3 new backend summary endpoints |
| WEB-P5 — Error & UX Reliability | ✅ closed 2026-FEB-24 | RootErrorBoundary + ToastBridgeMount + runtime telemetry |
| WEB-P6 — Web Build Governance | ✅ closed 2026-FEB-24 | `web_p6_master.py` master CI guard |

After SEAL, new product features (AI / forecasting / payouts v2 / analytics / multi-currency) are unblocked.

The historical context below is preserved for reference.

---

## 0. Context

После того как **money substrate sealed** (Phase 2C-B B4.5 Divergence Passive Observer
zafiksirovan, dev_wallet writers removed), bottleneck проекта переехал наверх — в
**frontend / runtime architecture**.

Прошлая линия рисков (`survival engineering line`):

- "сломаем деньги / authority / balances"

Текущая линия рисков (`scaling architecture line`):

- "платформа начнёт гнить организационно через frontend"

Аудит `WEB_AUDIT_2026-02-FEB` это подтвердил:

- 3 поколения API-клиента одновременно;
- 25% pages — мёртвый код (27/107);
- 172 нарушения `ARCHITECTURE.md` (.reduce / .filter / .sort / Math.* / useMemo в pages);
- 53 страницы с silent-failure UX;
- `yarn build` зелёный только с `DISABLE_ESLINT_PLUGIN=true`.

Это **тот же split-brain, что был в money-domain**, но на UI-уровне:
UI повторно вычисляет truth, скрывает данные, делает локальные aggregates, silently diverges.

## 1. Цель линии

> **Web перестаёт быть набором страниц и становится controlled runtime surface.**

Web должен стать **тонким интерфейсом поверх backend authority**:

```
pages/components
      ↓
runtime-client (единственный transport)
      ↓
backend aggregates (source of truth)
```

## 2. Strategy — peel, lock, test

Стратегия точно та же, что закрывала money substrate:

1. **Peel** — снять обрыв
2. **Lock** — зафиксировать контракт
3. **Test** — добавить guard, защищающий от регрессии
4. Перейти к следующему слою

Не «сразу переписать web». Не «redesign». Не «новые фичи».

## 3. Шесть фаз — WEB-P1 → WEB-P6

### 🔴 WEB-P1 — Critical Repair (~2 часа)

Цель: убрать реальные runtime defects.

**Scope:**
1. Удалить orphan route `<Route path="marketplace" .../>` (`App.js:521`)
2. Удалить duplicate route `<Route path="validation" .../>` (`App.js:460`)
3. Починить `/api/developer/profile/earnings` 404 в `DeveloperProfileEnhanced.js:60`
4. Починить ESLint build (убрать workaround `DISABLE_ESLINT_PLUGIN=true`)
5. Убрать hardcoded Google OAuth Client ID fallback (`App.js:539-540`)
6. Убрать hardcoded marketing stats `24/12/$48.2K` (`AdminLoginPage.js:303-307`)

**Acceptance:**
- `yarn build` проходит **без** `DISABLE_ESLINT_PLUGIN=true`
- `/api/web-ui/*` отдаёт свежий build (HTTP 200)
- 0 orphan public routes
- 0 duplicate routes
- Developer Profile earnings не падает (нет 404 в Network)

---

### 🟡 WEB-P2 — Route & Page Hygiene (~1 день)

Цель: web не содержит брошенной миграции v1/v2.

**Scope:**
1. Удалить 18 unused imports из `App.js` (список — §2 аудита)
2. 9 orphan pages → `web/src/_archive/pages/` (список — §3 аудита):
   AdminMarketplaceQuality, AdminPricingCalibration, AdminPricingConfigPanel,
   AdminProjectReprice, AdminSystemUsers, BuilderAuth, ClientAuth, EntryPage,
   LandingPageLight
3. Для каждой archived page создать `ARCHIVE_REASON.md` (причина + дата + альтернатива)
4. Route matrix test:
   - все nav-links имеют Route
   - все internal routes wrapped в `<ProtectedRoute>`
   - guest не видит internal route

**Acceptance:**
- 0 unused imports в `App.js`
- 0 active orphan pages
- 0 guest-access internal pages
- nav ↔ route consistency = 100%

---

### 🟡 WEB-P3 — Runtime Client Consolidation (~3–5 дней) — **ключевой этап**

Цель: **один transport layer для всех страниц**.

Сейчас:
```
lib/api.js          = legacy, 0 usages
runtime-client      = 40 pages
raw axios           = 56 pages
raw fetch           = 4 pages
runtime-client x2 (web/src + packages/) — дубликат
```

Должно стать:
```
pages → runtime-client (single source) → backend
```

**Scope:**
1. Единственный источник: `/app/packages/runtime-client/src/`
2. `/app/web/src/runtime-client/` → симлинк / build-step alias / удалить
3. Запрет на `axios` и `fetch()` в `pages/` — ESLint rule
4. Мигрировать 60 страниц (56 axios + 4 fetch) → runtime-client
5. `lib/api.js`: либо удалить, либо превратить в тонкий compat wrapper над runtime-client

**Acceptance:**
- 0 `import axios` в `web/src/pages/`
- 0 `fetch(` в `web/src/pages/`
- 1 runtime-client source (один путь, единственная копия)
- 1 error envelope (один `ApiError` shape)
- 1 auth / cookie / session policy

---

### 🟡 WEB-P4 — Backend Authority Contract (~1 спринт)

Цель: **страницы не считают бизнес-данные**.

**Scope:** ввести backend aggregates, заменить 172 локальных деривации:

| Замена | Заменяет |
|--------|----------|
| `GET /api/client/billing/summary` | `ClientBillingOS.js:76-77` `.reduce(totalPaid/Pending)` |
| `GET /api/developer/dashboard/summary` | `DeveloperHub.js:44` `.reduce(totalHours)` |
| `GET /api/developer/economy/summary` | `DeveloperPerformance.js:43-45` |
| `GET /api/admin/inbox/summary` | `AdminInboxPage.js:187` `useMemo(unreadTotal)` |
| `GET /api/admin/finance/summary` | разные `.reduce` в admin finance |
| `GET /api/client/projects/summary` | `GPTScopeBuilder.js:125,137` |

Backend возвращает:
```json
{
  "total_paid": 12300,
  "total_pending": 4000,
  "unread_count": 8,
  "cards": [...]
}
```

UI **рендерит**, не считает.

**Замечание:** `.filter()` для **чистого presentation-поиска** (по введённому пользователем тексту) разрешён. Запрещён `.filter()` для **business hiding** (например, скрывать «paid» invoice'ы).

**Acceptance:**
- 0 `.reduce` / `.sort` / `Math.max` / `Math.min` в `web/src/pages/`
- 0 `useMemo` для деривации business state в pages
- `.filter()` остаётся только как presentation search (с комментарием `// presentation-only`)
- ARCHITECTURE.md снова true

---

### 🟡 WEB-P5 — Error & UX Reliability (~3 дня)

Цель: web не молчит при ошибках.

**Scope:**
1. Единый `<ErrorBoundary>` на root уровне приложения
2. Единый error/toast handler внутри runtime-client (4xx → toast, 5xx → toast + log)
3. Retry для idempotent GET (с back-off)
4. Унифицированные `<HonestState>` для:
   - `empty` (нет данных)
   - `loading` (грузится)
   - `auth_expired` (401 → redirect на login + сохранить deep-link)
   - `permission_denied` (403 → дружелюбное сообщение)
   - `network_error` (offline / fetch failed)
   - `server_error` (5xx)

**Acceptance:**
- 0 `console.error`-only network failures в pages
- Каждый failed request → toast или inline error
- Каждый 401 → корректный redirect с сохранением `?return_to=`
- Каждый 403 → permission-denied UI, не пустая страница

---

### 🟢 WEB-P6 — Web Build Governance (~2 дня)

Цель: это больше не ломается незаметно.

**Scope — CI / pre-commit guards:**

1. `yarn build` без env-hacks — обязательное прохождение в CI
2. ESLint clean (без `DISABLE_ESLINT_PLUGIN`)
3. Route matrix test — pytest или vitest на App.js
4. ESLint rule: `no-restricted-imports` для `axios` и `fetch` в `pages/`
5. ESLint rule / file structure test: no duplicate runtime-client
6. Page-orphan test: каждая `.js/.tsx` в `pages/` имеет либо Route, либо `_archive/`
7. Architecture-rule test: no business `.reduce` / `.sort` / `Math.*` / `useMemo` в pages
   (за исключением аннотированных `// presentation-only`)
8. No hardcoded business numbers test (regex на `\$\d+(?:[.,]\d+)?(K|M)?` в `pages/`)
9. No public internal route test — каждая internal route обёрнута в `<ProtectedRoute>`

**Acceptance:**
- PR с raw axios в `pages/` → CI red
- PR с orphan route → CI red
- PR с duplicate route → CI red
- PR с guest internal page → CI red
- PR с dead active page → CI red
- PR с build workaround → CI red

---

## 4. Closing contract — "Web closed at 100%"

Web-клиент считается **закрытым на 100%** **только** когда выполняется весь contract:

| Слой | Требование |
|------|------------|
| BUILD | `yarn build` clean, no `DISABLE_ESLINT_PLUGIN` |
| ROUTES | 0 orphan / 0 duplicate / 0 accidental public internal |
| CLIENT | 1 runtime-client / 0 raw axios или fetch in pages / 0 duplicate packages |
| AUTH | All internal routes protected / auth-expired handled / 2FA stable |
| DATA | Pages render backend JSON / no business aggregates / backend provides summaries |
| ERRORS | No `console.error`-only network failures / every failed request visible |
| CODEBASE | 0 active orphan pages / archived legacy explicit / no fake business stats |
| GOVERNANCE | CI tests prevent regression on all of the above |

---

## 5. Phase progress

| Фаза | Цель | Статус | Acceptance |
|------|------|--------|------------|
| WEB-P1 | Critical Repair | ✅ CLOSED 2026-02-FEB | 7 / 7 |
| WEB-P2 | Route & Page Hygiene | ✅ CLOSED 2026-02-FEB | 4 / 4 (P2.3 part deferred to WEB-P3) |
| WEB-P3 | Runtime Consolidation | ✅ CLOSED 2026-02-FEB | 5 / 5 |
| WEB-P4 | Backend Authority | 🟡 NEXT | 0 / 6 |
| WEB-P5 | Error & UX Reliability | ⏸ BLOCKED by P4 | 0 / 6 |
| WEB-P6 | Build Governance | ⏸ BLOCKED by P1–P5 | 0 / 9 |

### WEB-P1 closure (2026-02-FEB)

Все 7 acceptance-критериев выполнены:

1. ✅ `yarn build` exit 0 без `DISABLE_ESLINT_PLUGIN=true`
2. ✅ `/api/web-ui/` HTTP 200, fresh main.62364e7b.js / main.c9489b99.js
3. ✅ 0 orphan public routes (orphan `path="marketplace"` удалён из `App.js:521`)
4. ✅ 0 duplicate routes (`path="validation"` дубликат удалён из `App.js:460`)
5. ✅ Developer Profile earnings → HTTP 200 (свитч на `/api/developer/earnings/summary` + adapter с TODO(WEB-P4))
6. ✅ Hardcoded Google OAuth Client ID не присутствует ни в source, ни в bundle (две копии удалены: `App.js:539-540`, `ClientAuthPage.js:13`)
7. ✅ Hardcoded `24 / 12 / $48.2K` маркетинг-цифры заменены на нейтральные `—` placeholder'ы

**Снижение risk surface:**
- Бизнес-данные не утекают через login-страницу
- OAuth client ID не утекает в bundle (никакой security surface на чужих установках)
- 0 unreachable routes на этапе production
- Build pipeline снова disciplined (без env-hacks)

---

## 6. Important guardrails (что **не** делать сейчас)

Пока линия не закрыта, **не начинаем**:

- AI agents
- Forecasting
- Automation
- Payout batching
- Analytics platform
- Multi-currency
- Любые новые продуктовые фичи

Причина: frontend / runtime сейчас structurally unstable. Любая новая фича умножит хаос на 3 клиента + 6 поколений деривации, и через 2 месяца web станет новым `server.py` (legacy substrate).

Money substrate уже прошёл эту ловушку — повторять её на UI запрещено.

---

## 7. Что эта линия даёт после закрытия

После завершения WEB-P1 → WEB-P6 проект переходит в фазу **scaling architecture**:

- Можно строить **velocity** (PR-ы не разламывают всё подряд)
- Можно строить **продукт / UX / monetization / automation**
- Можно безопасно подключать **live integrations** (Stripe, Resend, Google OAuth)
- Можно начинать **AI / forecasting / payouts v2 / analytics**

Без этой линии — нельзя.
