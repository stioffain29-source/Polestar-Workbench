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

**Unkeyed install = inactive.** No Apify key → the pass no-ops, Source Health
reads `not_configured`, the panel shows its empty-state; never half-runs.

**Test-stub caveat:** the in-memory db stub in `socialRawPromote.test.ts`
models `.returning()` + the `isNull` claim guard + transaction snapshot/rollback
— enough for route regression, but it CANNOT emulate Postgres row-locking/MVCC.
The concurrent-promote test is a useful regression, not a formal concurrency
proof; the production SQL pattern provides that guarantee.
