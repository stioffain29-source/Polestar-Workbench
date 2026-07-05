---
name: Cargo report country/attribution consistency
description: Why cargo report surfaces disagreed on country attribution, and the single-source rule that keeps Fast Facts, prose and Reads aligned.
---

# Cargo Watch country attribution must agree across surfaces

A Cargo Watch report has several surfaces that each name countries:
Fast Facts "Most Affected Country" card, the Executive Summary / Situation /
What Happened / What Matters / Polestar View prose, and the two auto Reads
(Cargo Security Read = route-side subset, Logistics Hub Read = hub-side subset).
They drove a "report contradicts itself" complaint.

## Two distinct contradiction classes (both fixed)

1. **"Unknown" counted as a country on some surfaces but not others.**
   "Unknown" can be the single largest BUCKET while still being a MINORITY of
   records (e.g. 17 Unknown vs 56 identified across many countries). A surface
   that counts the raw max shows "Country not identified"; one that excludes
   Unknown names the real lead. They then disagree.

2. **Compound country strings ("Indonesia; West Papua") treated as one literal
   country.** One surface splits them, another shows the compound verbatim as
   if it were its own country — same contradiction class, just shifted.

## The rule

- Country tokenisation lives in ONE place: `splitAttributedCountries()` (and
  `isUnattributedCountry()`) in `@workspace/relevance` (`topicRelevance.ts`).
  Every surface that counts countries (Fast Facts card, cargo prose builders,
  and the draft seed's own `expandCountries`) MUST normalise the same way:
  split on `; , /`, drop Unknown/empty/N-A/Other/unattributed. If you add a new
  country-counting surface, route it through the shared splitter or it WILL
  drift.

- **`cargoCountriesFor(i)` (in `cargoAnalysis.ts`) is the ONE per-row
  multi-country resolver for the COUNT surfaces (map + table + prose counts).**
  It wraps `splitAttributedCountries` → `normalizeCountry` (folds city/province
  aliases: Dubai→UAE, Hong Kong→China, West Papua & the other Indonesian New
  Guinea provinces→Indonesia), dedupes within the row, and text-recovers a
  country when the row is unattributed (`recoverCargoCountryFromText`, mirroring
  `cargoCountry`). The Cargo Theft Map (`buildCargoCountryIntensity`) and the
  Country Risk Breakdown table (`groupByCountry`/`topCountries`/`countryPicture`)
  BOTH iterate it, so shade and count can't disagree. `cargoCountry` (singular,
  first-country only) is still used by the monitor/other non-count surfaces.
  **Why:** the map used to take only the FIRST country + full alias norm while
  the table split the compound but skipped alias norm & recovery → same window,
  different per-country numbers. **How to apply:** any NEW cargo count surface
  goes through `cargoCountriesFor`, never a bespoke split.

- **Map/table relationship is SUBSET, not equality.** The table narrows to
  RECURRING geographies (>=2 records, when there are >=2 such) and caps at
  `maxRows`, so its country set is a subset of the map's; the invariant is that
  every SHARED country carries an IDENTICAL count. Test:
  `__tests__/workbench/cargoMapTableConsistency.test.ts`.

- **Subset Reads must name their scope, not contradict the headline.** The
  Cargo Security Read counts only route-side records and the Logistics Hub Read
  only hub-side records, so their leader legitimately differs from the
  overall-window lead. The fix is to SAY so ("among these route-side records")
  rather than hide it — a scoped phrase explains the gap; a bare "in the window"
  reads as a flat contradiction of the Fast Facts/Exec lead.

- **Don't assert a firm lead when attribution is weak.** `countryPicture` gates
  on a "strong" flag (identified rows must be a real majority); otherwise the
  prose states the attribution gap instead of naming a single lead. `identified`
  is ROW-level, `top` is TOKEN-level — intentional and commented.

**Why:** distrustful user; any cross-surface disagreement reads as the report
lying. The relevance-filtered window (not raw SQL) is what renders — raw SQL
over-counts noise the `isTopicRelevant` filter drops, and the cargo issue date
is clamped DOWN to the latest relevance-filtered record, so the window can be
narrower than a naive 30-day SQL query suggests.

**How to apply:** when touching any cargo report country text, verify the same
named lead appears in Fast Facts + Exec + Situation, and that the Reads carry a
"among these route/hub-side records" scope. Both the on-screen preview and the
jsPDF `exportTopicReportPdf` cargo branch import the same builders, so the fix
propagates to the PDF automatically.

## Country Risk Breakdown table — per-country severity must not overstate

The per-country breakdown table (`buildCargoCountryBreakdown` in
`cargoNarratives.ts`; rendered by `CargoCountryTable` in the preview and
`drawCargoCountryTable` in the PDF, in the SAME spot: after Logistics Hub Read,
before Situation) assigns each country ONE coloured five-tier rating.

- **Severity = the PREVAILING (modal) tier, escalated by AT MOST ONE tier and
  only when a strictly-higher tier RECURS (>=2 records)** (`pickCountrySeverity`).
  A single stray High never lifts a Moderate country; a mostly-Low country with a
  couple of Extremes reads "Low to Moderate", NOT Extreme. The coloured chip is
  driven by the (capped) `severityKey`, label may be a range ("Low to Moderate").

  **Why:** an earlier version jumped straight to the peak repeated tier, painting
  a mostly-Low country with the Extreme-red chip — exactly the exaggeration this
  user objects to (same anti-overstatement stance as `fuel-severity-capping`).
  **How to apply:** keep the +1 cap; never let an outlier tier set the chip
  colour. Brand: subdued red / Extreme reserved strictly.

- Pattern phrase drops the classifier's weak "Other land-based cargo theft"
  bucket whenever a stronger named type exists, and skips a location-exposure
  suffix whose keyword already appears in a named type (no "Warehouse theft,
  warehouse exposure"). Severity colours come from `severityBadgeStyle`
  (`RATING_COLORS`, preview) and `SEV_COLOR` (`pdfChrome`, PDF) — kept in lockstep.
