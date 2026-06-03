---
name: Country report 30-day headline window
description: Country reports lead with the rolling 30-day window (not a 7-day weekly window); why, and where the window+labels are wired.
---

# Country reports lead with the rolling 30-day window

Country reports headline the **rolling 30-day window**, clearly labelled "30-day".
They do NOT use a strict 7-day weekly window.

**Why:** PNG / West Papua (and similar) are structurally sparse-reporting,
high-threat countries. A blank week there is a coverage artifact, not calm, so a
7-day headline read as "thin" in every quiet week and triggered repeated user
"still looking thin" complaints. The user confirmed (via user_query) the report
must lead with the 30-day window as the headline. This SUPERSEDES the earlier
"Option A" design where the active window was the 7-day window (empty when sparse)
and 30/90-day were only "context".

**How to apply:**
- `resolveActiveCountryWindow` (countryReportLayers.ts) always returns the 30-day
  window: `basisDays:30`, `incidents = layers.thirtyDay`, labels via
  `countryRangeLabels(end, 30)`. This one window drives Fast Facts, map, charts,
  the related-incidents table AND the drafted prose — keep them on ONE window.
- `computeCountryCoverageStatus` keys its "active" (no-banner) guard off
  `layers.thirtyDay.length`, so the coverage banner fires only when the 30-day
  window is empty. Banner/Fast-Facts/prose copy says "30-day window" and refers
  to a single deeper "90-day background section" (NOT "30 / 90-day context").
- `summariseLookback` "30-Day Context" section gives a recency split (how many of
  the 30-day records landed in the most-recent week vs earlier in the month),
  since the 30-day window is now the headline, not something to compare against.
- `draftCountryReportProse` (draftReportProse.ts) defaults `basisDays` to 30 and
  labels everything off `basisShort`. PNG/Papua have bespoke prose blocks; the
  generic block is the fallback. Callers always pass `windowIncidents` +
  `basisDays`, so the legacy 7-day filter fallback is defensive/dead.
- issueDate is still clamped to the latest RELEVANT record (reportWindow
  `clampIssueDateToLatestRecord`), so the 30-day window ends on real data, not on
  empty calendar time past the newest incident.

**Watch:** if you touch this, scrub for leftover "7-day"/"weekly"/"this week"/
"empty week" copy across countryReportLayers.ts, countryFastFacts.ts,
draftReportProse.ts and CountryReport.tsx — they re-introduce the contradiction.
