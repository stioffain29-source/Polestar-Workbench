---
name: Facebook OSINT promote gate
description: Invariants for promoting a social_raw (Papua/PNG Facebook OSINT) post into an incident — isolation, server-side re-derive, atomic claim, dual-window dedup, URL sanitisation.
---

Facebook OSINT posts live in the isolated `social_raw` table and are CONTEXT
ONLY — no incident-counting surface (dashboard, topic monitors, reports) reads
that table. The single path into `incidents` is the gated, human-in-the-loop
promote route.

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
