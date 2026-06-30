---
name: Jakarta corridor attribution vs masthead strip
description: Why a Jakarta corridor can fail to light up even when the title clearly names it — stripMasthead eats the title tail before matching.
---

# Jakarta corridor attribution vs masthead strip

`corridorIndexForIncident` (in `jakartaCorridors.ts`) decides which Jakarta
corridor an incident belongs to by matching keywords against
`location + stripMasthead(title)`. The catch: `stripMasthead` removes a trailing
`-/|/–/—` followed by 2–40 non-separator chars anchored to end-of-string. A
title that *ends* with a hyphenated place tail loses that tail.

Example that bit me: `"Toll-road flooding delays Soekarno-Hatta airport
transfers"` → stripMasthead backtracks to the hyphen in `Soekarno-Hatta` and
strips `"-Hatta airport transfers"`, leaving `"Toll-road flooding delays
Soekarno"`. Now neither `soekarno-hatta` nor `airport` matches, so the airport
corridor never elevates, and `"toll"` re-homes it to the cross-city / commuter
area instead.

**Why:** the masthead stripper is meant to drop ` - Source Name` suffixes, but
it cannot tell a source name from a real hyphenated place at the end of a
headline.

**How to apply:**
- When something "should" attribute to a corridor but doesn't, check whether
  stripMasthead is eating the keyword off the title tail before blaming the
  keyword list.
- Put corridor-identifying terms where they survive: the `location` field is
  NOT masthead-stripped, or keep the place name away from the very end of the
  title. Test fixtures should follow the same rule.
