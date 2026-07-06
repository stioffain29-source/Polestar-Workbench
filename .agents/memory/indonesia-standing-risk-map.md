---
name: Indonesia country-report standing risk-area map
description: Why the Indonesia country map shows six fixed regions all rated High — it is an owner-authored standing overlay, not a data bug.
---

The Indonesia COUNTRY report map (`CountryReportMap.tsx`, gated on `isIndonesia`)
is a Polestar-assessed STANDING risk-area overlay: six fixed macro-regions
(Greater Jakarta & West Java; Central & East Java; Sumatra; Kalimantan / Borneo;
Sulawesi; Bali, Nusa Tenggara & Maluku), EVERY one rendered "High", each with an
on-map name-label pill plus a callout card and a "Map Read" box beneath.

**Why:** The owner authored this as a standing assessment (not fabrication). The
High rating is deliberate and does NOT come from the incident data.

**How to apply:**
- The standing High is applied at the RENDER layer only (keyed on the Indonesia
  flag). `aggregateZones` is UNCHANGED and still returns zero-count zones from an
  empty incident set — do NOT "fix" all-High Indonesia by re-scoring zones or
  touching `aggregateZones` (that would break the Jakarta/Papua zone contracts).
- Only Indonesia gets the standing overlay + Map Read box. Papua / West Papua
  stay data-driven (severity-coloured, unattributed honesty note); other
  countries stay per-coordinate dots. Keep those branches byte-identical.
- Screen == in-app PDF for free: the in-app Download PDF rasterises the
  `.print-report` DOM, so any render-body JSX (cards, Map Read) is captured. The
  headless jsPDF `exportCountryReportPdf` omits the Indonesia map and is not
  user-facing — leave it alone.
- Verify via `renderToStaticMarkup` tests (owner-gated app → no live
  screenshots): `countryMapLegendNoCounts.test.tsx` (Indonesia standing overlay +
  Papua generic-caption control) and `indonesiaRiskAreaMap.test.tsx`.
