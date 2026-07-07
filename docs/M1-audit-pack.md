# M1 Audit Pack — Polestar Advisory Workbench

**Milestone:** M1 — Live baseline audit & locked priority order  
**Date:** 7 July 2026  
**Auditor:** Tommy To
**Production URL:** `https://document-asset-manager-stioffain29.replit.app/`  
**Scope:** Audit and plan only — no code fixes in M1  
**Basis:** Live production walkthrough + codebase review (`docs/workbench-audit-2026-06-17.md`, `replit.md`, `threat_model.md`, integration probes)

---

## Executive summary

| Area | Rating | One-line verdict |
|------|--------|------------------|
| **Overall** | **AMBER** | Usable foundation; commercially incomplete without workflow, PDF polish, and distribution |
| Live app stability | AMBER | Core pipeline works; optional integrations and admin controls need triage |
| Source Health accuracy | AMBER | Unified integration status exists; several rows need owner decision (on vs intentionally off) |
| Report / PDF quality | AMBER | Strong templates; not consistently customer-demo ready |
| Workflow | RED vs Phase 2 | Thin pipeline (`draft` / `review` / `published`); no approval gates or distribution |
| Distribution | Not built | Correctly deferred to M6 |
| Engineering quality | GREEN | 80+ tests, typecheck clean, contract-first API |

**Recommendation:** Sign off M2 stabilisation backlog, then fund **M3 → M4 → M5 → M6** in that order (see Appendix A).

---

## 1. Live app checklist

Walk every core route on **production** while signed in as owner. Capture screenshot + URL for each row.

### 1.1 Core pages

| # | Route | Purpose | Load OK? | Empty/error states OK? | Notes | Evidence |
|---|-------|---------|----------|------------------------|-------|----------|
| 1 | `/` | Dashboard / KPIs, topic cards, recent incidents | `[ ]` | `[ ]` | Not a command centre — no report pipeline, no attention queue | `[SCREENSHOT]` `[URL]` |
| 2 | `/incidents` | Incident list + filters | `[ ]` | `[ ]` | | `[SCREENSHOT]` |
| 3 | `/map` | Incident map + optional Liveuamap overlay | `[ ]` | `[ ]` | Overlay may be empty if upstream blocks egress IP | `[SCREENSHOT]` |
| 4 | `/reports` | Report list | `[ ]` | `[ ]` | Filter by topic/status only; no owner, due date, pipeline view | `[SCREENSHOT]` |
| 5 | `/reports/:id` | Report editor + preview + PDF | `[ ]` | `[ ]` | PDF export not gated by approval status | `[SCREENSHOT]` |
| 6 | `/sources` | Source Health + integrations panel | `[ ]` | `[ ]` | Admin token required for source mutations | `[SCREENSHOT]` |
| 7 | `/countries` | Country report index | `[ ]` | `[ ]` | | `[SCREENSHOT]` |
| 8 | `/countries/:slug` | Country report builder (PNG, Indonesia, Jakarta, etc.) | `[ ]` | `[ ]` | Per-country pages are partly code-driven | `[SCREENSHOT]` |
| 9 | `/topics/shipping` | Shipping monitor | `[ ]` | `[ ]` | | `[SCREENSHOT]` |
| 10 | `/topics/cargo-watch` | Cargo Watch monitor | `[ ]` | `[ ]` | | `[SCREENSHOT]` |
| 11 | `/calendar` | Publication calendar | `[ ]` | `[ ]` | Read-only cadence display | `[SCREENSHOT]` |
| 12 | `/spot-reports` | Spot reports | `[ ]` | `[ ]` | Owner session only (no admin token) | `[SCREENSHOT]` |

### 1.2 Auth & access

| Check | Expected | Verified? | Evidence |
|-------|----------|-----------|----------|
| Unauthenticated user blocked from data routes | 401 / login redirect | `[ ]` | Replit Auth + `requireOwner` on all data routers |
| Non-owner Replit account blocked | 403 | `[ ]` | `[SCREENSHOT]` |
| `GET /api/healthz` public | 200 | `[ ]` | |
| `GET /api/access` returns `{authenticated, allowed}` | 200 | `[ ]` | |

