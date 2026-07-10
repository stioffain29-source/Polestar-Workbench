# M1 Audit Pack — Polestar Advisory Workbench

**Document version:** 1.0 (Word export)  
**Milestone:** M1 — Live baseline audit and locked priority order  
**Date:** 8 July 2026  
**Auditor:** Tommy To  
**Production URL:** https://document-asset-manager-stioffain29.replit.app/  
**Scope:** Audit and plan only — no code fixes in M1  

**Basis:** Dev-led audit — codebase review, unauthenticated production API probes (8 Jul 2026), prior workbench audit (docs/workbench-audit-2026-06-17.md), and in-repo PDF/font audit artifacts (docs/m1-evidence/). No joint live walkthrough required. Owner may correct any row during M2 if secrets have changed.

**Evidence bundle:** Attach or store alongside this document: docs/m1-evidence/ (screenshots, sample PDF, font audit log).

## Executive summary

| Area | Rating | One-line verdict |
|------|--------|------------------|
| Overall | AMBER | Usable foundation; commercially incomplete without workflow, PDF polish, and distribution |
| Live app stability | AMBER | Core pipeline works; optional integrations and admin controls need triage |
| Source Health accuracy | AMBER | Unified integration status exists; optional rows classified below |
| Report / PDF quality | AMBER | Strong templates; not consistently customer-demo ready |
| Workflow | RED vs Phase 2 | Thin pipeline (draft / review / published); no approval gates or distribution |
| Distribution | Not built | Correctly deferred to M6 |
| Engineering quality | GREEN | 80+ tests, typecheck clean, contract-first API |

**Recommendation:** Sign off M2 stabilisation backlog, then fund M3, then M4, then M5, then M6 in that order (see Appendix A).

## Action responsibility (M1 evidence vs M2 delivery)

| Who | Responsibility | When |
|-----|----------------|------|
| Owner | Sign Appendix C; confirm integration decisions still match production secrets; provision keys/approvals if turning integrations on | M1 sign-off and ongoing |
| Dev | Complete this audit pack with code/probe/repo evidence; deliver M2 backlog | M1 now; M2 after sign-off |
| Owner + Dev | Owner sets environment; dev ensures Source Health UI matches truth table (Appendix B items B1–B4) | M2 must-fix |

**Owner actions at sign-off (confirm, not collect)**

- Review Section 2.2 classifications; flag any row where production secrets differ from this audit.
- Sign Appendix C to lock M3–M6 priority order and M2 backlog.
- Optional later: provision ReliefWeb, Liveuamap whitelist, OpenAI, or GDELT if the product needs them.

**Dev actions (M2 — after M1 locked)**

- Appendix B items B5–B10: route reliability, error states, integration status tests, smoke PDF path.
- Appendix B items B1–B4: align Source Health UI with classifications below.
- M3+ workflow, PDF polish (M4), distribution (M6) per locked priority order.

## 1. Live app checklist

Core routes assessed by dev audit: route inventory, June 2026 workbench audit (live data, end-to-end report to PDF), production URL, and one in-repo production screenshot.

**Verification legend**

| Symbol | Meaning |
|--------|---------|
| Yes (Code) | Confirmed in repository |
| Yes (Prod) | Unauthenticated production probe |
| Yes (Dev audit) | Prior audit plus route/code review |
| No | Not independently verified on production UI |

### 1.1 Core pages

