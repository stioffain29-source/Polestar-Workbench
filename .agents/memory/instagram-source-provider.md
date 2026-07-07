---
name: Instagram (Papua/separatist) source provider
description: Instagram Apify posts as a SOURCE PROVIDER into existing incidents — same gates as Google/X, no OSINT review queue.
---

Instagram (Papua / separatist) is a **source provider only** — the owner PIVOTED away from a separate Instagram OSINT review queue: "this is just another information source, the same gates should apply to it like Google etc." So it mirrors the X source provider and the Google-News feeds, NOT a bespoke surface. `lib/ingest/src/instagramSource.ts`, CLI `scrape:instagram`, manual + dry-run by default, NOT in the scheduler.

- **Reuses X's authority verbatim.** `routeTopic` (relevance engine as router: data-centre → conflict → flashpoint → shipping → cargo_watch) AND `xDedupeKey` are imported from `xSearch.ts`, not re-implemented. **Why:** one routing/dedup taxonomy for every social source so nothing can drift. The relevance engine is the SAME gate Google-News rows pass — Instagram gets no special treatment.
- **Reads an EXISTING Apify dataset/task** (`--datasetId` or `--taskId`); never triggers a new Apify run. Reuses `normaliseInstagramPost` / `resolveApifyTaskOrActorLatestDataset` (instagramKammi.ts) + `fetchApifyDatasetItems` (facebookOsint.ts). Token = `APIFY_TOKEN` || `INSTAGRAM_PAPUA_APIFY_TOKEN`, query-param only, redacted.
- **PII scrub before storage:** captions run through `sanitiseCaption` (socialWatch.ts) to strip phone/email/messaging handles, THEN `cleanText`.
- **No-fabrication skips** (same as X): data-centre → `data_centre_candidate` HOLD (counted, never inserted); a post naming no tracked country in its own text → `no-country` skip; plus no-text / no-date / unroutable.
- **Marker + dedupe:** `analyst_notes = instagram:<postId> | @author`; plus fuzzy same-day text key (`xDedupeKey`) and source-URL. `instagramMarkerPostId()` round-trips the id.
- **backfillRelevance MUST NOT exclude `instagram:%`** — text-classified, re-scores on a `RELEVANCE_RULE_VERSION` bump (only `gdelt_cloud:` / `tapa_offline:` are excluded — lane/marker-vouched).
- Insert fields: `source="Instagram"`, `confidence="low"`, `occurredAt`=post time, `geocode()` for location/lat/lng; `recordSourceHealth(sourceType:"social")` on commit under topic `flashpoint`.
- `--expectHandle=<csv>` pins expected owner accounts (a reused backing actor can resolve an unrelated dataset). Owner-gated UI can't be screenshotted (Replit Auth) → verified via unit tests (`__tests__/ingest/instagramSource.test.ts`), not live screenshots.
