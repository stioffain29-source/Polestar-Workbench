---
name: apac_local natural-hazard coverage
description: Why apac_local now surfaces typhoon/quake/flood and the Tagalog "baha" substring trap
---

apac_local's relevance gate is purely GEOGRAPHIC (reuses FP_APAC_ANCHOR_RE, no
required vocab), so in-region items pass relevance. But the second-stage ingest
allow/deny gate (APAC_LOCAL_CONFIG in lib/ingest/src/topicConfigs.ts) is a
substring allow-list, and it originally had NO natural-hazard section — so
Philippine (Inquirer/Rappler/GMA) and Thai (Bangkok Post/Khaosod) typhoon
("bagyo"), earthquake ("lindol") and flood ("baha") stories passed relevance
then got silently dropped at ingest.

Decision: surface natural hazards, matching indonesia_local. Added
to APAC_LOCAL_CONFIG.allow: EN (typhoon/cyclone/tropical storm/storm surge/
earthquake/quake/aftershock/tsunami/volcano/volcanic/eruption/landslide/
mudslide/flood), Bahasa (banjir/longsor/gempa/erupsi/letusan/gunung meletus),
Tagalog (bagyo/lindol/bulkan/pagguho + bound flood forms pagbaha/bumaha/binaha).

**Why bound flood forms:** bare Tagalog "baha" (flood) is a substring of
"bahasa", "bahay" (house), "bahagi" (part) — so the bare token would
false-positive. Only the bound verb/noun forms are allow tokens.

**How to apply:** any new APAC hazard vocab goes in this allow-list only (no
RELEVANCE_RULE_VERSION bump — relevance is geo-only). Prefer distinctive or
bound tokens; re-check every short romanized token for substring collisions
against common Bahasa/Tagalog words before adding.
