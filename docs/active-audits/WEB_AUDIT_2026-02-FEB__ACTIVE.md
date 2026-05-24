> # 🟡 IN PROGRESS — WEB-P1 CLOSED, WEB-P2…WEB-P6 ACTIVE
>
> | Поле | Значение |
> |------|----------|
> | **Status** | 🟡 IN PROGRESS |
> | **Created** | 2026-02-FEB |
> | **Last updated** | 2026-02-FEB (WEB-P3 closed: P2.3 ✅ via WEB-P3.1 — runtime-client dedup + 45 axios + 4 fetch migrated) |
> | **Owner** | (назначить) |
> | **Open items** | 5 of 14 |
> | **P1 critical** | ✅ 4 of 4 CLOSED |
> | **P2 medium** | ✅ 5 of 5 CLOSED (P2.3 closed as part of WEB-P3.1) |
> | **P3 strategic** | 0 of 5 closed (5 open — scheduled across WEB-P4/P5/P6) |
> | **Stabilization Line** | `WEB_STABILIZATION_LINE.md` — WEB-P1 ✅ / WEB-P2 ✅ / WEB-P3 ✅ / WEB-P4 NEXT |
> | **Close criteria** | Все 14 пунктов в §15 переведены в ✅ |
>
> **⚠️ ОБЯЗАТЕЛЬНО К ПРОЧТЕНИЮ ПРИ КАЖДОМ ВХОДЕ В ПРОЕКТ.**
> Документ перемещается в `/app/docs/closed-audits/<YYYY-MM>/` **только** когда чек-лист §15 = 14 ✅.
> Зеркальная ссылка: `/app/memory/active_issues.md`.
> Любой агент / разработчик, начинающий сессию, **обязан** проверить статус открытых пунктов
> до того, как браться за новые фичи. Запрет на «забыть».

---

# Аудит web-клиента и web-админки — 2026-02-FEB

**Локация:** `/app/web` (React 19 CRA + craco + Tailwind + Radix shadcn)
**Брендинг:** EVA-X / ATLAS DevOS
**Метод:** построчный обход `App.js`, `layouts/`, `pages/`, `lib/`, `runtime/`, `runtime-client/`, `craco.config.js`, диффы с `web/ARCHITECTURE.md` и `backend/CONTRACTS.md`, кросс-проверка endpoint'ов через `/openapi.json` (688 paths), сборка `yarn build`, скриншоты `/api/web-ui/` и `/api/web-ui/admin/dashboard`.
**Статус сборки:** ✅ собирается (530 KB main.js gzipped + 20 KB css), но **с обходным `DISABLE_ESLINT_PLUGIN=true`** — иначе падает на TS-rule, не зарегистрированном в ESLint config (см. C1).

---

## 0. TL;DR — Резюме

| Слой | Состояние | Кратко |
|------|-----------|--------|
| Сборка | 🟡 СОБИРАЕТСЯ С ОБХОДОМ | 2 ESLint ошибки в `runtime-client/adapters/expo.ts` и `runtime/index.ts` блокируют чистый `yarn build` |
| Routing (App.js, 559 строк, 120 `<Route>`) | 🟡 ЕСТЬ ОБРЫВЫ | Orphan route, дубликат, ошибка отступа |
| Auth | ✅ работает | cookie-session, /api/auth/me + /api/auth/demo + /api/auth/quick + 2FA challenge |
| Admin layout (11 nav-зон) | ✅ все ссылки ведут на существующие роуты | Nav ↔ Route consistency = 100% |
| Client/Developer/Tester layouts | ✅ все ссылки ведут на роуты | 18 ссылок, 0 broken |
| Архитектурный контракт (`web/ARCHITECTURE.md`) | 🔴 МАССОВО НАРУШЕН | 14 `.reduce`, 106 `.filter`, 4 `.sort`, 20 `Math.max/min`, 28 `useMemo` в pages — это нарушение всех 6 hard rules |
| API client | 🔴 ТРИ ПОКОЛЕНИЯ ОДНОВРЕМЕННО | `runtime-client` (40 страниц) + raw axios (56) + raw fetch (4); `lib/api.js` (новый унифицированный) — **0 страниц** |
| Сиротские страницы (бандл-мусор) | 🟡 9 файлов / 3 558 LOC | Не импортируются, не имеют Route, тащатся в бандле через статический анализ только если в импортах — то 0; через бандл-сборку — 0. Но в репозитории = шум |
| Unused imports в App.js | 🟡 18 шт | Импортируются, но `<Component>` не используется — webpack tree-shaking должен убрать, но это маркер деградации |
| Endpoint contract drift | 🟡 2 реально missing | `/api/developer/profile/earnings` (404 silently) + неточная ссылка на `/api/webhook/stripe` (в hint placeholder) |
| Silent failure UX | 🔴 53 страницы | 53 файла ловят ошибку в `console.error` без toast/UI feedback |
| Hardcoded маркетинг-цифры | 🟡 1 место | `AdminLoginPage.js:304-306` — "24 / 12 / $48.2K" литералы |
| Real-time / WebSocket | ✅ ок | `lib/socket.js` корректно использует `/api/socket.io/` через ingress |
| Capability gating | ✅ ок | `runtime.capabilities.refresh()` с 1.5s race на boot |

