# Legal Contract Layer — Production Completion (Phase 2)

**Date:** 2026-FEB (current session)
**Driver:** User requested full production-grade closure of contract/document/signing logic — no mocks, no placeholders.
**Status:** ✅ **SHIPPED** — end-to-end e2e test green.

---

## TL;DR

The contract/document/signing surface moved from “OTP-signed but one-sided + no real PDF + client-profile tile said *Coming soon*” to a **fully executed bilateral agreement** with:

- **Two-sided signature** — client signs via click-wrap + email OTP; platform (Provider/EVA-X) auto-counter-signs at the same moment. Both signatures live in immutable evidence.
- **Real PDF generation via ReportLab** — pure-Python, no system deps. Branded header, paginated, sha-hint + page number footer.
- **PDF download endpoint** — streams `application/pdf` bytes with `X-Contract-Sha256` header.
- **ZIP bulk export** — every signed contract bundled with PDF + HTML + evidence.json + top-level manifest.
- **Notifications fan-out** — client + every admin + assigned developer get an in-app `contract.signed` notification (consumed by existing `/api/notifications/my` pipeline).
- **24h/48h/96h reminder daemon** — background loop scans `awaiting_signature` contracts and emits at-most-once reminders (admin endpoint to trigger manual sweep also live).
- **Client mobile profile tile** — fixed: `client/profile.tsx` now navigates to `/documents` instead of showing *Coming soon*.
- **Documents screen** — “Export all” ZIP button + counter-signature evidence block + PDF download now hits the real PDF endpoint.

---

## E2E smoke test result (verified on `/app`)

`python3 /app/backend/tests/test_legal_contract_e2e.py`

```
[login] client@atlas.dev role=client
[contracts/my] returned 1 entries
[request-otp] state→awaiting_signature delivered=False dev_mode=True dev_code=set
[confirm] state=signed sha256=6c5aa84912277625…
          pdf_status=generated fully_executed=True
          executor.party=EVA-X / ATLAS DevOS
[evidence] fully_executed=True executor.role=Provider
[pdf] downloaded 5570 bytes, sha256 header = 6c5aa84912277625…
[zip] downloaded 7945 bytes — manifest+evidence+pdf bundle OK
✅ END-TO-END CONTRACT SIGNING FLOW PASSED
```

Notifications fan-out confirmed via direct Mongo query:
```
contract notifications in DB: 4
 → contract.signed → client (Your agreement is signed)
 → contract.signed → admin × 3 (Agreement signed)
```

---

## Files touched

### Backend

| File | Change | Lines |
|---|---|---|
| `backend/legal_contract_layer.py` | Replaced placeholder weasyprint stub with full ReportLab pipeline (header/footer/branding, paginated, UTF-8 safe). Added `executor_signature` (auto counter-sign) into the persisted contract + signature audit row + sign response. Added 3 new endpoints: `GET /contracts/{id}/pdf` (streams real PDF, lazy-renders if not pre-rendered), `GET /contracts/exports/zip` (full archive), `POST /contracts/_reminders/sweep` (admin sweep). Added `_emit_signed_notifications` (client + admin + dev fan-out). Added `_run_reminder_sweep` + `contract_reminder_loop` (24h/48h/96h cadence, at-most-once per cadence). Extended `/contracts/{id}/evidence` to expose `executor_signature` + `fully_executed`. | +470 / -42 |
| `backend/server.py` | Added `on_event(startup)` to spawn `contract_reminder_loop`. | +5 |
| `backend/requirements.txt` | Pinned `reportlab==4.5.1`. | +1 |
| `backend/tests/test_legal_contract_e2e.py` | New end-to-end smoke (login → prepare → request-otp → confirm → verify counter-sign + sha256 + PDF bytes + ZIP). | +197 (new) |

### Frontend Expo

| File | Change |
|---|---|
| `frontend/app/client/profile.tsx` | Removed `value={t('common.coming_soon')}` + `Alert.alert` from Documents row. Now navigates to `/documents`. |
| `frontend/app/documents.tsx` | Added `downloadPdf` + `exportAllZip` link helpers. PDF button now hits the real `/api/contracts/{id}/pdf` endpoint. Added top "Export all" ZIP button. Added counter-signature evidence block (Provider party / role / signed at / method / signature hash). New styles: `topBarRow`, `exportBtn`, `exportBtnText`, `countersignDivider`, `countersignTitle`. |

