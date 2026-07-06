---
name: Country-report Operational Map (reporting-driven, all countries)
description: Country maps map a location ONLY where the current window reported a specific event; posture from frequency+business impact. Reverses the old Indonesia "standing High overlay".
---

Country-report maps (`CountryReportMap.tsx`, BOTH the configured-zone mode and
the per-coordinate dot mode) are REPORTING-DRIVEN. A location is plotted/carded
ONLY where the current reporting window carries a specific operationally relevant
event there. Heading is "Operational Map" / subtitle "Reported operational pinch
points for this period"; the "Map Read" note ends "...combined with reporting
frequency, not standing background risk." Every card reads Location / Reported
issue this period / Business relevance / Posture.

**Why:** The owner REVERSED the earlier decision (this file used to document a
Polestar "standing High" six-region overlay for Indonesia). No standing risk
picture, no fixed always-High regions — an empty window shows an empty-state note,
not painted geography. Do NOT re-introduce a standing overlay for any country.

**How to apply:**
- Posture (`lib/operationalPinchPoints.ts`, pure + unit-tested) = frequency +
  business impact: `count>=2` OR one high/extreme → **Primary**; one moderate →
  **Secondary**; single low/insignificant → **Watch**. `POSTURE_COLOR`
  Primary `#0B0B3D` / Secondary `#4655FF` / Watch `#6B7280` — never reuse the
  reserved severity hues (petrol `#1B6B7A`=Insignificant, red `#A33232`=Extreme),
  so a posture chip can't be mistaken for a severity chip. The map now carries NO
  severity chips at all.
- `businessRelevance()` reads the reported event's own words (headline first,
  topic fallback) into operational terms (movement/site-access/security/logistics/
  utilities/regulatory/continuity). It interprets the reported item, never
  fabricates standing risk.
- INDONESIA_ZONES lost its `alwaysShow`/`description` — it is now an ordinary
  gazetteer, so `aggregateZones([], INDONESIA_ZONES)` returns `[]`. JAKARTA_ZONES
  KEEPS `alwaysShow` (its six business areas stay fixed 1–6) — that contract and
  the Papua zone contract are untouched.
- Shared render helpers (`OperationalMapHeader`, `PostureLegend`, `PinchCard(Grid)`,
  `MapReadNote`) live in the render BODY and feed BOTH modes, so screen == in-app
  PDF (DOM-rasterise) and the two modes never drift. No `RELEVANCE_RULE_VERSION`
  bump (display-only).
- On-map MARKERS are TRANSLUCENT (owner rejected the solid dark-blue discs):
  fill `withAlpha(POSTURE_COLOR, 0.35)`, solid same-hue 2px ring, solid same-hue
  numeral. The legend dots / card left-borders / posture chips stay SOLID
  `POSTURE_COLOR` (crisp key + labels). Numerals centre on screen via symmetric
  flex + `line-height:1` (NO on-screen bottom pad — that made them read high);
  the html2canvas export re-adds the 2px bottom pad ONLY in the clone, keyed off
  `data-map-numeral` in `exportPdf.applySeverityBadgeExportLayout`, so screen==PDF.
- Verify via `renderToStaticMarkup` tests (owner-gated app → no live screenshots):
  `operationalPinchPoints.test.ts`, `indonesiaRiskAreaMap.test.tsx`,
  `countryMapLegendNoCounts.test.tsx`; `jakartaMapZones.test.ts` pins the
  unchanged Jakarta alwaysShow contract.
