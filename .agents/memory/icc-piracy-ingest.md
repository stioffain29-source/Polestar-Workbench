---
name: ICC CCS / IMB piracy ingest
description: How the standalone maritime-security source pulls and parses the ICC live-piracy WP Google Maps feed, plus its non-obvious data-shape traps.
---

# ICC CCS / IMB piracy & armed-robbery ingest

Standalone maritime-security source feeding `maritime_security_events` (its OWN table — NEVER incidents, can never inflate any count). Surfaced in Shipping Watch (monitor section + map "Maritime Security (IMB)" category + report/PDF) and a gated country-report "Maritime Security" section. Current calendar year only, no historical backfill, no key.

Feed: `https://icc-ccs.org/wp-json/wpgmza/v1/markers` (WP Google Maps plugin), HTTP 200, ~4MB, no key. ~2700 markers all-time; only ~30-some are the current year.

## The data-shape trap (cost a debugging round)
`custom_field_data` is an **ARRAY of `{id, name, value}` objects**, e.g. `[{id:9,name:"Incident Number",value:"001-26"},{id:66,name:"Sitrep:",value:"DD.MM.YYYY: …"}]` — NOT an object keyed by field-id with string values. Doing `Object.values(cfd).map(String)` yields `"[object Object]"` and loses the sitrep entirely → narrative `"[object Object]"`, null country/location/date, and the country-report section silently never matches. Parse by finding the pair whose `name` matches `/sitrep/i` (and `/incident number/i`). `customFieldPairs()` handles BOTH the array shape and the legacy id-keyed-object shape.
**Why:** some WP installs serve the legacy object shape; handle both so a plugin update can't break it.

## Other quirks
- Marker `title` IS the incident number ("001-26"; `-26` → 2026). Year resolution: parsed sitrep date first, else the `-YY` suffix; markers we cannot date at all are DROPPED (no guessing).
- Sitrep head format: `DD.MM.YYYY: HHMM UTC: Posn: <rawpos>, <location...>, <country>. <description>`. Split the location clause at the first `". "` (period+space) — decimal minutes like `45.72N` are period+digit so they don't trigger the split.
- Coordinates: prefer the marker's decimal `lat`/`lng`; `(0,0)` is the plugin's null-island = treat as missing, then fall back to parsing the IMB position string.
- `tableStats().latest` (a Drizzle `max(timestamp)`) comes back as a STRING from the pg driver, not a Date — wrap in `new Date(...)` before `.toISOString()` or the CLI throws "toISOString is not a function" AFTER a successful commit.
- Re-ingest dedupes by event key and does NOT update existing rows; to fix already-stored corrupt rows you must DELETE then re-ingest (dev). Prod is fresh (new table) so it ingests clean on first run.
- Source Health: `recordSourceHealth` under topic `maritime_security`, `pending:true` so an egress block shows amber "pending" (awaiting prod network validation), never a hard red failure.
