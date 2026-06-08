---
name: Fuel Watch Producer/Buyer Actions table sparseness
description: Why the Fuel Watch "Producer and Buyer Actions" table read sparse during a crisis, and the two-layer fix (relevance gate + dedup).
---

# Fuel Watch Producer/Buyer Actions table

A sparse Producer/Buyer Actions table during an obvious fuel crisis was NOT a
classifier-cap problem. The real chain, in order, was:

1. **Relevance REQUIRED gate dropped the crisis incidents first.** The fuel
   `REQUIRED` set (in `@workspace/relevance` `topicRelevance.ts`) keyed on
   `fuel (shortage|price|...)` but NOT `crisis`/`emergency`. Airline and
   municipality stories headlined "… Amid Fuel Crisis" were dropped with
   reason "no required topic phrase matched" before ever reaching the
   classifier. So the table could only ever show whatever sneaked past.
   **Fix:** add `crisis|emergency` to the fuel-noun alternation.

2. **Persisted relevance hides it until a version bump.** Relevance is
   persisted per-incident and the central API filter drops `relevant=false`
   rows, so the frontend never even receives them. Any fuel-rule change must
   bump `RELEVANCE_RULE_VERSION` so the boot backfill re-evaluates and flips
   the stored verdicts. Reaches prod only after a republish.

3. **`nearDuplicate` false-merged distinct actors.** Its absolute
   `overlap >= 4` branch collapsed two DIFFERENT carriers ("IndiGo Suspends
   … Asian Routes … Fuel Crisis 2026" vs "Emirates Cuts … Flights … Fuel
   Crisis 2026") because they share four GENERIC crisis tokens (fuel, crisis,
   major, the year). **Fix:** gate the absolute branch with a Jaccard floor
   (`>= 0.4`). True syndicated rewrites share distinctive tokens at high
   ratio and still merge; generic-vocabulary overlap no longer does.

**Why this matters:** the user reads junk/sparseness as dishonesty. Verify any
fuel-table change by replaying the LIVE prod incidents through the real
`buildFuelProducerBuyerActions` (fetch via `executeSql({environment:"production"})`,
feed JSON to a throwaway tsx script importing the real lib) — but remember the
fuel report's window end is `resolveFuelPeriodEnd` (latest market close in
`hardNumbers`, ~today for a live draft), NOT the stored issue date, and the
window filter needs each incident's `topic` field or `byTopic` drops everything.

**Also dropped a noise class:** consumer travel-advisory / SEO comma-spam
aggregator headlines ("Travelers Warned: Visa & Mastercard Banned … Emergency
Travel Tips Inside") that chain a fuel mention onto a tourism/payments lead —
added to `FUEL_EXCLUDE` so they drop on every fuel surface, not just this table.
