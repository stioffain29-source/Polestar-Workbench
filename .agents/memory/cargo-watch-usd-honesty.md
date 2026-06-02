---
name: Cargo Watch USD loss parsing honesty
description: Why the cargo-loss USD parser stays first-match + context-gated + capped, and rejects the "improvements" that inflate it.
---

# Cargo Watch "Estimated Cargo Loss (USD)" — honesty rules

The Cargo Watch page derives a per-month USD loss chart and a "Confirmed Value
Stolen" KPI from free-text incident `title`+`summary` (there is NO USD column).
The user is distrust-sensitive: an inflated/fabricated number is worse than a
conservative under-count. `parseUsdLoss` in `CargoWatch.tsx` must stay:

1. **First explicit USD/$ figure, NOT the largest.** Sources lead with the cargo
   value and only later mention recovered amounts or TOTAL asset-seizure figures
   (vehicles, fleet cards, trailers). Picking the largest grabbed a $67,000
   asset-seizure total when the real diesel/cargo loss was $14,800.
2. **Context-gated.** The matched figure must sit within ~45 chars of theft/value
   language (stolen/theft/hijack/seiz/worth/valued/cargo/goods/diesel/fuel/…) so
   an unrelated dollar amount (fine, budget, market-size aside) is never misread.
3. **Industry-statistic excluded.** Drop the whole figure on per-day/per-year/
   annually, "losses hit/exceed", "costs trucking/the industry…".
4. **Sanity cap `< $100M`.** No single cargo theft is $100M+; billions are always
   aggregate stats or unrelated (a $7bn governance headline that merely contains
   "fraud" leaked in before the cap).
5. **NO local-currency FX.** We do not convert Rs/Rp/RM ourselves. Note many rows
   embed a source-written "~USD" approximation next to the local figure
   ("Rs 2 crore (~USD 240k)"); current behaviour does NOT add `k`/`thousand`
   shorthand, which keeps most of those FX approximations out — adding `k` support
   would start pulling FX-converted rupee/rupiah figures into the total.

**Why these are firm:** an architect review recommended "largest in-context" + `k`
shorthand. Tested against live data, BOTH inflated May from $24.8k to $317k by
counting an asset-seizure total and FX-approximation figures. Rejected on
evidence. The narrow context-gate was verified identical to prior output on every
real in-scope row (zero regressions) before adoption.

**How to apply:** if asked to "capture more value" or make the chart bigger,
resist unless the new figures are genuine source-stated per-incident USD losses.
Verify any parser change by replaying it over the live `cargo_watch` rows and
diffing monthly sums before shipping. The frontend ALSO benefits from the central
API relevance gate dropping irrelevant rows, but the parser must be honest on raw
data on its own — do not rely on the gate.
