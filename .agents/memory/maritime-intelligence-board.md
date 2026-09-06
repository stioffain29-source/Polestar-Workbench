---
name: Maritime Intelligence shared builder
description: Shipping monitor + Shipping Watch report share ONE builder; movement is context-only; topic-scope + integer-validation traps.
---

The live Shipping monitor and the Shipping Watch report are driven by ONE
deterministic builder (`buildMaritimeIntelligence` in
`artifacts/workbench/src/lib/maritimeIntelligence.ts`) so screen == report ==
PDF stay in lockstep.

## Two explicit input modes
**Rule:** raw monitor input must still self-filter to `topic === "shipping"` and
run monitor scope/credibility/dedupe/window/confirmation. Report input must be
the already-final canonical set and skip every one of those selection gates.
**Why:** running a second report selection pipeline made Maritime Intelligence
totals/risk disagree with the rest of Shipping Watch.
**How to apply:** report callers use prevalidated mode with the report dataset's
canonical incidents; raw mode remains the monitor contract.

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

## Seven route cards, but report risk uses the whole final set
**Rule:** keep exactly seven chokepoint cards and never add a “wider waters”
bucket. In report mode, however, overall confirmed total/risk uses every final
canonical incident; cards are route-specific subsets of that same set.
**Why:** the current report invariant requires one incident denominator across
headline risk, narrative and Related Incidents. Silently dropping a confirmed
off-card event only from Maritime Intelligence recreates split totals.
**How to apply:** a no-chokepoint incident stays in the report total/risk and
confirmed table but contributes to no route card. Use geography-scoped
chokepoint detection so a country-incompatible name cannot inflate a card.

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