### 1.3 Ingest scheduler (production)

| Check | Expected | Verified? | Evidence |
|-------|----------|-----------|----------|
| Scheduler enabled (`INGEST_SCHEDULE_ENABLED` ≠ `false`) | Boot + recurring ingest | `[ ]` | Check server logs after deploy |
| Stale data triggers boot catch-up | Incidents/prices refresh when older than `INGEST_INTERVAL_HOURS` (default 12h) | `[ ]` | |
| Ingest failures visible (not silent) | WARN logs + Source Health degradation | `[ ]` | `[LOG SNIPPET]` |
| Manual ingest (`POST /api/admin/ingest`) | 503 if no token; 401 if wrong token; 200 if token set | `[ ]` | |

### 1.4 Performance spot-check

| Check | Observation | Pass? |
|-------|-------------|-------|
| Dashboard incident fetch bounded | Fetches max 1-year window, not full table | `[ ]` Code confirms bound in `Dashboard.tsx` |
| Core pages load in &lt; 5s on production | `[OWNER: note timing]` | `[ ]` |
| PDF generation completes without timeout | Country + one topic report smoke | `[ ]` |

---

## 2. Source Health truth table

**Classification key (M1 acceptance):**

| Classification | Meaning |
|----------------|---------|
| **Working** | Configured and producing useful output |
| **Intentionally off** | Deliberately disabled or not provisioned; UI should say so clearly |
| **Broken** | Configured but failing; needs fix or owner action |
| **Pending** | Built but awaiting external approval (e.g. ReliefWeb appname) |

### 2.1 Core data feeds (RSS / prices — required for product)

| Source | Purpose | Classification | Action owner | Evidence / notes |
|--------|---------|----------------|--------------|------------------|
| Google News RSS | Discovery for all topic feeds | **Working** | — | `[OWNER: confirm last success on Source Health]` |
| FRED | Brent / WTI / jet fuel | **Working** | — | No API key required |
| Yahoo Finance | Crude close (FRED fallback) | **Working** | Dev | Public endpoint; reliability risk if shape changes |
| World Bank Pink Sheet | Fertiliser prices | **Working** | — | |
| Google News URL resolution | De-opaque links | **Working** | — | Non-fatal on failure |
| Internal geocoder | Incident coordinates | **Working** | — | Local lookup |
| Postgres | Persistence | **Working** | — | |

### 2.2 Optional external integrations (`GET /api/integrations/status`)

| Integration key | Label | Classification | Action owner | Evidence / notes |
|-----------------|-------|----------------|--------------|------------------|
| `admin_controls` | Admin operator controls | `[ ] Working` / `[ ] Intentionally off` | **Owner** | `INGEST_ADMIN_TOKEN` — gates manual ingest, source CRUD, backfill |
| `gdelt` | GDELT Conflict Events | `[ ]` | Owner | Needs `GDELT_CLOUD_API_KEY` + `GDELT_ENRICH_ENABLED` |
| `gdelt_structured` | GDELT structured event layer | `[ ]` | Owner | Same key; QU budget ~240 calls/mo at daily cadence |
| `reliefweb` | ReliefWeb corroboration | `[ ]` | **Owner + ReliefWeb** | Needs approved `RELIEFWEB_APPNAME` |
| `reliefweb_reports` | ReliefWeb situational reports | `[ ] Pending` / `[ ] Intentionally off` | **Owner + ReliefWeb** | Appname approval + egress validation |
| `liveuamap` | Live map overlay | `[ ] Broken` / `[ ] Intentionally off` | **Owner + Liveuamap** | Key may be set but upstream 403 on server egress IP |
| `openai` | AI prose + headline translation | `[ ]` | **Owner** | `AI_INTEGRATIONS_OPENAI_*` — template fallback when off |
| `ais_movement` | AIS vessel movement sample | `[ ]` | Owner | `AISSTREAM_API_KEY` or `AIS_API_KEY`; free tier = Asian straits only |
| `vessel_registry` | Cargo-type vessel lookup | **Intentionally off** | Owner | `VESSEL_REGISTRY_ENABLED=false` (cost kill-switch) |
| `social_watch_instagram` | KAMMI Instagram OSINT | `[ ]` | Owner | Optional social channel |
| `tapa_iis` | TAPA IIS feed | `[ ]` | Owner | APAC local source health |
| `x_cargo_osint` | X / cargo OSINT | `[ ]` | Owner | |