**Веб собирается, рендерится, лендинг + админка работают.** Но есть **архитектурная деградация**: код одновременно живёт в трёх поколениях API-клиента, нарушает собственный contract `web/ARCHITECTURE.md`, и содержит мёртвые маршруты.

---

## 1. Обрывы в роутинге — `src/App.js`

### 1.1 🔴 CRITICAL — Orphan route с потерянным отступом (строка 521)

```jsx
{/* Legacy redirects */}
<Route path="/dashboard" element={<Navigate to="/client/dashboard" replace />} />
<Route path="/developer/hub" element={<Navigate to="/developer/dashboard" replace />} />
<Route path="/tester/hub" element={<Navigate to="/tester/dashboard" replace />} />
  <Route path="marketplace" element={<DeveloperMarketplace />} />   ← СТРОКА 521, СБИТ ОТСТУП
```

- Маршрут `path="marketplace"` (без leading `/`) находится **внутри корневого `<Routes>`, не внутри родителя**, поэтому React Router интерпретирует его как `/marketplace` (относительно `basename`).
- Не защищён `ProtectedRoute`. `DeveloperMarketplace` пытается рендериться **гостям**, что вероятно приведёт к Loading state или 401 спирали.
- Лишний отступ (`        ` вместо `      `) выдаёт, что это копи-паст из другого блока.
- Это **рассинхрон с задуманным `/developer/marketplace`** (строка 378), который уже корректно проложен внутри `/developer` parent.

**Fix:** удалить строку 521.

### 1.2 🟡 WARNING — Duplicate route внутри `/admin`

Внутри одного parent `<Route path="/admin">` есть два маршрута `validation`:

```
App.js:434  <Route path="validation" element={<AdminValidationPage />} />            ← живой
App.js:460  <Route path="validation" element={<Navigate to="/admin/workflow" replace />} />  ← мёртвый (никогда не сработает)
```

React Router v7 выбирает **первое совпадение** — строка 434. Legacy-редирект на строке 460 **dead code**, при этом скрывает намерение разработчика.

**Fix:** удалить строку 460.

### 1.3 🟢 OK — Catch-all правильный

`<Route path="*" element={<Navigate to="/" replace />} />` — корректный fallback.

### 1.4 🟢 OK — `<Navigate to="/client/projects/:projectId">` (строка 527)

React Router v7 поддерживает `to="/client/projects/:projectId"` для path-pass-through. Не баг.

---

## 2. Импорты в `App.js` — 18 неиспользуемых компонентов

Имоприруются, но компонент **не появляется ни в одном `<Component>` / `element={<Component>`**:

```
TesterDashboard            ← покрывается TesterHub
AdminDashboard             ← покрывается AdminV2Dashboard
DeveloperWorkUnit          ← покрывается DeveloperWorkPage
AdminIntegrationsPage      ← вытеснена AdminV2System (теперь /admin/system)
DeveloperHub               ← покрывается /developer/dashboard
AdminProjectWarRoom        ← редирект на /admin/workflow
AdminGrowthPage            ← редирект на /admin/team
AdminContractsPage         ← редирект на /admin/system
AdminBillingPage           ← редирект на /admin/finance
AdminWithdrawalsPage       ← редирект на /admin/finance
MasterAdminDashboard       ← редирект на /admin/dashboard
AdminEarningsControl       ← редирект на /admin/finance
ModuleCreatedSuccess       ← маршрут не определён вообще
AdminInboxPage             ← редирект на /admin/dashboard
AdminUsersPage             ← редирект на /admin/team
AdminTemplatesPage         ← редирект на /admin/system
AdminTeamPanel             ← вытеснена AdminV2Team
AdminTimeControl           ← редирект на /admin/team
```

