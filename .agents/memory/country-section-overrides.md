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

## Top 3 Developments curation (Aug 2026)
- `top3PinnedIds` / `top3ExcludedIds` / `severityOverrides` on CountryReportSectionOverrides. Pins lead the section in pin order; a section exclude drops the auto pick from Top 3 ONLY (falls back to Incident Details, unlike report-wide excludedIncidentIds).
- `severityOverrides` sets an EXACT tier either direction (owner-requested, supersedes the demote-only rule for analyst-explicit acts) and wins over severityDemotions.
- Curation applies in buildStructuredReportDataset at BOTH the initial topThree selection AND after the engine replacement path; the final topThree is then RECONCILED against the bucket/strand/incidentDetails arrays (removal-only prune) so nothing renders twice.
- Renderers (body + headless) render the WHOLE dataset topThree (no slice(0,3)) — the dataset caps autos at max(3, pinned count); >3 only with explicit pins.
- Headless exportCountryReportPdf loads section_overrides and applies applyIncidentCurations + top3Curation for audit fidelity.
- **Trap:** the preview builder args live in the pngDataset useMemo in CountryReport.tsx — wiring the headless path but not that memo makes the UI dead while PDFs curate (caught by review once).