`[OWNER ACTION: open Source Health → External Integrations on production; copy each row's status + summary into this table and tick classification.]`

### 2.3 Source Health UI honesty (M2 target)

| Issue | Today | M2 fix |
|-------|-------|--------|
| Unconfigured optional integrations show as failures | Partially addressed via `not_configured` / `pending` states | Align every row with truth table above |
| ReliefWeb pending vs broken | `pending` state exists in code | Owner decides: pursue approval or mark intentionally off |
| Liveuamap empty overlay | May look "broken" without clear message | Clear global "overlay unavailable" if IP blocked |

---

## 3. Report quality scorecard

**Method:** Export one sample PDF per priority product from **production** (in-app Download PDF). Assess against customer-demo bar (usable in a sales conversation without manual reformatting).

**Priority products (locked for M4):** Country Reports, Shipping, Flashpoint, Fuel

### 3.1 Scorecard

| Product | Sample report ID / slug | PDF generated? | Layout & typography | Maps in PDF | Tables & charts | Preview ↔ PDF match | **Pass / Fail** | Notes |
|---------|-------------------------|----------------|---------------------|-------------|-----------------|----------------------|-----------------|-------|
| **Country** | `[e.g. PNG / Indonesia slug]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | **Fail** | Per-country pages partly bespoke; map rasterisation risk |
| **Shipping** | `[report ID]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | **Fail** | jsPDF builder path; chokepoint map quality |
| **Flashpoint** | `[report ID]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | **Fail** | DOM rasterisation generally good; verify section breaks |
| **Fuel** | `[report ID]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | **Fail** | jsPDF chart replicas (`exportTopicReportPdf.ts`) — parity drift risk |

`[OWNER: attach sample PDFs to audit pack folder or link paths]`

### 3.2 Cross-cutting PDF issues (code review)

| Issue | Severity | M4 fix |
|-------|----------|--------|
| Multiple export paths (DOM rasterise vs jsPDF builders) | Medium | Parity audit per priority product |
| Font discipline (`setRoboto` only) | Low | Gate exists in `validateFonts.sh` for country briefs |
| Magic page-break constants | Medium | Any UI change can break PDF pagination |
| Map export quality | Medium | Dedicated print stylesheet / static map snapshot |
| "Data as of" line | OK | Present in preview + `drawDataAsOf` in headless builders |

### 3.3 Map tool (UI, not PDF)

| Capability | Built? | Gap |
|------------|--------|-----|
| Incident markers by severity | Yes | |
| Liveuamap overlay | Partial | Upstream / IP dependency |
| Unified filter bar (country, product, date, severity, category) | No | M4 |
| Clustering | No | M4 |
| One-click incident → report builder | No | M4 |
| Export-quality map tiles | No | M4 |

---

## 4. Workflow gap map

### 4.1 Today (as built)

| Capability | Status | Where |
|------------|--------|-------|
| Report statuses | `draft` \| `review` \| `published` | `topics.ts` → `REPORT_STATUSES` |
| Status change | Manual dropdown in editor | No submit/approve actions |
| Due date | **Missing** | Not in `reports` schema |
| Owner / assignee | **Missing** | `author` field only |
| Review / approval status | **Missing** | `review` ≠ formal approval |
| Export status | **Missing** | |
| Distribution status | **Missing** | |
| Export PDF gate | **None** | Any status can export |
| Send / email / WhatsApp | **Not implemented** | |
| Version history | **Missing** | |
| Event log / audit trail | **Missing** | |
| Homepage attention queue | **Missing** | Dashboard shows KPIs only |
| Report pipeline view | **Missing** | Flat list with topic/status filter |
| Executive Summary persistence | **Partially fixed** | DB column `executive_summary` exists; legacy localStorage fallback for old reports |

