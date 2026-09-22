---
name: Workbench basemap provider
description: Why Workbench maps use keyed CARTO Positron and must not silently fall back to another provider.
---

Use keyed CARTO Positron consistently across every Workbench map and its printed attribution. Direct CARTO basemap access now requires a domain-scoped basemap key; anonymous requests return valid-looking PNG error tiles watermarked “API KEY REQUIRED.” The owner explicitly chose keyed CARTO over the temporary generic OSM.de fallback.

**Why:** Polestar's report cartography depends on the low-noise Positron visual treatment. The OSM.de switch was only an emergency response to CARTO's new key enforcement and changed the intended appearance.

**How to apply:** Reuse the shared keyed Positron configuration and matching OSM+CARTO attribution. Do not change map layout, markers, risk colours, report logic, or framing when touching the provider. Verify the response is a genuine map tile, not merely HTTP 200.

Verify the exported map image itself, not just the preview or a successful tile-load count.

**Why:** A real-browser regional PDF capture lost every basemap tile even though all CARTO tile images had loaded and the preview was correct. Transformed offscreen Leaflet panes do not reliably survive html2canvas.

**How to apply:** Keep the decoded tile imagery and marker positions together in a static image for PDF capture; inspect the resulting PDF to confirm the basemap and numbered markers both remain visible.