---
name: OSM data-centre registry importer
description: CLI-only OpenStreetMap → data_centre_facilities importer; Overpass etiquette, strict no-fabrication, idempotency by source_url.
---

# OSM data-centre registry importer

A repeatable CLI (`import:osm-data-centres`) that self-populates the Data Centre
facility registry from OpenStreetMap across 11 Asian countries. Engine
`runOsmFacilityRegistryImport` in `lib/ingest/src/osmDataCentres.ts`; thin CLI in
`scripts/src/import-osm-data-centres.ts`.

## Non-obvious constraints (why it is built this way)

- **CLI-only, never the scheduler.** The runner is deliberately named
  `runOsmFacilityRegistryImport` to stay distinct from any incident-writing
  ingest path. It writes to `data_centre_facilities`, NOT `incidents`. Do not
  wire it into `runIngestOnce`/the boot scheduler — the owner wants a manual,
  supervised registry refresh.
  **Why:** registry rows are reference data, not live incident feed; automatic
  refresh could churn/duplicate the registry.

- **Strict no-fabrication.** Import a facility ONLY if it has a real mapped
  coordinate AND a name (`name:en || name`). Operator = `tags.operator` only —
  never fall back to `brand`/`name`. status/planning_risk stay `"Unknown"`,
  capacity/it_load stay NULL ("not reported"). Verified in prod: operator was
  set on only 138 of 296 rows (exactly those OSM tagged).

- **Idempotency key = OSM element URL** (`https://www.openstreetmap.org/<type>/<id>`)
  stored in `source_url`. INSERT-only; dedupe existing vs DB by `source_url` via
  `inArray`. Re-run inserts 0. No schema change needed for this.

- **Proximity is a WARN, never an auto-merge.** Two same-named facilities within
  250 m are flagged for the owner to eyeball in OSM (real node/way double-maps
  exist, e.g. KR "하남IDC" 21 m apart). Both are still imported.

## Overpass API gotchas

- **overpass-api.de WAF 406s a browser-looking User-Agent AND a missing UA.** A
  DESCRIPTIVE UA (e.g. `PolestarWorkbench/1.0 (…importer)`) is REQUIRED, not just
  polite etiquette. Also do NOT pin `Accept: application/json` — that combination
  is 406'd too; use `Accept: */*`. kumi.systems mirror also works with the
  descriptive UA (override via `OVERPASS_API_BASE`).
- Query unions `telecom=data_center` + `man_made=data_center` +
  `building=data_center` with `out center` (ways/relations return a `center`).
- Be polite: 6 s inter-country sleep + retry/backoff on 429/504/5xx. A full
  multi-country run therefore exceeds a 120 s shell timeout — run in small
  batches (≤3 countries) and verify by DB count. A bash "timeout" can still have
  committed everything (the sleep/pool-teardown ran after the per-country
  inserts); confirm via `select country,count(*) … where created_by='OpenStreetMap import'`
  before assuming failure.

## finiteOrNull coercion trap (shared with iccPiracy pattern)

`Number("") === 0` and `Number(asString(undefined)) === 0`, so an ABSENT lat/lon
would look like a real (0,0) point. `finiteOrNull` must short-circuit
`value == null || value === ""` → null BEFORE coercing, or way/relation elements
(which carry coords in `center`, not top-level `lat`/`lon`) get mis-read as the
null island and dropped.
