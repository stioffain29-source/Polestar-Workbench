---
name: Shared strike-target rulebook
description: One @workspace/strike-targets lib owns strike target/infrastructure classification for both ingest and the dashboard; how to extend it without re-introducing drift.
---

Strike target/infrastructure classification used to be duplicated: the ingest
classifier (lib/ingest/src/strikes.ts) wrote the strikes table's
`target_category` / `infrastructure` columns, and the Missile Strike Tracker
dashboard (artifacts/workbench/src/pages/Strikes.tsx) re-derived on-screen
labels from a near-identical-but-separate set of regexes. Editing one silently
left the other stale.

**Rule:** all strike target signal regexes (MILITARY/OILGAS/POWER/VESSEL/PORT/
AIRPORT/GOVT/CIVIL/INDUSTRIAL) and the two classify helpers
(`classifyStrikeTarget`, `classifyStrikeInfrastructure`) now live ONLY in
`@workspace/strike-targets` (lib/strike-targets, pure — no DB/Node). Ingest
imports the classify helpers; the dashboard imports the raw signal regexes to
build its TARGET_TEXT fallback + MILITARY-first check. Never re-declare a strike
target regex in either consumer — add it to the shared lib so both surfaces move
together.

**Why:** that drift was the whole point of the consolidation; the dashboard had
silently fallen behind ingest on aluminium smelters and "energy facilities".

**Regex convention (carried into the shared lib):** stems carry only a LEADING
`\b`, never a trailing one, so inflections still match (refiner→refinery,
"energy facilit"→"energy facilities"). A trailing `\b` on a stem drops every
inflected form — the historical cause of energy/oil/military targets reading
"Unknown". Short ambiguous tokens (crude, lng, grid, mall, home, `civilian\b`)
keep a trailing boundary so they don't over-match ("civilians injured" is a
casualty count, not a civilian-area target).

**Vessel framing must cover passive + plural + follow-on, not just active.**
`VESSEL_TARGET_FRAME` recognises a vessel target when ship/tanker/vessel is the
struck thing. Active framing ("ship seized") is the easy case; the harder ones
that kept landing in Unknown: PASSIVE ("ship was seized", "vessel has been
sunk") needs an optional auxiliary span (`(?:was|were|is|are|has|have|had|been|
being|got)\s+){0,3}` between noun and participle; PLURAL needs an optional `s?`
on the noun ("ships were sunk"); and a FOLLOW-ON clause ("One ship seized,
another sunk") needs a separate `another <participle>` check gated on a vessel
noun also being present (VESSEL_NOUN_SIG && ANOTHER_ATTACKED_FRAME) so it can't
fire on an unrelated "another sunk". The participle list is attack-only —
interception/escort/patrol stay OUT (those frame a responder, not the target).
Attacker gating is unaffected: military-force-as-attacker is decided in the
earlier military branch via MILITARY_ACTOR_FRAME, so "US forces seized a tanker"
still resolves with the tanker as the vessel target.

**Consolidation chose the comprehensive ingest signals as canonical**, with one
best-of-both tweak: CIVIL uses `civilian\b` (was bare `civilian` in ingest).
Net effect on the dev DB: exactly 3 strike rows moved Unknown→correct category
(an energy-facilities row → Oil & Gas; two aluminium rows → Civilian) — the
dashboard catching up to ingest, not a regression. The dashboard "Maritime"
label merges the lib's VESSEL_SIG + PORT_SIG (exported as MARITIME_SIG),
mirroring how mapDbTarget renders both the `vessel` and `port_maritime` enums.
