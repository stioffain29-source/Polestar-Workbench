---
name: Cargo report country/attribution consistency
description: Why cargo report surfaces disagreed on country attribution, and the single-source rule that keeps Fast Facts, prose and Reads aligned.
---

# Cargo Watch country attribution must agree across surfaces

A Cargo Watch report has several surfaces that each name countries:
Fast Facts "Most Affected Country" card, the Executive Summary / Situation /
What Happened / What Matters / Polestar View prose, and the two auto Reads
(Cargo Security Read = route-side subset, Logistics Hub Read = hub-side subset).
They drove a "report contradicts itself" complaint.

## Two distinct contradiction classes (both fixed)

1. **"Unknown" counted as a country on some surfaces but not others.**
   "Unknown" can be the single largest BUCKET while still being a MINORITY of
   records (e.g. 17 Unknown vs 56 identified across many countries). A surface
   that counts the raw max shows "Country not identified"; one that excludes
   Unknown names the real lead. They then disagree.

2. **Compound country strings ("Indonesia; West Papua") treated as one literal
   country.** One surface splits them, another shows the compound verbatim as
   if it were its own country — same contradiction class, just shifted.

## The rule

- Country tokenisation lives in ONE place: `splitAttributedCountries()` (and
  `isUnattributedCountry()`) in `@workspace/relevance` (`topicRelevance.ts`).
  Every surface that counts countries (Fast Facts card, cargo prose builders,
  and the draft seed's own `expandCountries`) MUST normalise the same way:
  split on `; , /`, drop Unknown/empty/N-A/Other/unattributed. If you add a new
  country-counting surface, route it through the shared splitter or it WILL
  drift.

- **Subset Reads must name their scope, not contradict the headline.** The
  Cargo Security Read counts only route-side records and the Logistics Hub Read
  only hub-side records, so their leader legitimately differs from the
  overall-window lead. The fix is to SAY so ("among these route-side records")
  rather than hide it — a scoped phrase explains the gap; a bare "in the window"
  reads as a flat contradiction of the Fast Facts/Exec lead.

- **Don't assert a firm lead when attribution is weak.** `countryPicture` gates
  on a "strong" flag (identified rows must be a real majority); otherwise the
  prose states the attribution gap instead of naming a single lead. `identified`
  is ROW-level, `top` is TOKEN-level — intentional and commented.

**Why:** distrustful user; any cross-surface disagreement reads as the report
lying. The relevance-filtered window (not raw SQL) is what renders — raw SQL
over-counts noise the `isTopicRelevant` filter drops, and the cargo issue date
is clamped DOWN to the latest relevance-filtered record, so the window can be
narrower than a naive 30-day SQL query suggests.

**How to apply:** when touching any cargo report country text, verify the same
named lead appears in Fast Facts + Exec + Situation, and that the Reads carry a
"among these route/hub-side records" scope. Both the on-screen preview and the
jsPDF `exportTopicReportPdf` cargo branch import the same builders, so the fix
propagates to the PDF automatically.
