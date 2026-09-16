---
name: incident geocoding
description: How flashpoint/cargo_watch incidents get lat/long; the lookup-table approach and its scope-sync constraint.
---

# Incident geocoding (no external API)

Incidents are geocoded from a curated, dependency-free lookup table in
`lib/ingest/src/geocode.ts` (`geocode(country, text)`), NOT an external
geocoding service — the pipeline has no API for it.

Resolution order inside ingest remains city match → country centroid → null.
On the Geospatial Map, an accepted row without a resolved locality uses a
labelled state/province-capital fallback when recognised, otherwise a labelled
country-capital fallback. Exact locations always take priority.

**Why:** The owner chose broad country visibility over omitting accepted
incidents, while requiring fallback labels so approximate placement is not
presented as exact incident geography. Relevance gates still prevent
country-edition feed noise from becoming accepted incidents.

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
- Map fallback is presentation-only and must be labelled “capital fallback” or
  “state-capital fallback”; never apply it to an Unknown country.
- `Map.tsx topicToCategory` maps BOTH `protests` and `flashpoint` →
  "Civil Unrest" (live civil-unrest data is under topic `flashpoint`).