Webpack tree-shaking **должен** их выкинуть из production-бандла, но:
- В dev они компилируются и читают side-effect модули (CSS, контексты).
- Это маркер незавершённой миграции `v1 → v2`.

**Fix:** удалить 18 неиспользуемых импортов из `App.js` (массив строк 39–149).

---

## 3. Сиротские страницы — 9 файлов, 3 558 строк мёртвого кода

Файлы существуют в `pages/`, **не импортируются** в `App.js`, **не имеют Route**:

```
pages/AdminMarketplaceQuality.js     240 LOC
pages/AdminPricingCalibration.js     205 LOC
pages/AdminPricingConfigPanel.js     545 LOC
pages/AdminProjectReprice.js         348 LOC
pages/AdminSystemUsers.js            200 LOC
pages/BuilderAuth.js                 214 LOC   ← заменён BuilderAuthPage
pages/ClientAuth.js                  182 LOC   ← заменён ClientAuthPage
pages/EntryPage.js                    80 LOC
pages/LandingPageLight.js          1 544 LOC   ← *самый жирный* alt-вариант лендинга
```

`AdminProjectReprice` использует `useMemo` 8 раз и `useState` 6 раз — большая страница, никогда не достижимая.

**Fix:** перенести в `pages/_archive/` или удалить (через rollback можно вернуть).

---

## 4. Архитектурный контракт `web/ARCHITECTURE.md` — массово нарушен

Контракт: «**UI renders JSON. Backend is the source of truth.**» Запрещено в pages:
- `.reduce()` — агрегация
- `.filter()` — скрытие данных
- `.sort()` — переупорядочивание
- `Math.max / Math.min` — эвристики
- `useMemo` для деривации — обычно неверно

Текущий результат `grep` по `/app/web/src/pages/`:

```
.reduce(            14 случаев   ← должно быть 0
.filter(           106 случаев   ← должно быть 0
.sort(               4 случая    ← должно быть 0
Math.max | Math.min  20 случаев  ← должно быть 0
useMemo              28 случаев  ← должно быть 0 (для деривации)
```

**Конкретные примеры нарушений:**

```js
// pages/ClientBillingOS.js:76-77
const totalPending = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);
const totalPaid    = paidInvoices.reduce((sum, inv) => sum + inv.amount, 0);
```
→ backend `GET /api/client/billing-os` должен вернуть `summary.totals.pending / paid`, UI обязан **отрисовать**, не считать.

```js
// pages/DeveloperHub.js:44
const totalHours = workUnits.reduce((sum, u) => sum + (u.actual_hours || 0), 0);
// pages/DeveloperPerformance.js:43, 45  — то же самое
// pages/GPTScopeBuilder.js:125, 137     — то же
```
→ нарушает hard rule №1 (UI не считает) и №5 (derived state).

```js
// pages/AdminInboxPage.js:187
const unreadTotal = useMemo(() => threads.reduce(
  (s, t) => s + (t.unread_admin || 0), 0
), [threads]);
```
→ двойное нарушение: `.reduce` + `useMemo` для деривации.

**Влияние:**
- Каждый раз, когда backend меняет формат `actual_hours` / `amount` / `unread_admin`, UI ломается тихо (NaN, undefined, 0).
- При SSE/WebSocket push «новый thread» — UI не пересчитывает корректно, потому что `threads` уже мемоизирован.
- Дрейф `total_paid` между UI и `GET /api/admin/financials` уже видим в проде, потому что в продакшене бекенд округляет до центов раньше, а клиент — позже.

**Рекомендация:** запустить найденный grep-скрипт в CI как pre-commit hook и блокировать новые нарушения. Существующие — постепенно мигрировать.

---

## 5. Три поколения API-клиента одновременно

### 5.1 Унифицированный клиент `lib/api.js` (Этап 6.2) — **используется 0 страницами**

Полная реализация (>200 строк): cookie-session + `X-Request-Id` + `ApiError` shape + retry для GET/HEAD + capability cache. Документировано в самом файле как замена «axios + ${API} + fetch» паттерна.

```bash
grep -rln "from '@/lib/api'" pages/ → 0 hits
```

→ **Никакая страница её не импортирует.** Чистый мёртвый код / задумка без миграции.

### 5.2 `runtime-client` (новый «v7 monorepo client») — 40 страниц

Импортируется через `import { runtime } from '@/runtime'` (singleton fabricated в `runtime/index.ts`).
`@/runtime` строит web-адаптер через `createWebRuntimeClient` из локальной копии `src/runtime-client/` (зеркало `/app/packages/runtime-client/src/`).

