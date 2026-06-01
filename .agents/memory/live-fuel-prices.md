---
name: Live fuel-market prices (Yahoo crude + FRED jet)
description: Why Fuel report Brent/WTI/jet prices must be a live ingest (not a hardcoded sample), which source feeds each card, and the freshness/horizon constraints that keep every report covered.
---

Fuel Watch market prices (Brent/WTI/jet fuel) MUST come from a live ingest,
never a hardcoded constant.

**Source per card (load-bearing):** Brent/WTI come from Yahoo Finance front-month
futures (BZ=F / CL=F) PRIMARY, with FRED EIA spot (DCOILBRENTEU/DCOILWTICO) as an
automatic fallback if Yahoo fails — crude must never go empty. Jet fuel stays on
FRED's EIA Gulf Coast kerosene series (DJFUELUSGULF) with no substitute.
**Why:** FRED's EIA SPOT series publish with a multi-business-day lag, so a
FRED-only crude card genuinely missed real price moves (e.g. Brent ~99.6→92.05
over 27-29 May) and the client correctly called it stale; Yahoo futures carry the
most recent daily CLOSE (incl. the Friday close). There is no honest daily
jet-fuel future, so jet legitimately tracks its own slower FRED cadence — do NOT
fabricate a jet proxy to make the dates match; a jet asOf older than crude asOf is
expected and truthful. Each series carries its own `source` string so the price-card
attribution always names the source that actually served the data.

**Why:** the original prices were a fixed sample constant that never changed
across republishes; the client saw identical numbers every week and called it
lying. Only the `fuel` family has market-price tiles — the other families are
incident-only, so there was nothing fabricated to replace there.

**How to apply:**
- The price ingest rides inside the shared single-run ingest path (after the
  incident scrapers) in its own try/catch, so the scheduler, the admin route and
  the combined prod scrape all refresh prices and a FRED outage can't fail the
  incident ingest.
- WINDOW-END ANCHOR (supersedes the earlier "newest report tracks today" rule):
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
