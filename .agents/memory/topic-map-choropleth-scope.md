---
name: Topic monitor choropleth scope
description: Country-choropleth monitor maps (energy/fertiliser/civil-unrest/conflict) share one CountryChoroplethMap; the cargo base geojson is scope-locked by a guard test, so extra countries go in a separate overlay merged only in the component — never in the cargo file.
---

# Monitor country choropleths (shared CountryChoroplethMap)

`components/CountryChoroplethMap.tsx` is the ONE country-choropleth used by every
country-shaded monitor map: energy + fertiliser (`pages/Topic.tsx`, gate
`useChoropleth = topic==="fertiliser"||"energy"`), Civil Unrest (`pages/Protests.tsx`,
topic=flashpoint) and Conflict Watch (`pages/Conflict.tsx`, topic=conflict). It exports
`buildCountryIntensity(rows)` (folds per-country counts into polygon-name space, applying
`CHOROPLETH_COUNTRY_ALIASES` e.g. "United Arab Emirates"→"UAE") and `CountryChoroplethMap`
(CARTO Positron basemap + shaded polygons + count-band legend + optional caption). Fuel and
other generic topics still use the per-incident CircleMarker spot map — the choropleth is
gated, so do not assume every topic shades.

Shading source of truth: `lib/cargoChoropleth` (`COUNT_BANDS`, `countBandColor`,
`featureCountryName`). Intensity keys off the RAW stored `i.country` names.

## Base geojson is CARGO-SCOPE-ONLY — extras go in an overlay

`assets/cargoScopeCountries.geo.json` must contain EXACTLY the cargo `IN_SCOPE_COUNTRIES`
(33). `__tests__/workbench/cargoChoropleth.test.ts` guards this both ways: every in-scope
country has a polygon AND there are no extra polygon names. Two more tests key off it
(`cargoAliasPolygon`, `cargoRecoveryPortPolygon`).

**Why it is scope-locked (do NOT add non-cargo countries to it):**
- The cargo STATIC report choropleth (`CargoChoroplethStatic`) paints ZERO-count features
  SOLID (`fillOpacity 1`, `#f2f3f7`) in file order, so a polygon overlapping another (e.g.
  West Papua over Indonesia's New Guinea) OVERPAINTS the shaded country → false "0 (none)"
  = no-fabrication violation. It also fits its framing to the bbox of ALL features, so a
  far-flung polygon would reframe the cargo report.
- The cargo monitor (`CargoWatch`) binds a per-polygon tooltip → a stray polygon drifts the
  hover ("West Papua — 0") while cargo folds those rows into Indonesia (`COUNTRY_ALIASES`).
- The guard test goes red.

**The pattern:** monitor countries OUTSIDE cargo scope live in
`assets/monitorChoroplethExtras.geo.json` (currently Nepal + West Papua — both are real
high-volume flashpoint/conflict `country` values, ~370 / ~345 rows). `CountryChoroplethMap`
merges base + extras into module-level `MONITOR_CHOROPLETH_GEO` and renders THAT. Cargo
surfaces import the base file directly, so they never see the extras. In the shared
component zero-count = `fillOpacity 0` (transparent outline), so an extra polygon with no
incidents on a given topic (e.g. West Papua on energy) is a harmless faint outline, not an
overpaint.

## Silent-drop traps (still apply)

1. **Missing polygon.** Every country a topic attributes incidents to needs a polygon
   (exact `properties.name`) in base OR extras, or it renders NOTHING (no shade/outline/
   tooltip) while the Top-Countries card still lists it → map/table divergence.
2. **DB-name != polygon-name.** Intensity keys off raw `i.country`; a DB spelling differing
   from the polygon `name` silently fails the lookup — fold it in `CHOROPLETH_COUNTRY_ALIASES`.

**How to apply — adding a country/topic:** diff the topic's distinct DB `country` values
against base+extras `name` lists. If a needed country is IN cargo scope it is already in
base; otherwise add its polygon to `monitorChoroplethExtras.geo.json` (never the base file).
Add any DB→polygon aliases. Composite strings ("India; Thailand", "Indonesia; West Papua")
and "Unknown" are DELIBERATELY unmapped — they appear as their own literal rows in the card
too, so leaving them off the map keeps map==table consistent. Do NOT split composites for
the map only.