### 4.2 Target (M3 requirements)

| Capability | M3 deliverable |
|------------|----------------|
| Status enum | `draft` → `in_review` → `approved` → `exported` → `sent` → `archived` |
| Schema fields | `due_date`, `owner`, `review_status`, `approval_status`, `export_status`, `distribution_status`, `approved_at`, `approved_by`, `last_edited_at` |
| Server rules | Export at `approved+`; send at `approved` + `distribution_status = ready` |
| UI | Command-centre homepage; report kanban/list; submit for review; approve |
| Audit | `report_events` table |

### 4.3 Explicitly deferred (not M3)

| Capability | Milestone |
|------------|-----------|
| Email distribution lists & templates | **M6** |
| WhatsApp share pack | **M6** |
| Customer-grade PDF polish | **M4** |
| Self-service country/product admin | **M5** |

### 4.4 Gap diagram

```
TODAY                          M3 TARGET                    M6 (later)
─────                          ─────────                    ──────────
draft ──┐                      draft                        approved + ready
review  ├── any status ──PDF    in_review ──approve──┐      │
published┘                      approved ──export─────┼──► email / WhatsApp
(no gate)                       exported / sent       │      (server-gated)
                                archived              │
```

---

## 5. Risk register

| ID | Risk | Likelihood | Impact | Owner | Mitigation / M2 action |
|----|------|------------|--------|-------|------------------------|
| R1 | ReliefWeb appname not approved → 403 | High | Medium | **Owner** | Request approval at reliefweb.int; until then mark **Intentionally off** |
| R2 | Liveuamap blocks server egress IP | High | Low–Med | **Owner + Liveuamap** | IP whitelist request; else mark degraded, clear UI message |
| R3 | `INGEST_ADMIN_TOKEN` not set | Med | Med | **Owner** | Set secret → re-enable manual ingest + source editing |
| R4 | OpenAI integration not provisioned | Med | Med | **Owner** | Add Replit AI integration OR accept template-only prose |
| R5 | GDELT / vessel registry cost overrun | Low | Low | Owner | Keep `VESSEL_REGISTRY_ENABLED=false`; cap GDELT structured cadence |
| R6 | Preview ↔ PDF drift on jsPDF topics | Med | High | Dev (M4) | Parity audit Fuel + Shipping + Flashpoint |
| R7 | Boot-time migrations grow fragile | Low | Med | Dev (M2+) | Document; consider drizzle-kit migrations long-term |
| R8 | No approval gate before customer send | High | High | Dev (M3→M6) | Server-enforced workflow before M6 |
| R9 | Executive Summary legacy localStorage | Low | Low | Dev (M3) | Migrate reads to DB-only; clear legacy keys on save |
| R10 | Public URL + owner-only auth | Low | Med | Owner | Replit Auth enforced; verify non-owner 403 on prod |

---

## 6. Engineering baseline (context only — not M1 acceptance)

| Metric | Value (July 2026) |
|--------|-------------------|
| Test files | 80+ under `__tests__/` |
| Typecheck | Clean across workspace packages |
| API contract | OpenAPI → Orval hooks + Zod |
| Auth | Replit Auth; `requireOwner` on data routes |
| Ingest | `runIngestOnce` + advisory lock; automatic scheduler |
| PDF rule | Preview and PDF must not disagree (product rule in `replit.md`) |

*Note: June 2026 `AUDIT.md` stated zero tests — superseded; test suite has since been added.*

---

## Appendix A — Priority order for M3–M6 (locked)

| Rank | Milestone | Cost | Rationale |
|------|-----------|------|-----------|
| 1 | **M3** — Command centre & approval workflow | $1,200 | Biggest daily-ops gap; blocks M6 |
| 2 | **M4** — Professional reports & PDFs | $1,000 | Customer-demo quality; export gates need M3 |
| 3 | **M5** — Country & product expansion | $1,000 | Scale after pipeline + PDF bar proven |
| 4 | **M6** — Email & WhatsApp distribution | $800 | Requires approved reports + attachable PDFs |

