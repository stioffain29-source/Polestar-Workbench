---
name: Data-centre enrichment adapter
description: Provider-agnostic, offline, enrich-only importer that fills status/type/capacity on existing data_centre_facilities rows from a third-party sample file.
---

# Data-centre ENRICHMENT adapter (provider-agnostic)

The OSM + PeeringDB importers are INSERT-only and neither free source publishes a
facility's operational STATUS / TYPE / CAPACITY. This adapter ENRICHES those
already-imported rows from a THIRD-PARTY provider EXPORT FILE. It never inserts,
never scrapes, never holds a key (offline — mirrors the TAPA offline precedent).

## Durable decisions (not derivable from a quick read)

- **Provider = a config profile, engine never changes.** A provider is a
  `ProviderProfile` (columnMap + statusValueMap + typeValueMap + powerUnit) in
  the `PROVIDER_PROFILES` registry. Adding Baxtel / Data Center Map = a new
  profile object, NOT engine edits. Ships only a `generic` canonical-header
  profile until a real sample proves the actual column names/values.
  **Why:** owner wants the provider swappable later (Baxtel pending
  cost/licensing; Data Center Map is location-only fallback — do NOT assume it
  carries status/type/capacity).

- **`enrichment_sources` jsonb is BOTH provenance AND the idempotency marker.**
  Per enriched field it stores `{provider, sourceRef, asOf, value}`. A field is
  proposed only when the source has a usable value AND it differs from the column
  AND the stamp's `value !== proposed`. **Why:** this one rule makes re-runs
  no-ops AND respects a later analyst override — an analyst edit changes the
  column but not the stamp, so the once-imported value is never re-imposed, yet a
  genuinely NEW source value still proposes a diff. Do not "simplify" it to a
  column-equality check; that would re-fight analyst edits.

- **No-fabrication is mechanical, three guards:**
  1. `mapVocab` requires an `Object.prototype.hasOwnProperty` hit on the value
     map — otherwise a cell like `constructor`/`__proto__` resolves to an
     inherited prototype member and smuggles junk into the constrained column.
  2. `parsePowerMw` accepts ONLY `^-?number (mw|kw)?$` (kW→/1000, >0); prose
     like "up to 50MW"/"~50"/"50-100" → null.
  3. operator is parsed but NEVER used to infer type. Unmappable status/type
     values are counted (`coverage.unmappable`) and left "not reported".

- **Matcher: name(normalised)+country exact, then coord ≤500 m, then city; >1
  survivor → `ambiguous` and NOTHING is written.** Empty record country →
  unmatched (conservative). Never picks arbitrarily.

- **Status change replicates the PATCH route's stamping**
  (statusChanged/previousStatus/statusChangedAt) so the recent-movers monitor
  stays correct.

- **Duplicate sample rows matching one facility:** first-with-diffs wins; the
  dry-run `diffs` list carries only the winner (so dry-run == what `--commit`
  writes) and `duplicateMatches` counts + logs the collision to reconcile.

## Where / how to run

- Engine `lib/ingest/src/dataCentreEnrichment.ts` (pure fns + DB runner
  `runDataCentreEnrichment`; `facilities` param is the test seam that also
  disables the commit path). Barrel-exported from `@workspace/ingest`.
- CLI `scripts/src/enrich-data-centres.ts`, npm `enrich:data-centres`
  (`--file= --provider= --country= --commit`). Dry-run prints per-field COVERAGE
  + per-record DIFF; manual only, NOT in the scheduler, never touches incidents.
- Column `enrichment_sources jsonb` on `data_centre_facilities` (schema + an
  idempotent boot ALTER in api-server migrations, kept in lockstep by the
  schema-drift test). Dev DB gets it via api-server restart (boot migration);
  prod via republish.
