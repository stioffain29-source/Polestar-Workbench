---
name: Country brief weekly-window scoping
description: Why PNG/country crime looks "missing" from the brief — it's the deliberate 7-day window, not a relevance/countryMatch drop.
---

# Country brief is a strict 7-day weekly report

"PNG (or any country) violent crime is missing from the brief" is almost always the **deliberate 7-day reporting window**, NOT a relevance or country-match bug.

**Why:** `resolveActiveCountryWindow` (countryReportLayers.ts) FIXES the active basis to 7 days and never widens. The user was explicit: "it's a weekly report; what happened this week gets reported this week, last week was reported last week." The 30/90-day buckets exist only as labelled context counts, never the headline.

**How to apply:**
- Crime incidents (Homicide/violent crime, Theft/break-in, Armed robbery, Tribal/communal) stored topic=flashpoint are marked relevance_status='irrelevant' by the flashpoint TOPIC gate (`explainRelevance`), but the country brief fetches `includeIrrelevant` AND re-gates with its OWN `isCountryRelevant`. Those crime titles PASS `isCountryRelevant` — verify by replaying titles through `isCountryRelevant`, NOT `explainRelevance`. They are different functions; `explainRelevance` line ~1708 "no flashpoint public-order signal" does NOT run for the country brief.
- Do NOT "fix" this by adding murder/homicide/massacre to `COUNTRY_HARD_SECURITY_RE` or by widening the window — both chase a non-bug. Two separate diagnoses did this and were wrong.
- A set of flagged incidents spanning >7 days can NEVER all appear in one weekly report by design; each shows in its own week's report (set the report's issueDate to that week).
- In-window crime DOES render: it passes `isCountryRelevant`, has a valid `PngCategory` with a theme (`themeForCategory` is exhaustive), and counts as a "confirmed incident" (the `isConfirmedIncident` regex includes robbery/homicide/theft/etc.).
