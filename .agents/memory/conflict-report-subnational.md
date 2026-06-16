---
name: Conflict report sub-national hotspots
description: How the Conflict Watch report localises violence to states/regions, and the honesty rule gating "rest of the country is safe" claims.
---

# Conflict Watch sub-national localisation

The Conflict Watch report (topic `conflict`) must name WHERE inside a country the
violence sits (e.g. India → Manipur + the Maoist/Naxal belt), never paint a whole
country as uniformly dangerous.

**Data reality:** the incident `location` column is EMPTY. Sub-national place
names only appear in the incident TITLE text, and `geocode.ts` is city-keyed so it
misses Indian states / regions entirely. So localisation is done with a curated
`COUNTRY_HOTSPOTS` gazetteer in `conflictReportDataset.ts` (per-country
`{label, terms[]}`), matched against titles with a word-boundary `mentions()`.
`detectHotspots(theatre, rows)` returns `{hits, coveredCount}`; per-incident
coverage is counted ONCE even if several labels match (no double-count).

**The honesty rule (the part that's easy to get wrong):** `focusOf()` returns BOTH
`hasFocus` (any hotspot matched) and `localised` (coverage ≥ 0.5). The strong
claims — "violence concentrated in X rather than countrywide", "Operations
elsewhere in <country> are largely unaffected", "the rest of each country largely
carries on as normal", "not the country as a whole" — must be gated on
`localised`, NOT merely `hasFocus`. One hotspot hit among many incidents
(coverage < 0.5) gets the softer "with the worst of it around X" / "clustered
mainly around X" wording instead. Gating only on `hasFocus` re-introduces the
original misleading "country is safe" failure for thinly-matched theatres.

**Why:** the user's complaint was that "India is worth watching" implied
countrywide risk when incidents were isolated to Manipur + the Maoist belt. The
fix is dishonest in reverse if a single matched title lets a noisy theatre claim
it's contained.

**How to apply:** any new section prose that asserts geographic containment must
test `f.hasFocus && f.localised`, with a `hasFocus`-only middle branch and a
no-focus fallback (see `buildAreaParagraph`, `buildSituation`, `buildWhatMatters`,
`buildPolestarView`). Add new region vocab to `COUNTRY_HOTSPOTS` only. Tests in
`__tests__/workbench/conflictReportDataset.test.ts` pin the sub-50% behaviour.
Preview (`ConflictReportPreview.tsx`) and PDF (`exportConflictReportPdf.ts`) both
consume the same dataset, so prose flows to both automatically.
