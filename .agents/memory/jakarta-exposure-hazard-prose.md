---
name: Jakarta exposure-map hazard prose (two surfaces)
description: The Jakarta operational exposure map names hazards only when reported this period; covers BOTH the React sidebar and the easily-missed headless PDF column.
---

The Jakarta "Operational Exposure Map" describes six fixed functional areas/corridors. Each area's description must name a hazard (flooding, protest, crime, fire, traffic, policing) ONLY when an incident attributed to that area actually reported it this period. Standing hazard templates are forbidden (no-fabrication): "if Jakarta isn't flooding, flooding isn't mentioned."

**Why:** the area objects carry static descriptor strings (e.g. `exposure: "Rain, flooding and congestion exposure"`). Rendering those verbatim asserts hazards regardless of live reporting — the exact thing the owner was angry about.

**How to apply:**
- Hazard text is derived live in `jakartaCorridors.ts`: `hazardForIncident` (priority-ordered text classifier over masthead-stripped displayTitle/title+location) → per-area `hazards[]` → `buildAreaProse` builds `relevance`/`action` (count==0 → neutral standing line naming NO hazard; count>0 no recognised hazard → "Security-relevant activity…"; else names only reported hazards).
- TWO surfaces must both consume the live text, and the PDF one is the trap: the React sidebar in `JakartaCorridorMap.tsx` AND the headless `drawJakartaExposureTable` in `exportCountryReportPdf.ts`. The PDF table has a "MAIN EXPOSURE" column that previously rendered the STATIC `area.exposure` — drive it from `hazardSummaryLabel(status)` instead (Standing profile / Security-relevant activity / Title-Case join of reported hazards).
- The `flooding` bucket is disjunctive: label is "Flooding / heavy rain" and the lead is "flooding or heavy rain" so a rain-only period stays honest. `landslide` is deliberately NOT in the flooding regex — a landslide-only item falls through to "Security-relevant activity" rather than fabricating "flooding".
