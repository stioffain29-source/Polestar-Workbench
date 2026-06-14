---
name: Card visual panel Leaflet map
description: Rendering a real map in the social-card visual panel and capturing it in the PNG export
---

# Card visual panel map mode

The Card Builder visual panel (`MasterCard.tsx` Region 3) supports `mapMode: "map"` rendering a real Leaflet map (`CardMap.tsx`) instead of an uploaded image. CardContent gained `mapMode`/`mapLat`/`mapLng`/`mapZoom`.

**Why it works in the PNG export:** `exportCardToPng` (`lib/exportCardPng.ts`) CLONES the card DOM and rasterises the clone with html2canvas. So the map must rasterise from a static DOM copy:
- Tiles are CartoDB Positron `<img>` (crossOrigin) — rasterise fine.
- The marker is a plain HTML overlay `<div>` dot positioned via `latLngToContainerPoint`, NOT a Leaflet SVG/canvas marker (those panes do NOT rasterise) — same pattern as `IncidentMap.tsx`/`CountryReportMap.tsx`.
- `waitForFontsAndImages` in the export waits for the cloned tile imgs to decode before capture.

**How to apply:** any new interactive widget added to the card must render as plain HTML/img (no canvas/SVG) and not rely on post-clone JS, or it vanishes from the exported PNG.
