---
name: Country-report Operational Map (reporting-driven, all countries)
description: Country maps plot a location ONLY where the current window reported a specific event; impact level = frequency-first (a single report is NEVER "Direct impact"). Reverses the old Indonesia "standing High overlay".
---

Country-report maps (`CountryReportMap.tsx`, BOTH the configured-zone mode and
the per-coordinate dot mode) are REPORTING-DRIVEN. A location is plotted/carded
ONLY where the current reporting window carries a specific operationally relevant
event there. Heading "Operational Map"; the "Map Read" note ends "...based on
likely business impact and reporting frequency, not standing background risk."
Every card reads Location / What happened this period / Business relevance /
**Impact level**.

**Why:** The owner REVERSED the earlier decision (this file used to document a
"standing High" six-region overlay for Indonesia). No standing risk picture, no
fixed always-High regions — an empty window shows an empty-state note, not
painted geography. Do NOT re-introduce a standing overlay for any country.

**Impact-level rule (`lib/operationalPinchPoints.ts`, pure + unit-tested) —
frequency FIRST, then business impact.** `impactLevelFor(count, worstSeverity)`:
- `count >= 2` → **Direct impact** — a corroborated hotspot (the area was
  reported more than once this period).
- else worst severity moderate-or-worse (`rank >= 3`) → **Possible impact** —
  one credible but INDIRECT report.
- else → **Monitor only** — a single low/insignificant report.

**A SINGLE report is NEVER Direct impact, however violent.** The owner
explicitly rejected the old "one high/extreme → Direct" escalation: a lone crime
is an indirect signal for operations until it repeats. Do NOT re-add a
single-severity escalation to Direct. (`count >= 2` all-low still reads Direct —
frequency is the Direct trigger; upstream news dedupe stops one syndicated event
counting twice.)

`IMPACT_COLOR`: Direct `#0B0B3D` / Possible `#4655FF` / Monitor `#6B7280` — never
reuse the reserved severity hues (petrol `#1B6B7A`=Insignificant, red
`#A33232`=Extreme) so an impact chip can't be mistaken for a severity chip. The
map carries NO severity chips at all.

**How to apply:**
- `businessRelevance()` reads the reported event's OWN words (headline first,
  topic fallback) into operational terms (movement/site-access/security/logistics/
  utilities/regulatory/continuity) — it interprets the reported item, never
  fabricates standing risk.
- INDONESIA_ZONES is an ordinary gazetteer (no `alwaysShow`), so
  `aggregateZones([], INDONESIA_ZONES)` returns `[]`. JAKARTA_ZONES KEEPS
  `alwaysShow` (its six business areas stay fixed 1–6); the Papua zone contract is
  untouched.
- On-map markers are TRANSLUCENT (owner rejected solid dark-blue discs); the
  legend dots, card left-borders and impact chips stay SOLID `IMPACT_COLOR`.
- Shared render helpers (header, legend, pinch cards, Map Read note) live in the
  render BODY and feed BOTH modes, so screen == in-app PDF (DOM-rasterise) and the
  two modes never drift. Display-only → NO `RELEVANCE_RULE_VERSION` bump.
- Verify via `renderToStaticMarkup` tests (owner-gated app → no live screenshots):
  `operationalPinchPoints.test.ts`, `indonesiaRiskAreaMap.test.tsx`,
  `countryMapLegendNoCounts.test.tsx`.
- SEPARATE feature, out of scope: the Jakarta corridor "Operating Posture" table
  (`jakartaOperatingPosture.ts` / `JakartaCorridorMap.tsx`) still uses "posture"
  wording — that is a DIFFERENT seven-zone model, not this Operational Map.
