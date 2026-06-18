---
name: Monitor syndication dedup (generic non-flashpoint)
description: Conservative full-title dedup for energy/fuel/fertiliser/conflict/cargo monitors and the masthead-stripping gate
---

- The non-flashpoint topic monitors (energy/fuel/fertiliser/conflict + the cargo dashboard) historically had NO syndication dedup — the generic `trueIncidents` branch was a bare relevance filter, so the same wire story showed many times.
- The shared helper (`artifacts/workbench/src/lib/monitorDedupe.ts`) dedupes on the FULL canonical title only — deliberately NOT flashpoint's aggressive fuzzy/topicSignature second pass. Flashpoint over-merges distinct events; the generic monitors must stay conservative (precision over recall) so they never hide a real event.
- `canonicalTitleKey` strips a trailing " - Source" / " | Source" masthead ONLY when the tail looks like a publication name (a bare domain, or a ≤5-word run whose significant words each carry an uppercase letter). A lowercase dash-subtitle ("...operations - evacuation ordered") is NOT a masthead and must be preserved, or two distinct headlines that merely share a prefix collapse into one. The separator must be space-padded so in-word hyphens (Iran-backed, COVID-19) never trigger a strip.

**Why:** architect flagged the naive "strip any trailing space-padded dash clause" as a medium over-merge risk — distinct subtitles after a dash would merge.

**How to apply:** any new generic monitor must route through `dedupeMonitorRows`; keep RAW DB tallies (totalInDb / outOfScope / excludedNonCargo) UN-deduped because they describe source data, not the visible working set. Winner order is optional rank > severity (SEV_RANK 1..5) > newest date; unkeyable rows are kept.
