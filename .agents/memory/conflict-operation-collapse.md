---
name: Conflict running-tally operation collapse
description: How the Conflict Watch report/monitor collapses same-operation duplicate incidents without merging distinct events, and the collateral traps that recur.
---

Conflict news reports ONE counter-insurgency operation as a running tally across
outlets/days ("75 → 88 → 102 → 114 militants killed since July 5"), each landing
as its own incident and inflating the Conflict Watch report + monitor. The fix is
`conflictOperationCollapse.ts` (`collapseConflictOperations`), conflict-topic only.

**Mandate:** ZERO real-event collateral. Under-merging a couple of copies is
ALWAYS preferred over ever merging two distinct events. Every design choice below
leans that way.

**Design (two tightly-gated passes, no chaining):**
- Candidacy REQUIRES a militant-direction DIGIT kill figure. A personnel-direction
  victim (police/soldiers/civilians…) is a HARD VETO checked FIRST, so the attacks
  that trigger an operation — and mixed both-side roundups — can never merge into
  an operation cluster.
- Pass A (anchorless snapshot): theatre + figure + same UTC day.
- Pass B (running tally): theatre + explicit anchor (named op OR "since M-D") + start year.
- THEATRES is deliberately a curated allow-list (balochistan only at first). Add a
  theatre only once its data actually shows the running-tally pattern.

**Collateral traps (each cost a review round — keep the guards):**
- **Pass A small-figure collision.** Two distinct same-day theatre encounters can
  each report the same LOW figure ("3 militants killed" in two different raids);
  the key can't tell them apart. Guard: `MIN_SNAPSHOT_FIGURE` floor (~20) — Pass A
  only folds large mass-snapshots; small ones are left uncollapsed. Anchored
  tallies are unaffected (they fold in Pass B regardless of size).
- **Pass B cross-year merge.** The MONITOR collapses the FULL incident list BEFORE
  windowing, so a "since July 5" 2025 op and a 2026 op would merge and drop last
  year's event. Guard: fold the operation START year into the Pass B key, with
  month-wraparound (since-month > row-month ⇒ started previous calendar year, e.g.
  a January report of a December-started op). Report path windows weekly so it was
  already safe, but the shared collapse must protect the monitor path too.

**Report vs monitor dedupe — the title-only trap.** The report builder
(`buildConflictReportDataset`) bypasses `resolveGenericTrue`, so it had NO
syndication dedupe at all. `dedupeMonitorRows` keys on the canonical TITLE ALONE —
applying it directly to a multi-country report would merge two DIFFERENT theatres
that happen to share a headline shape. Fix: `dedupeSyndicationByCountry` buckets by
attributed country FIRST and only folds copies WITHIN a country (compound "A; B"
attributions bucket separately). Preview==PDF parity is automatic because both read
`buildConflictReportDataset`.

**RELEVANCE_RULE_VERSION lockstep (bit us here).**
**Why:** `backfillRelevance` only re-scores rows whose stored version DIFFERS.
Softening a `topicRelevance` rule (e.g. dropping ceasefire/truce from the diplomacy
exclusion, widening the violence override) WITHOUT bumping the version means every
row already stamped at the current version keeps its OLD (stricter) verdict forever
— permanent real-event collateral, the exact thing the softening was meant to undo.
**How to apply:** any edit to the relevance RULES must bump
`RELEVANCE_RULE_VERSION` in `lib/relevance/src/evaluate.ts` in the SAME change, even
if an earlier commit in the same session already bumped it — a later softening
needs its own bump.
