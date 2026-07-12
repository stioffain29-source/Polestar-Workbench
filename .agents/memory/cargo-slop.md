---
name: Cargo Watch slop detector
description: Trade-press / commentary / legislation "slop" filter for topic='cargo_watch' — where it is wired, its precision gates, and the false-positive traps.
---

# Cargo Watch slop detector

`lib/relevance/src/cargoSlop.ts` (`CARGO_SLOP_EXCLUDE[]` + `matchCargoSlop`)
drops US/UK trade-press commentary, legislation/hearings, statistics
round-ups, explainers/webinars, vendor risk-marketing and out-of-region (US)
identifiers from `topic='cargo_watch'`. The feed is concrete APAC + Middle-East
cargo-crime EVENTS, not think-pieces that merely say "cargo theft".

Wired into TWO surfaces that share the ONE barrel-exported regex array, so they
cannot drift:
- ingest/API gate: `topicRelevance.ts` cargo exclude path (stamps the persisted
  `relevance_status`, drives the version-bump backfill).
- frontend: `cargoAnalysis.classifyScope` — checked BEFORE every in-scope rescue.

**Ordering (deliberate):** the slop check runs BEFORE the `analystInScope`
short-circuit in `classifyScope`, so an analyst-picked in-scope row is still
dropped if it reads as slop.
**Why safe for TAPA:** TAPA's synthesised text ("TAPA-recorded cargo crime
incident on <date>… Estimated goods value US$N. Original TAPA value reported in
EUR…") carries no cost-verb / percent / legislative / masthead framing, so no
slop pattern can match it. Mirrors the existing hard non-cargo rejects that also
precede the override.

**Precision gates (each closed a real false positive on the live corpus):**
- loss-aggregate line requires a literal `$` millions/billions ("losses exceed
  $6B"), so a local-currency per-incident loss ("Losses Reach IDR 23 Million",
  "Rp1.8 billion") is NOT read as industry commentary.
- "task force" is bound to "cargo theft task force" (a NAMED US body) so a local
  police task force arresting hijackers survives.
- legislative actor tokens (lawmakers/legislators/senators/congress/committee)
  are gated on adjacent cargo/freight/supply-chain/trucking within 40 chars, so
  a Karachi shop raid or an asset-declaration story that merely names an official
  is not swept up.
- the "L.A." token uses a negative lookbehind `(?<![a-z]\.)` so the "L.A." inside
  a dotted abbreviation (Indian "M.L.A.", "P.L.A.") does not drop genuine Indian
  headlines — India is the top in-region cargo source.

**False-positive tolerated by policy:** US-trade-press mastheads
(freightwaves / transport topics / lapd / nypd / socal / los angeles / c-span…)
drop even a genuine event syndicated by those outlets (e.g. a US KitKat-truck
theft). Acceptable under "signal thin > noise in"; local outlets are the primary
in-region source.

**How to change safely:** bump `RELEVANCE_RULE_VERSION` on any pattern change so
the boot backfill re-scores; marker-excluded rows (tapa_offline:/gdelt_cloud:)
never re-score. Verify by replaying `matchCargoSlop` over the live cargo_watch
corpus (throwaway script importing `pool` + the relevance barrel), not by eye.
