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

## Header band logo (light vs dark)

- The band logo MUST contrast with the band colour. White reverse logo
  (`Reverse_white_logo_hor`) is for DARK bands only; a Midnight Blue variant
  (`Polestar_navy_logo_hor.png`, recolored from the white PNG via ImageMagick,
  alpha preserved) is for LIGHT bands. The Spot Report band is light grey
  (POLAR, matching the sibling report footers), so it uses the navy logo — the
  white logo on grey is invisible.

## Preview == every export

- One shared dataset feeds the on-screen `SpotReportPreview` (`.print-report` DOM) and
  all exports; in-app PDF rasterises that DOM (`exportElementToPdf`) so screen==PDF is
  automatic, matching the rest of the workbench. .docx and plain-text render the same
  sections in the same order. Each export appends an export-history entry.
