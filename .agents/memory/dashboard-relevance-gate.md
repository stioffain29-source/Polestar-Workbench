---
name: Dashboard relevance gate + march-month homonym
description: Why dashboard widgets leak noise (raw SQL, no gate) and the "march"-the-month false positive in the relevance unambiguous tier.
---

# Dashboard surfaces bypass the relevance gate

The dashboard overview endpoint builds its widgets from RAW most-recent SQL
(`ORDER BY occurredAt DESC LIMIT n`) with NO relevance filter, so flashpoint
sports/finance/pageant noise leaks straight onto:
- the "Recent Priority Incidents" list, and
- each Topic Monitor card's `latestHeadline`/`latestAt`.

**Why it isn't fixed server-side:** the relevance logic (`isTopicRelevant`,
`selectFlashpointUsable`) lives ONLY in the workbench frontend, not in a shared
lib, so the api-server cannot import it.

**How to apply:** filter client-side in the dashboard. Over-fetch on the server
(e.g. LIMIT 80) so enough rows survive, then in the frontend run
flashpoint/protests rows through report-grade `selectFlashpointUsable` and every
other topic through `isTopicRelevant`, slice to the display count. Derive each
topic card's latest headline from the same relevance-gated list (override the
server's raw `latestHeadline`), falling back to the server value only when no
relevant row was fetched — do NOT blank the fallback or you erase legit
non-flashpoint headlines (fuel/shipping recent rows aren't in the
flashpoint-dominated fetch). Any new dashboard/list surface that reads incidents
must pass them through the same gate; the gate is not applied at the data layer.

# "march"-the-month homonym in the unambiguous tier

The flashpoint/protests REQUIRED ("unambiguous") tier listed bare `march`, which
matches the calendar MONTH ("activity flat from 50.4 in **March**"). This let
pure economics/any-topic items pass the relevance gate. The report's second
stage (`selectFlashpointUsable`) hid it (it drops such rows anyway), but the
bare relevance gate (used by the dashboard for non-flashpoint topics and as the
seed gate) leaked it.

**Rule:** a token that is also a common month/proper-noun is NOT unambiguous.
Keep only the inflected protest forms (`marches|marchers|marching|marched`) in
the unambiguous tier; bare `march` needs protest context — protest-march noun
phrases, directional forms (`march on|onto|into|through|past|towards|against`),
guarded `march in` (negative-lookahead parade|formation|step|uniform|honour|
memory|lockstep) and guarded `march to` (negative-lookahead sports objects
final|title|cup|playoffs|promotion|…), plus the existing actor-companion line.
A ceremonial/military **parade** excluder in `FLASHPOINT_EXCLUDE` catches
"soldiers march in … parade" regardless of word position (lookahead only sees
the next word).

**Why:** user is noise-averse ("signal thin > noise in"); a month name reading
as a protest is exactly the slop class they escalate on. Watch for the same
homonym trap with any future single-word trigger (e.g. "May"/"rally"/"strike").
