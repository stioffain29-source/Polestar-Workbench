---
name: Country-brief civic-admin & sports-fixture noise gates
description: isCountryRelevant excludes for taxi/airport admin, ceremonial infrastructure, defence-cooperation PR and sports fixture idioms; why PNG needs them
---

PNG briefs led on "HUNTERS GET BOOST … AHEAD OF HOME CLASH" (rugby, stored severity HIGH) and "NAC introduces new Taxi drop-off arrangements" while a communal clash (80 arrested, houses burned) sat flagged irrelevant. Root cause classes, all fixed display-side in `isCountryRelevant` (no RELEVANCE_RULE_VERSION bump — country briefs ignore stored relevance_status):

- **Sports fixture idioms** the league list missed: `(home|away) (clash|fixture|leg|game)`, `return of N players`. "clash" must never rescue sports — gate on COUNTRY_HARD_SECURITY_RE.
- **COUNTRY_CIVIC_ADMIN_RE** — taxi/terminal admin, station/barracks openings & decommissionings, road/airstrip project progress, recruitment/training capacity, ministry portfolio handovers, kina funding commitments, appreciation pieces. Gated on !HARD_SECURITY so "gunmen attack police station" survives.
- **COUNTRY_DEFENCE_COOPERATION_RE** — mil-to-mil "strengthens relationship/ties", army band, "deliver care during" exercise photo wires. Gated on FRESH_ATTACK like the exercise drop.

**How to apply:** new noise class in a brief → new named RE + the right rescue tier (HARD vs CONCRETE vs FRESH_ATTACK), verify by replaying isCountryRelevant over live prod rows for that country (esbuild harness), then run country-brief-sweep + pdf-fonts workflows. PNG-severity-inversion is a separate stored-severity problem (see png-severity-inversion.md) — the display gate hides junk but the ingest classifier still over-rates PR.

**Coverage gap FIXED (Aug 2026):** drought/water-utility vocab added in two gates: PNG_OPERATIONAL (flashpoint.ts, PNG-gated; bare "drought" carries a negative-lookbehind for sports idiom "title/medal drought") and APAC_LOCAL_CONFIG.allow (topicConfigs.ts: EN phrases + kekeringan/krisis air). No version bump — allow-list widening only re-admits, never re-classifies. Sports deny lists still run first on both paths.
