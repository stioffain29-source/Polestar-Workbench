# Polestar Advisory Workbench — Audit Report

*Read-only inspection. No code was changed during this audit. Date: 17 June 2026.*

---

## A. Executive summary

The Workbench is fundamentally sound and not broken. It typechecks cleanly across all 12 workspace projects, the server boots with no runtime errors, and the core pipeline — live ingest → Postgres → report editor → PDF — works. The 17 Jun boot log confirms live fuel prices were fetched and applied (`fuelReportsPriced: 7`, `fuelPriceAsOf: 2026-06-17`, no failures).

The weaknesses are not crashes; they are **inactive integrations and one data-loss trap**. Several advertised data sources (GDELT enrichment, UN ReliefWeb corroboration, AI translation, AI country prose) are dormant because their secrets/integration are not provisioned. The report Executive Summary is saved only in the browser, not the database. And the admin-gated controls (manual ingest, source editing) are effectively switched off because `INGEST_ADMIN_TOKEN` is not set.

## B. Overall rating

**AMBER — usable but needs clean-up.**

- **Why not Green:** multiple integrations the UI advertises return nothing or error (AI prose returns HTTP 503; translation ships raw foreign headlines; GDELT/ReliefWeb no-op; Liveuamap is blocked upstream). The Executive Summary persistence is a genuine reporting risk.
- **Why not Red:** nothing is crashing, the data is live and current, typecheck is clean, and the primary analyst workflow (build a report, export a PDF) functions end-to-end.

## C. API and data source table

| Source | Purpose | Code location | Status | Issue / action |
|---|---|---|---|---|
| FRED (fredgraph.csv) | Brent/WTI/jet fuel prices | `lib/ingest/src/{priceSeries,marketPrices,marketSnapshot}.ts` | **Live, working** (verified in boot log) | No key needed. None. |
| Yahoo Finance | Crude close (primary, FRED fallback) | `lib/ingest/src/{priceSeries,marketPrices}.ts` | **Live** | No key. Public endpoint — reliability risk if Yahoo changes shape; FRED fallback mitigates. |
| World Bank Pink Sheet | Fertiliser spot prices | `lib/ingest/src/priceSeries.ts` | **Live** | Scrapes a rotating XLSX URL; has fallback URL list. |
| Google News RSS | Discovery feed for all topics | `lib/ingest/src/{feedFetch,topicConfigs,flashpoint,newsTopic}.ts` | **Live** (data fresh) | No key. Throttling-resilient (browser UA + retry). |
| Google News URL resolution | De-opaque redirect links | `lib/ingest/src/googleNewsUrl.ts` | **Live**, non-fatal | None. |
| GDELT enrichment | Sub-national lat/long + fatalities | `lib/ingest/src/gdeltEnrich.ts` | **Dormant — disabled** | `GDELT_CLOUD_API_KEY` + `GDELT_ENRICH_ENABLED` not set. Provision or accept off. |
| UN OCHA ReliefWeb | Official corroboration links | `lib/ingest/src/reliefweb.ts` | **Dormant — disabled** | `RELIEFWEB_APPNAME` not set → no-ops, shows as failing source. |
| Liveuamap | Live map overlay | `artifacts/api-server/src/lib/liveuamap.ts`, `routes/liveuamap.ts` | **Degraded** | Key present, but upstream Cloudflare 403s our egress IP (prior finding). Proxy caches/fails gracefully, but overlay likely empties. |
| OpenAI (AI Integrations) | Title translation + country prose | `lib/ingest/src/titleTranslate.ts`, `api-server/src/lib/countryProse.ts`, `routes/prose.ts` | **Disabled** | No OpenAI integration added. Country prose returns **503** (`routes/prose.ts:73,89`); foreign titles ship untranslated. |
| Internal geocoder | Incident coordinates | `lib/ingest/src/geocode.ts` | **Live (local)** | None. |
| Postgres / Drizzle | Persistence | `lib/db/src/index.ts` | **Live, working** | Pool error listener present. None. |

**Secrets status** (authoritative source: environment snapshot + "No integrations are currently added"):

- **Present:** `DATABASE_URL`, `SESSION_SECRET`, `LIVEUAMAP_API_KEY`
- **Missing / not provisioned:** `INGEST_ADMIN_TOKEN`, `RELIEFWEB_APPNAME`, `GDELT_CLOUD_API_KEY`, `GDELT_ENRICH_ENABLED`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

## D. Major issues (most important first)

### 1. Executive Summary is saved only in the browser — data-loss risk. [High]
- **Why it matters:** an analyst can write a summary, save the report, then lose it on another browser, after a cache clear, or when a colleague opens the same report. It is never written to the DB.
- **Where:** `artifacts/workbench/src/pages/ReportEditor.tsx` (`execSummaryStorageKey`, lines ~56, 275–276, 468–471). There is a staleness guard, but no server persistence.
- **Fix:** persist exec summary on the report record (schema column + PATCH wiring) like other report fields.

### 2. Admin-gated controls are effectively off. [Medium-High]
- **Why it matters:** `INGEST_ADMIN_TOKEN` is not in Secrets, so `requireAdminToken` returns 503. That disables manual ingest (`POST /api/admin/ingest`), incident backfill, and **source create/update/delete**. The automatic scheduler still refreshes data, so the app stays current — but the manual operator controls are dead.
- **Where:** `api-server/src/lib/adminAuth.ts`, `routes/admin.ts`, `routes/sources.ts`, `routes/backfill.ts`.
- **Fix:** set `INGEST_ADMIN_TOKEN` if those controls are wanted.

