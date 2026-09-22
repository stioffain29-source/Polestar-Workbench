---
name: Publication gates that block whole reports
description: Why Workbench report builds and exports hard-fail on content that is factually correct, and where each gate's blind spot is.
---

Publication validation is fail-closed across Workbench reports: a failed check stops the
build or the export rather than shipping unverified text. Two gates fail on correct content.

## Forward-watch observance rule (regional weeklies)

The 7 Day Watch is COLLECTED, not written, so its rule runs before any analysis spend and
throws — the writer cannot repair it. If more than half the forward items are holidays the
whole report fails and nothing is saved.

**Why:** a watch list made of public holidays is not a product, and re-asking a model cannot
invent forward events that the calendar does not contain.

**Blind spot:** a region's real 7-day calendar can be legitimately holiday-led (late-September
Middle East: Saudi National Day, Yemen's Revolution Day, Sukkot). Then a correct collection
kills the entire report. Diagnose from `regional_report_jobs.error`, then compare against the
`watchItems` of the last report that completed before the rule landed — identical items that
previously published prove the calendar, not the collector, is what changed.

**How to apply:** when a collection-stage rule can fail on true data, decide whether it should
fail the build or degrade the section; failing the build must be reserved for output that
would be wrong, not merely thin.

## Fuel percentage tracing

The fuel consistency gate builds its known-percentage list ONLY from calculated indicator
changes (per-indicator 7d change plus average crude). Any percentage in a sentence that also
mentions brent/wti/jet/crude must match one of those within 0.15pp or the export blocks.

**Why:** it exists to stop invented market numbers.

**Blind spot:** a percentage quoted by a source (tariff, run rate, volume change) is
untraceable to the price feed and reads as fabricated.

## Cross-section repetition

`auditFinalReportSectionRepetition` compares display-ready text across sections; exact matches
always fail. Auto-built sections that both lead with the same event sentence (e.g. Situation
and What Happened seeded from one incident) collide by construction, not by model error.
