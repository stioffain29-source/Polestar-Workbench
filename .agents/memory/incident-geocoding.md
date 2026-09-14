---
name: incident geocoding
description: How flashpoint/cargo_watch incidents get lat/long; the lookup-table approach and its scope-sync constraint.
---

# Incident geocoding (no external API)

Incidents are geocoded from a curated, dependency-free lookup table in
`lib/ingest/src/geocode.ts` (`geocode(country, text)`), NOT an external
geocoding service — the pipeline has no API for it.

Resolution order inside the geocoder is city match → country centroid → null,
but feed-country fallback is discovery metadata, not geographic evidence.
Generic news ingest must not call the geocoder for fallback-only attribution,
and the map must never plot a row with a null resolved location even if a
legacy row still carries centroid coordinates.

**Why:** Country-edition feeds repeatedly syndicated foreign sports,
entertainment and Nigerian stories, then stamped them with Pakistan or Sri
Lanka and plotted them at those centroids. A country default must not become a
fabricated incident location.

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
