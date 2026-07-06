---
name: Country report fetch scoping (countryLike superset)
description: Why the country report's /incidents fetch is scoped by the loose countryLike OR-substring param, the superset invariant it relies on, the Jakarta trap, and the buildCountryLayers preFiltered flag.
---

The country report page (`CountryReport.tsx`) MUST scope its 90-day `/incidents`
fetch with the server `countryLike` param — a comma-separated token list that
becomes an OR of `country ILIKE '%token%'`. It is DELIBERATELY a loose substring
OR, NOT the exact `country` eq param: the incident `country` field is a
semicolon-compound list ("South Korea; Iran"), so an exact match is useless here.

**Why:** unscoped, the server returned the ENTIRE ~16k-row/90d incidents table
for EVERY country and joined corroborations (`withCorroborations` inArray) over
all of them — the confirmed root cause of the Indonesia country-tab freeze.

**Superset invariant (do not break):** the client's `incidentMatchesCountry`
requires an EXACT semicolon-split token of the field to be a member of
`acceptedCountryTokens(name)`. The tokens sent are exactly that accepted set, and
each is a substring of the field, so the server ILIKE can only OVER-return. The
client `isCountryRelevant`/`filterCountryRelevant` gate stays the SOLE relevance
authority; `countryLike` only trims payload, never correctness. Never switch it
to an exact eq, and never intersect it with the server relevance verdict.

**How to apply:** always derive the tokens from `countryFetchTokens(name)`
(`countryMatch.ts`, the shared authority) — do not hand-roll them at the call
site.

**Jakarta trap:** Jakarta records carry country="Indonesia" (never "Jakarta")
and the page matches them against the Indonesia group, so `countryFetchTokens`
remaps Jakarta → Indonesia tokens. Sending literal "jakarta" tokens starves the
brief to zero. A jest test (`countryFetchTokensSuperset.test.ts`) pins both the
superset invariant and this remap.

**Token-stripping caveat:** the route strips `% _ \` from tokens so a stray token
can't widen the LIKE. This assumes country names contain no LIKE metacharacters
(true for every `COUNTRY_GROUPS` name); a future name containing one would NARROW
the pattern below the client match and could silently starve that brief — escape
rather than strip if that ever changes.

**buildCountryLayers preFiltered:** the page filters relevance ONCE into
`countryRelevant` (reused for the issue-date anchor AND the lookback layers) and
passes `{preFiltered:true}` so `buildCountryLayers` skips its internal re-filter
— one relevance pass, byte-identical buckets. The headless
`exportCountryReportPdf` caller keeps the default self-filtering behaviour.

**Gated further work:** an O(n²)→indexed rewrite of `dropSyndicatedRehashes`
(`countryReportLayers.ts`) is intentionally deferred — it early-exits records
with no event signature, so its effective cost is small, and Step A removed the
dominant payload/join cost. Measure with a headless tsx timing harness over the
real Indonesia set before optimising it.