⚠️ **Не симлинк** — это две независимые копии: `/app/web/src/runtime-client/` и `/app/packages/runtime-client/src/`. **Любой апдейт пакета не отражается в веб-копии**, и наоборот.

Используют 40 страниц (`grep -l "from '../runtime'\|from '@/runtime'" pages/`).

### 5.3 Сырой `axios` — 56 страниц

```js
const r = await axios.get(`${API}/admin/mobile/finance`, { withCredentials: true });
```
По всему `pages/`. Это legacy паттерн до Этапа 6.2.

### 5.4 Сырой `fetch()` — 4 страницы (самое старое)

```
pages/DeveloperLeaderboard.js
pages/DeveloperTimeControl.js
pages/DeveloperDashboard.js
pages/AdminTimeControl.js
```

Все используют `fetch(${backendUrl}/api/...)` + `credentials: 'include'`. Дублируют функциональность axios + runtime.

### Архитектурный долг

| Клиент | Pages | % | Качество |
|--------|------:|--:|----------|
| `lib/api.js` (Этап 6.2) | 0 | 0% | мертво |
| `runtime` / `runtime-client` | 40 | 37% | новый |
| `axios` raw | 56 | 52% | legacy |
| `fetch` raw | 4 | 4% | самое старое |
| **Уникальных pages с импортом API** | ~100 | — | — |

→ Один и тот же endpoint вызывается из трёх клиентов с разной обработкой ошибок, разной телеметрией и разным X-Request-Id поведением.

---

## 6. Endpoint-contract drift (Web → Backend)

Сравнение 176 уникальных endpoint'ов, выдранных regex-ом из `pages/components/lib/`, с 688 paths из `/openapi.json`.

### 6.1 🔴 Реально отсутствующие endpoint'ы

| Web | Backend | Файл |
|-----|---------|------|
| `GET /api/developer/profile/earnings` | **НЕ СУЩЕСТВУЕТ** | `pages/DeveloperProfileEnhanced.js:60` (fetch raw) |

Конкретно:
```js
// DeveloperProfileEnhanced.js:58-60
const [ratingRes, qualityRes, earningsRes] = await Promise.all([
  fetch(`${backendUrl}/api/developer/economy/my-rating`,    { credentials: 'include' }),  ✅
  fetch(`${backendUrl}/api/developer/quality/my-score`,     { credentials: 'include' }),  ✅
  fetch(`${backendUrl}/api/developer/profile/earnings`,     { credentials: 'include' })   ❌ 404
]);
```
Третий вызов всегда возвращает 404, ошибка глотается в `console.error`, страница загружается «как будто всё ок», но раздел earnings пустой.

### 6.2 🟡 Ложные обнаружения (для протокола — НЕ баги)

| Endpoint | Объяснение |
|----------|------------|
| `/api/webhook/stripe` | Существует на бэкенде (`server.py:26571`, помечен `include_in_schema=False`). В UI упоминается **только как текст-подсказка** в `AdminPaymentsPage.js:419` (placeholder hint), не как HTTP вызов |
| `/api/socket.io/` | Socket.IO mount path, корректно настроен в `lib/socket.js:42` |
| `/api/admin/qa/{X}/{approve|reject}` | Это шаблон, фактически вызываются `/api/admin/mobile/qa/{module_id}/approve` и `…/reject` — оба есть в openapi |
| `/api/admin/settings/integrations/{X}` | Реально вызываются конкретные суффиксы (`/email`, `/stripe`, etc.) — все есть |
| `/api/web-ui/*` | Это SPA маршруты, не API |

---

## 7. AdminLoginPage — hardcoded маркетинг-данные

```js
// pages/AdminLoginPage.js:303-307
const stats = [
  { label: 'Active Projects', value: '24',    Icon: Activity },
  { label: 'Team Members',    value: '12',    Icon: Users },
  { label: 'Revenue',         value: '$48.2K', Icon: TrendingUp },
];
```

- Это **литералы**, не данные с бэка.
- На реальном dashboard (`/admin/dashboard`) backend возвращает `active_devs=8, active_modules=10, qa_pending=1`. Цифры на login-страницах (24/12/$48.2K) не имеют связи.
- Нарушает п.3 `ARCHITECTURE.md`: «UI does not decide».

**Рекомендация:** либо подгружать публичный `GET /api/stats` (он уже существует, см. openapi), либо явно пометить «marketing-only» и убрать конкретные цифры, заменить на нейтральные иконки.

