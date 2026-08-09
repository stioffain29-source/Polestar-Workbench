---
name: Jakarta §33 locality gate backstop
description: Why the no_out_of_scope_locality_event gate can false-fail on canonical titles and how the raw-source fallback + shared gate rerun path fix it
---

The §33 `no_out_of_scope_locality_event` backstop re-runs `isJakartaScoped` over the CANONICAL event (merged/translated eventTitle, eventSummary, city). A merged or translated title can lose its Jakarta token even though the underlying source row passed the predicate on raw title/summary/location at selection time — every row fed to the jakarta engine already did.

**Rule:** the gate's `localityScope.isInScope` checks canonical fields first, then falls back to the source row's raw fields (`windowItems` lookup by eventId, in pngReportDataset). No source found → false (fail-closed preserved: the fallback can only re-admit rows that already passed selection).

**Trap:** the gate is BUILT in the dataset builder but RE-RUN in CountryReport.tsx when analyst prose overlays a section. The rerun must reuse the localityScope riding in on `pngDataset.gateReport` — re-defining a canonical-fields-only predicate there reinstates the false fail exactly when an analyst edits.

**Why it looks flaky:** whether the failure fires depends on same-day clustering/representative choice, so a gate failure can appear and vanish between ingest runs on the same row.

Also: §30 banned phrases apply to RENDERED headings and card templates, not just prose — "Operating Picture This Week" (heading) and "at exposed sites" (structuredExtract impact template) both tripped the sweep. Heading renames are 4-surface lockstep: PngCountryReportBody + exportCountryReportPdf + auditJakartaPdf canonical list + jakartaReportRender test.
