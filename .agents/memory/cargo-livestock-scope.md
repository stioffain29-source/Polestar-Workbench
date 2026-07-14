---
name: Cargo Watch livestock scope exclusion
description: Livestock/cattle-truck theft is OUT of Cargo Watch unless a commercial supply-chain anchor is present.
---

# Cargo Watch livestock scope exclusion

**Rule:** Livestock / cattle-truck theft is NOT a Cargo Watch incident UNLESS the
text carries a clear commercial supply-chain / logistics / food-distribution
anchor — a named logistics operator, a warehouse / cold store / reefer /
container consignment, a port / rail freight movement, an abattoir supply line,
or an export consignment. Routine rural or isolated livestock crime (e.g. a
highway cattle-truck robbery with no commercial-logistics dimension) is excluded
entirely.

**Why:** Owner scope ruling — Cargo Watch tracks commercial cargo-crime, not
rural animal theft, which was reading as slop in the report.

**How to apply:**
- `cargoAnalysis.ts` `classifyScope`: `LIVESTOCK_RE && !LIVESTOCK_COMMERCIAL_ANCHOR_RE → excluded_non_cargo`, placed with the HARD non-cargo rejects, ahead of the analyst override, so a stray "Add to lane" cannot re-admit routine animal theft.
- Mirror the SAME gate in `lib/relevance/src/topicRelevance.ts` (ingest side) in lockstep, and bump `RELEVANCE_RULE_VERSION` in `lib/relevance/src/evaluate.ts` so the boot backfill re-cleans persisted rows.
- The two gates (display-side classifyScope + ingest-side relevance) must stay identical or ingested rows and displayed rows disagree.
