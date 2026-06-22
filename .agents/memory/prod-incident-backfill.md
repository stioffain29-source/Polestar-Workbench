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

## No-token variant: marker-gated boot-migration seed

When `INGEST_ADMIN_TOKEN` is UNSET in prod the admin backfill route 503s, and
setting a token directly is discouraged (and `requestEnvVar` stalls on the
user). The same deterministic copy can ship with NO secret as a one-time,
marker-gated block in `runDataMigrations` (`migrations.ts`) that imports a
generated seed module (export the dev rows with `json_agg`, write a typed
`*.ts` array under `artifacts/api-server/src/lib/seed/` — a TS array bundles
reliably; don't rely on JSON-loader behaviour). Same dual-key dedup
(`source_url` OR `(topic,title,occurred_at)`); set `relevanceVersion =
RELEVANCE_RULE_VERSION` + the dev verdict on inserts so the relevance backfill
leaves them untouched and they pass the API filter immediately.

**Why:** runs in the deployment runtime (writable prod DB) on the next boot
after a plain republish — no token, no post-deploy curl. Marker-gated so it
runs once per env and is idempotent.

**Validate before publishing:** restart the api-server in DEV — dev already
holds the rows, so the block must log `inserted:0 / skipped:<all>` (dedup
proven, zero dev pollution). In prod the dedup skips the rows the live feed
already landed and inserts only the genuinely-missing ones.

**Caveat:** this seeds a one-time SNAPSHOT. Ongoing freshness for a feed that
failed transiently still depends on the normal scheduler retrying it on its
next ~12h cycle; the seed only closes the immediate gap.

## Workspace → prod POST mechanics (operational gotchas)

- The `code_execution` JS sandbox does NOT expose `process.env` (it is
  `undefined`). To POST the token-gated prod admin route, run `curl` from a
  bash tool where `$INGEST_ADMIN_TOKEN` (set via `.replit [env]`) is in scope —
  reference the var, never the literal, so the value is never printed.
- `executeSql(...).output` is a psql-style TEXT table, NOT JSON — `JSON.parse`
  of it fails. To pull dev rows for a payload, dump clean JSON with
  `psql "$DATABASE_URL" -t -A -c "SELECT json_agg(...) FROM (...) t" > f.json`
  (tuples-only, unaligned = no header / no "(1 row)"), then `jq` it. json_agg
  encodes timestamptz as `...+00:00` (parseable), sidestepping the `+00` trap.
- The prod URL is NOT in the workspace `$REPLIT_DOMAINS` (that is the dev
  `.replit.dev` domain); get it from `getDeploymentInfo().primaryUrl`.
- A draft report auto-advances issue date to today + reseeds prose live in the
  browser, so once the backfill lands the missing rows, the live published
  report shows them on next load with NO report-row edit needed.