| # | Route | Purpose | Load OK? | Empty/error states OK? | Notes |
|---|-------|---------|----------|------------------------|-------|
| 1 | / | Dashboard, KPIs, topic cards, recent incidents | Yes (Dev audit) | Yes (Dev audit) | Not a command centre — no report pipeline or attention queue |
| 2 | /incidents | Incident list and filters | Yes (Dev audit) | Yes (Dev audit) | API listIncidents capped at 365 days |
| 3 | /map | Incident map and optional Liveuamap overlay | Yes (Dev audit) | No | Overlay empty when Liveuamap upstream blocks IP (Section 2.2) |
| 4 | /reports | Report list | Yes (Dev audit) | Yes (Dev audit) | Filter by topic/status only; no owner, due date, or pipeline view |
| 5 | /reports/:id | Report editor, preview, PDF | Yes (Dev audit) | Yes (Dev audit) | PDF export not gated by approval status |
| 6 | /sources | Source Health and integrations panel | Yes (Dev audit) | Yes (Dev audit) | Admin token required for source mutations |
| 7 | /countries | Country report index | Yes (Dev audit) | Yes (Dev audit) | |
| 8 | /countries/:slug | Country report builder | Yes (Dev audit) | Yes (Dev audit) | Per-country pages partly code-driven |
| 9 | /topics/shipping | Shipping monitor | Yes (Dev audit) | Yes (Dev audit) | |
| 10 | /topics/cargo-watch | Cargo Watch monitor | Yes (Dev audit) | Yes (Dev audit) | |
| 11 | /calendar | Publication calendar | Yes (Dev audit) | Yes (Dev audit) | Read-only cadence display |
| 12 | /spot-reports | Spot reports | Yes (Dev audit) | Yes (Dev audit) | Owner session only (no admin token) |

**Evidence references (Section 1.1):** June 2026 workbench audit Section A; production screenshot E1 (Appendix D); country PDF sample Section 3.1.

### 1.2 Auth and access

| Check | Expected | Verified? | Evidence |
|-------|----------|-----------|----------|
| Unauthenticated user blocked from data routes | 401 or login redirect | Yes (Code), Yes (Prod) | requireOwner on data routers; GET /api/incidents returned 401 on 8 Jul 2026 |
| Non-owner Replit account blocked | 403 | Yes (Code) | requireOwner returns 403 when authenticated but not owner; not re-tested with second account |
| GET /api/healthz public | 200 | Yes (Prod) | 200 with body {"status":"ok"} on 8 Jul 2026 |
| GET /api/access returns authenticated and allowed flags | 200 | Yes (Prod) | 200 with {"authenticated":false,"allowed":false} when logged out |

### 1.3 Ingest scheduler (production)

| Check | Expected | Verified? | Evidence |
|-------|----------|-----------|----------|
| Scheduler enabled (INGEST_SCHEDULE_ENABLED is not false) | Boot and recurring ingest | Yes (Code), Yes (Dev audit) | Default on when unset; June audit boot log shows scheduler start |
| Stale data triggers boot catch-up | Refresh when older than INGEST_INTERVAL_HOURS (default 12h) | Yes (Code), Yes (Dev audit) | June audit confirms live prices |
| Ingest failures visible (not silent) | WARN logs and Source Health degradation | Yes (Code) | summarizeIngestFailures and recordSourceHealth; June boot hadFailures: false |
| Manual ingest POST /api/admin/ingest | 503 if no token; 401 if wrong token; 200 if token set | Yes (Code), Yes (Prod) | Prod: no token returned 401 (token is configured) on 8 Jul 2026 |

### 1.4 Performance spot-check

| Check | Observation | Pass? |
|-------|-------------|-------|
| Dashboard incident fetch bounded | Fetches max 1-year window, not full table | Yes (Code) — API caps days at 365 |
| Core pages load in under 5s on production | Not timed in this audit | No — defer to M2 item B8 if slow |
| PDF generation completes without timeout | Country and topic reports export via headless builders | Yes (Dev audit) — font audit PASS; see Appendix D E3 and E4 |

## 2. Source Health truth table

**Classification key (M1 acceptance)**

| Classification | Meaning |
|----------------|---------|
| Working | Configured and producing useful output |
| Intentionally off | Deliberately disabled or not provisioned; UI should say so clearly |
| Broken | Configured but failing; needs fix or owner action |
| Pending | Built but awaiting external approval (e.g. ReliefWeb appname) |

### 2.1 Core data feeds (RSS and prices — required for product)

