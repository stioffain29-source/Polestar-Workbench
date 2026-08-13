---
name: Fuel coverage — strikes, aviation, and the continuity cross-read
description: How fuel-relevant events filed under other topics reach Fuel Watch, and the gates that keep the cross-read precise and gate-consistent.
---

## Feeds
Per-country when:14d targeted feeds + regulator gazetteer aliases; "oil transporters strike" is self-evidently fuel; jet-fuel market chatter stays out.

## Qualifying-set continuity cross-read (fuelNarratives.filterFuelContinuityCrossRead)
Fuel Watch's qualifying set = fuel-topic window PLUS a bounded cross-read:
- shipping-topic rows with a tracked chokepoint name AND a kinetic verb (missile/attack/seizure/closure…) — a strike on a vessel in the Gulf of Oman is fuel-route pressure even with no fuel token in the headline;
- energy-topic rows with a fuel-to-power continuity signal (load-shedding, or shortage/rationing WITH an explicit fuel/gas anchor). Bare "power cuts/blackout" is deliberately excluded (ordinary grid faults) and service-guide/explainer titles are rejected.

**Why:** the fuel relevance gate is fuel-operational-scoped, so Pakistan chokepoint strikes (shipping) and Bangladesh gas-shortage load-shedding (energy) were invisible to the report though relevant in the DB.

**Invariants:**
- Cross-read admits are syndication-collapsed: nearDuplicate title tokens AND a per-(canonicalised chokepoint, day) coarse key; also collapsed AGAINST the fuel window's titles (identity keys alone double-count a cross-topic rewrite). Pools are capped separately (shipping 4 / energy 4) so a strike week can't starve the energy admits.
- `buildFuelReportFacts` MUST receive the same qualifying universe (`qualifyingIncidents` arg) as `buildFuelCanonicalFacts`, or the consistency gate false-blocks every cross-read event (gate + AI FIXED FACTS count a different set than the prose describes).
- ReportEditor fetches fuel + shipping + energy for the fuel topic and waits for ALL queries before seeding.
- Chokepoint name list in fuelNarratives mirrors fuelCanonicalFacts.routeFor (a value import would close a module cycle through fuelReportFacts).
- Canonical Operational Read / Regional Highlights per-theatre sentences say "records", never "qualifying incidents"/"distinct days" — those exact phrasings are gate-bound to report-wide totals.
