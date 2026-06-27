# Polestar Advisory Workbench

A public, browser-based geopolitical-risk intelligence workbench: live incident feeds, country/topic reports, PDFs, and an incident map. STRICT no-fabrication — surfaces are empty or labelled "not reported" rather than guessed.

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

The core product (incident feeds, reports, PDFs, map base layer) works with none of these set; each no-ops cleanly when absent. Live state + evidence is surfaced PUBLICLY on Source Health → "External Integrations" (and `GET /api/integrations/status`) — STATE/EVIDENCE only, never secret values. States: `working`, `not_configured`, `failing_upstream`, `no_data`, `pending` (built+merged, awaiting external approval — amber), `disabled`, `unknown`. Manage secrets via the environment-secrets workflow, never by hand-editing `.env`/`.replit`. Per-integration quirks live in `.agents/memory/`.

- **GDELT Conflict Events** — `GDELT_CLOUD_API_KEY` (+ `GDELT_ENRICH_ENABLED`, `GDELT_CLOUD_API_BASE`). Additive precision layer over flashpoint rows; never inserts/removes incidents.
- **ReliefWeb (UN OCHA)** — `RELIEFWEB_APPNAME` (must be an APPROVED appname; v2 API 403s unapproved). Cross-checks incidents, attaches official corroboration links (not in PDFs).
- **ReliefWeb Situational Reports** — SAME `RELIEFWEB_APPNAME`; standalone humanitarian reports into their OWN `reliefweb_reports` table as CONTEXT, never incidents. Currently `pending` (appname unapproved + egress IP bot-blocked).
- **Liveuamap** — `LIVEUAMAP_API_KEY` (PAID). Server-side cached proxy; key never reaches browser. liveuamap.com 403s our egress IP → `failing_upstream` expected even when keyed.
- **AIS vessel tracking** — `AIS_API_KEY` **or** `AISSTREAM_API_KEY` (+ `AIS_PROVIDER`=aisstream, `AIS_ENABLED`, `AIS_COLLECT_SECONDS`). FREE terrestrial feed — the ACTIVE provider. Live ship-movement CONTEXT into the isolated `maritime_movement` table; never touches incidents. COVERAGE TRADE-OFF: the free feed cannot see the Middle-East chokepoints (Hormuz/Gulf/Bab el-Mandeb/Red Sea), so those movement panels read "not reported" — expected, not a bug; only Asian straits (Singapore, etc.) sample. The incident-driven Hormuz "Chokepoint Status" panel reads news, not AIS, so it is unaffected. Windward is scaffolded only (no ingest).
- **Vessel registry (Datalastic)** — `VESSEL_REGISTRY_API_KEY` (+ `VESSEL_REGISTRY_PROVIDER`=datalastic, `_ENABLED`, `_API_BASE`, `_MAX_LOOKUPS`). PAID satellite-AIS — DISABLED FOR COST via `VESSEL_REGISTRY_ENABLED=false` (its kill-switch). The flag doubles as the movement collection-source switch: with it off (or no key) collection falls back to the free aisstream feed and the bulk/container/LNG cargo split is skipped (stays NULL, "not reported"). Code stays in place behind the kill-switch so it can be re-enabled later if cost allows.
- **OpenAI** — `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (provisioned together). AI country-report narratives + headline translation; unset → deterministic template + raw headlines.

Other operational env: `DATABASE_URL` (required), `SESSION_SECRET`, `INGEST_ADMIN_TOKEN` (gates `POST /api/admin/ingest` + sources mutations), `INGEST_INTERVAL_HOURS` / `INGEST_SCHEDULE_ENABLED`, `RELEVANCE_RULE_VERSION` / `INGEST_FORCE_VERSION` (backfill triggers).

## Where things live

- Data-status model (live/manual/static + "Data as of"): `artifacts/workbench/src/lib/reportDataStatus.ts`.
- Provenance strip: `artifacts/workbench/src/components/DataAsOfBanner.tsx`; headless `drawDataAsOf` in `src/lib/pdfChrome.ts`.
- Scrapers: `scripts/src/scrape-*.ts` (run via `pnpm --filter @workspace/scripts run scrape:<name>`, add `--commit` to write).
- Ingest engines: `lib/ingest` (`@workspace/ingest`) — shared by CLI scrapers and the api-server route.
- Publication calendar (`/calendar`): per-topic last-published + cadence next-due; `pages/PublicationCalendar.tsx`, helpers `lib/publicationCalendar.ts`.

## Architecture decisions

- The in-app "Download PDF" button rasterises the on-screen `.print-report` DOM via `exportElementToPdf` (so screen == in-app PDF automatically). The jsPDF builders (`exportTopicReportPdf`/`exportShippingReportPdf`/`exportFlashpointReportPdf`/`exportCountryReportPdf`) are used ONLY by the headless scripts.
- The "Data as of" line therefore lives in the React previews (screen + in-app PDF) AND in the jsPDF builders via `drawDataAsOf` (headless).
- Ingestion status: flashpoint + cargo_watch + protests = "manual"; fuel/fertiliser/shipping/energy/missile = "static". `latestRecord`=max(occurredAt), `lastUpdated`=max(createdAt) per topic — computed from loaded incidents, not the `sources` table.
- Flashpoint reports carry topic `protests` but their incidents are stored under `flashpoint`; staleness logic maps `protests` → `flashpoint`.
- Stale-prose guard: if live data holds records newer than a report's issue date, the editor reseeds prose from a fresh draft + shows a subdued-red (no-print) warning. Non-destructive — nothing persists until Save.

## Production ingestion (read-only prod DB)

- The prod DB is READ-ONLY from the workspace (`executeSql(environment:"production")` is a SELECT-only replica). Refresh must run INSIDE the deployment runtime, which is the only place `DATABASE_URL` points at the writable primary.
- AUTOMATIC scheduler (default, no token): the api-server runs ingestion on boot if scraper-fed data is older than `INGEST_INTERVAL_HOURS` (default 12), then on a recurring timer. The boot catch-up keeps autoscale deployments fresh (timers don't fire while scaled to zero). Disable with `INGEST_SCHEDULE_ENABLED=false`. Reaches prod only after a republish. The boot freshness gate covers incidents, scraped land topics, strikes, and (when AIS is keyed) the AIS movement snapshot; a WARN-log SLA monitor fires when AIS movement is stale.
- Root cause of historical stale data: nothing TRIGGERED the scrapers — feeds were always live. The scheduler is the fix.
- Scheduler + admin route share `runIngestOnce` (advisory-locked, so manual + automatic never collide). It runs: incident scrapers (`flashpoint`, `cargo_watch`, `shipping`, `energy`, `fertiliser`, `fuel` — Google-News-RSS), live FRED fuel prices (`runMarketPricesIngest`, no key needed), Google-News URL resolution into `resolved_url`, and AIS movement. `strikes` is a SEPARATE missile/drone tracker (own table), not a news topic.
- Manual triggers: `POST /api/admin/ingest` (token-gated: 401 invalid / 503 unconfigured / 409 in-progress) or a Scheduled Deployment running `scrape:prod`. For prod, URL-resolution / movement CLIs must run inside the deployment runtime.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- The workbench is PRIVATE to the OWNER ONLY via "Sign in with Replit" (Replit Auth, OIDC+PKCE). The user explicitly asked for this, REVERSING the earlier "keep it public / anyone with the link can view and edit" preference — that older instruction is superseded; do NOT re-open the app to the public without the user asking. All data routers are gated by `requireOwner` (401 if not signed in, 403 if signed in but not the owner). Public routes: `GET /api/healthz`, `GET /api/access` (returns `{authenticated, allowed}`), the `/api/auth/*` login/callback/logout flow, and the pre-existing token-gated `POST /api/admin/ingest` + backfill (mounted BEFORE `requireOwner`). Owner is claimed first-login-wins via `ensureOwnerClaim` (advisory-lock) unless `ALLOWED_USER_IDS` env pins an allowlist. The pre-existing `requireAdminToken` on `sources` mutations is UNCHANGED — the owner logs in (session cookie) AND still pastes the admin token to edit. Session id is read cookie-first, then `Authorization: Bearer`, so the admin token never shadows the owner session. SPOT REPORTS are the EXCEPTION: saving a spot report needs only the owner session — the admin-token requirement was REMOVED at the user's explicit request ("I never asked for this"); do NOT re-add an admin-token gate to spot reports (all other mutating routers keep it).
- Report PROSE must never carry parenthetical record/incident count annotations like "(2 records)" or "(12 of 30 incidents)" — they read poorly. Counts belong only on Fast Facts stat tiles and chart captions, not narrative paragraphs. All report topics.
- Adhere strictly to user instructions. No drift, no debate. Follow the brand spec (Midnight Blue #0B0B3D, Dusk Gray #303030, Electric Blue #4655FF, Polar Gray #E2E2E2, petrol blue #1B6B7A reserved for the Insignificant severity tier, subdued red #A33232 reserved for Extreme only; Roboto Condensed/Roboto; no emojis, shadows, blurs, neon, or gradients on markers) and the five-tier risk vocabulary (Insignificant, Low, Moderate, High, Extreme) without substitution.
- Whenever a report's PDF exporter is rebuilt or changed, the on-screen preview pane in `ReportEditor.tsx` MUST be wired to a topic-specific preview component that renders from the same dataset, in the same section order, as the PDF. Preview and PDF must never disagree. Mirror `ShippingReportPreview` / `FlashpointReportPreview` (build dataset via `useMemo`, render the same sections, route the topic in the ternary at the preview wiring point in `ReportEditor.tsx`).

## Gotchas

- All PDF text MUST go through `setRoboto(pdf, "regular"|"medium"|"bold"|"italic")` from `src/lib/pdfFonts.ts`. Any direct `setFont` to a standard PDF base font (e.g. `helvetica`) is forbidden. `ensureRobotoLoaded(pdf)` must be awaited once per jsPDF instance before any `pdf.text(...)`.
- jsPDF auto-registers the 14 standard PDF fonts at construction; they appear in `pdffonts` output but are NOT embedded/selected. Removing them isn't exposed by jsPDF's API. The only safe acceptance check is the per-page `Tf` inventory in `screenshots/font_proof/FONT_AUDIT.txt` — only `/Roboto` may appear as USED.
- Headless PDF export for font auditing: `cd artifacts/workbench && REPORT_ID=<id> TOPIC=<fuel|shipping|cargo_watch|flashpoint> OUT_PATH=<abs.pdf> npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts`. The loader resolves `.ttf?url` imports to real paths in `node_modules/@expo-google-fonts/roboto/*`. Do NOT re-stub `pdfFonts.ts` in the loader — that silently drops Roboto and falls back to Helvetica.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Deep per-feature implementation notes/quirks live in `.agents/memory/`.
- Communication: no hyperbole or banter; answers ten words or less.
