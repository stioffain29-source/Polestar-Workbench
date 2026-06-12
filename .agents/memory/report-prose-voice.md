---
name: Report prose voice & cadence
description: Voice rules for reader-facing report narrative; per-topic cadence; the boilerplate-detection list that must NOT be rewritten.
---

# Report prose voice & cadence

Report narrative prose must read as plain reader-facing business language, not
"backend analyst speak". Strip process meta-commentary: "this cycle", "the
window"/"in the window", "coverage gap", "operational signal", "the read",
"directional rather than firm", "reached the file"/"on file", "prior cycle",
"qualifying"/"classifiable", "briefing window", "kinetic incident". Replace with
plain equivalents ("gap in reporting", "activity", "the picture", "a rough
guide", "came through", "recent weeks").

**Why:** the user (terse, distrustful) explicitly demanded reports read like
business briefs, not pipeline logs, across ALL report topics.

## Per-topic cadence — the easy-to-miss trap

- **Cargo Watch and Fertiliser are MONTHLY** (30-day window) → use "this month"
  / "a quiet month". Single source of truth is the `MONTHLY_TOPICS` set in
  `reportWindow.ts` (`reportCadence`); `cadenceWord` in `draftReportProse.ts`
  and the `cadence` field in `reportNaming.ts`'s `CANONICAL_TOPIC` table must
  agree with it — three places, flip all together when a topic changes cadence.
- **Every other topic is WEEKLY** (fuel, shipping, flashpoint, energy, protests,
  country) → "this week".
- Shared/generic stat surfaces used across topics (e.g. `topicFastFacts`) are
  cadence-neutral → "this period".
- A monthly report window matches the topic dashboard's 30D range (both read the
  relevance-gated `/incidents`); the report anchors to its issue date/latest
  record while the dashboard is today-relative, so a ~1-record boundary-day
  difference is BY DESIGN, not a sync bug — do not force exact equality.
- **Real-world timeframes are NOT cadence** and stay as-is even in cargo:
  underwriter/insurance lag ("one to two weeks"), copycat-theft window ("within
  two weeks"), tight clustering ("repeat operator names in the same week").

**How to apply:** when rewriting cargo prose, do not blanket-replace to "this
week" — a subagent did exactly that and had to be re-corrected to monthly.

## Do NOT rewrite the boilerplate-detection list

`GENERIC_FLASHPOINT_PROSE` (in `flashpointReportDataset.ts`, used by
`isGenericFlashpointProse`) holds OLD analyst-speak phrases verbatim
(e.g. "the story this cycle is operational tempo rather than headline severity").
These strings match SAVED legacy boilerplate so cleaned-up reports stop
displaying stale prose. Leave them untouched even when rewriting the live prose —
"cleaning" them silently breaks stale-prose suppression.

## Preview/PDF empty-message parity

Empty-state messages must match between the on-screen preview component and its
jsPDF builder (e.g. `ShippingReportPreview` ↔ `exportShippingReportPdf` —
"No piracy or armed-robbery reports this week."). Change both together.
