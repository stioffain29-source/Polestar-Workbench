---
name: Spot Report capability — editor contract & reusable map
description: Non-obvious conventions for the analyst-led Spot Report product (null-clear-on-update enum contract, reusable IncidentMap re-fit gating, preview==export parity).
---

# Spot Report capability

A standalone, analyst-led, incident-triggered report product (own table, public CRUD
API, dedicated nav/list/builder, incident→spot-report action). Most of its shape is
in code; these are the decisions that bite if you don't know them.

## Enum clear-on-UPDATE contract (severity / confidenceLevel)

- CREATE and UPDATE treat empty enums DIFFERENTLY:
  - **CREATE**: omit the field when empty (the input contract is non-nullable).
  - **UPDATE/PATCH**: SEND `null` to clear it; omitting leaves the old value stuck.
- This requires the field to be nullable in BOTH the OpenAPI `*Update` schema
  (`type: ["string","null"]`, `null` in the enum) AND the frontend `buildData`
  must emit `null` (not skip) on update. The server PATCH spreads `...parsed.data`,
  so a `null` in the validated body flows straight to the nullable DB column.

**Why:** an analyst must be able to reset severity/confidence back to "—". The first
build omitted empty enums on every path (mirroring the create rule), so once a value
was set it could never be cleared.

**How to apply:** any future report editor with an enum the user can blank needs the
nullable-on-update spec + send-null-on-update frontend pair. Verify end-to-end:
create with a value, PATCH `{field:null}`, GET and confirm it persisted as null.

## Reusable IncidentMap — gate the bounds re-fit

- The Leaflet/IncidentMap must re-fit its viewport ONLY when the geographic point
  SET changes, not on every render. Derive a content signature key (`fitKey`) from
  the plottable points and compare against a `lastFitKeyRef`; memoize `plottable` by
  that signature so unrelated form state changes don't rebuild it.

**Why:** the map lives inside the live builder form; without this gate every keystroke
in an unrelated field re-fit the bounds and jerked the viewport.

## Analyst-placed multi-point map markers (`mapPoints`)

- Beyond the single primary coord (`report.latitude/longitude`) and linked-incident
  coords, a Spot Report carries `mapPoints` — a `jsonb` array of
  `{lat, lng, label?, severity?}` — so an analyst can plot arbitrary extra markers.
- `buildSpotMapPoints` is the ONE place that assembles every plotted point (primary +
  linked + manual); manual points use key `m-${idx}`, `primary:false`. `IncidentMap`
  draws a TEXT caption beside the primary point (its location label) AND beside any
  MANUAL point whose `label` is non-blank — the manual `label` flows
  `SpotMapPoint.label` → `IncidentMapPoint.label` and renders as an HTML overlay div
  (so it rasterises into the PDF, screen==PDF). LINKED-incident dots get only a
  severity colour + hover title, no on-map text. NOTE: `pointsSig` (the memo key that
  gates the viewport re-fit) MUST include `label`, or editing a label wouldn't redraw.
- A manual point with no (or blank) severity INHERITS `report.severity`. Use
  `spotSevKey(m.severity) || spotSevKey(report.severity)` — `||` not `??`, because an
  empty-string severity (API-written) must still fall back instead of rendering the
  off-palette neutral dot.
- The editor sends `mapPoints` as a (possibly empty) array on BOTH create AND update;
  rows with missing/NaN coords are filtered out, blank label/severity omitted, so the
  stored shape stays clean.

**Why no boot-time DDL for the new column:** the first cut added an
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at the top of `runDataMigrations()` on the
false premise that "prod doesn't run drizzle push". WRONG — Publish introspects dev+prod
and applies the schema diff automatically, and startup-time DDL to self-heal prod is
explicitly forbidden (see the database skill's migrations-on-publish reference). Make
the schema change in the Drizzle source of truth, push to dev, and re-publish; never
self-heal prod from the app entrypoint.

## Section naming & order

- The analyst-judgement section is labelled **"Polestar View"** in the UI and every
  export, but is backed by the DB column / form key `assessment` (label-only change,
  no migration). Grepping "Assessment" finds the column, NOT the heading — search
  `report.assessment` to find the field.
- The Incident Map is NOT part of `spotReportSections`; the preview injects it
  separately at position 4 — after Bottom Line Up Front, before Incident Details
  (split BLUF from the rest, render BLUF → map → rest). Text/.docx exports omit it.
- Required render order: Header, metadata, BLUF, Incident Map, Incident Details,
  Current Situation, Operational Impact, Polestar View, Outlook (24–72h),
  Recommended Actions, Disclaimer (Reference Incidents / Sources are pre-existing
  supplements before the disclaimer).

## Title block & PDF masthead

- The body title block is WHITE with a 2px Electric-blue bottom underline (it
  matches the section headings); it carries NO logo — just the eyebrow, report
  title, risk chip, and dates. (It was previously a grey/POLAR band carrying the
  navy logo; that band background + the logo were removed by user request.)
- The dark PDF masthead shows the logo + the words "SPOT REPORT" (NOT the report
  title — the title already appears in the body block). Driven by
  `data-masthead-label="Spot Report"` on the `.print-report` root, which
  `reportTitleFrom()` (exportPdf.ts) reads and uppercases. Any report can pin its
  masthead text the same way; others fall back to the h1 / filename.

## Preview == every export

- One shared dataset feeds the on-screen `SpotReportPreview` (`.print-report` DOM) and
  all exports; in-app PDF rasterises that DOM (`exportElementToPdf`) so screen==PDF is
  automatic, matching the rest of the workbench. .docx and plain-text render the same
  sections in the same order. Each export appends an export-history entry.

## Single-page fit (DOM-rasterise) & map attribution parity

- The DOM-rasterise export emits ONE page only when the clone's `scrollHeight` ≤
  `pageCssHeight` (~1199px at the 960px export width). `buildPageSlices` has NO
  orphan / sparse-last-page handling: ANY overflow (even a few px) breaks at the
  last section top and dumps the remainder onto a near-empty next page. To keep a
  SHORT report on one page, cut content height — the spot locator map is the
  biggest lever (one dot doesn't need 360px; set to 220, applied to the React
  preview so screen==PDF). This is a product fit, not a general pagination fix;
  long reports still paginate. The body raster height == the clone's CSS height,
  so a quick offscreen 960px clone `scrollHeight` measure predicts the break
  exactly; verify the real output by rendering the in-app PDF headless via
  Playwright (system Nix Chromium) and checking the page count.
- `IncidentMap` is SPOT-ONLY (the country report uses a separate
  `CountryReportMap`). It renders its OWN attribution caption into the legend row
  (`attributionControl:false`) so attribution is identical on screen and in PDF
  and never clashes with the in-map location label. Because of that,
  `applyMapExportLayout` must be called with `appendAttribution=false` for
  `spot-report-map` (else the PDF shows it twice); the country map still appends.
