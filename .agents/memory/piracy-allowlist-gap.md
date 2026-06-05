---
name: Shipping piracy/sea-robbery allowlist gap
description: Why genuine Singapore-Strait piracy reports were silently dropped, and the two-layer fix.
---

# Shipping piracy / sea-robbery classifier gap

The Singapore Strait & Malacca RSS feed queries explicitly ask for `piracy OR robbery`,
but the bare words were absent from BOTH gates:
- ingest `ALLOW` in `lib/ingest/src/shipping.ts`
- relevance `REQUIRED.shipping` in `lib/relevance/src/topicRelevance.ts`

So a ReCAAP-style "armed robbery against a ship" / "sea robbery" report survived ONLY by
incidentally containing the literal string "singapore strait" / "boarding" / "hijack".
Headlines like "Pirates attacked a tanker" or "Sea robbery in eastbound lane" were rejected
with `no-allowlist-match` and never inserted.

**Why maritime-qualified phrases, not bare "piracy"/"robbery":** the live piracy feed is
flooded with metaphor/noise — "Kremlin calls it piracy" (tanker-seizure diplomacy),
"World's Piracy Hotspots" (listicle), "Golden Age of Piracy" (history). Bare tokens would
ingest all of it. Fix uses qualified forms ("sea robbery", "armed robbery", "piracy attack",
"suspected piracy", "pirate attack", "pirates boarded"...) + a vessel-proximity regex on the
relevance side. Verified 8/8 on real `evaluateIncidentRelevance`.

**How to apply:** any new maritime-incident class must be added to BOTH the ingest ALLOW and
relevance REQUIRED in lockstep, or items pass one gate and die at the other. Loosening
relevance needs a `RELEVANCE_RULE_VERSION` bump so persisted rows re-evaluate on boot.

**Diagnosis caveat:** the live feed is non-deterministic, so raw dry-run accepted/rejected
counts swing run-to-run and CANNOT prove a classifier fix. Prove it deterministically:
hand-written headline samples through the real `evaluateIncidentRelevance(topic, input)`
(note: two positional args; `input` needs title/summary/source/country or it throws on i.source).
