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

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

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
