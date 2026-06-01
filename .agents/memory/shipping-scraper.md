---
name: Live shipping scraper
description: How the topic='shipping' live ingest works, its noise traps, and the dedupe rule that keeps it honest.
---

# Live shipping scraper

Shipping used to be IMPORT-ONLY (no live feed), so the Shipping monitor froze at
the last manual import. There is now a live scraper (`lib/ingest/src/shipping.ts`,
`runShippingIngest`) mirroring `cargoWatch.ts`: Google News RSS chokepoint +
vessel + port feeds → classify → dedupe → geocode → `classifySeverity("shipping")`
→ `evaluateIncidentRelevance("shipping")` → insert `topic='shipping'`. It rides
`runIngestOnce` (so scheduler + admin route + `scrape:prod` all refresh it) and
has a CLI wrapper (`scrape:shipping`). Like the other lib ingests it must NOT
close the shared DB pool — only the CLI wrapper calls `pool.end()`.

**"port strike" is a semantic landmine.** REQUIRED.shipping (and the scraper
ALLOW) match "port strike" meaning a labour/disruption strike, but Google News
also returns MILITARY strikes ON a port (e.g. "Israeli port strike"), which drag
in funeral/human-interest aftermath ("City lays to rest youth killed in … port
strike"), viral-debunk pieces, and op-eds. Those carry casualty words so they
wrongly hit the EXTREME tier (extreme is brand-reserved for casualties). The
scraper DENY list strips them: `lays to rest`, `viral`, `false claim`,
`fact check`, `fake video`, `old video`, `misleading`, `debunk`. If extreme
shipping rows reappear, check for this collision first.

**Dedupe must grow its guard sets in-run.** Maritime items are often at sea, so
the scraper falls back to a per-feed default country (Hormuz→Iran,
Bab el-Mandeb→Yemen). The same article can surface under two feeds with two
default countries → two DIFFERENT title+date+country keys → the key-only in-batch
dedupe misses it. Fix: while building `toInsert`, add each accepted row's URL and
key to `existingUrls`/`existingKeys` so a same-URL duplicate is caught even when
its key differs. (Found in code review — the key-only pass alone is insufficient.)

**ALLOW must stay context-qualified.** Bare `diversion`/`diverting` matched
non-maritime stories that the relevance gate then dropped (wasted inserts).
Keep diversion terms qualified (`route diversion`, `vessel diversion`,
`diverting around`, `rerouting`) so ingestion precision matches the gate.

Country names are stored as FULL names ("United Arab Emirates", "Iran") to match
the legacy imported rows; "Unknown" is the convention for unlocated at-sea items.
Geocoding gap (some rows null lat/long) is known/acceptable.
