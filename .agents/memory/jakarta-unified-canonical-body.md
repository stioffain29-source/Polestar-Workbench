---
name: Jakarta unified into canonical report body
description: Jakarta city report now shares the 8-section PngCountryReportBody + renderStructuredBrief; tactical tables fold in as strand labels, not their own sections.
---

Jakarta no longer has a bespoke multi-section renderer. It renders through the
SAME unified path as PNG/West Papua/Indonesia/Thailand/Philippines:
- Screen/DOM-PDF: `PngCountryReportBody.tsx` (8 canonical `<Section>`s).
- Headless jsPDF audit: `renderStructuredBrief()` in `exportCountryReportPdf.ts`.

**Rule:** the ONLY per-theatre variation is the map slot. Jakarta's tactical
evidence tables are FOLDED INSIDE canonical sections as strand labels
(`<StrandLabel>`), never as top-level sections:
- Crime Trends + Priority Areas → **Incident Details**
- Staff Movement / Airport / Port (+ Port Actions) / Venue → **Operational Impact**
- Route and Timing Guidance → **Recommended Actions**
- Escalation Indicators → **Outlook: Next Seven Days**

The fold only fires when `dataset.jakartaTacticalBrief` is present; other theatres
pass it undefined so the shared body/PDF behave exactly as before (no font/severity
/relevance change). Escalation is left UNSLICED when the tactical brief is present.

**Why:** two divergent bodies drifted; converging removes the parity risk and the
dedicated `JakartaReportBody.tsx` (deleted) + `renderJakartaBrief` (deleted).

**How to apply / guardrails:**
- Section-order parity + font gate: `artifacts/workbench/scripts/auditJakartaPdf.ts`
  now parses `PngCountryReportBody.tsx` (`<Section title>`) and
  `renderStructuredBrief` (`drawSection*`) against the canonical 8. Strand labels
  are NOT sections, so they don't appear in the parity list — assert them by
  slicing between adjacent section headings instead (see the render test).
- Render test: `__tests__/workbench/jakartaReportRender.test.tsx` renders
  `PngCountryReportBody` with a Jakarta dataset and checks the folds by section
  slice. The map is injected by the PAGE (`CountryReport.tsx` mapNode), not the
  body, so don't assert the map inside the body render.
- Adding/reordering a fold = update body TSX + `renderStructuredBrief` in lockstep
  or the audit fails.
