---
name: GDELT flashpoint enrichment
description: How the additive GDELT enrichment layer matches/writes, and why its match rate is structurally low
---

GDELT is an ADDITIVE precision layer over EXISTING flashpoint rows (never a feed/replacement). It attaches sub-national lat/long, fatalities, named actors, event/sub-event coding, AI confidence. Engine: `lib/ingest/src/gdeltEnrich.ts` (`runGdeltEnrich`), runs inside `runIngestOnce` after corroboration, cadence-gated (max `gdeltEnrichedAt`, weekly), hard QU cap (`GDELT_ENRICH_MAX_CALLS`, default 10) + 429 backoff. Endpoint `/api/v1/conflict-events?disorder_type=Demonstrations&country=<iso3>`.

**Payload reality (gdeltcloud.com conflict-events):** envelope `{success,events,filters,metadata}`. Each event's REAL clustered news headlines/URLs live in `source_titles[]` / `source_urls[]` — NOT just the reworded `display_title`/`cluster_label`. Our rows come from Google-News RSS, so matching incident.title against ALL title variants (display_title + cluster_label + source_titles) is far higher recall than display_title alone. A normalised `source_urls[]` ↔ incident.source_url equality is a definitive match, but most of our rows store opaque `news.google.com/rss/...` redirect URLs (not the resolved publisher URL), so URL matching rarely fires — recall leans on title Jaccard (≥0.5).

**Match rate is structurally LOW, not a bug.** GDELT's APAC Demonstrations coverage is sparse and UNEVEN: Japan and Malaysia (our two highest-volume countries) returned ZERO Demonstrations events; India/Indonesia/Philippines had rich data. A budget-capped run picks countries stalest-first, so a tiny cap can burn the whole budget on GDELT coverage gaps. When validating, use a full cap (10) so it reaches covered countries. Expect single-digit matches per run — the value is precision where GDELT covers, falling back gracefully everywhere else.

**Severity:** floors via `severityFromFatalities` (fatalities≥1 → extreme) through `maxSeverity`, so a GDELT-derived Extreme can't be reverted by re-rating. Peaceful protests (fatalities 0) never raise severity — Extreme stays reserved for fatal/casualty.

**Drizzle gotcha (cost 1 failed commit):** `sql\`${col} = ANY(${[...ids]})\`` throws Postgres `make_scalar_array_op` (parse_oper.c) — the array param isn't typed. Use `inArray(col, [...ids])` for id-set updates instead.
