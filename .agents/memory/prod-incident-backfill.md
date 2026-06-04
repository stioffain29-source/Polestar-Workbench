---
name: Prod incident backfill route
description: Deterministic way to copy already-verified incidents from dev into prod when non-deterministic feeds leave prod missing genuine records.
---

# Deterministic prod incident recovery

When a genuine, already-verified incident exists in the dev DB but is missing
from prod, re-running ingest is NOT a reliable fix: the live Google News RSS
feeds are non-deterministic and rate-limit/throttle the deployment IP, so a
given pass may simply never return that record (observed: successive prod
ingests inserted 12 → 1 → 0 flashpoint rows as Google throttled repeated pulls;
the missing item's classifier verdict was `kept:true`, so it was the FEED, not
the classifier).

**Why a code route is required, not a SQL fix:** the production database is
read-only from the workspace (`executeSql(environment:"production")` is a
read-only replica; `DATABASE_URL` in the workspace points at dev). Only the
deployment runtime can write prod. So the recovery mechanism must live in the
deployed server.

**The mechanism:** token-gated `POST /api/admin/incidents/backfill`
(`artifacts/api-server/src/routes/backfill.ts`). It accepts fully-formed
incident records in the body and inserts the ones not already present. It does
NOT fetch anything external — it only persists records supplied by the caller
(records you already pulled verbatim from dev), which is why it is deterministic
where re-ingest is a coin flip.

**Dedup must check BOTH keys** (idempotency): a record is "already present" if
its `source_url` matches OR the `(topic, title, occurred_at)` natural key
matches. Checking only one key lets the same incident insert twice when prod
stored it without a source URL or with a URL variation.

**Gotcha — date offsets:** Postgres `to_char(..., 'OF')` emits offsets like
`+00` (no minutes), which JS `new Date()` CANNOT parse (yields Invalid Date →
the route skips with `bad_occurred_at`). Normalise to `+00:00` before sending
(`replace(/([+-]\d{2})$/, "$1:00")`).

**How to apply:**
1. Pull the real records from dev (`json_agg`), normalise the date offset, write
   a `{ "incidents": [...] }` payload.
2. Republish (only the user can trigger publish) so the route ships to prod.
3. `POST` the payload to the prod URL with `x-ingest-token: $INGEST_ADMIN_TOKEN`.
4. Verify on the live country/report page.

**Why:** repeated "we lost incidents prod had / dev has" complaints stem from
feed non-determinism; this route is the durable, deterministic recovery path.
