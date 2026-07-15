---
name: Conflict Watch same-event clustering
description: Server-side LLM same-event clustering that stamps event_cluster_key at ingest; display dedupe by key; why singletons are self-keyed for cost convergence.
---

# Conflict Watch same-event clustering

The Conflict Watch monitor showed the SAME real-world event under different
syndicated headlines. Fix = server-side LLM same-event clustering at ingest that
stamps `incidents.event_cluster_key`, plus a display fold that collapses rows
sharing a key. Core lives in `lib/ingest/src/conflictEventCluster.ts`
(`runConflictClustering` orchestrator, `clusterRows` + `candidatePairs`),
wired into `runIngestOnce` AFTER conflict ingest.

## Design rules (do not regress)

- **No RELEVANCE_RULE_VERSION bump.** Clustering only stamps a key; it never
  changes relevance/severity/country/text. The irrelevant-item excludes shipped
  alongside it (narrow, override-gated CONFLICT_EXCLUDE in `topicRelevance.ts`)
  also deliberately skip a version bump — the monitor re-evaluates client-side.
- **Under-merge is the safe direction.** The LLM judge fails CLOSED to "no" on
  any error/timeout/bad-JSON. No-fabrication: never risk a wrong merge that
  hides a distinct event. Rows with null/unknown country are never paired.
- **Deterministic pre-gate bounds LLM volume:** same country, within `gateHours`
  (30h — covers the widest real running-tally gap), share ≥1 significant token,
  forward-neighbour cap (`maxNeighbours` 6), and NOT both already keyed.

## Why singletons get a self-key (cost convergence)

`candidatePairs` skips a pair only when BOTH rows are already keyed. If singletons
stayed NULL, every ingest run (default 12h) would re-adjudicate the whole 14-day
window forever — unbounded recurring LLM spend, no convergence.

Fix: after clustering, every remaining singleton is settled with a self-key
`conflict_evt:<id>`. This is **display-inert** (a unique key is its own group in
`collapseByEventClusterKey`) and **never blocks a later merge**: a same-event copy
arrives NULL-keyed, so the pre-gate still pairs new-vs-settled and merges it
(adopting the existing cluster key). Only settled-vs-settled pairs are skipped —
which also persists negative verdicts (two rows judged "not same" in a prior run
stay separate). Steady-state cost converges to new-rows-only.

**Why:** the codebase gates external/LLM cost everywhere; unbounded per-run
re-adjudication would be a wallet leak. **How to apply:** keep the singleton
self-key; keep the both-keyed skip in `candidatePairs`; the UPDATE only stamps
NULL-key rows (idempotent).

## Display fold (preview==PDF parity)

`collapseByEventClusterKey<T>` in
`artifacts/workbench/src/lib/conflictSameEventCollapse.ts` groups non-empty keys,
survivor = highest SEV_RANK then newest, first-occurrence position. Wired FIRST
(after generic syndication dedupe, before same-event/operations) in BOTH
consumers — `trueIncidents.ts` (monitor) and `conflictReportDataset.ts` (report:
enriched + preWindow) — so monitor and report deflate in lockstep.

## Verify

Foreground audit: `SNAPSHOT=<rows.json> WINDOW_DAYS=<n> pnpm --filter
@workspace/scripts run dryrun:conflict-cluster`. Good negative control: two
DIFFERENT same-country events (e.g. Manipur Kangpokpi farmer killing vs Ukhrul
ambush) are candidate-paired on shared "manipur" but must SPLIT.
