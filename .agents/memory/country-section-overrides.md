---
name: Country/city report section overrides + incident curation
description: How analysts hide canonical sections and curate incidents in country/city briefs without touching data
---

Analysts can tailor a country/city brief without editing source data.

- Storage: nullable jsonb `country_reports.section_overrides` (Drizzle schema +
  idempotent boot ALTER in api-server migrations + OpenAPI
  CountryReportSectionOverrides + codegen). PATCH writes it through the existing
  generic `updates` path (no route change) — still requireAdminToken.
- Section keys: 8 STABLE canonical keys in `lib/countrySectionOverrides.ts`,
  deliberately decoupled from section TITLES (titles change, keys must not).
  `PngCountryReportBody` takes a `hiddenSections` prop and gates each `<Section>`
  with `show(key)`. Titles are kept literally in source so the Jakarta
  section-parity audit + pdf-fonts font audit still parse them.
- Curation: `applyIncidentCurations` removes excluded ids and applies
  demote-only severity. The editor's curation POOL is the UNCURATED relevance
  pool (consolidateCountryStories over active.incidents) so exclusions are
  reversible. The demote dropdown only offers tiers BELOW the stored severity.

**Why:** STRICT no-fabrication — curation may only remove or demote from the
relevance-passing pool; never add rows, never up-rate. Same rule as the PNG
severity-demote hedge.

**How to apply:** feed the CURATED incident set into every derived surface
(dedupe, pngDataset windowIncidents, generic prose) so Fast Facts/map/charts/
prose agree. Preview==PDF is free because both render PngCountryReportBody.
Owner-gated UI can't be e2e'd (Replit Auth vs Clerk harness) — verify via
renderToStaticMarkup + route round-trip + headless font audit.