---

## 8. Silent failure UX — 53 страницы

53 страницы из `pages/` ловят ошибки только в `console.error(...)` без вызова `toast.error(...)` / Toast UI:

```
AcceptanceQueue          AdminDashboard         AdminDeliverableBuilder
AdminDeveloperProfile    AdminEarningsControl   AdminFinancialsPage
AdminMarketplaceQuality  AdminProjectWarRoom    AdminTeamPanel
AdminTemplatesPage       … (всего 53)
```

Только 10 страниц используют `toast.*` для уведомлений пользователя.

**Эффект:** пользователь нажимает кнопку → ничего не происходит → данные не появляются. Никакой обратной связи. Ошибка только в DevTools console.

**Рекомендация:** ввести единый error-boundary с автоматическим toast на 4xx/5xx, плюс компонент `<HonestState/>` (он уже существует, см. `components/HonestState.js`, но используется реже, чем нужно).

---

## 9. Сборка `yarn build` — 2 ESLint ошибки

```
src/runtime-client/adapters/expo.ts:30:5
  Definition for rule '@typescript-eslint/no-var-requires' was not found

src/runtime/index.ts:55:3
  Definition for rule '@typescript-eslint/no-explicit-any' was not found
```

Причина: `eslint-disable-next-line @typescript-eslint/no-var-requires` ссылается на правило, **которое не зарегистрировано в craco eslint config**. CRA по умолчанию не включает `@typescript-eslint/*`, а в `craco.config.js` лишь добавлен `plugin:react-hooks/recommended` (строка 30-34).

**Эффект:** `yarn build` падает в CI. Сейчас пришлось ставить `DISABLE_ESLINT_PLUGIN=true`, что **отключает весь линт** во время сборки.

**Fix-варианты:**
1. (минимальный) Заменить `// eslint-disable-next-line @typescript-eslint/no-var-requires` на `// eslint-disable-next-line` без правила (2 строки).
2. (правильный) Добавить `@typescript-eslint/eslint-plugin` в `devDependencies` + расширить craco config.

---

## 10. Несоответствие `pages/` ↔ `App.js` — сводка

```
Файлов в pages/:                   107
Импортируется в App.js:             98   ← 9 сиротских
Используется в App.js (<Component>): 80   ← 18 неиспользуемых импортов
Реально достижимых через UI:        80
```

Иными словами: **27 из 107 страниц = мёртвый код** (25 %).

---

## 11. Дополнительные деградации (низкий приоритет)

| # | Проблема | Где | Severity |
|---|----------|-----|----------|
| L1 | `lib/api.js` написан, документирован, используется 0 раз | `lib/api.js` | LOW |
| L2 | `console.log` в production-коде (13 случаев), `console.error` (119) | разные pages | LOW |
| L3 | Двойная копия `runtime-client` (`web/src/` и `packages/`) — нет симлинка/build-step | `src/runtime-client/` vs `/app/packages/runtime-client/` | MED |
| L4 | `@emergentbase/visual-edits` — wrapper в craco поглощает MODULE_NOT_FOUND, но молчаливо отключает фичу | `craco.config.js:97-110` | INFO |
| L5 | `react-day-picker@8.10.1` peer-dep error (`date-fns@^2-3` vs у нас 4.1) | `package.json` | LOW |
| L6 | `react-day-picker` несовместим с `react@^16-18` (у нас 19) — peer warning | `package.json` | LOW |
| L7 | `recharts@3.8.1` unmet peer `react-is` | `package.json` | LOW |
| L8 | Hard-coded Google OAuth Client ID fallback (`539552820560-…`) в `App.js:539-540` | потенциальный security smell | MED |
| L9 | Browser console errors: posthog blocked, cdn-cgi/rum blocked, /api/auth/me 401 — спам для гостей | runtime | INFO |

---

## 12. Что **работает корректно** (не списать в ноль)

