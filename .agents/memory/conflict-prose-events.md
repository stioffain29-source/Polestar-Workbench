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
text (low but non-zero risk). Verify by reloading the saved report in the editor. The
new signatures must NOT appear in the NEW auto prose either, or `pickProse` would treat
fresh auto text as generic too (idempotent for the editable fields, but the
`isGenericConflictProse(autoSituation/autoPolestarView)===false` tests will fail).

## Trap 3 — localisation-honesty applies to EVERY section, not just the area paragraphs
**Rule:** any "rest of the country is quieter" / "not a country-wide shift" /
"concentrated rather than countrywide" containment claim must be gated on
`focus.hasFocus && focus.localised` (≥50% of incidents in named hotspots). The
no-focus / scattered branch must just NAME the lead theatre, never imply the rest is
safe — this includes `buildPolestarView`'s headline judgement, not only
`buildAreaParagraph` and Situation/What Matters.
**Why:** a sub-50%-coverage theatre is NOT contained; calling it "not country-wide"
falsely reassures. A prior rewrite gated the area paragraphs and Situation but left
Polestar's else-branch saying "uneven rather than country-wide" for scattered data.
**How to apply:** every section's localised-only sentence branches on the SAME
`hasFocus && localised` predicate; the fallback branch names the lead with no
geographic-containment language.

## Trap 4 — never say "country-wide" in a multi-country report
**Rule:** do NOT phrase the Polestar/judgement as "this is not a country-wide risk
shift" (or similar single-country yes/no framing). The conflict report spans several
theatres, so a reader sees 3 countries listed and reads "not country-wide" as a flat
contradiction. Describe WHERE the activity sits instead ("Most of the armed activity
sits in <hotspots> in <country>, with <others> quieter but still worth watching").
**Why:** user rejected "This is not a country-wide risk shift… India and Philippines
stay on the watch list" as nonsense — three countries are named.
**How to apply:** keep the within-country "rest of <country> is far quieter" line ONLY
inside a single theatre's area paragraph (unambiguous); the Polestar/cross-report
judgement must be location-led, not a country-wide verdict. A test asserts
`autoPolestarView` never matches /country-?wide/. Also avoid banned-root words: no
"exposed/exposure", and don't repeat "focused".
