---
name: CountryReportMap tile-layer lifecycle
description: Theatre-conditional Leaflet basemap must be resynced on countryName change, not just branched at construction.
---

# CountryReportMap theatre-conditional basemap

`CountryReportMap` creates its Leaflet map + tile layer ONCE, inside
`if (!mapRef.current)`. Any per-theatre tile style (e.g. Jakarta's label-free
`light_nolabels` faded basemap vs the standard labelled `light_all` at full
opacity) is chosen from `isJakarta`/`countryName`.

**Rule:** when you add or change a theatre-conditional basemap style, you MUST
resync the existing tile layer (`tileLayerRef.setUrl(...)` + `.setOpacity(...)`,
guarded by a `basemapStyleRef` so it only fires on actual change) on the
`countryName`-driven effect re-run. Do NOT only branch at construction.

**Why:** the same component instance can be reused while `countryName` changes
without a remount. If the style is baked in at first construction only, a map
first mounted as Jakarta keeps the faded label-free tiles when it later shows
Indonesia/PNG/West Papua (and vice-versa) — silently regressing other theatres
or making Jakarta look like a plain web-map screenshot.

**How to apply:** the effect deps already include `countryName`, so it re-runs
on theatre change; the create-block sets `tileLayerRef`/`basemapStyleRef`, and an
`else if (style changed)` branch calls `setUrl`/`setOpacity`. Reset both refs in
the unmount cleanup. Caught in review; SSR render tests don't run the effect and
the zones test is pure-fn, so neither would have caught it.
