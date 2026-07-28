---
name: Headless exporter must thread report prose columns
description: New/renamed report prose columns silently fall back to auto-prose in headless PDF exports; verification dump scripts with reduced row shapes under-count vs the real dataset.
---

**Rule:** Any report prose column consumed by a preview `pickRead`/`pickProse` must also be threaded through the headless exporter's hand-built `data` object (`exportReportPdfHeadless.ts`), or the headless PDF silently renders auto-prose while the preview shows the saved override — a parity gap invisible to typecheck.

**Why:** Task-445 flashpoint fix: exec/whatMatters/implications/polestar applied but activism/civilUnrest/forecast/regional reads rendered auto in the PDF because the exporter's `AnyReport` mapping omitted them.

**How to apply:** When adding or wiring a report prose field, grep `exportReportPdfHeadless.ts` for the field name and add it to both the interface and the `data` object. Also: ad-hoc dump scripts that map incidents to a reduced shape (dropping `summary` etc.) make relevance/dedup passes drop MORE rows than the real preview/PDF path — trust the exporter's counts, not the dump's, when they diverge. And the boot relevance backfill runs asynchronously after api-server restart: re-export/verify only after polling persisted `relevance_status`.