| Source | Purpose | Classification | Action owner | Notes |
|--------|---------|----------------|--------------|-------|
| Google News RSS | Discovery for all topic feeds | Working | — | June audit: live, data fresh |
| FRED | Brent, WTI, jet fuel | Working | — | No API key required |
| Yahoo Finance | Crude close (FRED fallback) | Working | Dev | Public endpoint; reliability risk if shape changes |
| World Bank Pink Sheet | Fertiliser prices | Working | — | |
| Google News URL resolution | De-opaque links | Working | — | Non-fatal on failure |
| Internal geocoder | Incident coordinates | Working | — | Local lookup |
| Postgres | Persistence | Working | — | |

### 2.2 Optional external integrations

Classifications are dev-audit (see Appendix D item E2). Owner may override at sign-off if secrets changed.

| Integration key | Label | M1 classification | Action | Expected API/UI status |
|-----------------|-------|---------------------|--------|------------------------|
| admin_controls | Admin operator controls | Working | Owner (token custody) | configured: true |
| gdelt | GDELT Conflict Events | Intentionally off | Owner | not_configured |
| gdelt_structured | GDELT structured event layer | Intentionally off | Owner | not_configured or disabled |
| reliefweb | ReliefWeb corroboration | Pending | Owner + ReliefWeb | pending |
| reliefweb_reports | ReliefWeb situational reports | Pending | Owner + ReliefWeb | pending |
| liveuamap | Live map overlay | Broken | Owner + Liveuamap | failing_upstream |
| openai | AI prose and headline translation | Intentionally off | Owner | not_configured |
| ais_movement | AIS vessel movement sample | Intentionally off | Owner | not_configured or disabled |
| vessel_registry | Cargo-type vessel lookup | Intentionally off | Owner | disabled |
| social_watch_instagram | KAMMI Instagram OSINT | Intentionally off | Owner | not_configured |
| tapa_iis | TAPA IIS feed | Intentionally off | Owner | N/A (offline) |
| x_cargo_osint | X / cargo OSINT | Intentionally off | Owner | not_configured |

**Integration evidence notes**

- **admin_controls:** INGEST_ADMIN_TOKEN set on production. POST /api/admin/ingest without token returned 401 (not 503) on 8 Jul 2026. Changed since June audit when token was unset.
- **gdelt / gdelt_structured:** No GDELT_CLOUD_API_KEY (June audit). Provision to enable.
- **reliefweb / reliefweb_reports:** RELIEFWEB_APPNAME not approved; v2 API returns 403 for unapproved appnames.
- **liveuamap:** LIVEUAMAP_API_KEY present (June audit) but upstream returns 403 on server egress IP. Whitelist or accept off.
- **openai:** No AI_INTEGRATIONS_OPENAI keys (June audit). Prose route returns 200 with template fallback (no 503).
- **ais_movement:** Requires AISSTREAM_API_KEY or AIS_API_KEY; free tier covers Asian straits only when on.
- **vessel_registry:** VESSEL_REGISTRY_ENABLED=false cost kill-switch.
- **social_watch_instagram:** APIFY_TOKEN optional; manual CLI only.
- **tapa_iis:** Offline HTML import only; manual admin promote endpoint; not scheduled.
- **x_cargo_osint:** X_BEARER_TOKEN; manual CLI only.

**Dev (M2):** Source Health UI must match this table — no false "failing" for intentionally off rows (Appendix B items B1–B4, B10).

### 2.3 Source Health UI honesty (M2 target)

| Issue | Today | M2 fix |
|-------|-------|--------|
| Unconfigured optional integrations show as failures | Partially addressed via not_configured and pending states | Align every row with truth table above |
| ReliefWeb pending vs broken | pending state exists in code | Owner decides: pursue approval or mark intentionally off |
| Liveuamap empty overlay | May look broken without clear message | Clear global "overlay unavailable" if IP blocked |

## 3. Report quality scorecard

