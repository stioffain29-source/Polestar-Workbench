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

## Board cards vs overall risk — the "Extreme over zeros" trap
**Rule:** `computeMaritimeRisk`/BLUF run over ALL confirmed incidents, but the
per-chokepoint cards only count confirmed incidents naming a `BOARD_CHOKEPOINTS`
strait. A confirmed incident whose only chokepoint is OFF-board (valid detection
key like "Arabian / Persian Gulf" / "Gulf of Oman") — or names none at all —
feeds the elevated overall risk but lands on NO card, so the board can read a
wall of L1·Insignificant zeros under an Extreme BLUF.
**Fix (in place):** after the 7 board cards, append a single "Wider waters (no
named chokepoint)" bucket (`WIDER_WATERS_KEY`) holding
`confirmed.filter(r => r.chokepoints.every(cp => !BOARD_CHOKEPOINTS.includes(cp)))`.
Bucket + board cards are mutually exclusive (never double-counts). Keep
`chokepointsAffected` and every KPI denominator keyed to
`BOARD_CHOKEPOINTS.length` (the fixed "/ 7"), NOT `chokepointCards.length`
(grows to 8 when the bucket is present). All three surfaces iterate
`board.chokepointCards` generically, so the bucket renders on screen==PDF for
free (`movement:null` → existing "unavailable" path).

## Vessel-attack CONFIRMATION needs active-voice phrasing
**Gotcha:** `isConfirmedOperationalIncident` confirms an attack via
`classifyVesselIncident` (VESSEL_RULES in `shippingAnalysis.ts`), which matches
ACTIVE voice ("missile struck a tanker", "drone struck a vessel") — the passive
"tanker struck by missile" matches NEITHER VESSEL_RULES nor
`CONFIRMED_PORT_ROUTE_RE`, so it is NOT confirmed and never enters the risk set.
**How to apply:** when writing a maritime test fixture (or reasoning about why a
real headline didn't confirm), use active-voice attack phrasing. A tautological
parity test that only compares `board.*` to `board.*` will silently pass over a
fixture that confirms nothing — assert a concrete `risk.level` to lock it.

## Brand: red reserved for Extreme
The maritime risk-color scale follows the strict cardTemplates rule, NOT the
app-wide severity palette: level-4 High = `#D35400` (burnt orange), level-5
Extreme = `#A33232`. No red of any family below Extreme. (The app-wide palette
uses `#C0392B` red for High — do not copy it onto brand-strict surfaces.)
