---
name: Apify paid-run safety
description: How to call any paid Apify actor from ingest without double-charging, and how a paid source must gate its own cadence.
---

# Calling a paid Apify actor from ingest

**Never call `run-sync-get-dataset-items` behind a retrying fetch helper.** These
scrapers routinely outlast a single HTTP timeout, and the retry starts a WHOLE
NEW PAID RUN each attempt while discarding the one already running — three
attempts, three charges, one result. Start the run asynchronously, poll it, then
read its dataset.

**The run-START POST is not idempotent, so it must never be retried.** A
timeout or lost response can mean Apify accepted (and is charging for) a run we
never saw. Retry only what comes after the start (polling, dataset read).

**Anything that goes wrong after the start must abort the run.** Budget
exhausted, polling failed, dataset unreadable — if we stop waiting, the actor
keeps running and spending with nobody reading its output. Aborting an
already-finished run is a harmless no-op, so abort on every post-start error,
not just the wall-clock deadline.

**Pass a per-run ceiling (`maxTotalChargeUsd`) on the start URL.** It caps one
run, not a sequence of them — which is exactly why the retry rule above
matters.

**Token hygiene:** Apify takes the token as a query param, so scrub it out of
every thrown error before it is logged or persisted to Source Health.

# Cadence gating for a paid source

**Why:** a paid pull inside the shared ingest would otherwise run on every
ingest tick (every few hours) and on every cold start.

**How to apply:**

- The collector self-throttles on its own Source Health heartbeat
  (`sources.last_success_at`), which advances on a successful zero-insert run —
  unlike the content tables, which do not.
- The boot scheduler's staleness trigger must key off the SAME heartbeat and
  the SAME interval as that cadence gate. Keying the trigger off newest content
  (e.g. newest incident from that source) means a quiet week looks stale
  forever: every cold start launches the whole ingest chain for a pull the
  collector then skips.
- The "is this source active?" gate must also require at least one enabled
  collection pass. Key-present-but-nothing-enabled yields a source that
  attempts nothing, never records a heartbeat, and so looks permanently stale
  to the scheduler.

# Papua/PNG Facebook collection reality

Every Facebook post that ever produced a promoted incident came from public
**GROUPS** (POM ALERT, PNG NEWS & CURRENT AFFAIRS, Info Kejadian Kota Jayapura,
BERITA KRIMINAL INDONESIA) via the groups scraper. The page and keyword-search
actors never produced a single stored row, so they stay off unless a dedicated
key is configured.

The account's shared Apify token covers this work — no separate Facebook
scraping subscription is needed. `resultsLimit` on the groups actor is applied
PER start URL, so the per-run cost scales with groups x limit.

Group attribution must compare the EXACT `/groups/{handle}` segment derived
from the post's input URL or permalink. A substring test mis-files a post whose
URL happens to contain another group's id.
