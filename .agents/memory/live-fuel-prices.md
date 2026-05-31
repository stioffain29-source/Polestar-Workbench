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
- HORIZON TRAP: the FRED fetch window must reach back to the OLDEST fuel
  report's issue date (with buffer for the prior-week change line + the weekly
  jet trajectory), NOT a fixed recent window — a fixed window silently skips
  older reports and leaves them on stale data. Prices anchor to each report's
  issue date (latest observation ≤ issue date), so re-running is idempotent.
- FRESHNESS GATE TRAP: the scheduler's boot catch-up gate is keyed on the
  incident scrapers' freshness. If incidents are fresh but prices are stale, a
  cold start skips the whole run and prices lag until the next gate trip / warm
  6h timer. Acceptable for weekly commodity reads; add a price-specific gate
  only if per-cold-start price freshness is ever required.
- Never re-introduce an auto-seeded fabricated sample into the preview/PDF. An
  unseeded report shows empty market fields, not fake numbers.
