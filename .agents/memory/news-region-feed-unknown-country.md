---
name: News region-feed 'Unknown' country attribution
description: Why energy/news region feeds leave country='Unknown' (→ "—" in the monitor) and how the gazetteer + Unknown-only backfill fix it
---

# News region-feed 'Unknown' country attribution

The multi-country "region" news feeds (energy load-shedding/grid-attack, and any
topic whose feed searches several countries at once) set
`defaultCountry='Unknown'`, then rely on `detectCountry(text, COUNTRY_ALIASES)`
to recover the real country from the headline. `detectCountry` only matches
whatever is in `COUNTRY_ALIASES`, which historically held country NAMES plus a
handful of capital cities. So any headline that identifies its country ONLY via a
sub-national place, a utility, or a regulator (Gazipur, K-Electric, NEPRA, LESCO,
NEA, Kerala, TEPCO, Yanbu…) fell through to `'Unknown'`, which the frontend
`cleanCountry` renders as "—". This is the root cause of "the COUNTRY column is
empty for lots of rows" reports — the data is in-region, just unrecognised.

**The fix has two halves and BOTH are required:**
1. Expand the EXPORTED `COUNTRY_ALIASES` gazetteer (in `topicConfigs.ts`) with
   state/city/utility/regulator aliases per in-region country. This fixes FUTURE
   ingests. `detectCountry` is first-match, India-first, `\bword\b`
   case-insensitive over `title + "\n" + summary`.
2. A marker-gated, Unknown-ONLY boot backfill (`runNewsCountryBackfill`,
   mirrors `backfillCargoCountry`) re-runs the SAME `detectCountry` over the rows
   already stored as `'Unknown'` and fills `country`; coords only when
   lat/long are BOTH null (never clobber a more precise geocode). This fixes the
   rows ALREADY in the DB. The update re-asserts `country='Unknown'` in its WHERE
   so the invariant holds at the DB boundary even if reused live.

**Why Unknown-only matters:** mis-attributed *non*-Unknown rows (e.g. a
Karnataka story wrongly stamped Indonesia) are a SEPARATE bug class — the
gazetteer expansion only prevents new ones; the backfill deliberately does NOT
touch attributed rows, so it can never make an existing attribution worse.

**How to apply / verify:** validate any alias addition by replaying
`detectCountry` over the live `country='Unknown'` haystacks BEFORE shipping —
generic words (dropped "brownout") mis-fire. Run the backfill against ENERGY
only unless explicitly widening scope. Genuinely place-less or out-of-region
headlines (Russia, Eskom/South Africa, Woerden/NL) correctly stay "—" — that is
honest, not a defect. Prod DB is read-only from the workspace, so the marker-
gated block in `runDataMigrations` runs the backfill inside the deployment on
republish (same pattern as the other one-time purges/relocations). Place it
AFTER the out-of-region purge so deleted rows are not re-placed.
