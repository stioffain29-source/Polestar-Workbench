---
name: Maritime Intelligence shared builder
description: Shipping monitor + Shipping Watch report share ONE builder; movement is context-only; topic-scope + integer-validation traps.
---

The live Shipping monitor and the Shipping Watch report are driven by ONE
deterministic builder (`buildMaritimeIntelligence` in
`artifacts/workbench/src/lib/maritimeIntelligence.ts`) so screen == report ==
PDF stay in lockstep.

## Topic-scope parity trap
**Rule:** the shared builder MUST filter incidents to `topic === "shipping"`
itself.
**Why:** the monitor feeds it server-filtered shipping-only incidents
(`useListIncidents({topic:"shipping"})`), but the report feeds it ALL topics
(`useListIncidents({})` in `ReportEditor`). Without the builder-internal filter
the two surfaces silently diverge (observed: report counted 8 vs monitor 6).
**How to apply:** any new consumer can pass whatever incident set it has; never
rely on the caller to pre-scope. Same trap applies to any future shared
topic-builder fed by both a server-scoped monitor and the all-topic report path.

## Movement (AIS) is CONTEXT, never an incident
Vessel-movement snapshots live in their OWN `maritime_movement` table, are
fetched separately, passed into the builder, and rendered as "Movement
Snapshot — Context". They are never incidents and never counted. Empty table →
every surface degrades to "movement data unavailable". There is no AIS API, so
rows are manual admin-token-gated uploads (`POST /api/maritime-movement`,
`requireAdminToken`); the upload form lives in `Shipping.tsx`.

## Orval zod can't emit `.int()` for OpenAPI `integer`
The generated `CreateMaritimeMovementBody` only enforces `>= 0`, not
integer-ness (no Orval toggle, and `clean:true` regenerates the file). Enforce
integer in a HAND-WRITTEN route refinement (`CreateMaritimeMovementBodyStrict`
in `routes/maritimeMovement.ts`), not the generated schema, so a decimal direct
call returns a clean 400 instead of a Postgres 500 on the integer columns.

## Brand: red reserved for Extreme
The maritime risk-color scale follows the strict cardTemplates rule, NOT the
app-wide severity palette: level-4 High = `#D35400` (burnt orange), level-5
Extreme = `#A33232`. No red of any family below Extreme. (The app-wide palette
uses `#C0392B` red for High — do not copy it onto brand-strict surfaces.)
