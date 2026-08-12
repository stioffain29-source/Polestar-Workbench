---
name: Fuel Watch coverage — aviation price action + fuel-linked transport strikes
description: Precision rules and feed-design decisions for the two fuel story classes that were invisible (regulator jet-fuel hikes; fuel-pricing freight/pump strikes).
---
Two story classes belong in the fuel topic but were structurally invisible: regulator/operator price action on a named aviation-fuel product, and freight/pump strikes whose cause is fuel pricing. Cross-topic dedupe is topic-scoped, so a fuel-side capture never conflicts with a flashpoint copy of the same story.

**Rules (precision-first):**
- Aviation price action needs a hike/raise/cut VERB near "price" near the product; bare "jet fuel price" market chatter must stay excluded.
- Transport strikes need the fuel word nearby — EXCEPT actor-only classes ("oil transporters", "petroleum dealers", "petrol pumps") whose actor IS the fuel network; those headlines carry no separate fuel token, so neither the relevance gate NOR the Google query may require one (a fuel-word conjunct in the feed query silently blocks retrieval even when relevance would keep the story).

**Feed design:**
- Targeted feeds are PER-COUNTRY with `defaultCountry` + `EDITIONS[c]` spread (these headlines rarely name the country) and `when:14d` (without it Google dredges months-old archive noise).
- Cross-border items still mis-stamp via defaultCountry; regulator names in the gazetteer (berc/petrobangla→Bangladesh, ogra→Pakistan) let detectCountry win over the default.

**Why:** owner instruction — the builder must scrape from source, never hand-paste missed items. `fuelExcludes.test.ts` pins both keep and drop directions.

**Dual-topic ruling (owner):** fuel-driven strikes belong in BOTH Fuel Watch and flashpoint. Cross-topic dedupe is topic-scoped, so each topic captures its own copy. Flashpoint side = FLASHPOINT_FUEL_NETWORK_ACTION_RE (actor-bound: dealers/transporters/pump owners + strike/shutdown/closure — the class often has NO "strike" token) + matching ingest cue + catalogued per-country "Fuel-network strikes (…)" source rows (flashpoint feeds live in the sources TABLE, not code — new rows must go to dev AND prod DBs; prod rules only apply after a republish).