**Method:** Headless PDF export from live database plus in-app editor screenshot from production (Jun 2026). Assessed against customer-demo bar: structurally usable; not sales-demo polished (M4).

**Priority products (locked for M4):** Country Reports, Shipping, Flashpoint, Fuel

### 3.1 Scorecard

| Product | Sample ID / slug | PDF generated | Layout OK | Maps OK | Tables/charts OK | Preview vs PDF | Result | Quality milestone |
|---------|------------------|---------------|-----------|---------|------------------|----------------|--------|-------------------|
| Country | indonesia | Yes | Yes | Yes | Yes | Yes | Fail | M4 |
| Shipping | latest shipping report | Yes | Yes | No | Yes | No | Fail | M4 |
| Flashpoint | latest flashpoint report | Yes | Yes | Yes | Yes | Yes | Fail | M4 |
| Fuel | latest fuel report | Yes | Yes | N/A | Yes | No | Fail | M4 |

**Result key:** Fail means not customer-demo ready. Export works. Quality fixes are M4.

**Sample evidence (Appendix D):** E4 country PDF; E3 topic font audit log for shipping, flashpoint, and fuel.

**Product notes**

- **Country:** Roboto font audit PASS; per-country bespoke layout; map rasterisation risk.
- **Shipping:** jsPDF builder path; chokepoint map quality concern.
- **Flashpoint:** DOM rasterisation generally good; 7-page sample.
- **Fuel:** jsPDF chart replicas; preview vs PDF parity drift risk.

### 3.2 Cross-cutting PDF issues (code review)

| Issue | Severity | M4 fix |
|-------|----------|--------|
| Multiple export paths (DOM rasterise vs jsPDF builders) | Medium | Parity audit per priority product |
| Font discipline (Roboto only) | Low | Gate exists for country briefs |
| Magic page-break constants | Medium | Any UI change can break PDF pagination |
| Map export quality | Medium | Dedicated print stylesheet or static map snapshot |
| "Data as of" line | OK | Present in preview and headless builders |

### 3.3 Map tool (UI, not PDF)

| Capability | Built? | Gap |
|------------|--------|-----|
| Incident markers by severity | Yes | |
| Liveuamap overlay | Partial | Upstream / IP dependency |
| Unified filter bar | No | M4 |
| Clustering | No | M4 |
| One-click incident to report builder | No | M4 |
| Export-quality map tiles | No | M4 |

## 4. Workflow gap map

### 4.1 Today (as built)

| Capability | Status | Where |
|------------|--------|-------|
| Report statuses | draft, review, published | topics.ts REPORT_STATUSES |
| Status change | Manual dropdown in editor | No submit/approve actions |
| Due date | Missing | Not in reports schema |
| Owner / assignee | Missing | author field only |
| Review / approval status | Missing | review is not formal approval |
| Export status | Missing | |
| Distribution status | Missing | |
| Export PDF gate | None | Any status can export |
| Send / email / WhatsApp | Not implemented | |
| Version history | Missing | |
| Event log / audit trail | Missing | |
| Homepage attention queue | Missing | Dashboard shows KPIs only |
| Report pipeline view | Missing | Flat list with topic/status filter |
| Executive Summary persistence | Partially fixed | DB column exists; legacy localStorage fallback for old reports |

### 4.2 Target (M3 requirements)

| Capability | M3 deliverable |
|------------|----------------|
| Status enum | draft, in_review, approved, exported, sent, archived |
| Schema fields | due_date, owner, review_status, approval_status, export_status, distribution_status, approved_at, approved_by, last_edited_at |
| Server rules | Export at approved or later; send at approved plus distribution_status ready |
| UI | Command-centre homepage; report kanban/list; submit for review; approve |
| Audit | report_events table |

### 4.3 Explicitly deferred (not M3)

| Capability | Milestone |
|------------|-----------|
| Email distribution lists and templates | M6 |
| WhatsApp share pack | M6 |
| Customer-grade PDF polish | M4 |
| Self-service country/product admin | M5 |

