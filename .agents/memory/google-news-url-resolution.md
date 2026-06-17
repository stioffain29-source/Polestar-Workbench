---
name: Google News redirect URL resolution
description: Additive resolved_url backfill that turns opaque news.google.com redirects into publisher URLs so the GDELT URL-match can fire
---

Most flashpoint rows come from Google-News RSS, so `incidents.source_url` is an opaque `news.google.com/(rss/)?articles/<id>` redirect, never the publisher URL. GDELT clusters on publisher URLs, so the gdeltEnrich URL-match could never fire against a redirect. Fix: resolve redirects into a NEW nullable `incidents.resolved_url` column (additive; `source_url` left untouched so UI links + dedupe keep working — mirrors the `display_title` pattern), and have every consumer read `resolved_url ?? source_url`. Only consumer today is gdeltEnrich.

Resolver: `lib/ingest/src/googleNewsUrl.ts` — `resolveGoogleNewsUrl(url)` and the converging backfill pass `runResolveGoogleNewsUrls({commit,limit,concurrency})`. Two redirect formats: OLD decodes the base64 segment locally (no network); NEW (current default) is an opaque id needing Google's `batchexecute` exchange = TWO HTTP calls (read `data-n-a-sg`/`data-n-a-ts` from the article page, then POST `Fbv4je`/`garturlreq`, parse `txt.split("\n\n")[1]` → `JSON.parse(row[2])[1]`). Verified working from this env's egress. Every failure returns null and leaves `resolved_url` NULL for retry — non-fatal.

**Scope the backfill to topic='flashpoint'.** First cut was topic-agnostic and it MASKED coverage: the pass reported "committed — resolved 750" but a `topic='flashpoint' AND resolved_url IS NOT NULL` count showed only ~59. The newest rows (the pass orders `created_at DESC`) are dominated by the higher-volume news topics (shipping/energy/conflict), so they ate the bounded run and starved flashpoint — the ONLY topic GDELT reads.
- **Why:** a bounded converging backfill spends its `limit` on whatever the ORDER BY surfaces first; if that's not the consuming topic, the consumer sees ~zero benefit while the log looks successful.
- **How to apply:** scope any consumer-specific backfill's candidate WHERE to the consuming topic, and ALWAYS verify with the consumer's own filter (here: `topic='flashpoint'`), not a global `resolved_url IS NOT NULL` count.

Wiring: pass runs inside `runIngestOnce` after title-translation, before gdeltEnrich (which runs last), in its own try/catch. Barrel-exported from `lib/ingest/src/index.ts`. CLI `scrape:resolve-urls` (`scripts/src/scrape-resolve-urls.ts`), added to the `scrape:prod` chain BEFORE `scrape:gdelt-enrich`. Schema in `lib/db/src/schema/incidents.ts` + idempotent boot `ALTER ... ADD COLUMN IF NOT EXISTS resolved_url` in api-server `migrations.ts` (prod DATABASE_URL is read-only from workspace; drizzle push only hits dev). Lib pass never closes the shared pool — only the CLI wrapper calls `pool.end()`.

Throughput is ~4 rows/sec (2 HTTP calls/row at concurrency 4), so a full backfill of the flashpoint window is ~minutes — run it in bounded chunks, not one giant `--commit`.
