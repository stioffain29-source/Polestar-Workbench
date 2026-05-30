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

## Where things live

- Data-status model (live/manual/static + "Data as of" line): `artifacts/workbench/src/lib/reportDataStatus.ts` (`computeDataAsOf`, `formatDataAsOfLine`, `latestRecordDate`).
- On-screen/in-PDF provenance strip: `artifacts/workbench/src/components/DataAsOfBanner.tsx`; headless equivalent `drawDataAsOf` in `src/lib/pdfChrome.ts`.
- Scrapers (data ingestion): `scripts/src/scrape-flashpoint.ts`, `scripts/src/scrape-cargo-watch.ts` (run via `pnpm --filter @workspace/scripts run scrape:flashpoint|scrape:cargo-watch`, add `--commit` to write).

## Architecture decisions

- The in-app "Download PDF" button (`ReportEditor.downloadPdf`) does NOT use the jsPDF builders — it rasterises the on-screen `.print-report` DOM via `exportElementToPdf`. So screen == in-app PDF is automatic. The jsPDF builders (`exportTopicReportPdf`/`exportShippingReportPdf`/`exportFlashpointReportPdf`/`exportCountryReportPdf`) are used ONLY by the headless scripts.
- Because of the above, the "Data as of" line lives in the React previews (covers screen + in-app PDF at once) AND in the jsPDF builders via `drawDataAsOf` (covers headless export).
- Ingestion status: flashpoint + cargo_watch + protests = "manual" (scraper-fed); fuel/fertiliser/shipping/energy/missile = "static" (import only). `latestRecord` = max(occurredAt); `lastUpdated` = max(createdAt) per topic — computed from the loaded incidents, not the `sources` table (the cargo scraper does not update `sources.lastSuccessAt`).
- Flashpoint reports carry topic `protests` but their incidents are stored under `flashpoint`; the data-as-of and staleness logic maps `protests` → `flashpoint` for scoping.
- Stale-prose guard: a report's window ends on its issue date. If live data holds records newer than the issue date, the editor reseeds prose from a fresh draft and shows a subdued-red (no-print) warning. Non-destructive — nothing persists until Save.

## Production ingestion (read-only prod DB)

- The production database is READ-ONLY from the workspace, so scrapers cannot write prod from here. Production data refresh must run INSIDE the deployment environment.
- Mechanism: a Scheduled Deployment running, e.g. `pnpm --filter @workspace/scripts run scrape:flashpoint -- --commit && pnpm --filter @workspace/scripts run scrape:cargo-watch -- --commit`. This must be created/published by the user (see the `deployment` skill); it cannot be provisioned from the workspace.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Adhere strictly to user instructions. No drift, no debate. Follow the brand spec (Midnight Blue #0B0B3D, Dusk Gray #303030, Electric Blue #4655FF, Polar Gray #E2E2E2, subdued red #A33232 reserved for Extreme only; Roboto Condensed/Roboto; no emojis, shadows, blurs, neon, or gradients on markers) and the five-tier risk vocabulary (Insignificant, Low, Moderate, High, Extreme) without substitution.
- Whenever a report's PDF exporter is rebuilt or changed, the on-screen preview pane in `ReportEditor.tsx` MUST be wired to a topic-specific preview component that renders from the same dataset, in the same section order, as the PDF. Preview and PDF must never disagree. Mirror the pattern used by `ShippingReportPreview` / `FlashpointReportPreview` (build dataset via `useMemo`, render the same sections, route the topic in the ternary at the preview wiring point in `ReportEditor.tsx`).

## Gotchas

- All PDF text MUST go through `setRoboto(pdf, "regular"|"medium"|"bold"|"italic")` from `src/lib/pdfFonts.ts`. `pdf.setFont("helvetica", ...)` or any direct `setFont` call to a standard PDF base font is forbidden. `ensureRobotoLoaded(pdf)` must be awaited once per jsPDF instance before any `pdf.text(...)` call.
- jsPDF auto-registers the 14 standard PDF fonts (Helvetica, Times, Courier, Symbol, ZapfDingbats) in the font dictionary at construction time. They appear in `pdffonts` output but are NOT embedded and NOT selected by any content-stream `Tf` operator. Removing them is not exposed by jsPDF's public API. The only safe acceptance check is the per-page `Tf` inventory in `screenshots/font_proof/FONT_AUDIT.txt` — only `/Roboto` may appear as USED.
- Headless PDF export for font auditing: `cd artifacts/workbench && REPORT_ID=<id> TOPIC=<fuel|shipping|cargo_watch|flashpoint> OUT_PATH=<abs.pdf> npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts`. The loader resolves `.ttf?url` imports to real on-disk paths in `node_modules/@expo-google-fonts/roboto/*`; the wrapper patches `fetch` for `file://` URLs. Do NOT re-stub `pdfFonts.ts` in the loader — that silently drops embedded Roboto and falls back to Helvetica.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
