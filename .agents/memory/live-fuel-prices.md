---
name: Live fuel-market prices (Yahoo crude + FRED jet)
description: Why Fuel report Brent/WTI/jet prices must be a live ingest (not a hardcoded sample), which source feeds each card, and the freshness/horizon constraints that keep every report covered.
---

Fuel Watch market prices (Brent/WTI/jet fuel) MUST come from a live ingest,
never a hardcoded constant.

**Source per card (load-bearing):** Brent/WTI come from Yahoo Finance front-month
futures (BZ=F / CL=F) PRIMARY, with FRED EIA spot (DCOILBRENTEU/DCOILWTICO) as an
automatic fallback if Yahoo fails — crude must never go empty. JET is now a
labelled PROXY: Yahoo HO=F (NY Harbor ULSD / heating-oil front-month, the closest
liquid DAILY distillate future to jet kerosene) PRIMARY, with FRED DJFUELUSGULF
(weekly Gulf Coast jet) as fallback so the card never goes empty. The benchmark
string is hardcoded "NY Harbor ULSD (heating oil) - jet fuel proxy" regardless of
which source served it, so the card is honestly labelled a proxy, not real jet.
**Why:** FRED's EIA SPOT series publish with a multi-business-day lag, so a
FRED-only crude card genuinely missed real price moves (e.g. Brent ~99.6→92.05
over 27-29 May) and the client correctly called it stale; Yahoo futures carry the
most recent daily CLOSE (incl. the Friday close). The OLD rule ("jet stays on
weekly DJFUELUSGULF, a jet asOf older than crude is expected/truthful, do NOT
proxy") was REVERSED by user demand: a jet card frozen ~a week behind daily
Brent/WTI read as broken/stale to the client ("stuck on 1st June"). HO=F is a
daily distillate future that tracks jet direction day-to-day, so the labelled
proxy keeps the jet date in step with crude. Each series carries its own `source`
string so the attribution always names the source that actually served the data.

**Why:** the original prices were a fixed sample constant that never changed
across republishes; the client saw identical numbers every week and called it
lying. Only the `fuel` family has market-price tiles — the other families are
incident-only, so there was nothing fabricated to replace there.

**How to apply:**
- The price ingest rides inside the shared single-run ingest path (after the
  incident scrapers) in its own try/catch, so the scheduler, the admin route and
  the combined prod scrape all refresh prices and a FRED outage can't fail the
  incident ingest.
- PERIOD = MARKET CLOSE (supersedes BOTH "newest report tracks today" AND the
  later "anchor prices to the incident-clamped issue date"). Fuel Watch is a
  MARKET product: the reporting-period END is the latest MARKET-CLOSE date the
  report carries (`fuelMarketLatestDate(hardNumbers)` = max of price asOf, jet
  snapshot asOf, jet trajectory point dates), NOT the latest incident. The
  workbench DERIVES the render period from the market close.
- LIVE-REPORT FORWARD ROLL (current rule; INTENTIONALLY reverses the old "anchor
  every report to its issue date / do NOT special-case the newest" guidance
  below). The newest fuel report (max issueDate, tie-break highest serial id) is
  the LIVE TRACKER: its `anchorDate` rolls FORWARD to the latest available CRUDE
  close (`latestCrudeClose` = max date across Brent+WTI points) whenever that is
  newer than its issue date — never backward. OLDER reports still anchor to their
  own issue date (frozen historical as-of snapshots). **Why:** with the strict
  issue-date anchor, the single prod fuel report (issue_date 2026-05-31) was
  permanently pinned to the 29 May close even though Yahoo/FRED ran to June; the
  client treats the one fuel report as a live tracker and (by their own words,
  "when the market closes that should be the last date") wants the LATEST close.
  This does NOT re-create the old period/price MISMATCH the warning below guards
  against, because the render period is derived from the SAME hardNumbers — Fast
  Facts, MARKET READ prose (`buildFuelMarketRead`, computed from the cards at
  render), jet trajectory and cover/period all move together. Issue_date is NOT
  mutated; only the anchor used for the price build advances.
  Cover date, REPORTING PERIOD label, Fast Facts asOf, jet chart latest, and the
  incident window ALL flow from this one date (`renderIssueDate` in
  ReportPreview.tsx + exportTopicReportPdf.ts; `resolveFuelPeriodEnd` in the
  editor's issue-date clamp/onChange/max), so they cannot disagree. The
  incident-vs-issue-date STALE-PROSE guard (`computeStale`) MUST exempt fuel, or
  it fires on every fuel report (period routinely earlier than newest incident)
  and falsely reseeds prose. Incident/market gaps (either direction — markets
  close Fri, incidents arrive over the weekend; or dev's stale market trails
  incidents) are EXPECTED and reported as TWO data-status lines (`Market data:`
  vs `Incident records:` via `marketAsOf`), never folded into the period. Fall
  back to the incident clamp ONLY for a fresh draft with no dated market data.
- CRUDE WINS THE PERIOD END; JET LAG IS LABELLED, NOT CLAMPED. When crude
  (Yahoo, daily) is fresher than jet (FRED, lagged) — e.g. crude 29 May, jet
  26 May — the user decided the period END = the LATEST CRUDE close (29 May).
  Do NOT clamp crude DOWN to the jet date to force full alignment: that
  re-shows an older crude value and re-triggers the "stale crude / you are
  lying" complaint (the two demands "crude must be freshest" and "all dates
  must match" are mathematically incompatible while jet lags, so the user
  chose freshest-crude). Instead the canonical builder emits
  `marketData.jetDataNote` (set ONLY when jetLatest < periodEnd) explaining the
  in-period gap; it renders under the Jet Fuel Trajectory in BOTH the preview
  and the PDF builder. Each card still shows its own asOf, so 29-May crude and
  26-May jet on the same page read as labelled per-series dates, not a
  contradiction. **Why:** asked which wins, the user said "29th is when the
  market closes that should be the last date."
  **Why (superseded rule kept for context):** the now-removed clamp anchored
  the period to the latest INCIDENT, so a report whose prices ran to 26 May
  showed a 23-May cover/period — the client flagged "23 May period with 26 May
  market data." A market product's horizon is the market close, not the incident.
- (HISTORICAL, superseded by the above) WINDOW-END ANCHOR rule:
  EVERY fuel report (including the newest) anchors its prices to the END OF ITS
  REPORTING WINDOW = its issue date clamped DOWN to the latest available fuel
  record (max occurredAt where topic='fuel'), mirroring
  clampIssueDateToLatestRecord in the workbench. So the Brent/WTI/jet "as of"
  dates and the weekly jet trajectory always fall INSIDE the period the report
  displays; a report is an AS-OF document, never a live ticker. Why: the prior
  rule anchored the newest report to TODAY, which pushed the price "as of" dates
  (and a jet trajectory point) PAST the report's stated reporting period (e.g. a
  17-23 May Fuel Watch showed Brent/WTI "as of 31 May" and a 26 May jet point) —
  the client flagged the date mismatch. The window end, not today, is the only
  date that keeps prices consistent with the rest of the report (cover period,
  data-status banner, incident window). Do NOT special-case the newest report or
  key anything on report status. FRED/Yahoo lag means the anchored close may be a
  couple of days before the window end (latest observation ≤ anchor); that is the
  freshest published on or before the window end, not a bug.
