---
name: Shipping report lead development
description: How the Shipping Watch report picks and surfaces the week's dominant chokepoint headline, and the detectChokepoints ops-gate trap.
---

# Shipping report "lead development" selection

The Shipping report names the week's dominant story up front (Executive Summary
+ Chokepoint/Route Read). The selector picks the MOST-CORROBORATED headline:
the largest length-normalised near-duplicate cluster (Jaccard ≥ 0.34 over
significant title tokens), tie-broken newest-day → severity → newest-time. This
beats "newest+severity" (picks a lone outlier) and "raw shared-token count"
(length-biased toward long closure headlines).

**The trap — `detectChokepoints` excludes pure political headlines.**
`detectChokepoints` / `matchesHormuz` (shippingAnalysis.ts) deliberately require
an OPERATIONAL maritime keyword (vessel/tanker/transit/strike/shipping/…) so a
passing "Hormuz" mention doesn't inflate the route-count table. But the headline
DOMINATING a week is often political — "US-Iran deal, Strait of Hormuz to reopen"
— which has NO ops word after stripping the chokepoint name, so it fails that
gate and is invisible to anything built on `detectChokepoints`.

**Why:** the user complained the report never surfaced the US-Iran agreement /
Hormuz reopening even though dozens of wires led with it — because the lead pool
was `detectChokepoints`-gated and the deal headlines all lacked an ops word.

**How to apply:** any "what is the dominant chokepoint story" selection must key
on the chokepoint NAME alone (a name-only regex over title+summary+location),
NOT `detectChokepoints`. Keep route-COUNT tables on `detectChokepoints` (the
ops-gate is correct there). These two pools are intentionally different.

# executiveSummary is browser-local and must honour the staleness guard

The report's `executiveSummary` has NO DB column — it persists only to
localStorage (keyed per report id) and is destructured OUT of the DB save
payload. Its "saved" value is therefore the localStorage copy. It MUST go
through the same `pick()` staleness guard as every other narrative field
(`situation`, `whatHappened`, …): when the draft window has advanced or live
data is newer than the issue date, reseed from the fresh draft.

**Why:** the Exec Summary previously kept the localStorage copy unconditionally,
so a browser that had saved an earlier summary (written before the lead-
development sentence existed, or against an older window) would silently never
show the new dominant headline — preview and PDF agreed with each other but both
omitted it.

**How to apply:** treat the localStorage summary like any other saved prose —
authoritative only when NOT stale. Fresh, non-advancing reports keep the saved
copy; stale/advanced drafts reseed (which is how the lead development reaches the
Exec Summary, since the in-app PDF renders the form's `executiveSummary`).
