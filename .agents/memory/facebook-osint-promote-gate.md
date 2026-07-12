---
name: Facebook OSINT promote gate
description: Invariants for promoting a social_raw (Papua/PNG Facebook OSINT) post into an incident — isolation, server-side re-derive, atomic claim, dual-window dedup, URL sanitisation.
---

Facebook/Instagram OSINT posts land in the isolated `social_raw` table; raw rows
are CONTEXT and no incident-counting surface (dashboard, topic monitors, reports)
reads that table directly. Rows reach `incidents` through a gated PROMOTE that
re-derives eligibility server-side — via TWO paths sharing the SAME gate:
(1) an AUTOMATIC DB→DB pass `runSocialPromote` (`lib/ingest/src/socialPromote.ts`)
that the Apify scrapers run after each persist so eligible posts flow into the
incident feeds UNATTENDED (mirrors gdeltPromote/tapaPromote; idempotent via an
`analyst_notes=social_raw:<id>` marker + the `promoted_incident_id` back-link),
and (2) the explicit human-in-the-loop promote route. **The owner REVERSED the
earlier "never an incident / manual-only" rule** ("social media scrapes are to
go directly into relevant feeds") — do NOT re-isolate this layer. The manual
route + social_raw UI/tables were deliberately left functionally untouched.
**Why NOT excluded from `backfillRelevance`** (unlike gdelt/tapa markers): social
rows are relevance-scored by the text engine on their OWN text at promote time
and stamped with `RELEVANCE_RULE_VERSION`, so a version-bump re-score is
semantically consistent — only structured-lane-derived rows need the skip.

**Server re-derives eligibility — never trust the client / stored flags.**
The promote route recomputes `deriveEligibility` from the STORED row
(category + sourceTier + detectedCredibleDomains + corroborated). The
`promotable/securityRelevant/credible` columns drive only the UI button; the
server gate is independent. Promotable = security-relevant category (≠ "Other
security") AND credible (official|local_media tier, OR a detected credible
domain, OR cross-feed corroboration). Category→topic: armed/violent-crime →
conflict, the rest → flashpoint.

**Promote is atomic (race fix).** Inside one `db.transaction`: insert the
incident, then a CONDITIONAL claim `UPDATE social_raw SET promoted_incident_id=?
WHERE id=? AND promoted_incident_id IS NULL ... RETURNING`; 0 rows → throw
`AlreadyPromotedError` → caught → 409, and the incident insert rolls back with
the transaction. Postgres serialises the conflicting row update, so two
concurrent promotes of the same item yield exactly one 201 + one 409 + one
incident. **Why:** a pre-check-then-insert without the in-transaction claim has
a TOCTOU window that double-counts.

**Dedup candidate window must OR both date columns.** `pickDuplicate` /
corroboration scorers key off `incidentDate ?? occurredAt`, so the candidate
gather must OR an occurredAt-window WITH an incidentDate-window — in BOTH the
route (`socialRaw.ts`) and the engine `findCorroboration`. Gathering only by
occurredAt lets a genuine duplicate (in-window by incidentDate) slip past.

**Every persisted URL goes through `sanitiseUrl()`** (exported from
`facebookOsint.ts` + barrel): strips query+fragment, http(s)-only, trims
trailing slash, else "". Applied in `normaliseFacebookPost` to `url` (also
drives `externalId`), `imageUrls`, `outboundLinks` — so `rawPayload.url` is
clean and no token-bearing / signed (`oh=`/`oe=`/`fbclid`) URL is stored.

**Two distinct, separately-keyed feeders share ONE persist seam.** The LIVE
scheduled ingest is keyed by `FACEBOOK_API_KEY`; a SEPARATE MANUAL importer
(`scripts import:apify-facebook (--datasetId X | --taskId Y) [--broad] [--commit]`)
is keyed by `APIFY_TOKEN`. Both normalise into `RawFacebookPost` and call the
SHARED `persistFacebookPosts(posts, {commit, mode})`, so dedup/insert behave
identically regardless of source. Do NOT conflate the two env vars. Apify
dataset items use aliases the normaliser must keep: `permalink`/`url`→url,
`groupUrl`/`facebookUrl`/`inputUrl`→pageUrl, `time`/`createdAt`→postedAt,
`groupTitle`→pageName, `likesCount`/`commentsCount`/`sharesCount`→engagement,
`attachments[].thumbnail`/`photo_image.uri`→imageUrls. NEVER store `user` /
`topComments` (commenter identities).
**Why:** the importer was added to backfill from Apify runs without standing up
a live key; one persist seam guarantees a manual import can never behave
differently (e.g. skip the isolation/dedup invariants) from the live feed.

**Daily automation — the scheduled path BOTH collects AND promotes.**
`runFacebookOsintIngest({commit:true})` runs inside `runIngestOnce`
(ingestRunner.ts) and `runSocialPromote({commit:true})` runs RIGHT AFTER it in
the same runner, so the daily scheduler is the unattended collect→promote path
(`import:apify-facebook` / `promote:social` are the manual CLI equivalents).
`runSocialPromote` is a FREE DB→DB pass (0 external calls, idempotent), so it
runs on EVERY full ingest and is NOT gated on the FB cadence — it drains any
eligible backlog (incl. manually-imported rows) each run; a quiet DB yields
`new=0`. It lives in its OWN try in the runner so a promote failure can never
fail the wider ingest.
**Why:** promotion must be free and prompt (drain backlog every tick) while the
paid collection must self-throttle — different clocks for different costs.

**Cadence gate throttles the PAID Apify fetch (not the free promote).** When
active + committing, `runFacebookOsintIngest` skips the fetch if the last
SUCCESSFUL pull was within `FACEBOOK_OSINT_INTERVAL_HOURS` (default 24). The
clock is the Source-Health HEARTBEAT (`MAX(sources.last_success_at)` for the FB
row via `lastSuccessfulFacebookRunAt()`), NOT `social_raw`'s timestamps —
`social_raw` uses `onConflictDoNothing`, so an all-duplicate 0-insert run leaves
its timestamps unchanged and keying off them would re-spend the paid call every
boot for a quiet page. `recordSourceHealth` stamps `last_success_at` ONLY on a
successful fetch (`f.ok`), so a failed run leaves the heartbeat untouched and the
next boot retries rather than waiting out the interval. A cadence skip sets
`summary.reason="cadence"`, fills `totalAfter`/`latestPostedAt` from
`tableStats()`, and returns WITHOUT `recordSourceHealth` (no heartbeat bump).
`FacebookOsintSummary.reason` ∈ `disabled|no-api-key|cadence|ok`. The scheduler
boot gate mirrors this: `socialRawStale` is active-only and keys off the SAME
heartbeat + `facebookOsintIntervalHours()` (log field `facebookRunAgeHours`);
never-run-while-active is a trigger. **Why:** the paid feed must self-throttle to
~1×/day even though the enclosing ingest ticks every 12h; the free promote must
not be throttled so it can drain backlog promptly.

**Two classification SCOPES via the `mode` option (default "scoped").**
"scoped" = `classifyPost` keeps ONLY in-theatre (PNG / Indonesian-Papua) posts —
the live engine ALWAYS uses this. "broad" (`--broad`, importer only) =
`classifyPostBroad` additionally keeps out-of-scope posts as multi-country
CONTEXT: country "Unknown", category "Other security", `businessImpact` null,
`securityRelevant`/`inScope` false. Broad rows are STRUCTURALLY non-promotable
(deriveEligibility needs a real security category) so the isolation invariant
holds even with a wide raw feed. `FbClassification.inScope` carries this; persist
counts `result.inScope` as the genuinely-in-theatre subset only. Both classifiers
still text-gate (empty sanitised caption → dropped), so media-only posts never
land. **Why:** the owner wanted EVERY group's text posts archived as context,
not just the two theatres — broad mode does that without ever risking promotion.

**`--taskId` resolves a task's latest SUCCEEDED run dataset** via
`resolveApifyTaskLatestDataset` (GET `/v2/actor-tasks/{id}/runs?status=SUCCEEDED&desc=1&limit=1`
→ `data.items[0].defaultDatasetId`); returns null when the task has no successful
run. NOTE: an actor run started directly (not through the task) has `taskId=None`
and does NOT appear under that task's runs — those must be imported by their
`--datasetId`. Triggering a fresh PAID task run (POST `/v2/actor-tasks/{id}/runs`)
can 402 `not-enough-usage-to-run-paid-actor` when the Apify account balance is
exhausted — an owner-only billing fix, not a code bug; importing an existing
already-paid dataset is free.

**Unkeyed install = inactive.** Neither key set → the relevant pass no-ops,
Source Health reads `not_configured`, the panel shows its empty-state; never
half-runs.

**Review status is a non-destructive triage layer, NOT a promote.** Analysts
set `reviewStatus` via `PATCH /social-raw/:id/review-status` accepting ONLY
`pending_review|ignored|context` — it never mints/touches an incident. `promoted`
is NOT a PATCHable value (→ 400); ONLY the promote route sets it, and a row with
a non-null `promotedIncidentId` is frozen (any re-review → 409). **Why:** keeps
the "only promote mints an incident" invariant true even as triage state grows.

**Test-stub caveat:** the in-memory db stub in `socialRawPromote.test.ts`
models `.returning()` + the `isNull` claim guard + transaction snapshot/rollback
— enough for route regression, but it CANNOT emulate Postgres row-locking/MVCC.
The concurrent-promote test is a useful regression, not a formal concurrency
proof; the production SQL pattern provides that guarantee.
