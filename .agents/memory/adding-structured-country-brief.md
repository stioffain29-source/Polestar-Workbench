---
name: Adding a structured operating-risk country brief
description: The full lockstep wiring checklist to add a new country to the Indonesia-style structured (province/region bucket) operating-risk brief, plus the map-view and region-as-province gotchas.
---

Adding a country to the structured operating-risk brief (the Indonesia/Jakarta/PNG family, NOT the generic country report) means editing every one of these in lockstep, or the country silently falls back to the generic brief / drops incidents:

1. `lib/ingest/src/<country>Extract.ts` — a gazetteer + `derive<C>Province`/`extract<C>Item`/`derive<C>Locality`/`derive<C>IncidentDate` cloned from `indonesiaExtract.ts` over the shared `structuredExtract.ts` helpers.
2. `lib/ingest/package.json` — a `./​<country>Extract` subpath export.
3. `artifacts/workbench/src/lib/pngReportDataset.ts` — a `*_REPORT_CONFIG: StructuredTheatreConfig` (buckets, empty/outlook/volatility copy, `deriveProvince`, `extractItem`, `proseVariant:"operating-risk"`) AND a `build<C>ReportDataset` wrapper that calls `buildStructuredReportDataset(args, CONFIG)`.
4. `artifacts/workbench/src/pages/CountryReport.tsx` — extend the `structuredTheatre` union, add a `tokens.includes(...)` branch, a switch case, and the builder import.
5. `artifacts/workbench/src/lib/exportCountryReportPdf.ts` — the SAME builder import + a branch in the `structuredBuilder` ternary (preview/PDF parity is structural; both key off `acceptedCountryTokens(country.name)`).
6. `artifacts/api-server/src/lib/migrations.ts` — add `{slug,name,region}` to `STRUCTURED_COUNTRY_REPORTS` (idempotent seed; baselines in `countryBaselineSeed.ts` attach by name match, so the report row must exist first).
7. `artifacts/workbench/src/components/CountryReportMap.tsx` — add a `COUNTRY_VIEW` center/zoom entry keyed on the lowercased country name.

**Why the config/extract split works with no ingest change:** `toItem` in pngReportDataset falls back to the client-side `config.extractItem` when server columns are null — the same path Indonesia/Jakarta already use. So a new structured country needs NO new feed and NO `RELEVANCE_RULE_VERSION` bump as long as the topics already tag `country=<C>`.

**Gotchas:**
- **Missing `COUNTRY_VIEW` entry → world-view map.** Without it the map only `fitBounds` over geocoded pins, so a window with zero geocodeable incidents renders a default/world view. Always add center/zoom.
- **No `RISK_MAP_ZONES` entry → dot map, not the Indonesia shaded macro-region map.** Curated shaded zones encode a STANDING risk-LEVEL judgement per zone; inventing them is fabrication. The reporting-driven dot map (PNG/West Papua style) is the no-fabrication-safe default — leave it unless the owner supplies/approves per-zone standing levels.
- **Bucket key must exactly string-match the `deriveProvince` output.** Any mismatch silently dumps the incident into the "Other" bucket. Philippines proves you can bucket at a coarser granularity than you derive: `derivePhilippinesProvince` returns the 17 admin regions and the 4 island-group buckets list those region names in `provinces` (region-as-province avoids naming independent cities → no fabrication). Verify by scanning every gazetteer value against the config bucket lists — zero orphans.
- Bespoke foreign-subject guards (e.g. Indonesia's Bahasa dominance guard) are theatre-specific; new countries fall through the generic `isForeignTheatreContext` only and need none.
