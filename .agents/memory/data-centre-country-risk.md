---
name: Data-centre per-country risk framework + CPI seeding
description: How the 16-dimension per-country data-centre risk framework is structured, why the dimension vocab is duplicated client-side, and the no-fabrication rules governing CPI auto-seeding.
---

# Per-country data-centre risk framework

One row per country (`data_centre_country_risk`, unique `lower(country)`) carries
a risk assessment across a FIXED 16-dimension jsonb map. Each dimension value:
`{rating, rationale, source, analystNote, provisional, overridden, seededFrom}`.
A missing key / null rating reads **"not reported"** — never guessed.

## Dimension vocab is duplicated on purpose
The 16 `{key,label}` dimensions live in BOTH `lib/db/src/schema/
dataCentreCountryRisk.ts` (`DATA_CENTRE_RISK_DIMENSIONS`) AND the client
`artifacts/workbench/src/lib/dataCentreRisk.ts`.
**Why:** importing `@workspace/db` into the browser bundles `pg` and crashes
(see workbench-server-lib-barrel-import.md). The client keys index the
orval-generated `DataCentreCountryRiskDimensions` type, so a client key TYPO
fails typecheck; only OpenAPI↔Drizzle KEY drift and label drift are unguarded —
keep the three lists (schema / OpenAPI / client) in lockstep when adding a dim.

## CPI auto-seeding — no-fabrication rules
`scripts/src/import-cpi.ts` (pure core `scripts/src/lib/cpiSeed.ts`) seeds the
`corruption` + `transparency` dimensions from a LOCAL Transparency International
CPI CSV. INVERTED band map v1 (higher CPI = cleaner = lower risk):
`>=80 Insignificant / 60-79 Low / 40-59 Moderate / 20-39 High / <20 Extreme`.
- Seeds are ALWAYS `provisional:true` (amber badge) with full year provenance in
  rationale/source/`seededFrom="TI CPI <year>"`; saving in the editor = review,
  which clears `provisional`.
- `isCpiSeedable` NEVER overwrites analyst work: only absent/empty dims and a
  PRIOR `TI CPI` provisional seed are seedable; `overridden` or analyst-written
  dims are left alone.
- Scoped to TRACKED countries only (distinct facility countries + existing risk
  rows); a country not matched in the CPI file stays "not reported" (honest, no
  guessing). Country match is case-insensitive exact — name mismatches (e.g.
  "Viet Nam" vs "Vietnam") simply don't seed.
- Dry-run is the DEFAULT; `--commit` gates the write. Local-file only, no
  network, NOT in the scheduler — run by hand per new CPI edition.
- **Why band-map versioning:** `CPI_BAND_MAP_VERSION` (in rationale text) lets a
  future threshold change be told apart from an old seed; bump it + the unit
  test if thresholds move.

## Generalised offline seed registry (WGI/ND-GAIN/INFORM/Aqueduct/…)
CPI seeding is now ONE case of a swappable registry: `scripts/src/lib/
riskSeed.ts` (generic `ratingFromBands`/`isSeedable`/`buildSeededDimension`/
`buildNoteDimension`/`parseIndexCsv`/`parseNotesCsv`), `scripts/src/lib/
riskSourceRegistry.ts` (one entry per source → dimension(s) + a versioned band
map, `kind:"rating"` or note-only `kind:"note"`), driven by one generic CLI
`scripts/src/import-risk-seed.ts` (`--source=<id> --file= --year= [--commit]`).
Adding a source = ONE registry entry; the CLI never changes.
- `isSeedable` now ALSO refuses a `locked` dim (per-field lock) and
  refuses a provisional seed from a DIFFERENT source prefix (cross-source
  overwrite guard). Dimension value gained `sourceDate` / `confidence`
  (Low|Medium|High — "Medium" NOT "Moderate", to avoid colliding with the risk
  tier) / `lastReviewed` / `locked`.
- **WGI column trap (no-fabrication):** WGI exports carry BOTH an "Estimate"
  (−2.5..+2.5) and a "Percentile Rank" (0–100) column. The estimate is in-range
  for a 0–100 band table but OPPOSITE meaning → silent mis-band. Value-header
  regexes are deliberately narrowed to the specific domain token (WGI
  `/percentile/i` only, INFORM `/hazard|exposure/`|`/conflict/`, etc.) — never a
  generic `/index|score|value|percent/` catch-all that could grab a neighbouring
  composite column.
- Seeds are BUILT (and thus band-validated) during the PLAN pass, so a dry-run
  surfaces an out-of-range value before any write; `--commit` runs in ONE
  transaction so a mid-run failure rolls back (no partial seed).
- Band maps pinned by `__tests__/scripts/riskSeedBandMaps.test.ts`; bump the
  per-source `bandMapVersion` + the test if thresholds move.
- Best-effort dataset auto-download was deliberately SKIPPED: raw govt bulk files
  are wide/multi-sheet and several hosts 406/403 our egress IP; hand-reshaping =
  fabrication risk. The registry expects an analyst to drop a clean offline CSV;
  until then the dimension stays "not reported".

## Brand ramp
`RISK_RATING_COLOR` mirrors `SPOT_SEV_COLOR`: petrol `#1B6B7A`=Insignificant
ONLY, subdued red `#A33232`=Extreme ONLY (Low/Moderate/High = #6FB872 / #E67E22
/ #C0392B).

## Editor gotcha
Update is a FULL-OBJECT REPLACE. `formToInput` omits blank optional fields
(`undefined`), which JSON-drops them — fine for create, but a blanked
`overallNote` could never be cleared on PATCH. The editor sends explicit `null`
for `overallNote` on the update path so a saved note can be cleared.
