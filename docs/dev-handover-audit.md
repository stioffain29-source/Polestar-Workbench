# Polestar Advisory Workbench — Developer Handover Audit

Date: 10 August 2026. Status at time of writing: full test suite green (230 suites / 3,634 tests), typecheck clean, all QA workflows passing, production live and healthy.

---

## 1. What this is

Owner-only security-intelligence workbench: automated open-source ingestion → PostgreSQL incident store → topic monitors and dashboards → analyst-edited, PDF-exportable reports (topic reports, country/city briefs, spot/special reports, intel cards). Single user (the owner) via Replit Auth; nothing is public.

## 2. Repository shape

pnpm monorepo (`pnpm-workspace.yaml`: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`).

| Package | Purpose |
|---|---|
| `artifacts/workbench` | React 19 + Vite frontend (~255 files). Entry `src/main.tsx`, routes in `src/App.tsx` (wouter). All report rendering/export logic lives here under `src/lib` + `src/components`. |
| `artifacts/api-server` | Express API (~58 files). Entry `src/index.ts`, app `src/app.ts`, routers `src/routes/*`. Also hosts the ingest scheduler and boot migrations. |
| `artifacts/mockup-sandbox` | Dev-only component preview server. Never built in production. |
| `lib/db` (`@workspace/db`) | Drizzle ORM + all table schemas (`src/schema/*.ts`, consolidated in `src/schema/index.ts`). |
| `lib/ingest` (`@workspace/ingest`) | All scrapers/ETL (~254 files). Import only via subpath exports — the root barrel pulls `pg` into the browser bundle. |
| `lib/api-spec` | `openapi.yaml` — the API contract. Orval codegen (`orval.config.ts`) generates: |
| `lib/api-zod` | generated Zod schemas (server validation) |
| `lib/api-client-react` | generated React Query client (frontend data access) |
| `lib/relevance` | shared relevance rule engine (see §4) |
| `lib/country-engine` | shared country-report gate/pipeline |
| `lib/strike-targets` | shared missile-strike target rulebook |
| `lib/replit-auth-web` | browser-side auth helper |
| `scripts` | operational CLI tooling (backfills, imports, replays) |

**Codegen caveat:** running api-spec codegen while the workbench Vite dev server is running corrupts HMR. Restart the workbench + api-server workflows after codegen.

## 3. Auth

Replit Auth (OIDC/PKCE, session cookie). `requireOwner` (`api-server/src/lib/ownerAccess.ts`) gates every data router in `src/routes/index.ts`. Public exceptions: `/api/healthz`, `/api/access`, `/api/auth/*`. Session cookie is read before Bearer token so the admin ingest token can't shadow a session. Consequence for QA: logged-out browsers/screenshots can't see the app — verification is done via jest render tests and headless PDF audits that read Postgres directly.

## 4. Data pipeline

- **Dispatch:** `api-server/src/lib/ingestRunner.ts` is the source-of-truth list of every ingest pass: Google News topic scrapers (flashpoint, conflict, shipping, cargo_watch, fuel, energy, fertiliser, data_centres, Indonesia/APAC local), missile strikes, AIS movement (aisstream — free tier; paid Datalastic kill-switched), ReliefWeb, ICC/IMB piracy, UKMTO/partner maritime products, GDELT (enrichment + structured events + promote), X search, Instagram/Facebook/KAMMI OSINT (context-only; incidents minted only by explicit promote), TAPA (offline saved-HTML import only), FRED fuel prices, World Bank fertiliser Pink Sheet, OSM/PeeringDB data centres.
- **Scheduling:** `ingestScheduler.ts` — boot catch-up with per-layer staleness gates (land topics, strikes, AIS movement, maritime security, GDELT structured each join the boot OR-gate), then interval runs (12h). Anything that only refreshes inside `runIngestOnce` must join the boot gate or it drifts stale.
- **Relevance:** one shared engine (`@workspace/relevance`) used by ingest, API and frontend. Status persisted per incident; central API filter (fail-open on NULL, `?includeIrrelevant` for raw). Any rule change requires a `RELEVANCE_RULE_VERSION` bump — a boot backfill then re-cleans persisted rows. Two deliberate frontend bypasses (trust their own gates instead): CountryReport and the Cargo Watch monitor.
- **Classification:** shared severity classifier (extreme reserved for mass-casualty; bilingual Bahasa cues), curated geocode lookup (no API), LLM title translation into nullable `display_title` (originals kept), LLM event-cluster keys for Conflict Watch (must be triggered; NULL keys never fold).
- **Source health:** every ingest path self-registers per-feed telemetry (`recordSourceHealth`); a new ingest path that skips it shows empty/stale in the Source Health page.

## 5. Frontend surfaces

- **Monitors:** per-topic pages (`src/pages/Topic.tsx`, labels in `src/lib/topics.ts`): fuel, flashpoint/protests, fertiliser, energy, shipping (incl. live AIS Fleet Intelligence + Red Sea flow panels), cargo_watch, conflict, data_centres, maritime_security, crime; separate strike tracker and dashboards. Monitors apply display-side syndication dedup (conservative full-title for most topics; fuzzy clustering for flashpoint; aggressive vessel-event clustering for shipping monitor only).
- **Reports:**
  - *Topic reports* — editor (`ReportEditor.tsx`) + live preview (`ReportPreview.tsx`). Prose precedence analyst edit → cached AI section → deterministic builder via one shared resolver (`topicProseResolution.ts`). AI prose: `api-server/src/lib/reportProse.ts`, fingerprint-cached, regenerates on data change.
  - *Fuel Watch is the exception*: its five analytical sections are **non-overridable deterministic projections** of a canonical facts object (`fuelCanonicalFacts.ts`) with a hard fail-closed consistency gate — preview shows a blocking panel, PDF export throws, on the same errors. The report date is market-anchored (latest market close ?? issue date) on both surfaces.
  - *Country/city structured briefs* — PNG, West Papua, Indonesia, Jakarta share ONE renderer/prose builder (`renderStructuredBrief`, `PngCountryReportBody`) with deterministic prose, themed sections, content-quality gates (banned phrasing, foreign-subject/retrospective excludes, repetition gates) and a validated country-engine gate. Adding a theatre is a 7-surface lockstep checklist (see `.agents/memory/adding-structured-country-brief.md`).
  - *Spot reports / Special reports* — analyst-authored, own tables, multi-point maps, photo attachments; Special = PDF-only clone with chosen covers.
  - *Card builder* — PNG export via DOM-clone + html2canvas; card widgets must be static DOM (no canvas/SVG markers).
- **PDF export:** in-app = DOM rasterise of the on-screen report (screen==PDF by construction), except fuel's in-app download which is a jsPDF builder (`exportTopicReportPdf.ts`, manual parity). Headless verification scripts render via system Chromium `page.pdf()`.

## 6. Database

Postgres via Drizzle. Dev DB + separate prod DB (`PROD_DATABASE_URL` writable from workspace). **Prod schema changes go through idempotent boot migrations** in `api-server/src/lib/migrations.ts` (`runDataMigrations`, marker table `app_migration_markers`) — drizzle push only reaches dev. One-off data fixes are marker-gated boot migrations. A jest drift guard (`__tests__/db/schemaBootMigrationDrift.test.ts`) keeps schema and boot migrations in sync.

## 7. Deployment

Reserved VM (min-instances 1), private visibility, `https://document-asset-manager-stioffain29.replit.app`.

- Per-artifact `.replit-artifact/artifact.toml` controls production build/run: api-server = esbuild bundle (`build.mjs` → `dist/index.mjs`, bundles ingest source, skips tsc — green typecheck ≠ deployable), health probe `/api/healthz`; workbench = static Vite build with SPA rewrite.
- `compression()` in `app.ts` is load-bearing: large JSON responses die at the proxy's 32 MB non-chunked cap without it.
- Known ops quirk: three promote-step failures on 9 Aug with zero diagnostic output were Replit infra faults (VM created, container never started); the app bundle boots clean locally against prod DB. Retry publish; escalate to Replit support if persistent.

## 8. QA / verification

- **Jest:** 230 suites / 3,634 tests from repo root (unit, render-to-static-markup UI tests, preview/PDF parity suites, property tests, schema drift guard). Route tests must stub `req.log`.
- **Workflows (live-data QA gates, all currently passing):**
  - `pdf-fonts` — exports PNG/West Papua/Indonesia country PDFs headless, asserts only Roboto fonts used.
  - `topic-font-audit` — same for the four topic reports (live-data dependent; a real gate failure blocks it by design).
  - `country-brief-sweep` — exports six country/city briefs, asserts the country gate passes and no banned phrases appear in `pdftotext` output.
- **Headless harnesses:** `scripts/exportReportPdfHeadless.ts`, `scripts/pdfHarness*/run.mjs` (Playwright + system Chromium) — the only way to verify DOM-rasterised exports, since the app is owner-gated.

## 9. Environment

Secrets in use: `PROD_DATABASE_URL`, `SESSION_SECRET`, `INGEST_ADMIN_TOKEN`, `AISSTREAM_API_KEY`, `APIFY_TOKEN`, `X_BEARER_TOKEN`, `AI_INTEGRATIONS_OPENAI_*` (LLM prose/translation via Replit AI proxy). Notable flags: `INGEST_SCHEDULE_ENABLED`, `INGEST_INTERVAL_HOURS`, `ALLOWED_USER_IDS`, `GDELT_*`, `UKMTO_*`, `INSTAGRAM_ENABLED`. Keep all ingest LLM `max_completion_tokens` ≥ 8192 (reasoning models silently return empty below that).

## 10. Institutional knowledge

`.agents/memory/MEMORY.md` + topic files (~140 entries) is the distilled rulebook: every gate, homonym exclude, dedup pass, parity requirement and owner ruling, with the *why*. **Read it before changing relevance rules, report prose, severity, dedup or PDF paths** — most of the sharp edges in this codebase are deliberate and documented there. `replit.md` holds project conventions and owner preferences.

## 11. Open items

- Proposed (not started) project tasks: strip unused Jakarta prose builders; harden section-hiding for remaining report sections; keep country name out of Outlook/category location lists; banned-wording guard for analyst-edited sections; date "from X to Y" flood advisories to start date.
- Dead-but-tested legacy fuel prose paths (`fuelReportConsistency.ts`, `buildFuelOperationalRead`, `topUpFuelBullets`, `buildFuelRegionalHighlights`) remain only as test consumers after the canonical-facts refactor — candidates for removal.
- The AI-prompt fuel facts module (`fuelReportFacts.ts`) uses slightly different bands/margins than the rendered canonical facts; it no longer drives any rendered fuel section but shouldn't be mistaken for the rendering authority.
- `artifact.toml` TODO: API artifact should be excluded from preview.
- Frontend bundle is one ~3.8 MB chunk (Vite warning) — code-splitting is an available optimisation, not a defect.

## 12. Golden rules (the ones that bite)

1. Preview == PDF for every report surface. Never fix one path only.
2. Relevance/classifier changes ⇒ version bump ⇒ boot backfill re-cleans prod. Precision-first: remove over-broad REQUIRED phrases rather than adding broad excludes.
3. Engine/deterministic text is authoritative; analyst edits are the only override, and gated sections re-run their gate on final text.
4. Never up-rate severity at display time; demote-only hedges.
5. New DB columns need Drizzle schema + idempotent boot migration in the same change.
6. One shared builder per surface family — fix once, all theatres/topics inherit.