✅ Сборка проходит (с обходом ESLint), артефакт 2.3 MB.
✅ FastAPI сервит `/api/web-ui/*` (HTTP 200) сразу после build.
✅ Landing рендерится: EVA-X, "Software, actually shipped", execution pipeline preview LIVE.
✅ AdminLogin → Demo Admin Access → `/admin/dashboard` рендерится с реальными данными из `/api/admin/mobile/home` (8 devs / 10 modules / 1 QA).
✅ 11 nav-зон admin layout: все ведут на существующие routes (100% consistency).
✅ Client / Developer / Tester layouts: 18 nav-ссылок, 0 broken.
✅ 2FA challenge flow реализован (`pages/TwoFactorChallengePage.js`, 320 строк) и зашит в `App.js` AuthProvider login (строки 215-223).
✅ WebSocket правильно сконфигурирован под `/api/socket.io/` ingress (`lib/socket.js:42`).
✅ Capability gating (`runtime.capabilities.refresh()` race с 1.5s) для payment кнопок.
✅ Cookie-session работает: `POST /api/auth/demo` → cookie → `GET /api/auth/me` 200 → переход в Admin.

---

## 13. Сводный план «починить деградацию»

### Минимум (P1, ~2 часа)
1. Удалить orphan `<Route path="marketplace" element={<DeveloperMarketplace />} />` (App.js:521).
2. Удалить дубликат `<Route path="validation" element={<Navigate to="/admin/workflow"/>}>` (App.js:460).
3. Заменить ESLint-disable комментарии в `runtime-client/adapters/expo.ts:30` и `runtime/index.ts:55` на общий `// eslint-disable-next-line` (без имени правила).
4. Исправить `pages/DeveloperProfileEnhanced.js:60` — заменить `/api/developer/profile/earnings` на `/api/developer/economy/earnings` (или добавить endpoint на бэке).

### Средне (P2, ~1 день)
5. Удалить 18 неиспользуемых импортов из `App.js`.
6. Перенести 9 сиротских pages в `pages/_archive/` (или удалить).
7. Удалить дубликат `runtime-client`: оставить `/app/packages/runtime-client/`, в `web/` сделать симлинк, чтобы build pipeline видел один source.
8. Заменить hardcoded `24 / 12 / $48.2K` в `AdminLoginPage.js` на `GET /api/stats` или нейтральный визуал.

### Стратегически (P3, спринт)
9. Миграция страниц на единый `runtime-client` (или на `lib/api.js` — решить, что канон). Цель: 56 axios pages + 4 fetch pages → 0 за 2 спринта.
10. Прогон по `ARCHITECTURE.md` rules: вынести `.reduce/.filter/.sort/Math.max/useMemo` из pages → запросить агрегаты от бэка. Начать с самых нагруженных: `ClientBillingOS`, `DeveloperHub`, `DeveloperPerformance`, `AdminInboxPage`, `GPTScopeBuilder`.
11. Унифицированный error-boundary + автоматический toast на 4xx/5xx → 53 страницы с silent failure исчезнут как класс.

---

## 14. Итог

**Web и web-админка ЖИВЫ и функциональны** — сборка проходит, лендинг рендерится, админ-дашборд работает с реальными данными. Но **архитектурная деградация очевидна**:

- 3 поколения API-клиента одновременно
- 25% pages = мёртвый код
- 6 hard rules `ARCHITECTURE.md` массово нарушены в `pages/`
- 2 реальных обрыва в `App.js` (orphan + duplicate route)
- 1 contract drift на бэк (`/api/developer/profile/earnings`)
- 53 страницы со silent failure UX

Всё это — **технический долг**, накопленный за 6 cleanup pass'ов (упоминается в `web/ARCHITECTURE.md` явно). Платформа работает, но любая новая фича гарантированно прирастёт ещё одной разновидностью клиента и ещё несколькими нарушениями контракта, пока эти обрывы не закрыты.

---

## 15. Progress Tracker — ОБЯЗАТЕЛЬНО ОБНОВЛЯТЬ

> Документ считается закрытым **только когда все 14 строк = ✅**.
> При закрытии каждого пункта добавлять: `закрыто <YYYY-MM-DD>, PR/commit <sha>, исполнитель`.

### P1 — Critical (блокирующие обрывы)

- [x] **P1.1** Удалить orphan `<Route path="marketplace" element={<DeveloperMarketplace />} />` (`/app/web/src/App.js:521`)
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1)
- [x] **P1.2** Удалить duplicate `<Route path="validation" element={<Navigate to="/admin/workflow"/>} />` (`/app/web/src/App.js:460`)
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1)
- [x] **P1.3** Исправить `/api/developer/profile/earnings` 404 в `pages/DeveloperProfileEnhanced.js:60` (либо заменить endpoint на существующий `/api/developer/economy/earnings`, либо добавить endpoint на бэке)
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1) — переключено на `/api/developer/earnings/summary` + добавлен adapter с TODO(WEB-P4) для канонической UI-shape
- [x] **P1.4** Заменить `// eslint-disable-next-line @typescript-eslint/no-var-requires` (`runtime-client/adapters/expo.ts:30`) и `// eslint-disable-next-line @typescript-eslint/no-explicit-any` (`runtime/index.ts:55`) на общий `// eslint-disable-next-line` — `yarn build` должен проходить без `DISABLE_ESLINT_PLUGIN`
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1) — `yarn build` проходит чисто (530 KB main.js gzip, 20 KB css)

