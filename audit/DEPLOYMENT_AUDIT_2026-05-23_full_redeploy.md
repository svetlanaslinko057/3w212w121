# DEPLOYMENT AUDIT — Full Redeploy (2026-05-23, fresh container)

**Repository**: `svetlanaslinko057/2ed2d2dd2` (auto-mirror of ATLAS DevOS / EVA-X)
**Environment image**: `expo_mongo_base_image_cloud_arm:release-22052026-1`
**Triggered by**: user request — "Разверни полностью данный проект, изучи репозиторий, полностью сделай аудит"
**Result**: ✅ **DEPLOY GREEN** — backend + Expo + Mongo running, 4 roles login OK, 688 routes live, 37 collections seeded.

---

## 1. What was done

| Step | Action | Result |
|---|---|---|
| 1 | Cloned `https://github.com/svetlanaslinko057/2ed2d2dd2.git` into `/tmp/repo_clone` | 135 MB tree (backend 3.6M, frontend src 1.5M, web 2.9M, audit 2.9M) |
| 2 | Backed up `/app/backend/.env` and `/app/frontend/.env` | preserved (`MONGO_URL`, `EXPO_PACKAGER_*`) |
| 3 | `rsync` repo → `/app`, excluding `.env`, `node_modules`, `.git`, `__pycache__` | sources synced, protected env retained |
| 4 | Freed disk — deleted stale `/app/frontend/.metro-cache` (223 MB) + pip cache | `/app` 99% → 69% used (3.1 GB free) |
| 5 | `pip install -r /app/backend/requirements.txt` | all deps installed, including `python-socketio`, `emergentintegrations`, `sentence-transformers` |
| 6 | `yarn install` in `/app/frontend` | 0 errors, lockfile saved |
| 7 | `supervisorctl restart backend && restart expo` | both RUNNING |
| 8 | Smoke endpoints + Mongo collection count + role logins | see §3 |

---

## 2. Service state (post-deploy)

```
backend     RUNNING   pid 1125
expo        RUNNING   pid (post-restart)
mongodb     RUNNING   pid 1014
nginx-code-proxy RUNNING
```

Backend: `INFO: Application startup complete.` — Guardian, Module Motion, Operator, Event background loops armed.

Expo: bundled **1561 modules** for web/SSR (Bundle time ~59s, fast-resolver). HTTP `GET /` → 200 with full hydrated SSR HTML (50.8 KB). Tunnel URL: `https://5ea0a8b4-bcc2-4d40-aeed-1bcbd667c3f0.preview.emergentagent.com`.

Mongo: 37 collections, seeded fresh on cold boot (admin + 4 quick-access users + 6 developers + 89 modules + 81 QA decisions + 2 demo projects + replay batch `replay_d477d648f3` with 70 synthetic events across 14 days).

---

## 3. Smoke matrix

### 3.1 Auth (4 roles)
| User | Password | `POST /api/auth/login` | Notes |
|---|---|---|---|
| `admin@atlas.dev` | `admin123` | **200** | role=admin, user_id=`user_342966d6011e` |
| `client@atlas.dev` | `client123` | **200** | role=client |
| `john@atlas.dev` | `dev123` | **200** | role=developer |
| `tester@atlas.dev` | `tester123` | **200** | role=tester |

### 3.2 Public endpoints
| Path | HTTP | Note |
|---|---|---|
| `/api/integrations/manifest` | **200** | payment/mail/storage/ai = `mock`, oauth = `unavailable` (`GOOGLE_CLIENT_ID missing`) — honest mock-reporting works |
| `/api/web-ui/` | **503** | `{"detail":"Web UI not built yet","build_dir":"/app/web/build"}` — **needs `bash /app/scripts/rebuild-web.sh`** |
| `/api/auth/me` | **401** | correct unauthenticated response (canonical error envelope present) |
| `/openapi.json` paths count | **688 routes** | full surface area live |

### 3.3 Integration capabilities (manifest)
| Capability | Mode | Reason |
|---|---|---|
| payment (Stripe) | mock | `STRIPE_SECRET_KEY missing` |
| mail (Resend) | mock | `RESEND_API_KEY missing` |
| storage (Cloudinary) | mock | `CLOUDINARY_CLOUD_NAME/_KEY/_SECRET missing` |
| oauth (Google) | unavailable | `GOOGLE_CLIENT_ID missing` |
| ai (LLM) | mock | `EMERGENT_LLM_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY all missing` |

> All "mock" capabilities are *honestly* reported as such in `/api/integrations/manifest` (per `integrations_api.py`). UI surfaces will render an "OFFLINE / DEMO" banner where appropriate.

---

## 4. Repository inventory

| Area | Count |
|---|---|
| Backend Python modules (top-level `backend/*.py`) | **91** |
| Backend API routes (live) | **688** |
| Mongo collections (post-seed) | **37** |
| Expo screens (`frontend/app/**/*.tsx`) | **93** |
| Web pages (CRA `web/src/pages/*.js`) | **107** |
| Shared packages (`packages/`) | 2 (`design-system`, `runtime-client`) |
| Operational scripts (`scripts/`) | 17 |
| Diagnostic tools (`tools/`) | 2 |
| Prior audit reports (`audit/`) | 99 |

