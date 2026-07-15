---
name: Conflict same-event collapse (display-layer syndication dedup)
description: How the Conflict Watch monitor/report collapses one real event syndicated under DIFFERENT headlines that title/canonical dedupe can't bridge, without ever merging two distinct events.
---

# Conflict same-event collapse

`artifacts/workbench/src/lib/conflictSameEventCollapse.ts` is a DISPLAY-LAYER
pass (no ingestion change, NO `RELEVANCE_RULE_VERSION` bump) that folds copies of
ONE real conflict event which arrive under different headlines the conservative
title/canonical dedupe (`monitorDedupe.ts`) cannot bridge. Owner trigger: one
Kuki-farmer killing in Manipur Kangpokpi counted 3× on the monitor.

It is a THIRD, distinct mechanism — separate from flashpoint `dedupeByTitle`
(fuzzy 3rd pass) and from `conflictOperationCollapse` (running-tally folding).
Order at BOTH surfaces: `collapseConflictOperations(collapseConflictSameEvent(deduped))`
— monitor in `trueIncidents.ts`, report in `conflictReportDataset.ts` (enriched
AND pre-window sites) → preview==PDF parity.

## Hard mandate
ZERO real-event collateral. ALWAYS prefer UNDER-merging: leaving true duplicates
un-merged is fine; merging two DISTINCT events is a defect. The design is
structurally under-merge-only — it emits exactly one row per cluster (output ≤
input) and every gate only PREVENTS links, so it can never up-count.

## Four gates (all must pass to fold two rows)
1. **Event-CLASS gate** (`classifyEventClass`): meta classes come first in
   precedence (named-operation, militant running-tally, reaction/aftermath/
   policy/explainer) → those are PERMANENT SINGLETONS passed through untouched
   (tallies are handled later by `collapseConflictOperations`). Only same-class
   CANDIDATE rows (kinetic/arrest/seizure/surrender) may fold.
2. **Complete-linkage clustering** (`groupConflictSameEvent`): a row joins a
   cluster only if it `pairLinks` EVERY existing member. This kills single-linkage
   transitive A–B–C chaining. Consequence: one real event can survive as 2+
   clusters (accepted under-merge) rather than risk chaining in a distinct event.
3. **≥3 shared ANCHOR tokens** (`anchorTokens`): anchors EXCLUDE the country name,
   pure digits, and generic vocab in `NON_ANCHOR` — casualty/action/actor/
   class-marker/spelled-number words.
4. **SUBSET digit veto** (`digitsConflict`): vetoes only when EACH side has a
   small number the other lacks; ALLOWS a subset (`{21} ⊆ {21,30}` toll-rises).
   Spelled-out small numbers feed the veto.

## Load-bearing lesson: NON_ANCHOR must include GEOGRAPHIC FILLER
`NON_ANCHOR` must exclude generic administrative place nouns (district, village,
area, town, region, state, border, city, tehsil, taluk, subdivision), not just
actor/casualty words.
**Why:** "Man killed in Kangpokpi district" vs "Woman killed in Kangpokpi
district" — man/woman are excluded actor words, so both otherwise anchor to
`{manipur, kangpokpi, district}` = 3 and MERGE two distinct killings. "…in X
district" is the standard South-Asian headline shape, so this is real, not
contrived. The real place token (kangpokpi) still anchors; only the filler drops.
**How to apply:** any future anchor-set change is safe to make MORE exclusive —
removing anchor tokens can only shrink/split clusters (under-merge), never grow
them. Adding a token TO the anchor set (making it more permissive) is the
dangerous direction — re-run the live audit. Verify on real rows, not just units.

## Accepted (non-bug) residuals
- Monitor collapses the unwindowed list; report collapses windowed subsets, so the
  survivor row can differ at window edges — cosmetic, not count inflation.
- Two digit-less DISTINCT events at the same specific named place within 48h can
  still fold; a 1080-row live audit showed this is currently only theoretical.

## Verification recipe
Live audit over `/tmp/conflict_rows.json` (1080 conflict rows) driving
`groupConflictSameEvent`: after the filler fix it folds 41 clusters / 90 rows
(a broken single-linkage version once folded 393 rows). Manually eyeball every
multi-row cluster — all must be genuine same-event syndications. Owner farmer case
folds; a Myanmar airstrike pair with a coincidental shared "8" correctly SPLITS.
