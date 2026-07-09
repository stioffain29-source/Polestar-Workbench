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

**New `spot_reports` columns DO need boot-time DDL.** (Supersedes an earlier note here
that claimed boot DDL was forbidden — that was wrong for this repo.) The drift guard
`__tests__/db/schemaBootMigrationDrift.test.ts` is AUTHORITATIVE: every NEW column added
to the Drizzle schema must ALSO get an idempotent `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` in api-server `runDataMigrations()`, and must NOT be added to the test's frozen
BASELINE (the baseline is the set of columns that predate the boot-migration regime).
This matches the repo-wide convention in `prod-schema-via-migrations.md` (prod
`DATABASE_URL` is read-only from the workspace, so drizzle push only touches dev; the
boot ALTER is what brings prod into line on republish). Workflow for a new column:
Drizzle schema + boot ALTER + `pnpm --filter @workspace/db run push` (dev) + codegen if
it's in the API contract; the drift test must stay green.

## Section naming & order

- The analyst-judgement section is labelled **"Polestar View"** in the UI and every
  export, but is backed by the DB column / form key `assessment` (label-only change,
  no migration). Grepping "Assessment" finds the column, NOT the heading — search
  `report.assessment` to find the field.
- The Incident Map is NOT part of `spotReportSections`; the preview injects it
  separately at position 4 — after Bottom Line Up Front, before Incident Details
  (split BLUF from the rest, render BLUF → map → rest). Text/.docx exports omit it.
- Required render order: Header, metadata, BLUF, Incident Map, Incident Details,
  **Imagery (photos)**, Current Situation, Operational Impact, Polestar View, Outlook
  (24–72h), Recommended Actions, Disclaimer (Reference Incidents / Sources are
  pre-existing supplements before the disclaimer).

## Photos / Imagery (`photos` jsonb)

- `photos` is a `jsonb` array of `{dataUrl, caption?}` — base64 image data URLs the
  analyst attaches; render position is RIGHT AFTER Incident Details, falling back to
  after the map when there are no incident-details fields. Multiple photos, reorderable
  (move up/down swaps array order; render and storage are array-order, so reorder needs
  no extra field). Editor resizes on add (canvas, longest edge ≤1600, jpeg ~0.82, white
  bg) to keep the data URL small enough for jsonb + DOM-rasterise. Preview is the single
  render surface (screen==PDF); .docx / plain-text exports OMIT photos, mirroring the
  map omission.

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

## Editor 24-hour date entry & on-map title decoupling

- The editor's Report/Incident date fields use a custom `DateTime24` control
  (native date picker + a text field constrained to 24-hour `HH:mm`), NOT
  `<input type="datetime-local">`. **Why:** native datetime-local renders in the
  browser's locale (am/pm in 12-hour locales) and there is NO attribute to force
  24h — the user explicitly demanded 24-hour notation. Do NOT revert to
  datetime-local. The control still emits/consumes the same `yyyy-MM-dd'T'HH:mm`
  form string; `toIsoOrNull` guards save/preview against a partially-typed time.
- The spot report map does NOT draw the location/country as an on-map title. The
  preview's `IncidentMap` is called WITHOUT `locationLabel` (only `showLabels`, so
  analyst-typed manual point captions still render). **Why:** the user asked to
  decouple the country title from the map ("still tied to the map"). The country
  still shows in the report header Location meta — keep the on-map label off.
- Analyst photos (`report.photos`) MUST cap `maxHeight` (single 360 / 2-up 240)
  with `width/height:auto`, NOT `width:100%`+`height:auto`. **Why:** a full-res
  portrait photo at 100% width expands to a huge height, and because the in-app
  PDF rasterises this DOM, each oversized image broke onto its own near-empty page
  (a one-incident report ran to 4 pages). The cap keeps aspect ratio, centres the
  image, and makes the border hug it. Same single-page-fit lever family as the
  220px locator map.

## Local-draft autosave / recovery (never lose an unsaved draft)

The editor form lives only in React state until Save POSTs; a draft the user
typed but never successfully saved used to vanish on navigation. A localStorage
autosave + recovery safety net now backs it (`DRAFT_PREFIX` keyed slots). Three
non-obvious traps, each a real bug the architect caught — do not regress them:

- **Autosave must be gated by a `ready` STATE, never a ref set in the same
  commit.** The restore effect does `setForm(draft)` + `setReady(true)` together;
  React batches them, so the autosave effect (deps include `ready`) first sees
  `ready=false`, bails, and only re-runs once the restored form is committed. A
  `readyRef.current=true` set synchronously does NOT work: the autosave effect in
  that same commit still reads the stale empty `form` and its synchronous
  empty-clear branch DELETES the draft you just tried to recover.
- **A `baselineRef` (serialised clean form) gates SAVES, or the notice cries
  wolf forever.** After loading a report, the form is non-empty, so autosave
  would write a byte-identical draft, and every reopen would then "recover" it.
  Autosave saves only when `JSON(form) !== baselineRef.current`. Reset the
  baseline on load, on Discard, on update-success, AND in create-success BEFORE
  `setLocation` (the `/new` and `/:id` editor share one wouter Route, so create
  does NOT unmount — a stale `/new` baseline otherwise writes a phantom draft
  under the new id and re-triggers recovery). The empty-clear branch is
  deliberately NOT baseline-gated so emptying a form drops its draft at once.
- **Namespace from-incident new-drafts (`new:<ids>`) separately from the manual
  `new` slot**, and have the new-restore effect set `prefilled.current=true` when
  it recovers, so the incident prefill can't overwrite recovered edits. Otherwise
  opening a from-incident link clobbers an in-progress manual draft.

`loadDraft` merges over `emptyForm()` and coerces the array fields, so a draft
written by an older schema can't crash `isFormEmpty`/render. `saveDraft` retries
without photos on a quota error (typed prose survives even if attachments don't)
and never throws into render. Diagnosis note: a "lost" report is almost always a
draft that never POSTed (check deployment logs for a POST/PATCH + the row count),
not deleted data — spot reports have no server-side autosave.
