---
name: Topic monitor choropleth scope
description: The fertiliser+energy topic maps are country choropleths reusing the cargo geojson+lib; a country absent from the geojson, or whose DB name != polygon name, silently won't shade (map/table divergence).
---

# Topic monitor (Topic.tsx) country choropleth

The generic topic monitor (`pages/Topic.tsx`, `/topics/:topic`) renders a country-level
choropleth for `topic === "fertiliser" || topic === "energy"` (gate = `useChoropleth`),
mirroring the Cargo Watch map. Every OTHER generic topic (fuel, flashpoint/protests, …)
still uses the per-incident CircleMarker spot map — the choropleth branch is gated, so do
not assume every topic shades. To add another topic to the choropleth, extend `useChoropleth`
AND run the coverage/alias check below first.

It reuses the SINGLE source of truth: `assets/cargoScopeCountries.geo.json` polygons +
`lib/cargoChoropleth` (`COUNT_BANDS`, `countBandColor`, `featureCountryName`). Per-country
intensity is built from the page's windowed `byCountry` aggregation of the RAW stored
`i.country` names (NOT the normalised `i.displayCountry` that CargoWatch keys on).

## Two silent-drop traps

1. **Missing polygon.** Every country a topic attributes incidents to MUST have a polygon
   (exact `properties.name`) in the geojson, or it renders NOTHING — no shading, outline,
   tooltip, or error — while the page's Top-Countries GeoCard still lists it (map/table
   divergence; `cargoMapTableConsistency.test.ts` guards the cargo case). Fertiliser's #2
   country Nepal was absent from the 33-country geojson → added a Nepal polygon (34 total).
2. **DB-name != polygon-name.** Because intensity keys off raw `i.country`, a DB spelling
   that differs from the polygon `name` silently fails the lookup. Energy stores "United
   Arab Emirates" but the polygon is "UAE" → folded via `CHOROPLETH_COUNTRY_ALIASES` in
   Topic.tsx (merge with `+=`, don't overwrite). CargoWatch dodges this only because it
   pre-normalises to `displayCountry`.

**Why the geojson, not a broader one:** the cargo STATIC report choropleth
(`CargoChoroplethStatic` via `buildChoroplethProjection`) fits its framing to the bbox of
ALL features, so adding a far-flung country would reframe the cargo report. Only add a
polygon that sits INSIDE the existing extent (Nepal is inside India's bbox → zero cargo
drift). Energy needed no new polygon — all its countries were already in scope.

**How to apply:** before pointing a NEW topic at this choropleth, diff the topic's distinct
DB `country` values against the geojson `name` list; add missing polygons (only if inside
the current bbox) and add any DB→polygon name aliases. Composite country strings
("India; Thailand", "Pakistan; United Arab Emirates") and "Unknown" are DELIBERATELY left
unmapped — they appear as their own literal rows in the GeoCard too, so leaving them off the
map keeps map==table consistent. Do NOT split composites for the map only.