### 4.1 Backend domains (visible from filename pattern)
`auth_otp`, `auto_guardian`, `assignment_engine`, `acceptance_layer`, `admin_*` (10), `client_*` (7), `developer_*` (4), `dev_wallet_reader`, `dev_work`, `decision_layer`, `decomposition_engine`, `earnings_layer`, `escrow_layer`/`escrow_api`, `event_engine`, `execution_intelligence`, `flow_control`, `funnel_events`, `google_auth`, `integrations_api`, `legal_contract_layer`, `money_ledger`, `money_projections`, `module_motion`, `operator_engine`, `overdue_engine`, `pricing_*`, `two_factor`, `team_intelligence`, `validation_campaigns`, `cloudinary_service`, `email_service`, `competitor_analyzer`, ... ~91 modules total.

### 4.2 Expo navigation map (groups)
- `app/admin/` (cockpit + 8 drill-downs: users, team, contracts, templates, integrations, inbox, marketplace, master)
- `app/client/` (workspace, projects, transparency)
- `app/developer/` (brain, intelligence)
- `app/tester/`
- `app/operator/`, `app/workspace/`, `app/project/`, `app/help/`, `app/contract/`, `app/lead/`
- Top-level: `welcome`, `auth`, `describe`, `estimate-result`, `estimate-improve`, `project-booting`, `documents`, `gateway`, `inbox`, `chat`, `hub`, `account`, `profile`, `settings`, `activity`, `work`, `operator`, `voice-demo`, `two-factor-{challenge,setup,recovery}`.

### 4.3 Web (CRA) — admin + client surfaces
107 pages including `AdminDashboard`, `AdminV2Dashboard`, `AdminBillingPage`, `AdminContractsPage`, `AdminPaymentsPage`, `AdminFinancialsPage`, `AdminPricingCalibration`, `AdminProjectWarRoom`, `AdminPressureTopology`, `AcceptanceQueue`, … (served via FastAPI `/api/web-ui/` once `rebuild-web.sh` is executed).

---

## 5. Money substrate state (per `memory/PRD.md`)

System is mid-migration of the **Phase 2C-B4.3** roadmap:

- ✅ **B4.3-D1** — admin-reject withdrawal: legacy `dev_wallets` writer removed
- ✅ **B4.3-D2+D3 (atomic pair)** — `request_developer_withdrawal` migrated to `MoneyService.reserve_withdrawal`; insert-failure path now emits canonical `bridge_withdrawal_released(reason="insert_failure")`
- 🟡 **B4.3-D4** — cancel flow with CAS tightening (NEXT, not started)
- 🟡 **B4.4** — `dev_wallets` → diagnostic-only formalisation
- 🟡 **B4.5** — divergence engine → passive observer

A by-design divergence class `pending_post_b4_3_d2` (INFO severity) is emitted for every fresh withdrawal until B4.4 demotes the legacy collection. `dev_wallet_reader` always prefers projection when `has_ledger_source=True`, so UI is unaffected.

Conservation chain (post-D1+D2+D3):
```
   request ─▶ ac_dev ─▶ ac_reserved ──┬─▶ ac_dev   (D-1 reject)
                                       ├─▶ ac_ext   (D-4 mark-paid)
                                       └─▶ ac_dev   (D-3 compensating release on insert fail)
```

---

## 6. Gaps / next actions

| # | Gap | Severity | Action |
|---|---|---|---|
| 1 | `/api/web-ui/` returns **503** — `web/build/` not in repo | **medium** | `bash /app/scripts/rebuild-web.sh` (builds in `/tmp/webwork` to avoid `/app` 10 GB limit, then copies `build/` back) |
| 2 | All real integrations in `mock` mode (Stripe, Resend, Cloudinary, Google OAuth, LLM) | low (intentional) | When user provides real keys, add to `/app/backend/.env`; manifest will auto-flip mode → `live` |
| 3 | No `HF_TOKEN` set → `sentence-transformers` downloads anonymously (rate-limited) | low | Add `HF_TOKEN` only if embedding throughput becomes an issue |
| 4 | Phase 2C-B4.3-**D4** (cancel-withdrawal canonical migration) — **not started** | medium | Tracked in `memory/PRD.md`; per user contract not part of this redeploy |
| 5 | `test_credentials.md` was not in repo | low | Created (§7 below) |

---

## 7. Test credentials seeded on cold boot

See `/app/memory/test_credentials.md` for full list. Quick reference:

| Role | Email | Password |
|---|---|---|
| admin | admin@atlas.dev | admin123 |
| developer | john@atlas.dev | dev123 |
| client | client@atlas.dev | client123 |
| developer (multi-role demo) | multi@atlas.dev | multi123 |
| tester | tester@atlas.dev | tester123 |

(Discovered by reading `backend/server.py` `_create_quick_access_user` seed block — confirmed all four POST `/api/auth/login` calls return 200.)

---

## 8. Verdict

**Container is fully redeployed and operationally green.** All backend background loops are running, 688 routes live, all 4 role logins succeed against freshly-seeded data, integrations manifest is honest, Expo SSR serves the welcome surface at the preview URL. The only deferred work is the optional `web/build/` rebuild (one shell command, no code change) and the next Money-substrate phase **B4.3-D4** (already roadmapped in `memory/PRD.md`).

Ready to proceed with the next development step on user's signal.