- PRICE REFRESH IS UNGATED ON BOOT: prices are cheap (a few small FRED CSVs,
  ~0.1-0.6s) so the scheduler boot ALWAYS refreshes them when incidents are fresh
  (not only when missing). The expensive INCIDENT scrape keeps its 6h freshness
  gate. This guarantees every cold start shows the latest prices and removes the
  whole class of "prices are stale" complaints.
- HORIZON TRAP: the FRED fetch window must reach back to the OLDEST fuel
  report's issue date (with buffer for the prior-week change line + the weekly
  jet trajectory), NOT a fixed recent window — a fixed window silently skips
  older reports and leaves them on stale data. Re-running is idempotent (each
  report deterministically re-derives the same values from its anchor date).
- FRESHNESS GATE TRAP (FIXED): the scheduler's boot catch-up gate is keyed on
  the incident scrapers' freshness. The trap: FRED is flaky, so a boot whose
  incident scrape succeeded but whose price fetch failed left prices empty, and
  because every later cold start saw "incidents fresh" it skipped the run, so
  FRED was never retried and prices stayed NULL forever (this shipped empty
  Brent/WTI/jet to prod). FIX (superseding the earlier "only-if-missing" gate):
  the boot now ALWAYS refreshes prices when incidents are fresh (see "PRICE
  REFRESH IS UNGATED ON BOOT" above), and the FRED fetch retries with backoff so
  a single transient INTERNAL_ERROR no longer zeroes the run. Reaches prod only
  after a republish.
- Never re-introduce an auto-seeded fabricated sample into the preview/PDF. An
  unseeded report shows empty market fields, not fake numbers.
- PROD-REFRESH TRAP (cost me a turn): a code-only change to the price/jet source
  does NOT refresh existing prod fuel reports just by republishing. The
  freshness-gated boot catch-up SKIPS the full ingest when incidents are fresh,
  and the every-boot priceTick only fires on a COLD start — so a warm autoscale
  process keeps serving the OLD jet entry (whole hardNumbers is REPLACED per run,
  so you see exactly the last successful run's code: old benchmark label = old
  code ran last). The deterministic lever is `INGEST_FORCE_VERSION` in
  `artifacts/api-server/src/lib/ingestScheduler.ts` — bump it so the next boot
  forces ONE full ingest (marker-gated in app_migration_markers, once per env per
  version). Symptom that pins this: Brent/WTI move to today but jet is frozen days
  behind with the OLD source/benchmark string. Confirm via prod replica:
  `SELECT key FROM app_migration_markers WHERE key LIKE 'ingest_force%'` (is the
  current version already applied?) and the fuel report's
  `hard_numbers->'fastFacts'->'prices'` jet benchmark label.
