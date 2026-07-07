---
name: KAMMI social-media protest watch
description: Instagram+Telegram social monitoring as additive context (own table, never incidents) with promote-to-incident; where the wiring lives and the invariants. Telegram is manual-entry-only (scraper retired). Analyst manual-paste create path.
---

# KAMMI / Indonesia Social Watch

Public KAMMI Pusat Instagram/Telegram protest monitoring. Posts are ADDITIVE
CONTEXT in their own `social_watch_items` table — they NEVER become incidents and
never inflate any incident count. The ONLY path into the incidents table is the
explicit operator promote action.

**Manual-paste create path (`POST /api/social-watch`, `createSocialWatchItem`):**
analysts add Instagram/Telegram posts BY HAND — no scraping, no API keys. Body =
`platform`(instagram|telegram)/`url`/`caption` required; optional
`actor`/`channel`/`postedAt`/`imageUrls`/`status`/`confidence`. Server RE-DERIVES
status/`promotable`/location/issue/`eventDateTime`/`alertReasons`/`dedupKey`
(client-supplied `promotable` is NOT an accepted field → stripped by zod;
eligibility is text/status-derived). Sets `sourceName="social_watch"`,
`country="Indonesia"`, `topic="flashpoint"`, `classification="context"`,
`externalId="manual_<platform>_<hash>"`. `onConflictDoNothing` then re-select by
dedupKey → 200 on dedupe / 201 created / 400 bad shape. TOKEN-GATED
(`requireAdminToken`) — the create write follows the admin-write posture, NOT the
public promote posture. UI: `AddWatchItemForm` in Protests.tsx SocialWatchPanel
invalidates `getListSocialWatchItemsQueryKey()` on success.

**Telegram = manual-entry-only (scraper stays retired):** the KAMMI Telegram
channel was dead (last active 2016) so the SCRAPER was removed permanently
(`parseTelegramHtml` gone, no `social_watch_telegram` Source Health entry, no
scheduler check). But the `platform` enum was RE-WIDENED to `[instagram,
telegram]` so analysts can manually paste Telegram posts. The old marker-gated
delete migration (`delete_telegram_social_watch_v1`) was REMOVED so manually-added
Telegram rows survive redeploys. Do NOT re-add a Telegram scraper without the
user asking.

**Source Health with no scraper credential = `working` (manual-entry mode), NOT
`not_configured`:** when no paid Instagram scraper credential is set, the panel
reports `working` because analyst manual-entry is a fully functional mode. Panel
counts BOTH platforms (`socialWatchPlatformCounts("all")`). Metric "Mode" =
"Scraper + manual" (configured) / "Manual entry" (not).

**Invariants (do not break):**
- Social posts live in their own table; incident counts must be unchanged by the
  social-watch pass. Verified by before/after of `GET /api/incidents?topic=flashpoint`
  across a promote: exactly +1.
- Promote re-derives `isPromotable` server-side (never trusts the client), inserts
  the incident in a transaction setting `promotedIncidentId`/`promotedAt`, returns
  409 if already promoted / not eligible, 404 if missing. Promoted incident is
  topic=flashpoint, links back to the source post URL. Its `country`/`province` are
  GEOGRAPHY-RESOLVED (see below), NOT hard-coded Indonesia — a West-Papua post
  becomes a `country="West Papua"` incident so it lands in the Papua report.
- Promote follows the PUBLIC incidents-POST auth posture (no token) — consistent
  with the user's "workbench is public" decision. Only admin/ingest + sources
  mutations stay token-gated.

**Config (all env, graceful no-op when unset):** `SOCIAL_WATCH_ENABLED`,
Instagram = `INSTAGRAM_API_KEY` (paid Apify scraper, primary) with `APIFY_TOKEN`
as an accepted FALLBACK credential — used when `INSTAGRAM_API_KEY` is unset, and
tried automatically when the primary key is REJECTED with an auth error (HTTP
401/403, e.g. a stale/wrong key in `INSTAGRAM_API_KEY`). The fallback advances
to the next token ONLY on 401/403 — that starts no Apify run, so it costs no
extra paid run; non-auth errors (5xx/429/network/timeout) do NOT advance. For
this to be prompt, `fetchJson` must fail fast on non-transient 4xx (it used to
retry every error 3× with backoff — fixed). Plus
`INSTAGRAM_PROVIDER`(apify)/`INSTAGRAM_ENABLED`/`INSTAGRAM_API_BASE`/`INSTAGRAM_ACTOR`/
`KAMMI_INSTAGRAM_HANDLE`(@kammi.pusat). `SOCIAL_WATCH_MAX_ITEMS` per-platform cap.

**Apify fetch is ASYNC run-and-poll, NOT run-sync (why):** an actor run takes
longer than the shared 20s `FETCH_TIMEOUT_MS`, so the old
`run-sync-get-dataset-items` call ALWAYS timed out and no posts ever landed. The
run is now STARTed, POLLed to a terminal state, then its dataset FETCHed. Rules
that must not regress:
- Each individual HTTP call keeps the 20s per-call `FETCH_TIMEOUT_MS` — do NOT
  raise that shared constant. The POLL LOOP is what supplies the longer overall
  budget (`INSTAGRAM_RUN_MAX_WAIT_MS` default 180000, cadence
  `INSTAGRAM_RUN_POLL_MS` default 5000). Budget exhausted → best-effort abort
  (never throws) + a "timed out" error captured per-feed.