### P2 — Medium (мёртвый код / расхождения)

- [x] **P2.1** Удалить 18 неиспользуемых импортов из `/app/web/src/App.js` (список в §2)
  - _Закрыто:_ 2026-02-FEB, WEB-P2, E1 — фактически удалено **20** unused imports (аудит §2 пропустил `ClientDashboard` и `TesterValidation`). Detection-скрипт зашит в `audit/web_p2_orphan_scan.py` для CI WEB-P6.
- [x] **P2.2** Перенести 9 сиротских pages из `/app/web/src/pages/` в `/app/web/src/pages/_archive/` (список в §3): AdminMarketplaceQuality, AdminPricingCalibration, AdminPricingConfigPanel, AdminProjectReprice, AdminSystemUsers, BuilderAuth, ClientAuth, EntryPage, LandingPageLight
  - _Закрыто:_ 2026-02-FEB, WEB-P2, E1 — фактически архивировано **17 файлов** (3 истинных сироты из §3 + 14 V1-страниц, осиротевших после удаления imports в P2.1). **6 файлов из §3 оказались false positives** (LandingPageLight, AdminMarketplaceQuality, AdminSystemUsers, AdminPricingConfigPanel, AdminProjectReprice, AdminPricingCalibration) — они embedded в `AdminV2System`/`AdminV2Finance`/`LandingPage` tabs и не являются сиротами. Каждому архивированному файлу прописан ARCHIVE_REASON.md (cause + replacement). `yarn build` clean (`main.d9c4fe4f.js` 530 KB gzip).
- [x] **P2.3** Устранить дубликат `runtime-client`: оставить канон в `/app/packages/runtime-client/src/`, в `/app/web/src/` сделать симлинк или build-step (текущая статическая копия рассинхронизирована)
  - _Закрыто:_ 2026-02-FEB, WEB-P3.1, E1 — `/app/web/src/runtime-client/` теперь симлинк → `../../packages/runtime-client/src`. Single canonical source. `web/scripts/audit/web_p3_guards.py` (G3) проверяет это в CI WEB-P6. Также исправлен 1-line ESLint drift в `adapters/expo.ts`.
- [x] **P2.4** Заменить hardcoded маркетинг-цифры `24 / 12 / $48.2K` в `pages/AdminLoginPage.js:303-307` на `GET /api/stats` или нейтральный визуал
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1) — заменено на нейтральные `—` плейсхолдеры (не маркетинг-плейс, а login-сёрфейс)
- [x] **P2.5** Hard-coded Google OAuth Client ID fallback (`pages/App.js:539-540`) — вынести в `REACT_APP_GOOGLE_CLIENT_ID` строго без fallback, чтобы конфиг не утекал в bundle
  - _Закрыто:_ 2026-02-FEB, commit pending, E1 (WEB-P1) — также удалена 2-я копия в `pages/ClientAuthPage.js:13`. Bundle clean.

### P3 — Strategic (архитектурный долг)

- [ ] **P3.1** Унификация API-клиента: выбрать один из `lib/api.js` или `runtime-client` как канон, мигрировать все pages (56 axios + 4 fetch → 0). Цель — 100% pages на одном клиенте.
  - _Прогресс:_ runtime-client 40 / axios 56 / fetch 4
  - _Закрыто:_ —
- [ ] **P3.2** Соблюдение `web/ARCHITECTURE.md`: вынести 14× `.reduce`, 106× `.filter`, 4× `.sort`, 20× `Math.max/min`, 28× `useMemo` из `pages/` в backend-агрегаты. Начать с критичных: `ClientBillingOS`, `DeveloperHub`, `DeveloperPerformance`, `AdminInboxPage`, `GPTScopeBuilder`.
  - _Прогресс:_ 0 / 172 нарушений устранено
  - _Закрыто:_ —
- [ ] **P3.3** Единый ErrorBoundary + auto-toast на 4xx/5xx → закрыть silent-failure UX в 53 страницах (список в §8)
  - _Прогресс:_ 0 / 53 страниц приведены в норму
  - _Закрыто:_ —
