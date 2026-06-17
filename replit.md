# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Integration secrets (all OPTIONAL — each degrades gracefully)

The four external integrations are non-essential: the core product (incident feeds, reports, PDFs, the map base layer) works with none of them set. Each one no-ops cleanly when its secret is absent. Live config + evidence is surfaced PUBLICLY on Source Health → "External Integrations" (and `GET /api/integrations/status`), which reports STATE and EVIDENCE only — never the secret values. Six states: `working`, `not_configured`, `failing_upstream`, `no_data`, `disabled`, `unknown`. Manage secrets via the environment-secrets workflow, never by hand-editing `.env`.

- **GDELT Conflict Events** — `GDELT_CLOUD_API_KEY` (required to enable), `GDELT_ENRICH_ENABLED` (set `false` to switch off even when keyed → `disabled`), `GDELT_CLOUD_API_BASE` (optional endpoint override). Additive precision layer over flashpoint incidents (sub-national geo, confirmed fatalities, named actors); never inserts/removes rows. Unset → `not_configured`, base flashpoint feed unaffected.
- **ReliefWeb (UN OCHA)** — `RELIEFWEB_APPNAME` (an APPROVED appname; the v2 API rejects unapproved names with 403 — request one at https://apidoc.reliefweb.int/parameters#appname). Cross-checks scraped incidents and attaches official corroboration links (Incidents/Topic screens, NOT PDFs). Unset → `not_configured` (the pass short-circuits; it is no longer mislabelled as a failing source).
- **Liveuamap (live-map overlay)** — `LIVEUAMAP_API_KEY` (PAID). Server-side proxy only; the key never reaches the browser and upstream calls are TTL-cached. Unset → `not_configured`; the incident map works fully without it. Note: liveuamap.com 403s our egress IP (their Cloudflare block) → `failing_upstream` is expected even when keyed.
- **OpenAI (AI narratives & translation)** — `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (provisioned together by the AI integration). Powers AI country-report narratives and English translation of foreign-language incident headlines. Unset → `not_configured`: country reports fall back to the deterministic template (with an "AI narrative unavailable — template" label) and foreign headlines stay raw (flagged with an on-screen "untranslated" hint, never in PDFs).

Other operational env (not integrations): `DATABASE_URL` (required), `SESSION_SECRET`, `INGEST_ADMIN_TOKEN` (gates `POST /api/admin/ingest` + sources mutations), `INGEST_INTERVAL_HOURS` / `INGEST_SCHEDULE_ENABLED` (ingest scheduler), `RELEVANCE_RULE_VERSION` / `INGEST_FORCE_VERSION` (backfill triggers).

## Where things live

- Data-status model (live/manual/static + "Data as of" line): `artifacts/workbench/src/lib/reportDataStatus.ts` (`computeDataAsOf`, `formatDataAsOfLine`, `latestRecordDate`).
- On-screen/in-PDF provenance strip: `artifacts/workbench/src/components/DataAsOfBanner.tsx`; headless equivalent `drawDataAsOf` in `src/lib/pdfChrome.ts`.
- Scrapers (data ingestion): `scripts/src/scrape-flashpoint.ts`, `scripts/src/scrape-cargo-watch.ts` (run via `pnpm --filter @workspace/scripts run scrape:flashpoint|scrape:cargo-watch`, add `--commit` to write).
- Incident corroboration (UN OCHA ReliefWeb): cross-checks scraped incidents against ReliefWeb and attaches official corroborating links shown on Incidents/Topic screens (NOT in PDFs). Engine `lib/ingest/src/reliefweb.ts` (`runReliefWebCorroboration`), table `lib/db/src/schema/corroborations.ts`, API attaches `corroborations[]` on incident reads (`artifacts/api-server/src/routes/incidents.ts`). Requires an APPROVED ReliefWeb appname via `RELIEFWEB_APPNAME` env (v2 API rejects unapproved appnames with 403; request one at https://apidoc.reliefweb.int/parameters#appname). Until set, the pass no-ops and shows ReliefWeb as a failing source on Source Health.
- Publication calendar (route `/calendar`): per-topic last-published list (Green ≤7d / Amber 8–14d / Red >14d flags + cadence-derived next-due) and a month grid, unified across topic/spot/country reports. Page `artifacts/workbench/src/pages/PublicationCalendar.tsx`; pure helpers `artifacts/workbench/src/lib/publicationCalendar.ts`. Read-only, no backend change; keys off `issueDate`/`reportDate`/`createdAt` as the publish date.

## Architecture decisions

- The in-app "Download PDF" button (`ReportEditor.downloadPdf`) does NOT use the jsPDF builders — it rasterises the on-screen `.print-report` DOM via `exportElementToPdf`. So screen == in-app PDF is automatic. The jsPDF builders (`exportTopicReportPdf`/`exportShippingReportPdf`/`exportFlashpointReportPdf`/`exportCountryReportPdf`) are used ONLY by the headless scripts.
- Because of the above, the "Data as of" line lives in the React previews (covers screen + in-app PDF at once) AND in the jsPDF builders via `drawDataAsOf` (covers headless export).
- Ingestion status: flashpoint + cargo_watch + protests = "manual" (scraper-fed); fuel/fertiliser/shipping/energy/missile = "static" (import only). `latestRecord` = max(occurredAt); `lastUpdated` = max(createdAt) per topic — computed from the loaded incidents, not the `sources` table (the cargo scraper does not update `sources.lastSuccessAt`).
- Flashpoint reports carry topic `protests` but their incidents are stored under `flashpoint`; the data-as-of and staleness logic maps `protests` → `flashpoint` for scoping.
- Stale-prose guard: a report's window ends on its issue date. If live data holds records newer than the issue date, the editor reseeds prose from a fresh draft and shows a subdued-red (no-print) warning. Non-destructive — nothing persists until Save.

## Production ingestion (read-only prod DB)

- The production database is READ-ONLY from the workspace, so scrapers cannot write prod from here. Production data refresh must run INSIDE the deployment environment. The deployment runtime is the only place `DATABASE_URL` points at the writable production primary — from the workspace it points at dev, and `executeSql(environment:"production")` is a read-only replica (SELECT only). Verified empirically: dev and prod are separate databases.
- AUTOMATIC scheduler (default mechanism, no token needed): the api-server starts `startIngestScheduler()` (`artifacts/api-server/src/lib/ingestScheduler.ts`) after `listen`. On boot it runs ingestion IF the newest scraper-fed record (flashpoint/cargo_watch `created_at`) is older than `INGEST_INTERVAL_HOURS` (default 12), then sets a recurring timer. The boot catch-up is what keeps an AUTOSCALE deployment fresh — timers don't fire while scaled to zero, but every cold start that finds stale data self-refreshes. The freshness guard keeps frequent cold starts cheap. Disable with `INGEST_SCHEDULE_ENABLED=false`. Reaches prod only after a republish (the new code must ship first). For a GUARANTEED cadence regardless of traffic, use a reserved-VM/always-on deployment or a Scheduled Deployment running `scrape:prod`.
- Root cause of the historical stale-data complaints: nothing TRIGGERED the scrapers — the feeds were always live (a dry-run `scrape:flashpoint` shows dozens of "New to insert"); the DB just sat at the last manual run. The scheduler above is the fix.
- Both the scheduler and the admin route share `artifacts/api-server/src/lib/ingestRunner.ts` (`runIngestOnce`), which holds the cross-instance advisory lock, so manual + automatic runs can never collide.
- Fuel-market PRICES are now LIVE: `runMarketPricesIngest` (`@workspace/ingest`, `lib/ingest/src/marketPrices.ts`) pulls Brent (FRED DCOILBRENTEU), WTI (DCOILWTICO) and jet fuel (DJFUELUSGULF) from FRED's public `fredgraph.csv` endpoint (no API key) and writes the canonical `hardNumbers` shape into every `topic='fuel'` report, anchored to the END OF EACH REPORT'S REPORTING WINDOW — its issue date clamped DOWN to the latest available fuel record (mirrors `clampIssueDateToLatestRecord`), so the Brent/WTI/jet "as of" dates and the ~6-point weekly jet trajectory always fall INSIDE the report's period (latest observation ≤ anchor; 7-day change). A Fuel Watch issue is an AS-OF report, not a live ticker — prices do NOT track today's close. (This SUPERSEDES the earlier rule that special-cased the newest report to anchor to today, which pushed the price dates past the report's stated period.) It runs inside `runIngestOnce` (after flashpoint+cargo) so the scheduler + admin route + `scrape:prod` all refresh prices, and is wrapped in its own try/catch so a FRED outage cannot fail the incident ingest. CLI: `pnpm --filter @workspace/scripts run scrape:prices [--commit]`. This REPLACED the hardcoded `FUEL_MARKET_DATA_SAMPLE` fabricated prices (Brent 109.26 / WTI 101.02 / jet 4.152) that never changed — the root cause of the "prices not changing / you are telling me lies" complaint. The editor no longer auto-seeds that sample into the preview/PDF (it only loads via the explicit "Load sample" button); a report with no saved data renders empty market fields rather than fake numbers.
- INCIDENT scrapers now cover `flashpoint`, `cargo_watch`, `shipping`, `energy`, `fertiliser`, and `fuel` — all live Google-News-RSS feeds. `energy`/`fertiliser`/`fuel` run through a generic config-driven runner (`runNewsTopicIngest` in `lib/ingest/src/newsTopic.ts`) with per-topic feeds/allow/deny + severity rules in `lib/ingest/src/topicConfigs.ts` (generalised from `shipping.ts`). `fuel` additionally has the live FRED PRICE feed (`runMarketPricesIngest`) for its `hardNumbers` market tiles. `strikes` is intentionally OUT of scope — it is a SEPARATE missile/drone theatre tracker (`Strikes.tsx`, own table/schema), not a news-incident topic, so it has no news scraper. The news scrapers geocode best-effort from the curated lookup (rows with no match still insert with null lat/long).
- Topic wiring: the scraper writes civil-unrest data under topic `flashpoint`; `protests` is a legacy snapshot no feed writes. The "Protests & Civil Unrest" monitor (`Topic.tsx`, slug `protests`) resolves to the `flashpoint` data topic so it shows live data.
- Primary mechanism (in-app trigger): `POST /api/admin/ingest` on the api-server runs the Flashpoint + Cargo Watch ingest from the running server process (which, in the deployment, has the writable prod DB). It is gated on the `INGEST_ADMIN_TOKEN` env var — present it via `Authorization: Bearer <token>` or the `x-ingest-token` header. Missing/invalid token → 401; token not configured → 503 (route disabled, never runs unauthenticated); a run already in progress → 409. The JSON response reports records inserted, latest record date, last-updated time, and per-feed/country coverage per topic. The new route only reaches prod after the autoscale app is republished.
- Ingest logic lives in `lib/ingest` (`@workspace/ingest`: `runFlashpointIngest` / `runCargoWatchIngest`), imported by BOTH the CLI scrapers (`scripts/src/scrape-*.ts`, now thin wrappers) and the api-server route, so all paths run identical code. The lib functions deliberately do NOT close the shared DB pool (`@workspace/db` singleton) — only the CLI wrappers call `pool.end()`; the long-lived server must keep the pool open. esbuild bundles the lib + `rss-parser` into `dist/index.mjs`, so no `tsx`/`pnpm` is needed in the prod runtime.
- Fallback mechanism: a Scheduled Deployment running `pnpm --filter @workspace/scripts run scrape:prod` (same combined script). Only viable if the Scheduled Deployment option is available in the Publishing UI; the in-app trigger above is the default because it needs only a normal republish.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- The workbench is intentionally PUBLIC — no token/login wall to view or edit. A prior security task (API Access Control) gated the read endpoints (dashboard/overview, reports, sources) and most writes behind `requireAdminToken` and added a client login screen; the user explicitly reverted this to "anyone with the link can view and edit, like before." Do NOT re-add a login gate or token-gate the read/edit routes without the user asking. The only auth that should remain is the pre-existing protection on `POST /api/admin/ingest` and the `sources` create/update/delete mutations.
- Report PROSE must never carry parenthetical record/incident count annotations like "(2 records)" or "(12 of 30 incidents)" — they read poorly. Counts belong only on Fast Facts stat tiles and chart captions, not in narrative paragraphs. Applies across all report topics.
- Adhere strictly to user instructions. No drift, no debate. Follow the brand spec (Midnight Blue #0B0B3D, Dusk Gray #303030, Electric Blue #4655FF, Polar Gray #E2E2E2, subdued red #A33232 reserved for Extreme only; Roboto Condensed/Roboto; no emojis, shadows, blurs, neon, or gradients on markers) and the five-tier risk vocabulary (Insignificant, Low, Moderate, High, Extreme) without substitution.
- Whenever a report's PDF exporter is rebuilt or changed, the on-screen preview pane in `ReportEditor.tsx` MUST be wired to a topic-specific preview component that renders from the same dataset, in the same section order, as the PDF. Preview and PDF must never disagree. Mirror the pattern used by `ShippingReportPreview` / `FlashpointReportPreview` (build dataset via `useMemo`, render the same sections, route the topic in the ternary at the preview wiring point in `ReportEditor.tsx`).

## Gotchas

- All PDF text MUST go through `setRoboto(pdf, "regular"|"medium"|"bold"|"italic")` from `src/lib/pdfFonts.ts`. `pdf.setFont("helvetica", ...)` or any direct `setFont` call to a standard PDF base font is forbidden. `ensureRobotoLoaded(pdf)` must be awaited once per jsPDF instance before any `pdf.text(...)` call.
- jsPDF auto-registers the 14 standard PDF fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats) in the font dictionary at construction time. They appear in `pdffonts` output but are NOT embedded and NOT selected by any content-stream `Tf` operator. Removing them is not exposed by jsPDF's public API. The only safe acceptance check is the per-page `Tf` inventory in `screenshots/font_proof/FONT_AUDIT.txt` — only `/Roboto` may appear as USED.
- Headless PDF export for font auditing: `cd artifacts/workbench && REPORT_ID=<id> TOPIC=<fuel|shipping|cargo_watch|flashpoint> OUT_PATH=<abs.pdf> npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts`. The loader resolves `.ttf?url` imports to real on-disk paths in `node_modules/@expo-google-fonts/roboto/*`; the wrapper patches `fetch` for `file://` URLs. Do NOT re-stub `pdfFonts.ts` in the loader — that silently drops embedded Roboto and falls back to Helvetica.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Communication: no hyperbole or banter; answers ten words or less.
