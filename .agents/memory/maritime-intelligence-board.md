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

## Board is chokepoint-SCOPED — off-board incidents are excluded (owner directive)
**Rule:** the whole maritime board is scoped to tracked chokepoints. In
`buildMaritimeIntelligence`, `confirmed` is filtered to incidents whose
`detectChokepoints()` names ≥1 `BOARD_CHOKEPOINTS` strait
(`r.chokepoints.some(cp => BOARD_CHOKEPOINTS.includes(cp))`) at the single point
where `confirmed` is built, so EVERY downstream surface (risk/BLUF,
incidentSnapshot, confirmedIncidents table, cards, chokepointsAffected, KRIs,
watch-next) derives from the board-scoped set. A confirmed incident whose only
chokepoint is OFF-board (valid detection key like "Arabian / Persian Gulf" /
"Gulf of Oman"), or names none, is DROPPED from the report entirely.
**Why:** the earlier defect was an Extreme BLUF over a wall of L1 zero cards.
The first fix surfaced off-board incidents in a "Wider waters (no named
chokepoint)" bucket card — the owner REJECTED it ("no. the solution is to remove
this from the report"). Scoping at source removes the contradiction: empty board
→ risk L1 → an accurate Insignificant BLUF. Accepted trade-off: legitimate
off-chokepoint maritime incidents don't appear on this chokepoint-scoped board
(they still surface in the report's other sections + the live monitor).
**How to apply:** there are ALWAYS exactly 7 cards; `chokepointCards.key` is
`ChokepointKey` (no bucket key). Do NOT re-add a wider-waters / reconciliation
bucket. The empty-week (L1) BLUF must stay chokepoint-SCOPED ("No confirmed
incidents at tracked chokepoints this week"), never a blanket "no confirmed
maritime security incidents" — an off-board incident can still appear in the
same PDF's vessel-threat section, so an unscoped negative is falsifiable.
`chokepointsAffected` / KPI denominators stay keyed to `BOARD_CHOKEPOINTS.length`
(fixed "/ 7").

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
