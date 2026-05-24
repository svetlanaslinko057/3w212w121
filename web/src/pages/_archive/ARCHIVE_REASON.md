# Archived Pages — WEB-P2 (Route & Page Hygiene)

> **Status:** ARCHIVED — no Route in `App.js`, no `<Component>` rendering, no imports from active code.
> **Archived on:** 2026-02-FEB (WEB-P2 closeout)
> **Phase:** WEB_STABILIZATION_LINE → WEB-P2
> **Acceptance criterion closed:** §15 P2.2 (`/app/docs/active-audits/WEB_AUDIT_2026-02-FEB__ACTIVE.md`)

## ⚠️ Audit correction

The original audit `WEB_AUDIT_2026-02-FEB__ACTIVE.md` §3 listed **9 orphan pages**.
**Verification during WEB-P2 found 6 of those to be false positives:**

| Page | Audit verdict | Real status |
|------|---------------|-------------|
| `LandingPageLight.js` | orphan | **live** — imported by `LandingPage.js:29` and rendered for `mode=light` |
| `AdminMarketplaceQuality.js` | orphan | **live** — imported by `AdminV2System.js:17`, rendered in tab `marketplace` |
| `AdminSystemUsers.js` | orphan | **live** — imported by `AdminV2System.js:16`, rendered in tab `users` |
| `AdminPricingConfigPanel.js` | orphan | **live** — imported by `AdminV2Finance.js:21` |
| `AdminProjectReprice.js` | orphan | **live** — imported by `AdminV2Finance.js:22` |
| `AdminPricingCalibration.js` | orphan | **live** — imported by `AdminV2Finance.js:23` |

The audit checked only top-level `App.js` Route definitions. It missed pages that are
embedded inside V2-style tab containers (`AdminV2System`, `AdminV2Finance`). Those pages
are reachable through admin nav and rendered without a dedicated Route.

**Net result:** 3 truly orphan pages archived (not 9).

## True orphans archived here

These files were physically present in `/app/web/src/pages/` but unreachable through any
React Router route, any layout, any other page or component in active code (verified by
`grep -rln "from '@/pages/<Name>'" /app/web/src/`). They are quarantined here to preserve
historical context without polluting active surface.

### `BuilderAuth.js` (214 LOC)

- **Reason:** Replaced by `BuilderAuthPage.js` (current Builder auth surface, already routed in `App.js`).
- **Last referenced:** never in active code.
- **Replacement:** `BuilderAuthPage` (`/builder/auth` Route).

### `ClientAuth.js` (182 LOC)

- **Reason:** Replaced by `ClientAuthPage.js` (current Client auth surface, already routed in `App.js`).
- **Last referenced:** never in active code.
- **Replacement:** `ClientAuthPage` (`/client/auth` Route).

### `EntryPage.js` (80 LOC)

- **Reason:** Generic entry-gate pre-dating role-aware `LandingPage.js` (routes per `?mode=` and per cookie). Made redundant by the unified landing flow.
- **Last referenced:** never in active code.
- **Replacement:** `LandingPage.js` (`/` Route).

---

## Recovery procedure (if needed)

A page can be moved back to `pages/` if:
1. A new Route is added in `App.js` that renders the component;
2. An entry below is updated with the recovery PR / commit;
3. The audit `WEB_AUDIT_2026-02-FEB__ACTIVE.md` §15 P2.2 is annotated.

`git mv pages/_archive/<FileName>.js pages/<FileName>.js` and re-add the import + Route.

## Additional V1 superseded pages (archived during WEB-P2 P2.1 cleanup)

After removing 20 unused imports from `App.js` (P2.1), the corresponding **page files
became orphans** as well — they had no remaining importers anywhere in active code.
The original audit §2 explained each as "superseded by V2 variant" or "redirected by
Route to canonical page". Per acceptance criterion "0 active orphan pages", these 14
files are also archived here:

| File | LOC | Reason (from audit §2) | Canonical replacement |
|------|-----|------------------------|-----------------------|
| `AdminInboxPage.js` | — | redirect to `/admin/dashboard` | `AdminV2Dashboard` |
| `TesterValidation.js` | — | superseded by `TesterValidationPage` | `/tester/validation/:id` |
| `MasterAdminDashboard.js` | — | redirect to `/admin/dashboard` | `AdminV2Dashboard` |
| `DeveloperWorkUnit.js` | — | superseded by `DeveloperWorkPage` | `/developer/work` |
| `AdminTimeControl.js` | — | redirect to `/admin/team` | `AdminV2Team` |
| `AdminGrowthPage.js` | — | redirect to `/admin/team` | `AdminV2Team` |
| `AdminBillingPage.js` | — | redirect to `/admin/finance` | `AdminV2Finance` |
| `ClientDashboard.js` | — | superseded by `ClientDashboardOS` | `/client/dashboard` |
| `DeveloperHub.js` | — | superseded by `DeveloperHub` V2 (deprecated route) | `/developer/dashboard` |
| `AdminProjectWarRoom.js` | — | redirect to `/admin/workflow` | `AdminV2Workflow` |
| `AdminDashboard.js` | — | superseded by `AdminV2Dashboard` | `/admin/dashboard` |
| `AdminContractsPage.js` | — | redirect to `/admin/system` | `AdminV2System` |
| `ModuleCreatedSuccess.js` | — | Route never defined in `App.js` | n/a — flow moved inline into project workspace |
| `TesterDashboard.js` | — | superseded by `TesterHub` | `/tester/dashboard` |

These pages are retained in `_archive/` (not deleted) so:
- their content can be referenced if V2 misses an edge case;
- recovery is a single `git mv` + re-add of Route;
- audit trail (§15 P2.1 / P2.2 closeout) preserves the V1→V2 transition history.

## Final count — WEB-P2 archive

| Category | Files |
|----------|-------|
| True orphans (audit §3 verified) | 3 |
| V1 pages newly-orphaned after import cleanup (audit §2 follow-through) | 14 |
| **Total archived** | **17** |
| False positives kept active (verified via embedded imports — V2 admin tabs) | 6 |

### Verification (final corrected scan, 2026-02-FEB)

After archive operations and `yarn build` clean pass:

```
$ python3 -c "..."  # corrected orphan detector with literal substring search
True orphan pages (corrected detection): 0
```

`yarn build` is the authoritative proof: any unresolved import would fail compilation.
Bundle: `main.d9c4fe4f.js` 2.16 MB raw / 530 KB gzip + `main.141f7b78.css` 20 KB gzip.

## Acceptance — WEB-P2 P2.1 + P2.2

- [x] **P2.1** 0 unused page imports in `App.js` (20 imports removed)
- [x] **P2.2** 0 active orphan pages in `web/src/pages/` (17 archived, 6 false positives corrected)
- [x] ARCHIVE_REASON.md documents cause + canonical replacement for every archived file
- [x] 0 imports of archived files in active code (verified by `grep -rln "from '@/pages/X'"`)
- [x] 0 Route definitions reference archived files (verified in `App.js`)
- [x] `yarn build` passes cleanly (no `DISABLE_ESLINT_PLUGIN`)
- [x] 0 duplicate routes / 0 orphan routes (nested-aware parse of `App.js`)
- [x] 0 guest-access internal pages (provider routes now wrapped in `ProtectedRoute`)
- [x] nav ↔ route consistency = 100% (29 layout nav links, 0 broken)