- [ ] **P3.4** CI-guard: pre-commit / GitHub Action который блокирует PR, если в `pages/` появляется `.reduce|.filter|.sort|Math.max|Math.min|useMemo` (паттерн, нарушающий `ARCHITECTURE.md`)
  - _Закрыто:_ —
- [ ] **P3.5** Привести peer-deps в порядок: `react-day-picker@8.10.1` ↔ `react@19` + `date-fns@4.1` + `recharts@3.8.1` ↔ `react-is`. Решение: обновить `react-day-picker` до версии, совместимой с React 19, или зафиксировать `--legacy-peer-deps` в CI и записать в `web/README.md` явно.
  - _Закрыто:_ —

---

## Лог закрытий

| Дата | Пункт | Исполнитель | PR/commit | Примечание |
|------|-------|-------------|-----------|------------|
| 2026-02-FEB | WEB-P1 (P1.1, P1.2, P1.3, P1.4, P2.4, P2.5) | E1 (main agent) | pre-redeploy | Critical Repair — 7/7 acceptance, см. WEB_STABILIZATION_LINE.md §5 |
| 2026-02-FEB | WEB-P2 P2.1 | E1 (main agent) | post-redeploy | Removed 20 unused page imports from `App.js` (audit §2 listed 18; +ClientDashboard, +TesterValidation found by extended scan) |
| 2026-02-FEB | WEB-P2 P2.2 | E1 (main agent) | post-redeploy | Archived 17 pages to `pages/_archive/` (3 true orphans + 14 V1 superseded). 6 audit §3 entries verified live (false positives) and kept. ARCHIVE_REASON.md documents each. |
| 2026-02-FEB | WEB-P2 acceptance §4 (route matrix) | E1 (main agent) | post-redeploy | 0 duplicate / 0 orphan routes (nested-aware parse), 29 nav links → 0 broken, /provider/inbox + /provider/job/:bookingId wrapped in ProtectedRoute (added `/provider` → `/provider/auth` redirect to ProtectedRoute). 0 guest-access internal pages remain. |
| 2026-02-FEB | WEB-P3 P2.3 + WEB-P3.1 (runtime-client dedup) | E1 (main agent) | post-redeploy | `/app/web/src/runtime-client/` → symlink → `/app/packages/runtime-client/src/`. 1-line ESLint drift in `adapters/expo.ts` repaired. Webpack already symlink-aware (`craco.config.js:43-47`). |
| 2026-02-FEB | WEB-P3.2 (request facade) | E1 (main agent) | post-redeploy | `runtime.{get,post,put,patch,delete,request}` confirmed live with middleware chain (token-prime → telemetry → auth-expired → dedup → capability-gate → retry → transport). Cookie auth via web adapter. ApiError envelope universal. |
| 2026-02-FEB | WEB-P3.3 (page migration) | E1 (main agent) | post-redeploy | 49 files migrated: 45 axios (149 method calls + 137 withCredentials configs + 35 unused `API` imports rewritten) + 4 raw fetch (DeveloperDashboard, DeveloperLeaderboard, DeveloperProfileEnhanced, DeveloperTimeControl). Reusable tooling: `/app/web/scripts/audit/migrate_axios_to_runtime.py`. |
| 2026-02-FEB | WEB-P3.4 (error semantics) | E1 (main agent) | post-redeploy | ApiError canonical class confirmed (status / code / message / request_id / retryable). Compat-preserving — existing try/catch keep working unchanged. Toast/retry UX deferred to WEB-P5. |
| 2026-02-FEB | WEB-P3.5 (guards) | E1 (main agent) | post-redeploy | `/app/web/scripts/audit/web_p3_guards.py` exits 0: G1 (0 raw axios) + G2 (0 raw fetch) + G3 (single canonical source) ✓. Wired-ready for WEB-P6 CI. Smoke: admin/client/developer login 200, /api/admin/users + /api/client/workspace + /api/developer/dashboard/summary all 200, /api/web-ui/ 200. |

---

## 🔒 Закрывающий критерий

Документ переводится в `Status: ✅ CLOSED` и перемещается в `/app/docs/closed-audits/2026-MM/`
**только** когда:

1. Все 14 строк §15 = ✅
2. Удалена соответствующая запись из `/app/memory/active_issues.md`
3. В §0 «TL;DR» обновлён каждый «🔴 / 🟡» → «✅»
4. Зафиксирован финальный коммит с пометкой `audit(web): close 2026-02-FEB — all P1/P2/P3 resolved`
