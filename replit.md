# Polestar Advisory Workbench

An owner-private, browser-based geopolitical-risk intelligence workbench: live incident feeds, country/topic reports, PDFs, and an incident map. STRICT no-fabrication — surfaces are empty or labelled "not reported" rather than guessed.

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

The core product (incident feeds, reports, PDFs, map base layer) works with none of these set; each no-ops cleanly when absent. Live state + evidence is surfaced on Source Health → "External Integrations" (and `GET /api/integrations/status`) — STATE/EVIDENCE only, never secret values. States: `working`, `not_configured`, `failing_upstream`, `no_data`, `pending` (built, awaiting external approval — amber), `disabled`, `unknown`. Manage secrets via the environment-secrets workflow, never by hand-editing `.env`/`.replit`. **Deep per-integration quirks live in `.agents/memory/` — read the linked file before touching a layer.**

- **GDELT Conflict Events** — `GDELT_CLOUD_API_KEY` (+`GDELT_ENRICH_ENABLED`). Additive precision layer over flashpoint rows; never inserts/removes incidents. `gdelt-enrich.md`.
- **GDELT Cloud structured event layer** — same `GDELT_CLOUD_API_KEY`. Own `gdelt_structured_items` table; EVENTS PROMOTE into incidents (owner REVOKED "never an incident" — do NOT re-isolate). Owner-gated UI `/gdelt-structured`. Disable `GDELT_STRUCTURED_ENABLED=false`; QU-budget cadence/caps. `gdelt-structured-layer.md`.
- **ReliefWeb (UN OCHA)** — `RELIEFWEB_APPNAME` (must be APPROVED; v2 403s unapproved). Corroboration links on incidents. `reliefweb-situational-reports.md`.
- **ReliefWeb Situational Reports** — same appname; own `reliefweb_reports` table as CONTEXT, never incidents; currently `pending`.
- **Liveuamap** — `LIVEUAMAP_API_KEY` (PAID). Cached server proxy, key never reaches browser; egress IP 403s → `failing_upstream` expected. `liveuamap-overlay.md`.
- **AIS vessel tracking** — `AIS_API_KEY` **or** `AISSTREAM_API_KEY` (free terrestrial feed, the ACTIVE provider). Ship-movement CONTEXT in isolated `maritime_movement` table; never touches incidents. No Middle-East chokepoint coverage → those panels read "not reported" (expected). `ais-provider-cost-switch.md`.
- **Vessel registry (Datalastic)** — `VESSEL_REGISTRY_API_KEY` (PAID satellite-AIS). DISABLED for cost via `VESSEL_REGISTRY_ENABLED=false`; the flag also switches movement collection back to the free feed (cargo split stays NULL). `ais-provider-cost-switch.md`.
- **OpenAI** — `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (provisioned together). AI country-report narratives + headline translation; unset → deterministic template + raw headlines.
- **TAPA cargo-crime (OFFLINE)** — no key. Reads SAVED "Data Explorer" HTML in `attached_assets/`; NEVER scrapes/uses the cookie/drives a browser. Promotes into `cargo_watch` incidents; manual token-gated `POST /api/admin/tapa-promote`, idempotent. `tapa-import.md`.
- **X (Twitter) Recent Search** — `X_BEARER_TOKEN`. SOURCE PROVIDER ONLY (no new page/feed/queue). Manual CLI `scrape:x`, dry-run by default, not in scheduler. `x-search-source-provider.md`.
- **Instagram OSINT** — `APIFY_TOKEN` (or `INSTAGRAM_PAPUA_APIFY_TOKEN`). SOURCE PROVIDER ONLY; reads an existing Apify dataset, reuses X routing/dedupe + PII-scrub. Manual CLI `scrape:instagram`, dry-run default. `instagram-source-provider.md`.
- **Facebook OSINT** — `FACEBOOK_API_KEY` (PAID Apify; DISTINCT from `APIFY_TOKEN`, which only drives `import:apify-facebook`). Own `social_raw` table as CONTEXT; runs daily in the scheduler + a free DB→DB promote pass mints incidents (owner REVERSED "manual-only" — do NOT re-isolate). `facebook-osint-promote-gate.md`.

Other operational env: `DATABASE_URL` (required), `SESSION_SECRET`, `INGEST_ADMIN_TOKEN` (gates `POST /api/admin/ingest` + sources mutations), `INGEST_INTERVAL_HOURS` / `INGEST_SCHEDULE_ENABLED`, `RELEVANCE_RULE_VERSION` / `INGEST_FORCE_VERSION` (backfill triggers).

## Where things live

- Data-status model (live/manual/static + "Data as of"): `artifacts/workbench/src/lib/reportDataStatus.ts`.
- Provenance strip: `artifacts/workbench/src/components/DataAsOfBanner.tsx`; headless `drawDataAsOf` in `src/lib/pdfChrome.ts`.
- Scrapers: `scripts/src/scrape-*.ts` (run via `pnpm --filter @workspace/scripts run scrape:<name>`, add `--commit` to write).
- Ingest engines: `lib/ingest` (`@workspace/ingest`) — shared by CLI scrapers and the api-server route.
- Publication calendar (`/calendar`): `pages/PublicationCalendar.tsx`, helpers `lib/publicationCalendar.ts`.
- World-scope monitors (energy/fuel/fertiliser surface out-of-region "global market" incidents; STRICT map==table, real countries only, no new feeds): `energy-fuel-fertiliser-world-scope.md`.

## Architecture decisions

- The in-app "Download PDF" button rasterises the on-screen `.print-report` DOM via `exportElementToPdf` (screen == in-app PDF automatically). The jsPDF builders (`exportTopicReportPdf` / `exportShippingReportPdf` / `exportFlashpointReportPdf` / `exportCountryReportPdf`) are used ONLY by the headless scripts. The "Data as of" line therefore lives in the React previews AND in the jsPDF builders via `drawDataAsOf`.
- Ingestion status: flashpoint + cargo_watch + protests = "manual"; fuel/fertiliser/shipping/energy/missile = "static". `latestRecord`=max(occurredAt), `lastUpdated`=max(createdAt) per topic — computed from loaded incidents, not the `sources` table.
- Flashpoint reports carry topic `protests` but their incidents are stored under `flashpoint`; staleness logic maps `protests` → `flashpoint`.
- Stale-prose guard: if live data holds records newer than a report's issue date, the editor reseeds prose from a fresh draft + shows a subdued-red (no-print) warning. Non-destructive — nothing persists until Save.

## Production ingestion (read-only prod DB)

- The prod DB is READ-ONLY from the workspace (`executeSql(environment:"production")` is a SELECT-only replica). Refresh must run INSIDE the deployment runtime, the only place `DATABASE_URL` points at the writable primary (reaches prod only after a republish).
- AUTOMATIC scheduler (default, no token): api-server runs ingestion on boot if scraper-fed data is older than `INGEST_INTERVAL_HOURS` (default 12), then on a recurring timer; boot catch-up keeps autoscale deployments fresh. Disable with `INGEST_SCHEDULE_ENABLED=false`. Boot freshness gate covers incidents, scraped land topics, strikes, and (when AIS is keyed) the AIS movement snapshot. Root cause of historical stale data: nothing TRIGGERED the scrapers — the scheduler is the fix.
- Scheduler + admin route share `runIngestOnce` (advisory-locked): incident scrapers (`flashpoint`, `cargo_watch`, `shipping`, `energy`, `fertiliser`, `fuel` — Google-News-RSS), live FRED fuel prices, Google-News URL resolution, AIS movement, conflict same-event clustering. `strikes` is a SEPARATE missile/drone tracker (own table).
- Manual triggers: `POST /api/admin/ingest` (token-gated: 401 invalid / 503 unconfigured / 409 in-progress) or a Scheduled Deployment running `scrape:prod`.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- The workbench is PRIVATE to the OWNER ONLY via "Sign in with Replit" (Replit Auth, OIDC+PKCE). The user explicitly asked for this, REVERSING the earlier "keep it public / anyone with the link can view and edit" preference — that older instruction is superseded; do NOT re-open the app to the public without the user asking. All data routers are gated by `requireOwner` (401 if not signed in, 403 if signed in but not the owner). Public routes: `GET /api/healthz`, `GET /api/access` (returns `{authenticated, allowed}`), the `/api/auth/*` login/callback/logout flow, and the pre-existing token-gated `POST /api/admin/ingest` + backfill (mounted BEFORE `requireOwner`). Owner is claimed first-login-wins via `ensureOwnerClaim` (advisory-lock) unless `ALLOWED_USER_IDS` env pins an allowlist. The pre-existing `requireAdminToken` on `sources` mutations is UNCHANGED — the owner logs in (session cookie) AND still pastes the admin token to edit. Session id is read cookie-first, then `Authorization: Bearer`, so the admin token never shadows the owner session. SPOT REPORTS are the EXCEPTION: saving a spot report needs only the owner session — the admin-token requirement was REMOVED at the user's explicit request ("I never asked for this"); do NOT re-add an admin-token gate to spot reports (all other mutating routers keep it).
- Report PROSE must never carry parenthetical record/incident count annotations like "(2 records)" or "(12 of 30 incidents)" — they read poorly. Counts belong only on Fast Facts stat tiles and chart captions, not narrative paragraphs. All report topics.
- CARGO WATCH SCOPE RULING: livestock / cattle-truck theft is OUT of Cargo Watch UNLESS the record shows a clear commercial supply-chain / logistics / food-distribution impact (named logistics operator, warehouse / cold store / reefer / container consignment, port / rail freight, abattoir supply line, or export consignment). Routine rural or isolated livestock crime is EXCLUDED entirely. Enforced in `cargoAnalysis.classifyScope` AND the `topicRelevance` ingest mirror in lockstep; details in `.agents/memory/cargo-livestock-scope.md`.
- Adhere strictly to user instructions. No drift, no debate. Follow the brand spec (Midnight Blue #0B0B3D, Dusk Gray #303030, Electric Blue #4655FF, Polar Gray #E2E2E2, petrol blue #1B6B7A reserved for the Insignificant severity tier, subdued red #A33232 reserved for Extreme only; Roboto Condensed/Roboto; no emojis, shadows, blurs, neon, or gradients on markers) and the five-tier risk vocabulary (Insignificant, Low, Moderate, High, Extreme) without substitution.
- Whenever a report's PDF exporter is rebuilt or changed, the on-screen preview pane in `ReportEditor.tsx` MUST be wired to a topic-specific preview component that renders from the same dataset, in the same section order, as the PDF. Preview and PDF must never disagree. Mirror `ShippingReportPreview` / `FlashpointReportPreview` (build dataset via `useMemo`, render the same sections, route the topic in the ternary at the preview wiring point in `ReportEditor.tsx`).

## Gotchas

- All PDF text MUST go through `setRoboto(pdf, "regular"|"medium"|"bold"|"italic")` from `src/lib/pdfFonts.ts`. Any direct `setFont` to a standard PDF base font (e.g. `helvetica`) is forbidden. `ensureRobotoLoaded(pdf)` must be awaited once per jsPDF instance before any `pdf.text(...)`. jsPDF auto-registers the 14 standard fonts at construction (they show in `pdffonts` but are not embedded/selected); the only safe acceptance check is the per-page `Tf` inventory — only `/Roboto` may appear as USED.
- Automatic font gate: the `pdf-fonts` validation step runs `artifacts/workbench/scripts/validateFonts.sh`, which headlessly exports the country briefs (PNG / West Papua / Indonesia) and runs the per-page `Tf` audit, FAILING if any non-Roboto font is selected. Side-effect free; needs `DATABASE_URL`. The topic audits (flashpoint/shipping/fuel) are NOT in the gate (they fetch the owner-gated `/api`).
- Headless PDF export for font auditing: `cd artifacts/workbench && REPORT_ID=<id> TOPIC=<fuel|shipping|cargo_watch|flashpoint> OUT_PATH=<abs.pdf> npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts`. The loader resolves `.ttf?url` imports to real font paths — do NOT re-stub `pdfFonts.ts` in the loader (silently drops Roboto → Helvetica fallback).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Deep per-feature implementation notes/quirks live in `.agents/memory/`.
- Communication: no hyperbole or banter; answers ten words or less.
