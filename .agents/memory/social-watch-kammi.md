---
name: KAMMI Instagram source provider
description: KAMMI is a SOURCE PROVIDER (like X / Instagram-Papua), not a Social Watch board — its posts route into the shared incidents table via the one social-source routing authority; slop is discarded at the router. Documents the marker, config, scheduler gate, telemetry, and the one-authority invariant.
---

# KAMMI Instagram source provider

The owner REVOKED the old "Social Watch" board: *"KAMMI is just another news
source. Scrape, validate, put into relevant feeds; if it's slop it's
discarded."* KAMMI is now a SOURCE PROVIDER exactly like the X and
Instagram-Papua providers — NOT a standalone review queue, context table, page,
or feed.

**Pipeline (`lib/ingest/src/kammiSource.ts`, `runKammiSourceIngest`):** fetch
KAMMI Pusat public Instagram posts via the paid Apify scraper → PII-scrub the
caption (`sanitiseCaption`, BEFORE translate/store) → translate to English
(failure falls back to the sanitised original, which then drops at the relevance
gate rather than being coerced) → content-route + relevance-gate + dedup + insert
into the shared `incidents` table. Slop is discarded at the router; a genuine
protest lands in the relevant feed (Flashpoint / Protests & Civil Unrest).

**ONE routing/dedup authority (do not fork):** kammiSource REUSES
`decideInstagramIncident` + `dedupeAndInsertIgIncidents` from `instagramSource.ts`,
which themselves reuse `routeTopic` + `xDedupeKey` from `xSearch.ts` VERBATIM.
X / Instagram-Papua / KAMMI all share the same routing + dedup + marker code.
Add routing/dedup logic THERE only — never a parallel KAMMI implementation.

**Marker + telemetry:** rows are stamped by `instagramMarker(postId, handle)`
with `author = cfg.instagram.handle` ("kammi.pusat"), so `analyst_notes LIKE
'%@kammi.pusat%'` matches routed KAMMI rows. Source Health counts routed
incidents via `kammiIncidentCounts()` (`db.execute` raw SQL over `incidents`,
NOT any deprecated table). No-fabrication: a post naming no tracked country is
SKIPPED (never centroid-stamped); a data-centre post HOLDs (never committed).

**STALE-HANDLE DRIFT RISK:** the telemetry SQL (`kammiIncidentCounts`) and the
scheduler boot gate hardcode `'%@kammi.pusat%'`, while the monitored handle is
env-overridable (`KAMMI_INSTAGRAM_HANDLE`). If the handle is ever changed via
env, Source Health + the boot gate silently under-count. Derive the LIKE pattern
from config if you touch this.

**Scheduler + boot gate:** `runKammiSourceIngest({commit:true})` runs inside
`runIngestOnce` (ingestRunner.ts) — KAMMI is a scheduled feed, NOT a manual CLI
(this deliberately diverges from X/Instagram-Papua, which are CLI-only;
continuity with the previously-scheduled socialWatch pass + the "scrape,
validate, route" intent). Boot catch-up gates on `kammiSourceActive()`
(`isKammiSourceActive(readKammiSourceConfig())`) + newest-marker-row age — same
pattern as strikes / land topics / AIS movement (see boot-freshness memory). An
empty table while active IS a trigger (initial population).

**Config (all env, graceful no-op when unset):** `KAMMI_ENABLED` (primary
switch; `SOCIAL_WATCH_ENABLED` honoured as a LEGACY alias). Instagram creds:
`INSTAGRAM_API_KEY` (paid Apify, primary) with `APIFY_TOKEN` as an accepted
FALLBACK — used when the primary is unset, and rolled over to on a START-only
401/403 (never post-start; a started run is already paid). `KAMMI_MAX_ITEMS`
(legacy `SOCIAL_WATCH_MAX_ITEMS`), `KAMMI_INSTAGRAM_HANDLE` (@kammi.pusat),
`INSTAGRAM_ENABLED`/`INSTAGRAM_PROVIDER`/`INSTAGRAM_API_BASE`/`INSTAGRAM_ACTOR`.
A valid Apify token starts with `apify_api_`; a malformed primary silently
falls back and masks the config problem — verify prefixes only (never log the
value) from a fresh process.

**Apify fetch is async run-and-poll, NOT run-sync:** a run outlasts the 20s
per-call `FETCH_TIMEOUT_MS`, so START → POLL to terminal → FETCH dataset. Keep
each HTTP call at 20s; the poll loop supplies the longer overall budget. (Shared
with the Instagram provider — do not regress.)

**Source Health:** one 7-state entry, panel key EXACTLY `social_watch_instagram`
(envelope key kept stable for the status contract), label "KAMMI Instagram",
health name `KAMMI_IG_HEALTH_NAME` (topic=flashpoint). States: `disabled`
(KAMMI_ENABLED/INSTAGRAM_ENABLED off) → `not_configured` (no INSTAGRAM_API_KEY /
APIFY_TOKEN) → `failing_upstream` (feed health row = failing) → `dormant`
(newest routed incident > `KAMMI_FRESH_DAYS`=30) → `working` (routed ≥1, fresh) →
`no_data` (configured, nothing routed yet). There is NO "manual-entry mode".

**backfillRelevance:** KAMMI rows carry the `instagram:` marker and are TEXT-
classified, so `backfillRelevance` MUST NOT exclude them — they re-score on a
`RELEVANCE_RULE_VERSION` bump like X/Google/Instagram rows (only `gdelt_cloud:`
and `tapa_offline:` markers are excluded).

**Removed (deprecate-in-place, do not resurrect):** the `social_watch_items`
table is DEPRECATED IN PLACE (idempotent CREATE left in migrations, harmless —
NOT dropped). Deleted entirely: `socialWatch.ts`, `kammiGeography.ts`,
`routes/socialWatch.ts`, `CountrySocialWatchContext.tsx`, the manual-paste
create path, the public promote route, all Social Watch UI in Protests.tsx /
CountryReport.tsx, and the social-watch OpenAPI endpoints (codegen re-run;
generated clients lost only social-watch exports). Do NOT re-add a Social Watch
board, manual-paste create, or a KAMMI context panel without the user asking.

**KEPT (unrelated, still live):** Facebook OSINT + `social_raw` table +
`socialPromote` + `instagramKammi.ts` (the Apify-task import into `social_raw`)
are SEPARATE and untouched.
