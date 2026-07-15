---
name: Assessed-brief shared layers (country/city)
description: Shared-layer decisions turning the six country/city briefs from aggregate-then-label into assessed briefs.
---

The six briefs (PNG, West Papua, Indonesia, Thailand, Philippines, Jakarta) share
buildStructuredReportDataset (pngReportDataset.ts) + config profiles. Durable
rulings from the "assessed briefs" rebuild:

- **PNG-only display hedges are now ALL-THEATRE opt-out.** Both the development-wire
  filter (`filterDevelopmentWire`) and the demote-only severity correction
  (`demoteNonKineticWire`) flipped from opt-in (`=== true`, PNG only) to opt-out
  (`!== false` / `=== false` early-return). Every brief now drops low-value PR
  copy and caps mis-rated assistance/PR severity. A theatre opts out by setting
  the flag `false`. **Why:** the aggregate-then-label engine let development PR
  lead real security reporting across all theatres, not just PNG.

- **Key Developments ranked by ASSESSED VALUE, not count.** Themes scored by
  `scoreClusterValue` (countryTopValue.ts — casualties/evacuation/transport/
  regulatory/commercial signals + corroboration), with severity then count only
  as tie-breakers. **Why:** a single consequential development must outrank a
  pile of low-value items. Top-3 already used scoreClusterValue; this brings Key
  Developments in line.

- **Accident/hazard classification reroute** lives in structuredExtract.ts
  (ACCIDENT_HAZARD_RE / ACCIDENT_ONLY_RE / DELIBERATE_VIOLENCE_RE): flood /
  snakebite / drowning / lightning / vehicle-crash deaths → "Natural hazard";
  deliberate killings keep Homicide; road ACCIDENTS reroute but road
  closures/landslips stay transport. No RELEVANCE_RULE_VERSION bump (ingest
  category rewrite, not a relevance change).

- **Trajectory "nobasis" state:** with no comparable prior window the brief STATES
  no trend is asserted (BLUF + operatingRiskProse BLUF/Exec/Polestar) rather than
  implying stability. Adding it ripples to the operatingRiskProse trajectory union
  type — keep both in lockstep.
