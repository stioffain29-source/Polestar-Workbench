# Polestar Advisory Workbench — Honest Code Audit (Developer Handoff)

_Date: 2026-06-05. Scope: the whole monorepo (`artifacts/workbench`, `artifacts/api-server`, `lib/*`, `scripts`). Grounded in the current code, not aspiration._

## TL;DR verdict

Solid, type-safe, contract-first codebase that ships and works in production. The
engineering discipline on types is genuinely good. The two things a new dev must
know up front: **(1) there are zero automated tests, no linter, and no CI**, and
**(2) production data and schema changes flow through ad-hoc, boot-time, marker-gated
"migrations" rather than a real migration tool.** Everything else is normal
product tech debt. Nothing here is a fire; several things are landmines if touched
carelessly.

---

## 1. What is genuinely solid (don't "fix" these)

- **Strict TypeScript, clean.** `pnpm run typecheck` passes across every package.
  `0` uses of `as any`, `0` `@ts-ignore`/`@ts-expect-error`. That is rare and worth
  preserving.
- **Contract-first API.** OpenAPI spec → generated React Query hooks
  (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). The server
  validates with Zod (`parse`/`safeParse` present in 7 of the route files). Keep the
  spec as the source of truth; regenerate with
  `pnpm --filter @workspace/api-spec run codegen`.
- **Shared libraries, no cross-artifact imports.** Ingest, relevance, and DB logic
  live in `lib/*` and are imported by both the CLI scrapers and the server, so all
  paths run identical code. This is the right structure.
- **Ingest concurrency is handled correctly.** `runIngestOnce` holds a Postgres
  cross-instance advisory lock, so manual + scheduled + boot runs can't collide. The
  lib functions deliberately do **not** close the shared pool (only CLI wrappers do).
- **Supply-chain guard.** `pnpm-workspace.yaml` enforces `minimumReleaseAge: 1440`.
  Leave it on.
- **The `console.error` in `lib/db/src/index.ts` is intentional** (documented
  last-resort sink) — not a logging violation. Everything else uses the pino logger.

---

## 2. Critical gaps (address these first on handoff)

### 2.1 No tests, no linter, no CI — biggest risk
- **`0` test files, no `vitest`/`jest` config, no `test` script anywhere.** Every
  change is verified by hand. For a data product where correctness (severity,
  relevance, dedupe, $ parsing) is the whole value, this is the top liability.
- **No ESLint config** and no root `lint` script. Style/consistency is enforced only
  by `prettier` + reviewer attention.
- **No CI.** `pnpm run typecheck` is the only automated gate, and it must be run
  manually.
- **First moves:** add `vitest`; the highest-value tests are pure functions in
  `lib/relevance` (`topicRelevance.ts`), `lib/ingest` (dedupe, severity, the cargo
  USD-loss parser), and `lib/ingest`/workbench dataset builders. They are pure and
  trivially testable. Then wire a GitHub Action running `typecheck` + `test`.

### 2.2 Database migrations are ad-hoc and boot-time
- Schema is applied with `drizzle push` (no migration history table, no rollback).
- Data migrations live in `artifacts/api-server/src/lib/migrations.ts` — **603 lines,
  8 hand-numbered blocks (0–7)**, each gated by a marker row in
  `app_migration_markers` or by idempotency. They run on every server boot.
- This works but is fragile: ordering is manual, there is no down-migration, a
  half-applied block can leave inconsistent state, and the file only grows. The
  recently fixed "FAO Fertilizer Outlook mis-filed under flashpoint" bug is exactly
  the class of error this pattern invites.
- **Recommendation:** keep the marker-gating discipline, but treat `migrations.ts` as
  a stopgap. For any real schema evolution, adopt `drizzle-kit generate` migrations
  with a tracked history rather than `push` + boot scripts.

---

## 3. Tech debt by area (real, not urgent)

### 3.1 "Fat" files doing too much
Largest hand-written modules (excluding generated `lib/api-*/generated/*`):
- `artifacts/workbench/src/lib/flashpointReportDataset.ts` — **1769**
- `artifacts/workbench/src/pages/ReportEditor.tsx` — **1378** (multi-topic drafting +
  fuel market forms + JSON validation + PDF orchestration in one component)
- `artifacts/api-server/src/lib/countryBaselineSeed.ts` — **1373** (mostly data)
- `artifacts/workbench/src/pages/CountryReport.tsx` — **1349**
- `artifacts/workbench/src/lib/exportTopicReportPdf.ts` — **1208**

`ReportEditor.tsx` and `CountryReport.tsx` are the two that would most benefit from
being split into topic-specific sub-components. Budget real time; they are central
and lightly tested (i.e. not at all).

### 3.2 PDF export is the single most fragile subsystem
There are **multiple export code paths that must stay in agreement**:
- In-app "Download PDF" rasterises the on-screen `.print-report` DOM
  (`exportPdf.ts` / `exportElementToPdf`), so screen == in-app PDF for free.
- Headless scripts use the jsPDF builders
  (`exportTopicReportPdf.ts`, `exportShippingReportPdf.ts`,
  `exportCountryReportPdf.ts`, `pdfChrome.ts`).
- Fonts are finicky: **all** jsPDF text must route through `setRoboto(...)` in
  `pdfFonts.ts`; a stray `setFont("helvetica")` silently drops embedded Roboto.
- The manual page-break algorithm in `exportPdf.ts` and the keep-together table
  pagination in the jsPDF builders are full of magic constants
  (`HEADER_BAND_H`, `EXPORT_REPORT_WIDTH_PX`, row-height formulas). Any UI change to
  charts/maps/tables needs a matching export-CSS or measurement change or the PDF
  breaks.
