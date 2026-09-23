---
name: City-level coverage gaps (the four-link chain)
description: Why a city can read as "nothing happening" while its country is well covered, and the four links that must all be fixed for city reporting to surface.
---

A city reads empty because of a COVERAGE chain, not because the city is quiet.
When a country's feeds are all war-led or vertical (junta/airstrike, fuel,
fertiliser, cyber), the wires' national ranking is consumed by the conflict and
the city's own reporting — structure fires, robbery, crackdowns, conscription
sweeps, road accidents — never enters the pipeline at all.

Four links must all be present, and a miss in ANY one of them looks identical
from the workbench (an empty city):

1. **A feed that carries city reporting.** The general local-security topic
   needs its own entry for the country: direct English desks where they allow
   an automated fetch, plus a PLACE-ANCHORED news query (city names OR'd with
   incident words). A nationwide OR-query is rank-capped and never reaches the
   city however fresh the scrape is.
2. **Country aliases that include the sub-city names.** City reporting names
   the TOWNSHIP/district, not the country, so without those aliases the item
   does not attribute to the country at all. Aliases are literal substring
   matches: only tightly-bound tokens are safe, and a township that is also a
   common word in a neighbouring country's language must be left out.
3. **Ingest allow cues that match how local desks write.** The gate is a
   literal `includes()`, so noun-only cues miss verb and plural forms
   ("robbery" misses "robberies", "theft" misses "stolen"). Whole incident
   families can be missing outright — an urban fire vocabulary, for instance.
4. **Downstream relevance cues in parity with the ingest cues.** Rows admitted
   at ingest are still hidden everywhere if the persisted relevance gate's
   title regex does not recognise the same families. Its alternation is
   plural-blind in the same way ("bombing" does not match "bombings").

**Why:** all four were broken at once for one city; fixing only the feed would
have inserted rows that attributed to nothing, and fixing ingest without the
relevance gate stores rows as `irrelevant`, which no read surface shows.

**How to apply:** when someone says "not much coming in from X", measure before
changing anything — count stored rows for the place, then check what the wires
actually carry for it in the same window. If the wires have items and the DB
does not, walk the four links in order. Verify by dry-running the topic scrape
and reading the per-feed accept counts, then re-checking `relevance_status` on
the rows that land: ingest acceptance alone proves nothing.

Relevance-rule changes still require the rule-version bump; the boot backfill
then re-scores the table in the background over several minutes.
