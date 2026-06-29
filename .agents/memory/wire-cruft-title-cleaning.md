---
name: Wire/video cruft title cleaning chokepoints
description: Where social/video cruft ("Watch:" prefix, trailing "(VIDEO)"/"[WATCH]"/"| VIDEO"/"VIDEO BY <credit>") is stripped from incident titles across every report topic, and how to keep preview==PDF when adding a topic.
---

One shared cleaner `stripWireCruft` lives in `artifacts/workbench/src/lib/incidentTitle.ts` (the single exported copy; flashpoint's `cleanDisplayTitle` composes `stripWireCruft(stripMasthead(...))`). It is display/dedup-only — NEVER a relevance change, so it does NOT bump `RELEVANCE_RULE_VERSION`.

**Rule:** apply the cleaner at each topic's ONE shared dataset chokepoint that feeds BOTH the on-screen preview AND the PDF, and apply it BEFORE that topic's dedup so cruft-only duplicate rows collapse (the flashpoint lesson). Cleaning at the render site instead would break the preview==PDF HARD rule.

**Why:** every report topic must satisfy preview==PDF. Each topic has a different shared chokepoint; cleaning anywhere downstream of the split (e.g. only in a jsPDF exporter) silently diverges the headless/legacy PDF from the screen + in-app DOM-rasterised PDF.

**How to apply — current chokepoints (a new topic MUST route through its analogue):**
- cargo / fuel / conflict Related Incidents: `relatedIncidents.ts` `selectRelatedIncidents` cleans `title` (and `displayTitle` when a string) on input rows before titleKey/dedup. Dedup keys on cleaned `title` ONLY — cargo/fuel render `r.title`, conflict renders `displayTitle ?? title`; cruft originates in the source `title` (already cleaned), so dedup-on-title is correct. Do NOT switch the dedup key to displayTitle (creates a cargo/fuel render/dedup field mismatch).
- shipping: `shippingReportDataset.ts` maps `windowed`/`windowed30` through `stripIncidentWireCruft` before `enrich()`/dedupe → cards + related table.
- structured country briefs (PNG / West Papua / Indonesia / Jakarta): `pngReportDataset.ts` `toItem` strips before `dedupeByTitle`.
- GENERIC country report (every non-structured country): `countryFastFacts.ts` `computeCountryFastFacts` cleans `windowIncidents` (title + displayTitle) at construction. This single source feeds the `CountryReport.tsx` preview AND the headless `exportCountryReportPdf` (`facts.windowIncidents` → `drawIncidentTable` `sanitize(i.title)`). The generic country path is the easy miss — `toItem` does NOT cover it.
- Spot reports are intentionally OUT of scope.

Tests: `__tests__/workbench/incidentTitleClean.test.ts`.
