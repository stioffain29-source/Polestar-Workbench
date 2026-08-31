---
name: Workbench basemap provider
description: Why Workbench maps use the OSM.de raster tile endpoint instead of CARTO or the main OSM tile service.
---

Use one keyless, verified raster-tile provider consistently across every Workbench map and its printed attribution. CARTO's anonymous Positron endpoint now returns tiles watermarked “API KEY REQUIRED”; the main OpenStreetMap tile endpoint rejects Replit's shared server egress even though it may respond with HTTP 200 and an image content type. The OSM.de raster endpoint returned genuine PNG tiles from this environment.

**Why:** A nominally successful tile response can still contain a provider error tile, producing repeated watermark text or a blank/blocked basemap while Leaflet and incident markers continue to work.

**How to apply:** When adding or changing a map, reuse the currently verified Workbench tile URL and matching OpenStreetMap attribution. Test the response body as a real, non-trivial image rather than trusting only the HTTP status.