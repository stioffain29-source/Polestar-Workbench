---
name: Shipping monitor == report dedup parity
description: The Shipping monitor page must run the same dedup+noise pipeline as the Shipping report; why raw counts were wrong and how to keep them aligned.
---

# Shipping monitor dedup parity

The Shipping **monitor** page (`Shipping.tsx`) and the Shipping **report**
(`shippingReportDataset.ts`) must render the same cleaned + deduplicated event
set. They originally diverged: the monitor ran only the noise filter
(`isLowCredibilityShippingRecord`) and deliberately reported raw record volume,
while the report deduped via `dedupeByEventKey(dedupeByTitle(...))`. Result: the
same event (e.g. a single UAE seizure republished under ~8 wire headlines) showed
as multiple cards, and the SAME event surfaced as BOTH Extreme and Low because
syndicated copies carried different severity tags.

**Rule:** the monitor base dataset (`enriched`, and its alias `cleanEnriched`)
must be `dedupeShippingMonitorRows(scope+noise-filtered rows)`. That exported
helper mirrors the report recipe — event-key dedupe ONLY on vessel rows
(`classifyVesselIncident !== null`), title+signature dedupe on the rest. Running
event-key dedupe across non-vessel rows over-merges unrelated same-day stories
that share a chokepoint anchor.

**Why:** user explicitly confirmed ("use the clean deduped numbers") that the
monitor's headline must be one-event-one-row, not raw wire volume. This REVERSES
the earlier deliberate choice to show raw `enriched.length` "so the page does not
silently shrink." Headline dropped 246 → 90 once deduped + noise-filtered.

**Gotchas:**
- The dedupe helpers (`vesselEventKey`, `topicSignature`) call
  `date.toISOString()`, which throws on an invalid `Date`. The report path
  pre-filters invalid dates; the monitor does not, so `dedupeShippingMonitorRows`
  partitions invalid-date rows out and appends them undeduped (no crash, no drop —
  they were never deduped before either).
- Open parity gap (NOT fixed, user only asked for the monitor): the report's
  "Records In Window" fast-fact KPI in `buildShippingReportDataset` still uses
  raw `enriched.length`, so the report headline can differ from the monitor's 90.
  If the user later wants them identical, normalise that KPI to the deduped count.
