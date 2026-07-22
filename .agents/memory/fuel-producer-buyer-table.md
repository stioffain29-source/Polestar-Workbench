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

## Third cause: genuine actions siloed under the `shipping` topic

A one-row table during a Hormuz crisis was NOT relevance/dedup — the real
producer/buyer actions (OPEC+ moves, ADNOC/Aramco/Pertamina crude-route moves)
are filed under the **shipping** topic and are invisible to the fuel-only
builder, because fuel relevance is deliberately scoped to fuel-OPERATIONAL
incidents and excludes OPEC/crude-market framing.

**Fix (in `fuelNarratives.ts`, no relevance version bump — this is a workbench
builder, not the shared gate):** `filterFuelActionIncidents(incidents, issueDate)`
merges the canonical in-window fuel rows with in-window **shipping** rows that
pass BOTH `FUEL_ACTION_TOPICAL_RE` (a fuel/crude/national-oil-company signal)
AND `classifyCategory` ∈ `CROSS_READ_ACTION_CATEGORIES`
(Producer/Buyer/Government/Infrastructure — **never** "Market / supply signal").
`buildFuelProducerBuyerActions` consumes it; preview + PDF both read the single
`producerBuyerActions` from `fuelWatchReport.ts`, so parity is automatic.

**Integrity traps this surfaced (fix in lockstep on any change):**
- **Market-signal leak:** a bare "Oil prices jump after attack" headline is NOT
  an action — excluding the Market category from the cross-read is what keeps
  the crude-price noise (the very thing fuel excludes) out of an *Actions* table.
- **"Reliance" homonym:** "reduce **reliance** on Hormuz" false-matched the
  company. Bare `reliance` was removed from the classifier Producer rule, the
  topical guard, AND `pickActor` — all now require `reliance industries|
  reliance jamnagar|jamnagar`.
- **Food-oil:** bare `oil` matched "palm oil"/"cooking oil". Guarded with a
  negative lookbehind over food-oil qualifiers.

**Honest-ceiling discipline (no-fabrication):** the fuel report window is
**weekly (7 days)** while producer/buyer actions run on a monthly-ish cadence,
so this table is *structurally* sparse most weeks. Before assuming over-
filtering, scan the actual window in the DB for action terms — if only N genuine
actions exist in-window, N rows is correct. Do NOT widen the window or pull in
pre-window OPEC/ADNOC actions to pad it (misdates the report). The cross-read is
the honest maximum; a modest table is the truth, not a bug.

**Known watch-point (accepted trade-off):** the cross-read's action gate relies
on the broad table classifier, whose Producer rule treats a bare national-oil-
company name as sufficient. This is *load-bearing* — it's why the Pertamina
tanker (an operational supply move, no action verb) surfaces. It could over-
admit a future bare "OPEC meeting" mention; owner prose review is the backstop.
Tightening to require an action verb would regress the current fix, so don't.
**Shadow of the same rule:** CATEGORY_RULES is first-match, so an NOC-named
refinery fire ("Pertamina refinery ablaze") classifies **Producer** (an
involuntary event shown as an "action") — the fire→Market rule only catches
the no-NOC case. Accepted, same backstop; don't "fix" by reordering rules.

## Fourth cause: classifier vocabulary gaps (display-side, no version bump)

A crisis week's genuine rows matched NO CATEGORY_RULE and were silently
dropped by the builder. Fixed in `fuelNarratives.ts` (builder-only — no
relevance change, no RELEVANCE_RULE_VERSION bump):
- **Buyer supplier-pivot:** `SUPPLIER_PIVOT_RES` — "turns to X for <product>" /
  "seeks <product> from X", NAMED products only (gasoline/diesel/jet fuel/
  fuel/crude), never bare "oil" (palm-oil guard). Speculative "could turn to"
  commentary can match — accepted, owner prose review backstop.
- **Market:** `refin(ery|er|ing) margins?`/`crack spreads?`; refinery/depot/
  terminal fire → Market (see NOC shadow above).
- **Pivot story-key dedupe:** two syndicated rewrites of one pivot share too
  few tokens for nearDuplicate (jaccard 0.267 < the load-bearing 0.4 floor —
  NEVER lower it), so the builder loop also dedupes on
  `pivot:${firstSigToken}:${product}`. Coarse-key caveats: subject = FIRST
  sig token (two buyers sharing a leading token could false-merge) and
  product = first PIVOT_PRODUCT_RE hit; harden only if a real false-merge
  appears.

**Verification pattern (owner-gated app, no live screenshot):** replay prod
rows through the real builder AND assert rendered markup via
`renderToStaticMarkup(<ProducerActionsTable rows/>)` (component exported from
`ReportPreview.tsx` for this) — `fuelProducerActionsRender.test.tsx`.

Unit tests live in `__tests__/workbench/fuelProducerBuyerActions.test.ts`
(Pertamina inclusion, oil-price/reliance/palm-oil exclusion, pivot
classify+collapse, different-buyers separate, refiner margins, refinery fire,
cross-read Market refusal).
