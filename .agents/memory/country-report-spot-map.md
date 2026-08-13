---
name: Country report spot-style incident map
description: All country/city report maps now plot §23-gated incidents on the shared spot-report IncidentMap; zone/impact aggregation and the Jakarta corridor schematic are retired.
---

**Rule:** Every country/city report (Jakarta included) renders the spot-report `IncidentMap` fed by `buildCountryIncidentMapPoints(mapGatedIncidents)` — severity-coloured dots, exact-coordinate coalesce to WORST severity, no invented locations. `CountryReportMap` zone/impact logic and `JakartaCorridorMap` are unwired from reports (components remain for App demo/harness only), and the headless Jakarta renderer no longer draws the corridor map caption (parity).

**Why:** Owner ruling (Aug 2026): "the map logic on all the reports is flawed — it just needs to show incidents using the same theme as the spot reports." Supersedes the earlier zone/impact-tier map ruling (indonesia-standing-risk-map) for the RENDERED report map; §23 gating (credible precision + coords, engine mapPoints) still decides WHAT plots.

**How to apply:**
- Coordinates must survive the engine: `PngSourceIncident` and `PngReportItem` carry latitude/longitude and `toItem` copies them — stripping them makes `toMapPoints()` reject every event and the map silently renders EMPTY (the bug the first cut shipped).
- The engine ALSO geocodes credible place mentions from title/location text via its gazetteer, so a coordinate-less row naming a known town legitimately plots; a row with coords but no credible sub-national place does NOT.
- Integration coverage: `countryReportMapPoints.integration.test.ts` (end-to-end coord path), `countryIncidentMapPoints.test.ts` (builder).
