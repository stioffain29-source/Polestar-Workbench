---
name: Country/city brief assessed-theme lead
description: How every country/city brief leads with 2-3 assessed themes instead of one theme per display category
---

# Assessed-theme synthesis for country/city briefs

Every country/city brief now LEADS with two-to-three explicitly ASSESSED themes,
each carrying concentration + business exposure + trajectory-vs-baseline, instead
of one theme per display category.

## Where it lives
- `countryThemeSynthesis.ts` — the pure, deterministic, count-free, no-LLM
  synthesiser. Type-only import of `PngReportItem`; runtime imports are the
  equally-pure `countryIncidentThemes` / `countryTopValue` helpers.
  - `synthesiseAssessedThemes(windowItems, baselineItems, {hasBaseline, max=3})`
    → buckets via `themeForCategory` into the six fixed themes, scores each with
    `scoreClusterValue` (assessed VALUE, not count), sorts score→worstRank→count
    →fixed theme order, slices top 3.
  - Trajectory: no baseline→`nobasis`; theme absent in baseline→`new`; else
    severity move (then ±2 volume swing) → `rising`/`easing`/`steady`.
  - `buildAssessedThemeGroups` → `CountryIncidentThemeGroup[]` for
    `incidentThemesOverride`; `buildWhatMattersFromThemes`; `themeLedLead`.

## Wiring in pngReportDataset.ts
- `assessedThemes` computed from `windowItems` + `previousWindowItems`.
- `keyDevelopments` and `whatMattersBullets` derived from `assessedThemes`.
- `incidentThemesOverride` set from `buildAssessedThemeGroups(incidentDetailsItems…)`
  for EVERY non-Jakarta theatre (Jakarta keeps its own `jakartaBrief` themes).
  **This is the actually-RENDERED surface**: PngCountryReportBody line ~303 and
  exportCountryReportPdf line ~1276 render `incidentThemesOverride ?? buildCountryIncidentThemes(...)`,
  and the body only renders `g.paragraph`. `keyDevelopments`/`whatMattersBullets`
  are contract-tested but NOT rendered by the body/PDF.

## Reuse note
Several `countryIncidentThemes.ts` helpers were made `export` (THEME_WHAT/
SIGNIFICANCE/AFFECTED, joinList, topProvinces, topCategories, categoryNoun,
leadIncidentSentence, worstSeverityIndex, SEVERITY_ORDER) so the synthesiser
reuses them rather than duplicating.

## Drift
BLUF/Executive-Summary standard + operating-risk + Jakarta prose builders were
left as-is (not theme-led) — the "lead with assessed themes instead of one theme
per display category" target is the Incident Details section, which
`buildCountryIncidentThemes` used to build one-group-per-display-category.
No RELEVANCE_RULE_VERSION bump (prose-only change).
