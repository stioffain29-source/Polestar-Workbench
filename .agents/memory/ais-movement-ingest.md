---
name: Live AIS vessel-movement ingest
description: How the Shipping Watch movement (AIS) context is populated live, and the constraints that keep it context-only.
---

# Live AIS vessel-movement ingest

Movement context for the Shipping Watch maritime board can now be populated LIVE
from an AIS provider, in addition to the pre-existing admin manual-upload path.

- **Provider:** aisstream.io (FREE, WebSocket). Selected by `AIS_PROVIDER`
  (default `aisstream`; any other value → clean `unsupported_provider` no-op —
  Windward ingest is NOT implemented, only its Source Health scaffolding exists).
  Credential `AIS_API_KEY`; kill-switch `AIS_ENABLED=false`; sample window
  `AIS_COLLECT_SECONDS` (default 60, clamped 10–180).
- **Runtime, not type:** Node 24 has a global `WebSocket`, but `@types/node`
  here lacks the type and the ingest tsconfig is `lib es2022` + `types:["node"]`
  (no DOM). So the engine declares a minimal local `WsLike` interface and reads
  the constructor off `globalThis`, never relying on the global `WebSocket` type.

**Why context-only is structural, not just a convention:** the engine writes
ONLY the isolated `maritime_movement` table — it never imports or touches the
incidents table, so it cannot inflate a confirmed-incident count. Verify this
invariant survives any future edit.
**How to apply:**
- Theatre names written MUST exactly match `BOARD_CHOKEPOINTS`
  ("Strait of Hormuz", "Bab el-Mandeb", "Gulf of Aden", "Singapore Strait",
  "Malacca Strait", "Red Sea") or the board's per-chokepoint Movement line and
  the workbench `matchChokepointMovement` substring match silently won't bind.
- `source_name` MUST contain "ais" so Source Health's AIS row pattern `%ais%`
  flips to `live` (FRESH_DAYS=14). Manual-upload health was re-scoped to EXCLUDE
  `%ais%`/`%windward%` rows so the live feed doesn't also light the manual row.
- Only fill counts AIS can actually derive: total/AIS-visible = unique MMSI;
  tankers = ship-type code 80-89. inbound/outbound, bulk/container/LNG, anchored
  and AIS-dark stay NULL ("not reported"). A theatre with zero observed vessels
  gets NO row — absence, never a fabricated zero (zero would read as no traffic).
- Bounding boxes are assigned SPECIFIC→BROAD (first containing box wins) so a
  ship in the narrow Bab el-Mandeb strait isn't swept up by the broad Red Sea
  box that overlaps it. Same boxes drive the aisstream subscription and the
  point-in-box assignment.
- Wired into `runIngestOnce` in its own try/catch (a WebSocket/provider failure
  can never fail the incident chain); CLI `scrape:maritime-movement`; in
  `scrape:prod`. `INGEST_FORCE_VERSION` bumped so a prod cold start re-runs once.
- No-op paths (disabled / not_configured / unsupported_provider / fetch_failed
  with no data) write nothing and never throw — the board degrades to "movement
  data unavailable".

**Latent crash that only fires once a movement row exists:** Source Health's
`/api/integrations/status` read `max(data_as_of)` via a raw Drizzle `sql<Date>`
aggregate. A raw `sql` aggregate BYPASSES Drizzle's column type parser, so the
pg driver returns the timestamp as a STRING, and the freshness check called
`.getTime()` on it → `asOf.getTime is not a function`. It stayed dormant while
the table was empty (max → NULL) and only crashed after the first AIS row
landed. Coerce any raw `max(timestamp)`/`sql<Date>` result with `new Date(...)`
before treating it as a Date. The end-to-end verification (key set → ingest →
17 vessels in Singapore Strait, AIS row "live", incident count unchanged) is
what surfaced it — typecheck + the no-op path alone would not have.
