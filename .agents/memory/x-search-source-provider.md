---
name: X (Twitter) Recent Search source provider
description: X as a SOURCE PROVIDER ONLY into existing incidents — routing==relevance gate, no new product surface.
---

X (Twitter) recent-search is a **source provider only** — no new page/feed/report/Social Watch surface. `lib/ingest/src/xSearch.ts`, CLI `scrape:x`, manual + dry-run by default, NOT in the scheduler.

- **Router == relevance gate in one.** `routeTopic` walks precedence data-centre → conflict → flashpoint → shipping → cargo_watch and returns the FIRST topic whose relevance rules (`isTopicRelevant`) judge the post relevant. There is no separate relevance pass — if nothing matches, `kind:"none"` and the post is dropped. **Why:** avoids drift between a bespoke router and the maintained relevance engine.
- **No-fabrication skips:** data-centre posts → `data_centre_candidate` HOLD (counted, never inserted — DC registry is a curated facilities table). A post naming no tracked country in its own text → `no-country` skip (never stamped on a guessed centroid). Also skips no-text / no-date / unroutable.
- **Marker + dedupe mirror gdeltPromote:** `analyst_notes = x_search:<postId> | @author | query:<label>`; plus fuzzy same-day text key (`xDedupeKey`, mirrors newsTopic) and source-URL.
- **backfillRelevance MUST NOT exclude `x_search:%`** — X rows are text-classified and are meant to re-score on a `RELEVANCE_RULE_VERSION` bump (deliberately absent from the marker-exclusion list, unlike gdelt_cloud:/tapa_offline:).
- Insert fields: `source="X"`, `confidence="low"`, `sourceUrl=https://x.com/<user>/status/<id>`, `occurredAt`=post created_at, geocode() for location/lat/lng.
