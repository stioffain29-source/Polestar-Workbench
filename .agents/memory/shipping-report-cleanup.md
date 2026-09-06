---
name: Shipping Watch report client-readiness cleanup
description: How shipping-report noise/rhetoric/capability classifiers, credibility-filtered counts, and dataset-seeded prose keep the Shipping Watch report client-ready and internally consistent.
---

# Shipping Watch report cleanup

Durable rules learned making the Shipping Watch report client-ready (Cargo Watch is a separate report, out of scope here).

## Rhetoric vs confirmed closure — precision over recall
- A waterway "closure" headline is only **rhetoric/claim** (drop from operational surfaces) when it pairs a waterway with an *intent verb adjacent to a close word* (vow/threaten/pledge to shut), a *close-noun + threat* ("closure threatens"), or a *future-modal + close* ("will stay closed"). A plain past-tense factual closure ("Suez closed after grounding") or a real blockage with a recovery outlook ("blocked, could reopen") has none of these and must NOT be suppressed.
- **Why:** an earlier broad regex matched bare verbs (`said`/`move`/`set`) and a lone `to` modal, suppressing genuine confirmed closures — a reviewer flagged this as blocking. Missing one speculative headline is cheaper than dropping a real disruption.
- **How to apply:** use `isRhetoricalClosureThreat(text)` (requires waterway AND one of three tight shapes), not a single mega-regex. Same precision-first stance applies to the capability/procurement filter: never use a bare `launched new` / `to order` fragment — it eats real attack reporting ("launched new attacks", "ordered to evacuate"); require a capability noun (drone/frigate/minehunter/exercise) instead.

## One final canonical incident set — no split denominators
- Every incident-derived Shipping Watch surface uses the same confirmed, event-folded canonical set: headline count/risk/severity, chokepoints, Fast Facts, vessel/piracy/commercial tables, charts, narrative, Maritime Intelligence and Related Incidents. `enriched` is diagnostics only.
- **Why:** independent pools let headline totals, risk, narrative, charts and listed incidents disagree while each section looked locally plausible.
- **How to apply:** build the dataset once per report snapshot; pass its canonical incidents into report-mode Maritime Intelligence and deterministic prose. Never re-query, re-window, re-dedupe or re-confirm inside a report section.

## One dataset for chart AND prose (country parity)
- The seeded draft prose for shipping must be built from the SAME final canonical incidents the preview/PDF use, and the four analyst sections seed straight from `ds.auto*`. Never hardcode a country in the prose — derive the lead from `ds.countryRows`.
- **Why:** screen == in-app PDF is architectural; the only way prose can contradict the chart is if it's seeded from a different derivation.
- **How to apply:** carry id/sourceUrl/location into the seed incidents so the seeded dataset is byte-identical to the preview's (location/sourceUrl feed country + social-source detection); a thinner shape silently diverges. `DraftableIncident` now has optional `id`.

## Related Incidents = positive confirmation, not denylist
- An incident only reaches operational surfaces (Related Incidents, chokepoint counts, latest-significant, country chart) when `isConfirmedOperationalIncident()` says so: it is a POSITIVE gate (attack/seizure/piracy OR a concrete port/route/physical disruption that actually occurred), not just "not noise". Claims, threats, planning/prediction language, advisory/escort posture and bare chokepoint commentary all return false.
- **Why:** a denylist always leaks the next un-listed claim phrasing ("transits are rising", "predicts oil will flow", "US Navy blockade escalates tensions") and presents it as a confirmed incident — the exact lie the distrustful user flagged. Requiring positive confirmation closes that whole class at once.
- **How to apply:** wire the SAME gate into every operational surface in `buildShippingReportDataset` (cpCounts, chokepoint `credible` filter, latestSig pool, prioritiseRelated) — never `!isLowCredibilitySource` on some and the gate on others, or the headline count and the table diverge again. Seed prioritiseRelated with `[latestSig, vesselThreatSeed]` so the latest-significant card is GUARANTEED present in the table (consistency).
- **Planning-veto needs a confirmed-cause escape hatch:** `PLANNING_INTENT_RE && !CONFIRMED_INCIDENT_CAUSE_RE` drops forward-looking text, but the cause set must include in-effect port/terminal/berth closures + dock/labour strikes + canal blockages + disabled vessels (not just physical causes), or a real "port closed after strike, expected to reopen" is wrongly dropped. Deliberately EXCLUDE weak route words (reroute/diverted/cape of good hope/congestion) from the escape hatch so pure claims stay out.
- **Country conclusions get a confidence caveat:** when unattributed records >= attributed, `buildRegionalCountryRead` appends an explicit "country-level conclusions should be treated as low-confidence" qualifier rather than stating leads as fact.
- Trend headlines, travel/booking guides, advisory-only notices and market/political commentary are not incidents merely because they mention piracy, tankers or a port closure. A discrete operational event must be present. Keep this rule mirrored in ingest relevance and the report confirmation gate, then bump the relevance version.

