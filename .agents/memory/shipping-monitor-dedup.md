---
name: Shipping monitor vs report dedup (decoupled by surface)
description: Why the Shipping monitor uses a MORE aggressive vessel dedup than the comprehensive report, and how the two paths are wired in shippingReportDataset.ts.
---

# Shipping monitor vs report dedup

The Shipping **monitor** page (`Shipping.tsx`) and the Shipping **report**
(`buildShippingReportDataset`) both run the same noise filter
(`isLowCredibilityShippingRecord`) + title/signature dedupe, but they
**deliberately diverge on vessel-row dedup** — the monitor collapses harder.

**Why they diverge (decoupled by surface, architect-mandated):**
One real seizure (e.g. the 13/14/15 May UAE/Hormuz vessel seizure) is re-picked
up by wires across SEVERAL calendar days, and each headline cites a different
anchor subset ("off UAE" / "near Strait of Hormuz" / "heading to Iran"). So
neither `dedupeByTitle` (first 6 significant words diverge) nor an EXACT-day +
anchor-set key collapses the copies — they show as multiple cards, and the same
event surfaces as BOTH Extreme and Low (syndicated copies carry different
severity). The only signal common to all copies is {act, coarse theatre,
~same week}, so collapsing the triple REQUIRES coarse {act,region,time}
clustering. But that same coarse clustering is TOO aggressive for the report:
two genuinely distinct same-act incidents in the same theatre within ~3 days
would wrongly merge and one would be dropped. The report is the COMPREHENSIVE
product and must not drop incidents; the monitor is an explicit SUMMARY ("Full
records remain available in the incident table") where one-card-per-event is the
goal. Lexical-overlap gating can't bridge this — the wires share only generic
"vessel/seized", no distinctive entity token — so the surfaces must use
different policies, NOT one shared function.

**Wiring (in `shippingReportDataset.ts`):**
- REPORT vessel dedup = `dedupeByEventKey(dedupeByTitle(vesselAll))`.
  `dedupeByEventKey` is CONSERVATIVE: `vesselEventKey` keys on EXACT calendar day
  + act + EXACT anchor subset (Map-keyed; empty-anchor rows kept distinct via
  `__title|key`). Only merges near-identical same-day copies.
- MONITOR vessel dedup = `dedupeVesselEventsClustered(dedupeByTitle(vessel))`,
  called only inside the exported `dedupeShippingMonitorRows`. AGGRESSIVE: groups
  vessel rows by `{vesselType, coarseRegion}` (gulf/redsea/suez/malacca/somalia
  via `COARSE_REGION_TESTS`, first-match), then single-link clusters in time
  (`EVENT_GAP_DAYS=3` consecutive gap, `EVENT_SPAN_DAYS=6` total span anti-chain),
  collapsing each cluster to its most-severe/most-recent row. Rows with no
  recognised theatre pass through untouched. `coarseRegion`/`COARSE_REGION_TESTS`
  are monitor-only — do NOT call the clusterer from the report builder.
- Non-vessel rows on BOTH surfaces get title+signature dedupe only. Running any
  event/coarse dedupe across non-vessel rows over-merges unrelated same-theatre
  stories.

**Accepted tradeoff:** in a high-tempo week the monitor's vessel count can
UNDERCOUNT the report's vessel table (two distinct same-theatre same-act events
within the window merge on the monitor). This is the intended monitor policy —
do not "fix" it by reusing the conservative key on the monitor (that brings back
the multi-card / Extreme+Low duplicate the user complained about).

**Gotchas:**
- The dedupe helpers (`vesselEventKey`, `topicSignature`) call
  `date.toISOString()`, which throws on an invalid `Date`. The report path
  pre-filters invalid dates; the monitor does not, so `dedupeShippingMonitorRows`
  partitions invalid-date rows out and appends them undeduped (no crash, no drop).
- The `dedupeVesselEventsClustered` single-link loop resets `startMs` only on a
  NEW cluster and `prevMs` on every member — keep both resets or it re-orphans /
  over-chains.
- No test runner exists in `@workspace/workbench` (no vitest, no `test` script),
  so the divergence is guarded by comments + architect review, not unit tests.
- Live result of the deduped monitor: TOTAL ~85, vessel incidents 4 (2 attacks,
  2 seized), the UAE/Hormuz seizure = ONE Extreme card.

**Open parity gap (NOT a bug, user only asked for the monitor):** the report's
"Records In Window" fast-fact KPI still uses raw `enriched.length`, so the report
headline can differ from the monitor's deduped total. Normalise only if asked.
