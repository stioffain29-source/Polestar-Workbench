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

## Counts must use credible-only records
- Chokepoint headline / fast-fact counts must skip low-credibility rows (rhetoric, media-packaging, social, commentary), matching the credible table the report renders — otherwise the headline number (e.g. Hormuz 154) dwarfs the table (30) and reads as a lie.
- **Why:** the user's core complaint was that the big chokepoint number didn't reconcile with the listed incidents.

## One dataset for chart AND prose (country parity)
- The seeded draft prose for shipping must be built from the SAME `buildShippingReportDataset` the preview/PDF use, and the four analyst sections seed straight from `ds.auto*`. Never hardcode a country in the prose (the old fallback said "China and South Korea" while the chart led Iran/Singapore) — derive the lead from `ds.countryRows`.
- **Why:** screen == in-app PDF is architectural; the only way prose can contradict the chart is if it's seeded from a different derivation.
- **How to apply:** carry id/sourceUrl/location into the seed incidents so the seeded dataset is byte-identical to the preview's (location/sourceUrl feed country + social-source detection); a thinner shape silently diverges. `DraftableIncident` now has optional `id`.

## Proof harness
- `artifacts/workbench/scripts/proveShippingSelection.ts` reads dumped incidents + report text and prints included/rejected-with-reasons + country/chokepoint/commercial reconciliation. Mirror this pattern when a distrustful user demands evidence a selection is correct.

## Saved prose overrides the live dataset until reset (the real fault-2 trap)
- Seeding parity (above) only governs a FRESH draft. Once a report is saved, `ReportEditor.pick()` returns the SAVED `what_matters/implications/polestar_view/watch_next` verbatim whenever the report is not flagged stale (`computeStale` only fires when live data is newer than the issue date). So a stale saved Polestar View ("China and South Korea") keeps contradicting the live country chart even after the seeding code is fixed and the app is redeployed.
- **Fix:** a ONE-TIME, marker-gated DB reset blanks those four stored sections for `topic='shipping'` so the frontend falls back to the live dataset. Marker-gated (not every-boot) because the shipping editor DOES persist those fields — an every-boot wipe would destroy deliberate analyst edits on each cold start.
- **Why marker, not content-heuristic or every-boot:** code review flagged the every-boot version as a data-loss regression. Use `app_migration_markers(key,applied_at)` (registered in the Drizzle schema so `drizzle push` won't drop it); check key before the destructive UPDATE, insert after. Bump the key (`shipping_prose_reset_v1`→v2) to re-run. This is the runtime-migration counterpart to `RELEVANCE_RULE_VERSION`.
- Do NOT clear `situation`/`what_happened` — the shipping preview/PDF never render them, so blanking them is destructive for no gain.
