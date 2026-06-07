---
name: Feed fetch resilience (Google News throttling)
description: Why all RSS scrapers must use the shared fetchFeed, not rss-parser parseURL, and how Google News throttling manifests in Source Health.
---

# Feed fetch resilience

All ingest scrapers fetch RSS through the shared `fetchFeed()` in `lib/ingest/src/feedFetch.ts`. Never call `parser.parseURL(...)` directly.

**Why:** Source Health showed ~21 Google-News-backed sources (energy/fertiliser/shipping/strikes) Failing with "Request timed out after 20000ms" while flashpoint's feeds stayed healthy. Root cause was NOT the network (and NOT the user's hotel WiFi — Source Health reflects the SERVER fetching feeds, not the browser). It was rss-parser's `parser.parseURL`: a generic/library User-Agent + `Promise.allSettled` bursts of 6-8 concurrent requests → Google News throttled them. Flashpoint already fetched via a custom `fetch` with a browser-ish UA, so it was unaffected.

**The fix (shared fetcher):** real desktop-browser User-Agent, `AbortController` timeout, Node global-`fetch` gzip/br auto-decompress (parseURL doesn't reliably — surfaces as a `\x1F` "Non-whitespace before first tag" XML error), `parser.parseString(body)`, and bounded retry/backoff+jitter. `stagger:true` desyncs feeds in the same concurrency batch. Per-scraper concurrency lowered 8→4 (strikes 6→4) to stop synchronized bursts.

**How to apply:**
- Any new feed-fetching code path MUST import `fetchFeed` from `./feedFetch` and pass `{ stagger: true }` inside a concurrency batch. Adding a `parser.parseURL` call reintroduces the throttling/timeout.
- Retries are deliberately gated to transient errors only (timeout / network / 429 / 5xx via the internal `FeedFetchError.retryable` flag). 4xx and parseString errors fail fast — do NOT make them retryable, or a sustained upstream outage doubles per-feed cost (~20s → ~42s) and can hold the ingest advisory lock for tens of minutes.
- Worst-case fetch time under a full Google outage is bounded but large (concurrency 4 × ~42s/feed per batch). If ingest starts timing out again, tune `attempts`/`timeoutMs`/concurrency or add a per-scraper wall-clock deadline — do not just raise concurrency back up.
