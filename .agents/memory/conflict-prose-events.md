---
name: Conflict Watch event-led auto-prose
description: How the Conflict report auto-prose cites real events, and the two traps that make it lie or go stale.
---

# Conflict Watch event-led auto-prose

The Conflict Watch report's auto-prose (in `conflictReportDataset.ts`) leads with
CONCRETE cited events — a cleaned headline + " on D MMM" date pulled from the
period's standout incidents — across Situation, each Top Activity Area paragraph,
Watch Next and Polestar View. Raw source headlines keep their mid-sentence Title
Case (deterministic sentence-rewrite is infeasible); citing the real event verbatim
is the accepted tradeoff. Preview (`ConflictReportPreview.tsx`) and PDF
(`exportConflictReportPdf.ts`) consume the SAME dataset + `pickProse`, so they never
disagree.

## Trap 1 — "deadly" must track the casualty SIGNAL, not the severity rank
**Rule:** any "deadly" / "turned deadly" / "casualties" framing in the prose must be
gated on `areas.some(a => a.casualtySignalCount > 0)`, never on `SEV_RANK >= 4`.
**Why:** a High/Extreme window can have zero confirmed casualties; keying deadly
language off severity falsely calls it deadly and contradicts the area paragraph,
which honestly says "no casualties were confirmed". The user's standing order is to
state REAL facts from the rows.
**How to apply:** Situation `sevClause`, `buildWhatMatters` para1, and
`buildPolestarView` grade all branch on the casualty signal. Keep them in lockstep.

## Trap 2 — rewriting auto-prose silently leaves SAVED reports on stale boilerplate
**Rule:** when you change the conflict auto-prose wording, add the PRIOR auto-prose's
distinctive signature phrases to `GENERIC_CONFLICT_PHRASES`.
**Why:** editable fields (situation/whatMatters/watchNext/polestarView) persist the
old auto text in saved reports (e.g. report 21). `pickProse` only swaps in fresh auto
when `isGenericConflictProse` recognises the saved text as boilerplate, so without the
new signatures the saved report keeps rendering the old prose forever. The Top
Activity Area paragraphs are always auto (not editable) so they update automatically;
the four editable fields do not.
**How to apply:** pick phrases distinctive enough not to collide with analyst-authored
text (low but non-zero risk). Verify by reloading the saved report in the editor.
