---
name: Option A — static reports dated to their data window
description: How static/import-only reports are bound to the period their data covers, and the parity invariants that keeps consistent.
---

# Option A: static/import-only reports describe one window only

For topics with NO live feed (shipping, cargo, country, fertiliser, energy),
a report must be DATED to the period its data actually covers — never presented as a
current/empty week. The window end = latest available record; ALL incident tables and
prose are bound to that one window.

**FUEL IS THE EXCEPTION — it is a MARKET product, not incident-clamped.** Fuel
Watch's reporting-period END is the latest MARKET-CLOSE date the report carries
(`fuelMarketLatestDate`), NOT its latest incident. Do NOT apply the
incident-clamp (`clampIssueDateToLatestRecord`) to fuel for the rendered period,
and do NOT subject fuel to the incident-vs-issue-date stale-prose guard. See
`live-fuel-prices.md` ("PERIOD = MARKET CLOSE") for the full model and why. The
incident/market date gap is reported as a separate data-status line, never as
the period.

**Why:** the domain expert rejected stale/static data shown under a current-dated cover.
A report that borrows older records to fill a quiet current week is dishonest to the reader.

**How to apply:**
- The issue date is clamped to the latest real record via `clampIssueDateToLatestRecord`
  (`reportWindow.ts`) for the INCIDENT-DRIVEN static topics. Clamp at BOTH the seed AND the
  manual-edit boundary — the Issue Date input enforces `max` + an onChange clamp, or an author
  can re-date forward and reintroduce stale-as-current. Live topics (flashpoint/protests) clamp
  too but it is a no-op because their latest record is ~today. FUEL uses `resolveFuelPeriodEnd`
  / `fuelMarketLatestDate` instead (market close, not incident) at all three boundaries.
- Do NOT keep a rolling 30-day look-back alongside the report window. Shipping previously
  pooled vessel/piracy/chokepoint over a rolling 30 days; that surfaced pre-window incidents.
  Collapsing the pool to the window is correct, but then EVERY "trailing 30 days" / "last 30
  days" / "(30d)" string (prose, KPI labels, section headers, empty-state copy, comments)
  becomes a lie. When you change a window, grep the whole topic's dataset + preview + headless
  exporter + comments for "30 day"/"30d" and the weekly-vs-month comparison language.
- Removing a window also removes the weekly-vs-window contrast prose (e.g. shipping's
  `weeklySegment`); delete its dead plumbing (interface fields, call-site args, upstream
  computations) too, and re-check any "Of these, N records" line that referenced a count from
  the removed window — it can contradict the surviving window's count.
- Country reports: there was a 30/90-day fallback that promoted the window when the data-driven
  window was thin; that fallback is removed so the report stays on its true data window.

## Provenance banner gotcha
The on-screen/in-PDF "Data status / Latest record / Last updated" strip (`DataAsOfBanner.tsx`)
renders uppercase with letter-spacing. In `pdftotext` output it comes out spaced like
`D ATA S TAT U S` — grepping for "DATA STATUS" finds nothing even though it IS present.
Grep the spaced form or visually inspect; do not conclude the banner is missing.
