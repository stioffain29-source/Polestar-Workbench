---
name: Headless topic-report font audit (private app)
description: How the topic PDF font audit runs headlessly now that /api is owner-gated
---

# Headless topic-report font audit

The PDF font-audit exporter (`exportReportPdfHeadless.ts`) cannot reach `/api`
anymore — the workbench is owner-only (`requireOwner`, 401, no dev bypass). The
country branch already read straight from Postgres; the topic branches
(shipping/fuel/cargo_watch/flashpoint) now do too, via a loader that MIRRORS the
API handlers (relevance gate + corroboration attach + maritime movement).

**Why:** owner gate means no headless HTTP auth; reading Postgres directly is the
same pattern the country branch uses.

**How to apply:**
- The loader must reproduce the API RESPONSE SHAPE, not just the rows: apply the
  default relevance gate (drop `relevance_status='irrelevant'`, NULL fails open),
  attach `corroborations`, and JSON-roundtrip so Date columns become ISO strings
  exactly as `res.json()` would. Otherwise the exporters see a different shape
  than the on-screen report and the audit stops being faithful.
- Chart embedding requires a DOM. `embedReactChartInPdf` builds React HTML via
  `document.createElement` BEFORE the `document===undefined` guard inside
  `embedChartMarkupInPdf`, so the guard was dead for the React entry point and
  fuel/cargo crashed headlessly with "document is not defined". Charts rasterise
  to a PNG (no embedded text), so a headless run can safely skip them — the guard
  belongs at the TOP of `embedReactChartInPdf` too. Skipping charts does NOT
  weaken the font audit (it only inspects `pdf.text` Tf operators).
