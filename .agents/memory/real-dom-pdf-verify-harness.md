---
name: Real-DOM PDF verify harness
description: How to headlessly verify report PDFs whose sections rasterise React via html2canvas (embedReactChartInPdf), and the jsPDF save-capture gotcha.
---

Some report-PDF sections rasterise a live React component via `html2canvas`
(`embedReactChartInPdf` / `ln` in `embedReportChartInPdf.ts`) — e.g. the Energy
Watch "Market Prices" card grid (`MarketPricesReportGrid`). These CANNOT be
verified by the tsx headless exporter (`exportReportPdfHeadless.ts`): the embed
skips itself without a real DOM, so the cards silently vanish.

**A `typeof document === "undefined"` guard is NOT enough.** The tsx headless
exporter installs a minimal `document`/`window` stub so shared browser modules
can be imported at all, and its `createElement` returns a plain object with no
`nodeType`. Every such guard therefore reads as "browser present" and the code
proceeds until React or html2canvas rejects the container ("Target container is
not a DOM element"), failing the whole export instead of falling back. Probe the
created element (`hasRealDom()` in `pdfChrome.ts`), and route any new
DOM-touching export path through it.

**Fuel's export bypasses `pdf.save()` entirely.** Its in-app download builds a
Blob and clicks an anchor, so a harness that patches `save()` captures nothing
and no file is written — the topic font audit failed on exactly this, after the
chart guard was fixed. Any such browser-only delivery path needs the same
real-DOM gate with a `save()` fallback behind it.

**To verify:** run in a real browser DOM. `scripts/verifyEnergyMarketPricesPdf.ts`
(+ `.browser.tsx`) does this: fetch data from Postgres directly (owner-gated /api
can't be hit headlessly), esbuild-bundle the browser entry (alias @/@assets,
dataurl image loaders, a `?url` plugin for the Roboto TTFs), run it under
Playwright with the Nix Chromium at `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`,
capture the PDF bytes, write to `screenshots/`.

**jsPDF save gotcha (cost 2h):** jsPDF copies its API methods onto EACH instance
at construction, so `jsPDF.prototype.save = ...` NEVER fires — the export runs,
calls the instance's OWN save (real download), resolves with no error and your
capture stays empty. Fix: patch `jsPDF.API.save` (the template new instances are
built from) BEFORE the export constructs its pdf. Symptom of the wrong patch:
`saveCalls=0`, no error, "export produced no PDF bytes".

**Verify acceptance:** heading (drawSectionHeading) stays selectable Roboto text
in `pdftotext`; card text (commodity names, "As of…") is ABSENT from the text
layer because the grid is an image; render the page with `pdftoppm` to eyeball
four cards + mini SVG trajectory + provenance, no clipping.

**Static-map constraint:** Running the exporter in Chromium still does not mount effects in a component passed through `renderToStaticMarkup`. Interactive Leaflet maps therefore remain blank in that path even in a real browser.

**Why:** the rasterisation host receives static HTML, not a mounted React tree; a successful six-page export can contain a chart-failure message instead of its map.

**How to apply:** use a shared static SVG/GeoJSON projection for report maps consumed by that host, or explicitly mount and await the interactive map. Inspect the rendered chart, not only the page count and headings. Keep layout-only fixes separate from narrative generation.