**Hard rule:** No automated customer distribution. WhatsApp = share pack (`wa.me` + message + PDF), not Business API.

**Out of scope (full Phase 2):** platform rebuild, multi-tenant portal, auto-send, Windward AIS, full no-code product builder.

---

## Appendix B — M2 fix backlog (numbered, for sign-off)

Pull from this audit. Estimate days are guide only.

| # | Item | Must-fix / Defer | Est. | Acceptance test |
|---|------|------------------|------|-----------------|
| B1 | Set `INGEST_ADMIN_TOKEN` OR mark admin controls intentionally off in truth table | Must-fix | 0.5d | Manual ingest returns 200 with token; Source Health matches |
| B2 | ReliefWeb: approve appname OR mark both ReliefWeb rows intentionally off | Must-fix | 0.5d | No false "failing" noise on Source Health |
| B3 | Liveuamap: whitelist IP OR clear "overlay unavailable" global state | Must-fix | 1d | Map page honest when overlay empty |
| B4 | OpenAI: provision OR prose route uses template (no 503) | Must-fix | 1d | Country prose returns 200 with template |
| B5 | Core route reliability pass (dashboard, incidents, map, reports, editor, sources) | Must-fix | 2d | All routes load; errors user-visible |
| B6 | Ingest scheduler: failures visible in logs + Source Health | Must-fix | 1d | Simulated failure surfaces within one cycle |
| B7 | Loading / empty / error states on core pages | Must-fix | 2d | No blank screens on API failure |
| B8 | Dashboard fetch bounds / aggregates if slow on prod | Defer | 1d | Dashboard &lt; 5s with growing incident table |
| B9 | Smoke PDF: Country + one topic report generates | Must-fix | 0.5d | PDF downloads without error (quality = M4) |
| B10 | Integration status tests pinned (`integrationStatus.test.ts`) | Must-fix | 1d | CI/typecheck + tests green |
| B11 | Executive Summary: confirm DB persistence; remove legacy localStorage on save | Defer → M3 | 0.5d | Summary survives cross-browser open |
| B12 | Persist any other localStorage-only editor fields | Defer | 1d | Audit complete |

**M2 total (must-fix):** ~9–10 dev-days (within $1,000 / 10–14 day envelope)

---

## Appendix C — Owner sign-off

### C.1 M1 Audit Pack acceptance

| Criterion | Met? |
|-----------|------|
| Audit Pack covers live app, sources, report quality, workflow, risks **with evidence** | `[ ]` |
| Every source row classified: Working \| Intentionally off \| Broken \| Pending | `[ ]` |
| One sample PDF assessed per priority product with pass/fail notes | `[ ]` |
| Workflow gap doc: today vs M3; distribution deferred to M6 | `[x]` (Section 4) |
| Priority order M3–M6 signed off | `[ ]` |
| M2 backlog agreed with acceptance tests | `[ ]` |

### C.2 Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Owner | | | |
| Developer | | | |

**Revision round:** One included in M1. Notes: _________________________________

---

## Appendix D — Evidence index

| # | Artifact | Path / link |
|---|----------|-------------|
| E1 | Live dashboard screenshot | `[ ]` |
| E2 | Source Health screenshot | `[ ]` |
| E3 | Integration status JSON export | `GET /api/integrations/status` |
| E4 | Sample PDF — Country | `[ ]` |
| E5 | Sample PDF — Shipping | `[ ]` |
| E6 | Sample PDF — Flashpoint | `[ ]` |
| E7 | Sample PDF — Fuel | `[ ]` |
| E8 | Ingest scheduler log excerpt | `[ ]` |
| E9 | Prior code audit | `docs/workbench-audit-2026-06-17.md` |
| E10 | Phase 2 commercial proposal | `Phase 2 Proposal.docx` |

---

*End of M1 Audit Pack — fill `[OWNER]` and `[ ]` items during live production walkthrough, then sign Appendix C.*
