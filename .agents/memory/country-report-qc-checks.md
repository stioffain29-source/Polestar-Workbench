---
name: Country/city brief §13 QC checks
description: How the non-blocking runCountryReportQc guards must be reachable, not coupled to impossible builder states
---

`runCountryReportQc(dataset, mapIncidents)` emits a non-blocking advisory banner
(no-print) plus console warnings for the structured country/city briefs. Three
checks: A (older-lead dating), B (top-dev location on map), C (top-dev named in
narrative).

## Check A must guard a REACHABLE failure

The builder sets `occurredEarlier` / `occurredOutOfWindow` on a `PngReportItem`
ONLY when it extracted an `incidentDate`. So the naive "older row flagged but
`!incidentDate`" check is DEAD CODE on real output — it can never fire.

The real §13 failure is: the LEAD development (`topThree[0]` — the exact row the
event-led opening sentence is built from) actually happened before the window,
but the prose presents it as fresh. Check A therefore asserts BOTH the lead's
occurrence date AND its report date (formatted `d MMM yyyy`, mirroring
`pngReportDataset.formatBriefDate`) appear in the shared narrative haystack
(bluf/exec/outlook/polestar/whatChanged + JSON of key devs/themes/actions).

The old `!incidentDate` loop is KEPT but demoted to a documented builder-invariant
safety net (fires only if that coupling is ever broken).

**Why:** an architect review flagged Check A as illusory — it validated a state
the builder cannot produce, so it gave false confidence while the actual
"old-event-reads-as-new" regression went unchecked.

**How to apply:** any QC check here must be provable to fire on a realistic
dataset. Build a synthetic `topThree[0]` with `occurredOutOfWindow: true` +
`incidentDate` set + a bluf that omits the dates, and assert it warns. Keep the
narrative-format date token in lockstep with `formatBriefDate`.