- **Token fallback is START-ONLY.** Only a 401/403 on the run-START (no run
  created, zero spend) may advance to the next candidate token. This is enforced
  by a dedicated `ApifyStartAuthError` type thrown ONLY from the START call; the
  fallback loop rolls over on that type, never on a bare `isApifyAuthError`.
  **Why:** once a run has started it is already paid for, so a post-start 401/403
  (while polling or fetching the dataset) must surface as-is — rolling over would
  start a SECOND paid run. Never widen the fallback back to any auth error.

**Data-source reality:** Instagram (the primary, paid Apify feed) is the live
path — it needs a real `apify_api_` token. Without one, the feed no-ops cleanly.

**Credential-hygiene tell:** a valid Apify token starts with `apify_api_`. A
primary `INSTAGRAM_API_KEY` whose value does NOT start with that prefix is
malformed — every pull then auth-fails on it and silently falls back to
`APIFY_TOKEN`, burning a pointless failed sign-in and masking the config problem
(if the fallback is ever removed, the feed breaks with no obvious cause). Fix by
REMOVING the bad primary secret (in the Secrets pane — the agent can't delete a
user-supplied secret) so the deduped candidate list collapses to the single valid
`APIFY_TOKEN`. Verify prefixes only (never log the value) from a FRESH process.

**Boot freshness gate:** the pass runs inside `runIngestOnce`; the scheduler's
boot catch-up gates on `socialWatchStale` ONLY when Instagram is active
(`socialWatchActive()` → `igActive()`), scoped to this table — same pattern as
the other context layers (AIS movement, ICC piracy). An empty table while active
IS a trigger (initial population).

**Source Health:** one 7-state entry (`social_watch_instagram`) in
`integrationStatus.ts`; health name exported as `SOCIAL_WATCH_IG_HEALTH_NAME`
(topic=flashpoint).

**Board:** Protests.tsx last section "KAMMI / Indonesia Social Watch" — KPIs +
planned/active/other group tables, Promote button (hooks
`useListSocialWatchItems` / `usePromoteSocialWatchItem`). `1B6B7A`=planned,
`A33232`=active, per brand reservations.

**Country-report context panel + shared geography resolver:** KAMMI posts also
surface as read-only, SCREEN-ONLY context on the geographic country report
(`CountrySocialWatchContext.tsx`, heading EXACTLY "KAMMI protest monitoring
context", wired into `CountryReport.tsx` after `CountryReportVisuals`, passed
`structuredTheatre`). Renders nothing where no post matches (PNG/other/generic/
null = empty). Both the panel AND the promote route decide geography through ONE
pure resolver `lib/ingest/src/kammiGeography.ts`
(`@workspace/ingest/kammiGeography`): `resolveKammiTheatre(item)` →
westPapua|jakarta|indonesia + countryTag, precedence **West Papua BEFORE Jakarta**
(city defaults to "Jakarta" on every row, so a real WP post would otherwise be
swallowed), PNG-guarded; Jakarta via `isJakartaScoped` over caption/province/
location (NOT the defaulted city). `kammiItemInReportTheatre` gates the panel:
Papua report=WP posts, Jakarta brief=Jakarta posts, Indonesia national=everything
EXCEPT WP. Add geography logic THERE only or the panel and the promoted incident
will disagree about where a post belongs. Still context-only + manual-promote-only.

**Privacy:** captions sanitised; no phone numbers / personal accounts / WhatsApp
/ member data stored (`sanitiseCaption`).

**Apify-task import (one-off / re-runnable):** an Apify *task* ("Polestar
Instagram KAMMI Watch") can be imported via `import:apify-instagram`
(`--taskId|--datasetId`, `--limit`, `--commit`; dry-run default). The named task
has ZERO task-runs (the backing actor was run directly), so
`resolveApifyTaskOrActorLatestDataset` must FALL BACK from the task's last run to
the **backing actor's** last SUCCEEDED run's dataset. Strictly GET-only metadata
+ dataset reads — it must NEVER POST/run-sync (no new paid run); token in the
query-param only, redacted from errors.
- Rows land in the `social_raw` table (NOT `social_watch_items`) tagged
  `source_name=instagram_kammi`, `platform=instagram`, `country=Indonesia`,
  `classification=context`, `credible=false`, `promotable=false`. They are DB-only
  by design: `routes/socialRaw.ts` hard-filters its review queue to
  `source_name="facebook_osint"`, so KAMMI rows are queryable but not surfaced
  there unless a dedicated UI is requested.
- **Handle guard (actor-fallback safety):** the importer defaults to keeping only
  `ownerUsername==="kammi.pusat"` (override `--expectHandle`, disable
  `--any-handle`) so if that backing actor is ever reused for a different IG
  target the resolved dataset can't be mis-filed as KAMMI/Indonesia. Idempotent:
  re-running an unchanged dataset inserts 0 (dedup on `dedup_key`+`external_id`).
