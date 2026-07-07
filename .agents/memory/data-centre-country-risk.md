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

## Brand ramp
`RISK_RATING_COLOR` mirrors `SPOT_SEV_COLOR`: petrol `#1B6B7A`=Insignificant
ONLY, subdued red `#A33232`=Extreme ONLY (Low/Moderate/High = #6FB872 / #E67E22
/ #C0392B).

## Editor gotcha
Update is a FULL-OBJECT REPLACE. `formToInput` omits blank optional fields
(`undefined`), which JSON-drops them — fine for create, but a blanked
`overallNote` could never be cleared on PATCH. The editor sends explicit `null`
for `overallNote` on the update path so a saved note can be cleared.
