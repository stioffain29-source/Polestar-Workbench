---
name: Cargo Watch syndication collapse (transitive)
description: Second-pass collapse in cargoPatternModel now chains transitively through strong links, not seed-only.
---

# Cargo Watch syndication collapse (transitive)

`collapseSyndicatedClusters` (cargoPatternModel.ts) is the SECOND-pass dedup that
merges outlet copies of ONE event that survived the coarse first-pass bucket
(they land in different category/port buckets because outlets frame the same bust
differently).

**Decision (reversed the earlier design):** it now matches a candidate against
ANY cluster already in the group (bounded TRANSITIVE chaining, grown to a fixed
point), NOT only the seed. The earlier code was deliberately seed-only "so
unrelated events can never daisy-chain" — that guard is REVOKED.

**Why:** heavy syndication leaves a terse copy and a heavily-attributed copy
("according to <outlet>, Location: <place>") under-sharing DIRECTLY (overlap dips
below the 0.5 containment floor) even though both link strongly to a THIRD copy
naming the ringleader/suspect count. Seed-only left the same Selangor
bonded-lorry bust as 2 enforcement rows = the owner's "still slop" complaint.

**How to apply / guardrails:**
- Every hop still passes the strict per-link thresholds in `collapseTokensMatch` (distinctive-token overlap / Jaccard), so unrelated events can't daisy-chain: two different crime stories rarely share several DISTINCTIVE (generic- and country-stripped) tokens within the window, same country.
- Distinctive tokens come from `collapseTokens` (generic crime/logistics vocab + in-scope country names stripped, light stem; syndicate/mastermind/bonded kept).
- Window is seed-relative, same country, so a group spans one event; it doubles as the total-span guard (no group-size cap needed).
- Verify with the transitive regression test in `cargoPatternModel.test.ts` (three real bonded-lorry outlet copies → one cluster) and by re-running `CARGO_FAST=1 npx tsx scripts/verifyCargoPatternPdf.ts` then grepping the PDF for a single bonded-lorry enforcement row.
