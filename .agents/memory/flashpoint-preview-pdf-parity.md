---
name: Flashpoint preview/PDF parity
description: Wiring rules for FlashpointReportPreview.tsx vs exportFlashpointReportPdf.ts.
---

Rule: preview and PDF render from the same `buildFlashpointReportDataset()` output, in the same section order. When a new auto-prose field (e.g. `autoExecutiveSummary`) is added to the dataset for the PDF, the preview component must consume it via the same fallback chain — `(report.<field> ?? "").trim() || ds.<autoField>`.

**Why:** replit.md "User preferences" makes this a hard rule: preview and PDF must never disagree. A PDF-only auto-field that the preview does not consume produces silently divergent output that the user only catches on the printed PDF.

**How to apply:** When editing `exportFlashpointReportPdf.ts`, mirror the change in `FlashpointReportPreview.tsx` in the same turn. Do NOT add a Source Notes / Data Notes section — user has explicitly forbidden it; the `dataNote` field on the dataset stays computed for internal use only and is never rendered.
