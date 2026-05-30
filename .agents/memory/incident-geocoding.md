---
name: incident geocoding
description: How flashpoint/cargo_watch incidents get lat/long; the lookup-table approach and its scope-sync constraint.
---

# Incident geocoding (no external API)

Incidents are geocoded from a curated, dependency-free lookup table in
`lib/ingest/src/geocode.ts` (`geocode(country, text)`), NOT an external
geocoding service — the pipeline has no API for it.

Resolution order: city match in title+summary (finer marker + sets `location`)
→ country centroid → null. Combined country tags like "West Papua; Papua New
Guinea" resolve on their first `;`-separated component.

**Why:** the Map showed "0 geocoded" because ingest inserted rows with null
lat/long. Both `runFlashpointIngest` and `runCargoWatchIngest` now call
`geocode()` when building insert rows, and log a WARNING listing any rows that
could not be geocoded (they still insert, just without coordinates).

**How to apply:**
- The country-centroid keys MUST stay in sync with the canonical names emitted
  by the classifiers' `COUNTRY_ALIASES` in `flashpoint.ts` / `cargoWatch.ts`.
  A mismatch silently drops markers — e.g. legacy flashpoint rows tagged
  "United Arab Emirates" missed until that exact key was added alongside "UAE".
- Existing rows are backfilled by `scripts/src/backfill-geocode.ts`
  (`pnpm --filter @workspace/scripts run backfill:geocode [-- --commit]`),
  which reuses the same `geocode()` so backfilled rows match fresh ingests.
- Prod DB is read-only from the workspace, so the backfill (like the scrapers)
  must run inside the deployment runtime to write prod.
- The stored coordinate is an honest country/city point; `Map.tsx` applies a
  tiny deterministic id-seeded jitter (~±0.25°) at render time so many
  same-centroid markers don't stack into one. Do not bake jitter into the DB.
- `Map.tsx topicToCategory` maps BOTH `protests` and `flashpoint` →
  "Civil Unrest" (live civil-unrest data is under topic `flashpoint`).