### 3. AI features inactive. [Medium]
- **Why it matters:** country-report AI narrative returns 503 (falls over entirely, not to a template at the route layer); non-English headlines are shown raw. For an APAC product this is visible.
- **Where:** `routes/prose.ts`, `lib/countryProse.ts`, `lib/ingest/src/titleTranslate.ts`.
- **Fix:** add the OpenAI AI integration, or make `routes/prose.ts` fall back to the deterministic template instead of 503.

### 4. GDELT + ReliefWeb dormant. [Medium]
- **Why it matters:** the Source Health screen advertises these as sources; without secrets they contribute nothing and ReliefWeb shows as failing — noise that erodes trust in Source Health.
- **Fix:** provision the secrets, or hide/mark these as intentionally off.

### 5. Liveuamap overlay degraded. [Medium]
- **Why it matters:** the map advertises a live overlay that our server IP is blocked from fetching; analysts may see an empty/error overlay with only a sidebar note.
- **Fix:** confirm whether the paid feed permits our egress; otherwise present a clear global "overlay unavailable" state.

### 6. Public mutation routes — by explicit product decision, flagged for awareness. [Informational, not a defect]
- All non-admin mutations (`incidents`, `strikes`, `reports`, `spot-reports`, `countries`, `baselines`, `prose`, `cards`, `brand-settings`) are open: anyone with the link can create/edit/delete. Per the owner's stated preference the Workbench is intentionally public and editable, so this is **working as instructed**, not a bug.
- **Residual risk to be aware of:** no audit trail, and accidental or malicious edits/deletions are possible. No action unless the owner wants it.

### 7. Preview-vs-PDF parity for topic reports relies on hand-ported chart replicas. [Low-Medium]
- `lib/exportTopicReportPdf.ts` redraws charts (`drawJetFuelChart`, `drawCargoTrendChart`) as jsPDF copies of the on-screen Recharts. Any chart change must be ported by hand or the PDF drifts. (Most reports rasterise the DOM so screen==PDF is free; the jsPDF builders are the exception.)

## E. Quick wins

- Set `INGEST_ADMIN_TOKEN` → re-enables manual ingest + source editing.
- Add the OpenAI integration → switches on translation + country prose. (Or change `routes/prose.ts` to template-fallback instead of 503 — small.)
- Decide on GDELT/ReliefWeb: provision keys, or mark them off so Source Health stops showing failures.
- Remove the now-redundant strip of dead `country_report` columns in `routes/countries.ts:50` (already wiped by migration).

## F. Larger fixes

- Persist Executive Summary (and audit whether any other editor field is localStorage-only) to the database.
- Resolve the dormant-source story coherently: a single "source configured / live / failing" state surfaced consistently in Source Health and on the map.
- Consolidate PDF chart drawing to cut topic-report parity drift.

## G. Dead / duplicated / misleading code

- Duplicated token logic: `safeEqual` / `presentedToken` exist in both `routes/admin.ts` and `lib/adminAuth.ts`; `admin.ts` does its own check instead of the shared middleware.
- Inconsistent import extensions: `routes/sources.ts` uses `.js` suffixes; others don't.
- Hardcoded `BRAND_ID = 1` singleton in `routes/cards.ts` (mitigated by `onConflictDoNothing`).
- Dead `country_report` columns (`overview`, `trend_summary`, `implications`) — wiped by migration yet still stripped on PATCH.
- `FUEL_MARKET_DATA_SAMPLE` sample data — load-by-button only now, but a "force allow" export path can still emit a report built on sample numbers.
- Thin pages relative to their billing: Timeline (limited vs topic charts) and Publication Calendar (static display, read-only — by design).

## H. Final recommendation

**Stabilise before further build-out.** The foundation is healthy and the main workflow works, so this is light stabilisation, not a rebuild. Priorities, in order:

1. Persist the Executive Summary.
2. Set `INGEST_ADMIN_TOKEN` and add the OpenAI integration to switch on the AI features.
3. Make a clear call on GDELT/ReliefWeb/Liveuamap — turn them on and verify, or stop advertising them.

After those, the Workbench is in good shape to keep building on.

---

## Appendix — verification method

- **Typecheck:** `pnpm run typecheck` — clean across all 12 workspace projects.
- **Hygiene scans:** no hardcoded secrets/keys found; no `TODO`/`FIXME`/`HACK`/`XXX` markers; `console.log` appears only in `scripts/src` CLI tools (none in `api-server/src` or `lib`).
- **Runtime:** server boots cleanly; boot log shows successful migration, scheduler start, and live price top-up with `hadFailures: false`.
- **Route/auth inventory and frontend/backend structure** verified by reading the route files, `ReportEditor.tsx`, and the export/preview modules directly (not assumed from existence of code).
- **Not directly exercised** (stated honestly): a fresh Google-News scrape did not run this boot because data was fresh (the scheduler skipped it); GDELT/ReliefWeb/AI were confirmed inactive via missing secrets + the 503 path in `routes/prose.ts`, not by a live call.