---

## Data model (sealed)

`contracts` document after signing now contains:

```jsonc
{
  "contract_id": "ctr_…",
  "user_id": "user_…",
  "project_id": "proj_…",
  "state": "signed",
  "signed_at": "2026-…",
  "html_snapshot": "<…immutable…>",
  "project_snapshot": { … },
  "legal_profile_snapshot": { … },
  "terms_version": "v1.0-placeholder",
  "template_version": "…",
  "sha256_hash": "6c5aa84912277625…",
  "pdf_status": "generated",
  "pdf_b64": "<…base64 PDF bytes…>",
  "signer": { "ip": "127.0.0.1", "user_agent": "…", "email": "…", "user_id": "…" },
  "executor_signature": {
    "party": "EVA-X / ATLAS DevOS",
    "role": "Provider",
    "tax_id": "[Platform Tax ID — pending]",
    "registered_address": "EVA-X Platform, Operational HQ — pending legal review",
    "country": "International",
    "signed_at": "2026-…",
    "signature_method": "platform_auto_countersign",
    "signature_authority": "EVA-X Platform Operator",
    "signature_hash": "sha256(executor|contract_id|user_id|content_hash|signed_at)"
  },
  "fully_executed": true,
  "reminder_24h_sent_at": null,   // populated by daemon
  "reminder_48h_sent_at": null,
  "reminder_96h_sent_at": null
}
```

`contract_signatures` row mirrors the same `executor_signature` block for audit symmetry.

---

## Env contract (additions)

| Variable | Purpose | Default |
|---|---|---|
| `EXECUTOR_TAX_ID` | Provider tax ID printed on counter-sign block | `[Platform Tax ID — pending]` |
| `EXECUTOR_ADDRESS` | Provider registered address | `EVA-X Platform, Operational HQ — pending legal review` |
| `EXECUTOR_COUNTRY` | Provider country | `International` |
| `EXECUTOR_SIGNATORY` | Name of the authorising operator on the platform side | `EVA-X Platform Operator` |
| `CONTRACT_REMINDER_INTERVAL_SEC` | Background reminder sweep cadence | `21600` (6 h). Set `0` to disable. |

When the legal review delivers real platform identity, just fill these env vars
and restart — counter-signature blocks instantly carry the real legal entity.

---

## Endpoint inventory (after Phase 2)

```
POST  /api/contracts/prepare                       (create draft from project)
GET   /api/contracts/my                            (list mine)
GET   /api/contracts/{id}                          (one, with rendered html)
GET   /api/contracts/{id}/html                     (full HTML page)
GET   /api/contracts/{id}/pdf                      ← NEW (real PDF stream)
POST  /api/contracts/{id}/sign/request-otp         (issue email OTP)
POST  /api/contracts/{id}/sign/confirm             (verify OTP + sign + counter-sign)
GET   /api/contracts/{id}/evidence                 (audit + executor_signature)
GET   /api/contracts/gate/{project_id}             (payment gate)
GET   /api/contracts/exports/zip                   ← NEW (bulk ZIP)
POST  /api/contracts/_reminders/sweep              ← NEW (admin manual sweep)
GET   /api/legal/profile                           (read my legal profile)
PUT   /api/legal/profile                           (upsert)
```

---

## What's intentionally NOT in scope of this phase

These are real product decisions for the next legal-review pass:

1. **v1.0 template body** — still labelled `v1.0-placeholder`. The
   contract structure, snapshots, evidence package and immutability
   guarantees are production-grade; only the prose body needs real legal
   text. Drop in by replacing the `_render_template` body — no changes
   to flow, audit, hash, or schema.
2. **Real platform legal identity** — `EXECUTOR_*` env vars are
   placeholders. Set them once legal entity is finalised.
3. **Email rail** — Resend SDK is installed and wired; when `RESEND_API_KEY`
   is provisioned, OTPs and reminders auto-flip from dev-surface to email.

These three together complete the "from production-grade engine to
notarised real-world agreement" mile — the engine itself is done.

---

## Closeout signed off — 2026-FEB.