## "Vessel Attacks" table = physical incidents only, never advisories
- The "Vessel Attacks" table (`ds.vesselRows`) must exclude `vesselType === "Threat"`. A `Threat` is a bare advisory (e.g. UKMTO "threat to shipping remains critical") — elevated RISK, not a physical event — and rates LOW on the 5-tier incident-severity scale. Listing it as an attack row produces a self-contradiction the user will catch on sight: a "remains critical" headline with a LOW chip.
- **Why:** "critical" in such headlines is the source's *advisory threat-LEVEL* jargon, not our incident severity; the two scales are different axes. `isConfirmedOperationalIncident` already treats `Threat` as unconfirmed, so the table was the lone surface still leaking it.
- **How to apply:** drop `Threat` at the `vesselAll` build in `shippingReportDataset.ts` (keep Attack/Near miss/Seized). Downstream `vesselThreat30Total`/`vAttackSeize` stay coherent because they recompute from the filtered set; the fast-fact card already counts hostile-only.

## Fail closed on contradictions
- Preview and PDF must validate the rendered Fast Facts (including analyst overrides), route counts, geographic totals, Related Incident membership, Maritime Intelligence IDs/total and recomputed risk against the canonical set before rendering.
- **Why:** a shared builder prevents normal drift, but saved overrides or later field mutation can still create a contradictory report.
- **How to apply:** any mismatch throws and blocks output. Do not catch-and-render around the Shipping consistency assertion.

## Proof harness
- `artifacts/workbench/scripts/proveShippingSelection.ts` reads dumped incidents + report text, validates the canonical set/risk, and prints included/rejected-with-reasons + country/chokepoint/commercial reconciliation. Its seeded prose also uses the canonical set. Dump incidents with snake_case keys (`occurred_at`, `source_url`); `/tmp/shipping_report.txt` must be `id|title|issue_date`.

## Saved prose overrides the live dataset until reset (the real fault-2 trap)
- Seeding parity (above) only governs a FRESH draft. Once a report is saved, `ReportEditor.pick()` returns the SAVED `what_matters/implications/polestar_view/watch_next` verbatim whenever the report is not flagged stale (`computeStale` only fires when live data is newer than the issue date). So a stale saved Polestar View ("China and South Korea") keeps contradicting the live country chart even after the seeding code is fixed and the app is redeployed.
- **Fix:** a ONE-TIME, marker-gated DB reset blanks those four stored sections for `topic='shipping'` so the frontend falls back to the live dataset. Marker-gated (not every-boot) because the shipping editor DOES persist those fields — an every-boot wipe would destroy deliberate analyst edits on each cold start.
- **Why marker, not content-heuristic or every-boot:** code review flagged the every-boot version as a data-loss regression. Use `app_migration_markers(key,applied_at)` (registered in the Drizzle schema so `drizzle push` won't drop it); check key before the destructive UPDATE, insert after. Bump the key (`shipping_prose_reset_v1`→v2) to re-run. This is the runtime-migration counterpart to `RELEVANCE_RULE_VERSION`.
- Do NOT clear `situation`/`what_happened` — the shipping preview/PDF never render them, so blanking them is destructive for no gain.