### 4.4 Workflow comparison (today vs target)

| Stage | Today | M3 target | M6 (later) |
|-------|-------|-----------|------------|
| Draft | Yes — no gate on PDF export | Yes — submit moves to in_review | |
| Review | Manual status dropdown only | Formal in_review with approve action | |
| Approved | Not implemented | Required before export/send | Required before distribution |
| Exported | Not tracked | Tracked status | |
| Sent / distributed | Not implemented | sent status | Email and WhatsApp share pack (server-gated) |
| Archived | Not implemented | archived status | |

## 5. Risk register

| ID | Risk | Likelihood | Impact | Owner | Mitigation / M2 action |
|----|------|------------|--------|-------|------------------------|
| R1 | ReliefWeb appname not approved | High | Medium | Owner | Request approval; until then mark Pending or Intentionally off |
| R2 | Liveuamap blocks server egress IP | High | Low–Med | Owner + Liveuamap | IP whitelist request; else clear UI message |
| R3 | INGEST_ADMIN_TOKEN not set | Low | Med | Owner | Resolved since June audit — prod probe shows token configured |
| R4 | OpenAI integration not provisioned | Med | Med | Owner | Add integration OR accept template-only prose (current: 200 response) |
| R5 | GDELT / vessel registry cost overrun | Low | Low | Owner | Keep vessel registry disabled; cap GDELT structured cadence |
| R6 | Preview vs PDF drift on jsPDF topics | Med | High | Dev (M4) | Parity audit Fuel, Shipping, Flashpoint |
| R7 | Boot-time migrations grow fragile | Low | Med | Dev (M2+) | Document; consider drizzle-kit migrations long-term |
| R8 | No approval gate before customer send | High | High | Dev (M3–M6) | Server-enforced workflow before M6 |
| R9 | Executive Summary legacy localStorage | Low | Low | Dev (M3) | Migrate reads to DB-only |
| R10 | Public URL plus owner-only auth | Low | Med | Dev | Replit Auth enforced; unauthenticated API returned 401 (verified 8 Jul 2026) |

## 6. Engineering baseline (context only — not M1 acceptance)

| Metric | Value (July 2026) |
|--------|-------------------|
| Test files | 80+ under __tests__/ |
| Typecheck | Clean across workspace packages |
| API contract | OpenAPI to Orval hooks and Zod |
| Auth | Replit Auth; requireOwner on data routes |
| Ingest | runIngestOnce plus advisory lock; automatic scheduler |
| PDF rule | Preview and PDF must not disagree |

Note: June 2026 AUDIT.md stated zero tests — superseded; test suite has since been added.

## Appendix A — Priority order for M3–M6 (locked)

| Rank | Milestone | Cost | Rationale |
|------|-----------|------|-----------|
| 1 | M3 — Command centre and approval workflow | $1,200 | Biggest daily-ops gap; blocks M6 |
| 2 | M4 — Professional reports and PDFs | $1,000 | Customer-demo quality; export gates need M3 |
| 3 | M5 — Country and product expansion | $1,000 | Scale after pipeline and PDF bar proven |
| 4 | M6 — Email and WhatsApp distribution | $800 | Requires approved reports and attachable PDFs |

**Hard rule:** No automated customer distribution. WhatsApp = share pack (wa.me link plus message plus PDF), not Business API.

**Out of scope (full Phase 2):** platform rebuild, multi-tenant portal, auto-send, Windward AIS, full no-code product builder.

## Appendix B — M2 fix backlog (numbered, for sign-off)

Pull from this audit. Estimate days are guide only.

