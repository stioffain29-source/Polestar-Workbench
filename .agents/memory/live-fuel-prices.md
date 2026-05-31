---
name: Live fuel-market prices (FRED)
description: Why Fuel report Brent/WTI/jet prices must be a live ingest (not a hardcoded sample), and the freshness/horizon constraints that keep every report covered.
---

Fuel Watch market prices (Brent/WTI/jet fuel) MUST come from the live FRED
ingest, never a hardcoded constant.

**Why:** the original prices were a fixed sample constant that never changed
across republishes; the client saw identical numbers every week and called it
lying. Only the `fuel` family has market-price tiles — the other families are
incident-only, so there was nothing fabricated to replace there.

**How to apply:**
- The price ingest rides inside the shared single-run ingest path (after the
  incident scrapers) in its own try/catch, so the scheduler, the admin route and
  the combined prod scrape all refresh prices and a FRED outage can't fail the
  incident ingest.
- LIVE-vs-FROZEN ANCHOR: the CURRENT report (every fuel report sharing the MAX
  issue date that is ON OR BEFORE today — in prod there is exactly one) anchors to
  TODAY (latest FRED observation), so the live product always shows the latest
  prices, NOT a week-old snapshot tied to its issue date. Older/archived issues
  stay frozen at their own issue date for historical accuracy. The "on or before
  today" qualifier is load-bearing: a future-dated DRAFT (next week's report being
  prepared) must not steal the "current" designation and freeze the live report on
  stale prices — so do NOT key "current" on a global max or on report status. Why: a report dated last week was
  showing last week's prices and the client (rightly) called it stale — the live
  product must track current prices. FRED has a few days' reporting lag, so
  "latest" may legitimately be ~2-4 days old; that is the freshest published, not
  a bug.
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
