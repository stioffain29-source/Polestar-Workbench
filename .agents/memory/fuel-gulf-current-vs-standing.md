---
name: Fuel Gulf & Hormuz chokepoint current-vs-standing
description: Why the Gulf chokepoint section anchors on issue date and splits current/standing
---
Fuel Watch "Gulf and Hormuz Chokepoint Watch" (`buildFuelGulfChokepointWatch`) is anchored on the report ISSUE DATE (same window as the rest of the report via `reportWindowDefaultDays("fuel")`), NOT the market-close date.

**Rule:** Split matched chokepoint fuel records into a CURRENT set (issue-date report window, extended to market close only if later) and older STANDING context (within ~60d lookback, before current start). Current always leads; standing shown under `standingNote` block. The "no fresh reporting" line is computed ONLY from the current set — emit it only when current is empty.

**Why:** The old code anchored the 60-day lookback on the market-close date and ranked by severity, so an old high-severity May event led and a >14-day gap check fired "no fresh Gulf chokepoint reporting since May" even though current-week (July) Hormuz items existed elsewhere in the same report — a self-contradiction.

**How to apply:** Interface exposes `currentItems/currentItemLines` + `standingItems/standingItemLines/standingNote`. BOTH ReportPreview.tsx and exportTopicReportPdf.ts render current block then (if standingNote) the standing block — keep them in lockstep for screen==PDF parity.

Also: Regional Highlights `COUNTRY_OVERLAY` now has distinct russia/ukraine entries (export/sanctions vs physical-supply framing) so they no longer share the generic `crude` family boilerplate.
