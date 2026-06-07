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

**ReCAAP weekly-bulletin feed + two-layer anti-aggregate defense.** Google News
RSS lags ReCAAP ISC weeklies (published days AFTER the boarding) and buries
Malacca/Singapore items under Hormuz-war analysis, so genuine Singapore Strait
armed-robbery boardings were never ingested. Fix = a dedicated VESSEL_FEEDS feed
("Sea robbery (ReCAAP)", defaultCountry Singapore) querying ReCAAP + robbery/
boarding terms. The trap: ReCAAP also publishes NON-incident content carrying
"armed robbery" (null-incident weeks "No incident…", governing-council/capacity-
building governance, half-yearly/annual/quarterly tallies, "N-year record"),
which would otherwise classify as fake discrete piracy rows. Defense is TWO
layers, both needed:
  1. INGEST DENY (`shipping.ts`, GLOBAL across all feeds) stops the high-volume
     null-week/governance/period-tally items from entering at all.
  2. PRESENTATION guard `PIRACY_STAT_RE` in `shippingAnalysis.ts` `classifyPiracy`
     returns null for statistical/trend framing ("reported in 2025", "N-year
     record", "first half of YYYY", "incidents surged") that slips ingest —
     benefits ALL sources, not just ReCAAP.
**Why two layers:** a "No incident of armed robbery" bulletin DOES match the
Armed-robbery PIRACY_RULE, so without the ingest DENY it would show as a fake
row; presentation guard alone can't strip what ingest never tagged as stat.
**How to apply:** weekly bulletins ("Two incidents of armed robbery 24 Feb – 2
Mar") must survive BOTH layers — verify any DENY/regex change with the KEEP/DROP
sample sets (period-tally framing DROPs, day-range bulletins KEEP). DENY is
global, so prefer the presentation guard over broad global DENY words.