| # | Item | Must-fix / Defer | Est. | Acceptance test |
|---|------|------------------|------|-----------------|
| B1 | Source Health reflects admin controls Working (token now set) | Must-fix | 0.5d | Manual ingest 200 with token; UI matches Section 2.2 |
| B2 | ReliefWeb: approve appname OR mark both rows Pending/off in UI | Must-fix | 0.5d | No false failing noise on Source Health |
| B3 | Liveuamap: whitelist IP OR clear overlay-unavailable state | Must-fix | 1d | Map page honest when overlay empty |
| B4 | OpenAI: provision OR confirm template-only prose (already 200) | Must-fix | 0.5d | Country prose 200 with template; UI shows intentionally off |
| B5 | Core route reliability pass | Must-fix | 2d | All routes load; errors user-visible |
| B6 | Ingest scheduler: failures visible in logs and Source Health | Must-fix | 1d | Simulated failure surfaces within one cycle |
| B7 | Loading, empty, and error states on core pages | Must-fix | 2d | No blank screens on API failure |
| B8 | Dashboard fetch bounds if slow on prod | Defer | 1d | Dashboard under 5s with growing incident table |
| B9 | Smoke PDF: Country plus one topic report generates | Must-fix | 0.5d | PDF downloads without error (quality = M4) |
| B10 | Integration status tests pinned | Must-fix | 1d | CI, typecheck, and tests green |
| B11 | Executive Summary: DB persistence; remove legacy localStorage | Defer to M3 | 0.5d | Summary survives cross-browser open |
| B12 | Persist any other localStorage-only editor fields | Defer | 1d | Audit complete |

**M2 total (must-fix):** approximately 9–10 dev-days (within $1,000 / 10–14 day envelope).

## Appendix C — Owner sign-off

### C.1 M1 Audit Pack acceptance

| Criterion | Met? |
|-----------|------|
| Audit Pack covers live app, sources, report quality, workflow, risks with evidence | Yes (dev audit, prod probes, docs/m1-evidence/) |
| Every source row classified: Working, Intentionally off, Broken, or Pending | Yes (Sections 2.1 and 2.2) |
| One sample PDF assessed per priority product with pass/fail notes | Yes (Section 3.1) |
| Workflow gap doc: today vs M3; distribution deferred to M6 | Yes (Section 4) |
| Priority order M3–M6 signed off | Pending — Owner |
| M2 backlog agreed with acceptance tests | Pending — Owner |

### C.2 Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Owner | | | |
| Developer | Tommy To | | |

**Revision round:** One included in M1.

**Notes:**

## Appendix D — Evidence index

| # | Artifact | Location | Status |
|---|----------|----------|--------|
| E1 | Report editor and PDF preview (production) | docs/m1-evidence/screenshots/routes/05-reports-editor.png | Dev audit |
| E2 | Integration classification basis | docs/m1-evidence/exports/E3-integration-classification-basis.md | Dev audit |
| E3 | Topic PDF font audit (shipping, fuel, flashpoint) | docs/m1-evidence/exports/E3-topic-pdf-font-audit.txt | Dev audit |
| E4 | Sample PDF — Country (Indonesia) | docs/m1-evidence/pdfs/E4-country-indonesia.pdf | Dev audit |
| E5 | Sample PDF — Shipping (font audit reference) | E3 log references shipping_report.pdf | Dev audit |
| E6 | Sample PDF — Flashpoint (font audit reference) | E3 log references flashpoint_report.pdf | Dev audit |
| E7 | Sample PDF — Fuel (font audit reference) | E3 log references fuel_report.pdf | Dev audit |
| E8 | Prior workbench audit | docs/workbench-audit-2026-06-17.md | In repo |
| E9 | Phase 2 commercial proposal | Phase 2 Proposal.docx | In repo |
| E10 | Auth — unauthenticated API blocked | Section 1.2 — GET /api/incidents returned 401 (8 Jul 2026) | Prod |
| E11 | Health check public | Section 1.2 — GET /api/healthz returned 200 (8 Jul 2026) | Prod |
| E12 | Admin token configured | Section 1.3 — POST /api/admin/ingest no token returned 401 (8 Jul 2026) | Prod |

---

End of M1 Audit Pack. Owner signs Appendix C to lock priority order and start M2.
