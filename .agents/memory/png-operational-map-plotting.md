---
name: PNG Operational Map plotting
description: Why the country-report Operational Map plots on location-presence (geocoder contract), and the homograph trap when adding PNG town keys
---

# PNG (dot-mode) Operational Map plotting

The country-report Operational Map (`CountryReportMap.tsx`, dot mode = every
country EXCEPT the zone-mode set Indonesia/West Papua/Papua/Jakarta) plots a
marker for an incident **iff** it has valid numeric lat/lng AND a non-empty
`location` string.

**Why:** `geocode(country, text)` sets `location` to a place name ONLY on a
sub-national city/province match; on the bare country-centroid fallback it
returns `location: null`. So location-presence == "we actually know where".
Gating on it (not on `classifyLocationConfidence`) means centroid-fallback rows
never stack invisibly on the single national point — the defect that made the
map "stay on the same spot each week". `classifyLocationConfidence` stays in use
for `pngReportDataset` summariseLocationConfidence's plottableShare≥0.5 gate.

**How to apply:** to make a country's rows plot off-centroid, add its real
province/district towns to `CITY_COORDS` in `lib/ingest/src/geocode.ts`, then
add a marker-gated RELOCATE-not-delete backfill in `migrations.ts` that re-runs
`geocode()` over existing `location IS NULL` rows for that country (re-bound the
UPDATE with `AND location IS NULL` so analyst/already-resolved points are never
overwritten). The backfill is one-shot per marker — a later gazetteer fix will
NOT re-run it, so the gazetteer must be complete BEFORE it first runs.

## Traps
- Do not accidentally REMOVE an existing gazetteer entry when inserting a block
  near it (a first pass silently dropped `bougainville`). Bougainville is a
  headline PNG region attributed on that word alone; losing it strands rows.
- Homograph collision: `geocode` matches any CITY_COORDS key within
  `MAX_CITY_KM` (2500 km) of the attributed country's centroid. PNG towns whose
  keys are common Indonesian words — `tari` ("dance"), `buka` ("open") — sit
  within range of the West Papua centroid, so an untranslated Bahasa West Papua
  row would geocode across the border onto a PNG town (fabrication). Keep such
  bare keys OUT; rely on their parent region (Hela covers Tari; Bougainville
  covers Buka).
