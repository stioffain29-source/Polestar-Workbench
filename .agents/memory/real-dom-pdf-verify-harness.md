---
name: Real-DOM PDF verify harness
description: How to headlessly verify report PDFs whose sections rasterise React via html2canvas (embedReactChartInPdf), and the jsPDF save-capture gotcha.
---

Some report-PDF sections rasterise a live React component via `html2canvas`
(`embedReactChartInPdf` / `ln` in `embedReportChartInPdf.ts`) — e.g. the Energy
Watch "Market Prices" card grid (`MarketPricesReportGrid`). These CANNOT be
verified by the tsx headless exporter (`exportReportPdfHeadless.ts`): the embed
NO-OPs when `typeof document === "undefined"`, so the cards silently vanish.

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