- **Hard product rule (from `replit.md`):** the on-screen preview and the PDF must
  never disagree — every topic preview renders from the same dataset, same section
  order, as its exporter. Honour this when touching either side.

### 3.3 Data pipeline brittleness (inherent, not a bug)
- Incident ingest depends on **free Google News RSS** feeds and **FRED CSV** for fuel
  prices — no API keys, but no SLAs either. Feed format/availability changes break
  ingest. Each runner is wrapped in its own try/catch so one feed failing can't fail
  the run; that's good, but failures are quiet (logged, not alerted).
- **Severity classification and relevance are heuristic text-matching.** They are
  carefully tuned (deny-lists, homonym guards like "march" the month, West Papua
  mis-tag guard) but inherently approximate. Rule changes require bumping
  `RELEVANCE_RULE_VERSION` so the boot backfill re-cleans persisted rows.
- **Geocoding is a curated city→country lookup**, not an API. No match → the row
  inserts with null lat/long and silently drops off the map. Centroid keys must match
  classifier country aliases or markers vanish.
- **Cargo translation** (`lib/ingest/src/translateScreen.ts`) reads
  `AI_INTEGRATIONS_OPENAI_*` directly and degrades if unset — a non-obvious runtime
  dependency for that one topic.

### 3.4 Editor state
- `ReportEditor` uses `localStorage` as a fallback for some fields (e.g. Executive
  Summary). Drafts can therefore diverge per browser/device until saved. Worth making
  explicit to users or removing.

---

## 4. Security posture (honest, given the intent)

The workbench is **intentionally public** — the owner explicitly reverted a prior
login/token gate ("anyone with the link can view and edit"). That is a product
decision, documented in `replit.md` and `threat_model.md`. Given that decision:

- **Single shared secret.** All privileged actions (`POST /api/admin/ingest`,
  `/api/admin/incidents/backfill`, and `sources` create/update/delete) reuse one
  `INGEST_ADMIN_TOKEN`. Missing token → 503 (route disabled), wrong token → 401. Fine
  for one operator; there is no per-user identity or audit trail.
- **CORS is wide open** (`app.use(cors())` with no config) and there is **no rate
  limiting and no helmet**. Acceptable for a deliberately public read/edit tool, but a
  new dev should know it, especially before adding any expensive or write endpoint.
- **One known dependency vuln:** `pnpm audit --prod` reports **1 moderate** — `qs`
  (transitive via `express`) DoS, fixed in `>=6.15.2`. Low impact here; bump when
  convenient.
- **Threat model exists** (`threat_model.md`) and is accurate. If auth is ever
  re-added, the client gate must *validate* the token server-side, not just store a
  string (a prior attempt did the latter).

---

## 5. Operations / deployment

- **Target:** Cloud Run autoscale (`.replit` → `deploymentTarget = "cloudrun"`).
- **Prod DB is writable only from inside the deployment runtime.** From the workspace,
  `DATABASE_URL` points at dev, and `executeSql(environment:"production")` is a
  read-only replica. You can verify prod but cannot fix it from the workspace — fixes
  reach prod only on **republish**.
- **Data freshness depends on cold-start catch-up.** The ingest scheduler runs on boot
  if data is stale, then on a timer; but autoscale scales to zero, so timers don't
  fire while idle. Frequent cold starts keep it fresh cheaply, but there is **no
  guaranteed cadence** unless you move to a reserved-VM/always-on deployment or a
  Scheduled Deployment running `scrape:prod`.
- **Failures are logged, not alerted.** No monitoring/alerting on ingest failures or
  feed outages. For a "live intelligence" product this is the gap most likely to cause
  another "data is stale / you're lying to me" complaint.

---

## 6. Suggested first 2 weeks for the new dev

1. Add `vitest` + a CI workflow (`typecheck` + `test`). Backfill tests for
   `lib/relevance`, ingest dedupe/severity, and the cargo USD parser first.
2. Add basic alerting on ingest failures (even a logged-error count surfaced on the
   Source Health page or a webhook).
3. Bump `qs`/`express` to clear the moderate advisory.
4. Decide on migrations: adopt `drizzle-kit` generated migrations before the next
   schema change; stop growing `migrations.ts`.
5. Only then refactor `ReportEditor.tsx` / `CountryReport.tsx` into smaller pieces —
   and write tests as you split.

---

## 7. File-level hotspots cheat-sheet

| Area | File(s) | Why it's sensitive |
|------|---------|--------------------|
| Boot migrations | `artifacts/api-server/src/lib/migrations.ts` | 8 ordered blocks, runs every boot, no rollback |
| Ingest core | `lib/ingest/src/{newsTopic,shipping,cargoWatch,strikes,marketPrices,sourceHealth}.ts` | external feeds, dedupe, severity, $ parsing |
| Relevance | `lib/relevance/src/topicRelevance.ts` | heuristic gate; bump `RELEVANCE_RULE_VERSION` on change |
| PDF (screen path) | `artifacts/workbench/src/lib/exportPdf.ts`, `pdfFonts.ts` | rasterise + manual page breaks + font embedding |
| PDF (headless path) | `exportTopicReportPdf.ts`, `exportShippingReportPdf.ts`, `exportCountryReportPdf.ts`, `pdfChrome.ts` | must match the screen path exactly |
| Big components | `pages/ReportEditor.tsx`, `pages/CountryReport.tsx` | doing too much; central; untested |
| Auth | `artifacts/api-server/src/lib/adminAuth.ts`, `routes/admin.ts`, `routes/backfill.ts`, `routes/sources.ts` | the only privileged boundary; single shared token |
