---
name: PeeringDB data-centre registry importer
description: CLI-only PeeringDB → data_centre_facilities importer; mirrors OSM; anonymous 429 cooldown, cross-source dedupe limits, no-fabrication.
---

# PeeringDB data-centre registry importer

A repeatable CLI (`import:peeringdb-data-centres`) that populates the Data Centre
facility registry from PeeringDB, mirroring the OSM importer exactly. Engine
`runPeeringDbFacilityRegistryImport` in `lib/ingest/src/peeringdbFacilities.ts`;
thin CLI in `scripts/src/import-peeringdb-data-centres.ts`. Reuses
`OSM_DC_COUNTRIES` (13 territories) for scope. Writes `data_centre_facilities`
ONLY, never `incidents`, never the scheduler — same supervised-registry policy as
OSM.

## PeeringDB anonymous API rate-limit is the operational gotcha

The public `GET https://www.peeringdb.com/api/fac?country__in=<ISO>&limit=250&skip=<n>`
endpoint needs NO key, but its ANONYMOUS rate limit is strict and its cooldown is
LONG (minutes-to-an-hour, NOT seconds). Running the full 13-country scan a few
times back-to-back (e.g. two dry-runs + a commit) trips 429 on the remaining
countries; a 75 s wait did NOT clear it. Symptoms: `FETCH ERROR: status 429` per
country, and a bash "timeout" (`exit -1`, no output) while the retry/backoff
waits pile up past the 120 s shell cap.

**How to run cleanly:** scope to small country batches (`--country=ID,JP`), space
runs out, and expect to FINISH partial loads by an idempotent re-run after the
cooldown. The importer captures 429 as a NON-FATAL per-country error and dedupes
by `sourceUrl`, so re-running only inserts what is missing (re-run reports
"N already stored, 0 new"). A bash -1 can still have committed rows — always
confirm via `select country,count(*) … where created_by='PeeringDB import'`
before assuming failure.

## No-fabrication specifics (differ subtly from OSM)

- Import only if the row has a real coordinate AND a name; `operator` comes from
  PeeringDB `org_name` ONLY (no fallback). status/planning_risk stay "Unknown",
  facility_type stays the table default "Unknown / not reported".
- **PeeringDB `status` field is record MODERATION state ("ok"), NOT facility
  operational status — discard it.** Do not map it to the registry `status`
  column.
- Many PeeringDB rows carry no coordinates and are correctly SKIPPED (observed:
  JP dropped 56 of 112, IN 45 of 245). This is the no-coords gate, not a bug.
- `finiteOrNull` must short-circuit `null`/`""` before `Number()` (same trap as
  OSM/iccPiracy: `Number("") === 0` → false null-island).

## Cross-source duplicate limitation (owner-reviewed, not a defect)

Dedupe is by `sourceUrl` and proximity warnings only run WITHIN the PeeringDB
batch — NEVER against existing OSM rows. So the same physical facility listed by
both OSM and PeeringDB is imported twice (exact same-name overlaps exist, plus
near-name variants like "Equinix SG3" vs "Equinix Singapore SG3"). The OSM
importer has the identical limitation; the owner-reviewed dry-run is the
mitigation. A cross-source proximity/duplicate REPORT (query-only, no auto-merge)
would be the follow-up if the owner wants to prune doubles.

## Undo

Delete `where created_by = 'PeeringDB import'`. Prod is a separate supervised CLI
run — the dev `DATABASE_URL` is the only one writable from the workspace.
