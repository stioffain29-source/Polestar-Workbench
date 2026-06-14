---
name: Card Builder chart embed
description: Why in-card dashboard charts must be card-native HTML bars, and where the builders/render/scope live.
---

# Embedding a dashboard graph into the Infographic Card

The Infographic Card Builder exports the MasterCard to a 1080×1350 PNG via
html2canvas. **html2canvas mangles recharts (SVG) output**, so an in-card chart
can NOT reuse the dashboard's recharts components.

**Rule:** in-card charts are rebuilt as card-native HTML/div horizontal bars —
no SVG, canvas, shadow, gradient, or blur — so they survive the raster export.
This is the same constraint as the IncidentMap card (HTML overlay dots, not SVG
markers). Any new in-card visual must rasterise from static DOM.

**How to apply / where it lives:**
- Data shape: `CardContent.chart` (`CardChart{title?,note?,bars?[]}`,
  `CardChartBar{label,value,valueLabel?,rating?}`) in the OpenAPI spec → codegen.
  `mapMode === "chart"` selects the chart branch (alongside `image`/`map`).
- Render: MasterCard Band-5 chart branch. Bar fill colour = `cardRatingColor`
  when a bar carries a five-tier `rating`, else Electric Blue; track = Polar.
  `chartMax = Math.max(1, …)` guards divide-by-zero; empty bars → placeholder.
- Builders: one pure-function module turns live dashboard data into `CardChart`
  (topic severity/country/trend, cargo loss-by-month + by-country, strike
  country/weapon/target). A source catalog + dispatcher drive the picker UI.
  Count charts cap at top 6.

**Scope honesty caveat:** the card builders read the FULL datasets
(`useListStrikes()` = all theatres/all-time, `useListIncidents()` = all-time),
but the dashboards default to scoped windows (e.g. Strikes = one theatre, 60d).
So a card chart is NOT a 1:1 snapshot of the dashboard's default view. Strike
chart notes say "All theatres · …" to make this explicit; keep that qualifier
if you add theatre/range scoping later, or analysts will read it as the
dashboard's filtered view.

**Shared extraction:** strike label helpers (strikeText/deriveTarget/
deriveWeapon/groupCount) were lifted out of `Strikes.tsx` into a shared module
so the card builders and the dashboard derive identical labels — add new strike
target/weapon vocab there once, not in two places.
