---
name: Related Incidents shared selector + preview parity
description: Why the Related Incidents table row-selection must live in one shared module, and the parity gap that existed when only the PDF rendered it.
---

# Related Incidents table: one selector, two surfaces

The Related Incidents table is rendered by BOTH the on-screen preview and the
jsPDF builder. Row selection (title dedupe, weak-bucket + generic-cargo-title
filtering, recency sort, per-topic cap fuel<=6 else<=10) is the single source of
truth in `selectRelatedIncidents(window, topic)` in `src/lib/relatedIncidents.ts`.

**Why:** the selection logic used to live inline ONLY in the PDF builder, and the
preview rendered NO Related Incidents table at all — a silent preview/PDF parity
gap. The distrustful user treats any screen-vs-PDF disagreement as the report
lying. If you reintroduce per-surface selection the two WILL drift.

**How to apply:**
- Never re-inline the dedupe/weak/cap logic in either surface. Both call
  `selectRelatedIncidents`.
- The selector classifies via `classifyIncidentType` from `./incidentClassifier`
  (NOT `cargoAnalysis` — different classifier), which requires a `topic` field on
  the input. `RelatedIncidentInput` therefore carries `topic`; both caller row
  types (`TopicFastFactsIncident`, `TopicReportIncident`) already provide it.
- Cargo rows show an italic "Source: <src>" line under the title on BOTH surfaces.
  In the PDF this extra line height (`SOURCE_LINE_H`) MUST be added in BOTH
  `measureTable` AND the per-row render height, or the keep-together pagination
  orphans the table or its disclaimer.

## Footer page numbering counts the cover

`drawFooters` in `pdfChrome.ts` renders `Page {p} of {pageCount}` — the cover IS
page 1, so body pages read "Page 2 of N". An earlier version subtracted the cover
(`p-1 of pageCount-1`), which read oddly ("Page 1 of 4" on the first body page).
