---
name: Fuel Gulf & Hormuz chokepoint current-vs-standing
description: Why the Gulf chokepoint section anchors on issue date and splits current/standing
---
Fuel Watch "Gulf and Hormuz Chokepoint Watch" (`buildFuelGulfChokepointWatch`) is anchored on the report ISSUE DATE (same window as the rest of the report via `reportWindowDefaultDays("fuel")`), NOT the market-close date.

**Rule:** Split matched chokepoint fuel records into a CURRENT set (issue-date report window, extended to market close only if later) and older STANDING context (within ~60d lookback, before current start). Current always leads; standing shown under `standingNote` block. The "no fresh reporting" line is computed ONLY from the current set — emit it only when current is empty.

**Why:** The old code anchored the 60-day lookback on the market-close date and ranked by severity, so an old high-severity May event led and a >14-day gap check fired "no fresh Gulf chokepoint reporting since May" even though current-week (July) Hormuz items existed elsewhere in the same report — a self-contradiction.

**How to apply:** Interface exposes `currentItems/currentItemLines` + `standingItems/standingItemLines/standingNote`. BOTH ReportPreview.tsx and exportTopicReportPdf.ts render current block then (if standingNote) the standing block — keep them in lockstep for screen==PDF parity.

**Cross-read parity trap:** genuine Gulf/Hormuz chokepoint events (tanker struck in the strait, crude reroute) are frequently filed by ingestion under `topic=shipping`, not `fuel`, and already surface in the Fuel Watch Producer/Buyer Actions table via the cross-read. The chokepoint watch must therefore admit `shipping`-topic rows too, gated on the SAME `FUEL_ACTION_TOPICAL_RE` fuel-market signal the cross-read uses — otherwise it prints a stale "No fresh reporting" line while July Strait-of-Hormuz items sit in the table on the same page. A pure fuel-topic filter reproduces exactly that contradiction on live data.

Also: Regional Highlights `COUNTRY_OVERLAY` now has distinct russia/ukraine entries (export/sanctions vs physical-supply framing) so they no longer share the generic `crude` family boilerplate.

**Gulf read retired as a standalone paragraph (owner, Aug 2026):** the section's `read` paragraph no longer renders in the Gulf section and its per-panel override (panelReads/panelReadBases/resolvePanelRead — the exact-match staleness binding that went 'Out of date' within days) is deleted. `fuelWatchReport.ts` folds `gulfChokepointWatch.read` into `canonicalSections.operationalRead` (gate-covered there); the Gulf section keeps ONLY the dated anchor bullets (per-bullet overrides unchanged). Do not re-add a separately-editable Gulf read box.
