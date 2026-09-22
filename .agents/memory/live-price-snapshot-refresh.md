---
name: Live price snapshot vs report prices
description: Why production prices look stale even when the price refresh logs success, and which path must own the market_prices snapshot.
---

# Two price stores, one of them was orphaned

Fuel prices exist in TWO places and they refresh on DIFFERENT paths:

- per-report `reports.hard_numbers` — written by the report price ingest, which the
  cheap boot/hourly price tick runs. This one stays current.
- the live `market_prices` snapshot table — read by the Fuel/Energy monitors AND used
  to seed the prices of a NEWLY CREATED fuel report.

The snapshot used to be written ONLY at the tail of the long full-ingest chain. Any run
that ends before its last stage (restart, timeout, crash) leaves the snapshot frozen while
the price tick keeps logging a healthy fresh "as of" date for reports. Symptom the owner
sees: a brand-new report is born with week-old crude and a jet price older still, right
after a log line saying prices refreshed today.

**Rule:** anything that seeds user-visible numbers must be refreshed by a SHORT, cheap
path of its own, never only by the tail of a long chain. The daily series (fuel, energy)
refresh on the price tick; the monthly World Bank workbook stays on the full run.

**Why:** a long serial chain is the least reliable place to put a dependency that other
surfaces read; it fails silently and the failure looks like success elsewhere.

**How to apply:** when prices look stale in production, compare `market_prices.updated_at`
against the deployment's "price top-up finished" log line. If the log is fresh and the
table is not, the snapshot writer is orphaned in a chain that did not finish. Creating a
report also refreshes the fuel snapshot when nothing has rewritten it for hours, so a new
issue can never be born on a dead pipeline's numbers.
