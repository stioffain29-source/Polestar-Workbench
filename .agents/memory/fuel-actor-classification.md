---
name: Fuel action actor/category classification
description: Why the Fuel Watch "Producer/Buyer/Government/Infrastructure/Market" action table must not tag a bare institution mention as a policy action.
---

The Fuel Watch report's action table classifies each fuel incident into one of
five actor categories (`fuelNarratives.ts` `CATEGORY_RULES` / `classifyCategory`,
ordered first-match-wins): Producer / Buyer / Government-policy / Infrastructure /
Market-supply.

RULE: an institution name ALONE is NOT a "Government / policy action."
**Why:** the Government rule's first matcher used to be a bare
`(government|ministry|...|municipality|council|authority)` regex, so an
operational bulletin like "Jalu Municipality Monitors Fuel Crisis and Announces
Start of Supply Arrivals" got tagged "Government / policy" purely because the
word "municipality" appeared — and then carried the misleading "Policy
intervention resets pump-price…" operational read. The client flagged it: the
actor is not a government policy action.
**How to apply:** the Government category must require an institution PLUS a
concrete policy LEVER (subsidy/levy/tax/duty/excise/tariff, price
control/cap/freeze, export/import ban/quota, rationing/allocation/curfew,
mandate/sanction, nationalisation), in either order. A municipality/council
merely announcing that fuel supply is arriving / resuming is a supply-availability
signal → "Market / supply signal", not policy. Verify any rule change by replaying
the regexes over both the false case and a set of genuine policy headlines
(subsidy cut, rationing, export ban, levy hike, price cap, curfew) so the lever
matchers still fire.
