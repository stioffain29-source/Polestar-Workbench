---
name: KAMMI social-media protest watch
description: Instagram+Telegram social monitoring as additive context (own table, never incidents) with promote-to-incident; where the wiring lives and the invariants.
---

# KAMMI / Indonesia Social Watch

Public KAMMI Pusat Instagram + Telegram protest monitoring. Posts are ADDITIVE
CONTEXT in their own `social_watch_items` table — they NEVER become incidents and
never inflate any incident count. The ONLY path into the incidents table is the
explicit operator promote action.

**Invariants (do not break):**
- Social posts live in their own table; incident counts must be unchanged by the
  social-watch pass. Verified by before/after of `GET /api/incidents?topic=flashpoint`
  across a promote: exactly +1.
- Promote re-derives `isPromotable` server-side (never trusts the client), inserts
  the incident in a transaction setting `promotedIncidentId`/`promotedAt`, returns
  409 if already promoted / not eligible, 404 if missing. Promoted incident is
  topic=flashpoint, country=Indonesia, links back to the source post URL.
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
`KAMMI_INSTAGRAM_HANDLE`(@kammi.pusat); Telegram = FREE public web view
(`t.me/s/<channel>`) via `KAMMI_TELEGRAM_CHANNEL` + `TELEGRAM_ENABLED`,
needs no key. `SOCIAL_WATCH_MAX_ITEMS` per-platform cap.

**Data-source reality:** the confirmed Telegram channel's most recent posts are
from 2016 — the channel is inactive, so the board shows old context. This is NOT
a parse bug (`parseTelegramHtml` + `slice(-maxItems)` correctly takes the NEWEST
posts; t.me/s/ returns oldest-first in HTML order). The channel handle is
env-overridable; Instagram (the primary, paid feed) is the live path.

**Boot freshness gate:** the pass runs inside `runIngestOnce`; the scheduler's
boot catch-up gates on `socialWatchStale` ONLY when a platform is active
(`socialWatchActive()`), scoped to this table — same pattern as the other
context layers (AIS movement, ICC piracy). An empty table while active IS a
trigger (initial population) since the free Telegram view is normally reachable.

**Source Health:** two 7-state entries (`social_watch_instagram`,
`social_watch_telegram`) in `integrationStatus.ts`; health names exported as
`SOCIAL_WATCH_IG_HEALTH_NAME` / `SOCIAL_WATCH_TG_HEALTH_NAME` (topic=flashpoint).

**Board:** Protests.tsx last section "KAMMI / Indonesia Social Watch" — KPIs +
planned/active/other group tables, Promote button (hooks
`useListSocialWatchItems` / `usePromoteSocialWatchItem`). `1B6B7A`=planned,
`A33232`=active, per brand reservations.

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
