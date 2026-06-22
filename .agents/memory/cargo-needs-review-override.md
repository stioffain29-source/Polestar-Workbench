---
name: Cargo Needs Review analyst override
description: How an analyst resolves an unidentified-country Cargo Watch incident so it promotes into the in-scope lane, and the invariants that keep it honest.
---

A Cargo Watch "Needs Review" row (cargo incident whose country the classifier
could not identify) is resolved by an analyst assigning a country and clicking
"Add to lane". That decision persists `incidents.analystInScope = true` together
with the assigned country.

`classifyScope` honors the override by returning `in_scope` when
`analystInScope === true` AND the (analyst-assigned) region is APAC or Middle
East. Its placement is load-bearing: it sits AFTER the hard non-cargo / fish
rejects but BEFORE the heuristic cargo-vocabulary / genuineness gate.

**Why:** simply writing the country onto the row is not enough — the heuristic
cargo-vocab/genuineness gate would immediately re-drop the row back into Needs
Review (the "I assigned it and it vanished" UX failure). The analyst read the
source; the classifier only sees the headline, so a persisted human override
must be authoritative over the *heuristic* gates. It must NOT be authoritative
over the hard non-cargo/fish rejects (those still win), and it must never be
able to force a row into geography the classifier doesn't recognize as in-scope.

**How to apply:**
- Any NEW hard reject must stay ABOVE the override branch so it still wins.
- The override stays gated on region ∈ {APAC, Middle East}; region is derived
  from the analyst-assigned country, so an out-of-scope/unrecognized assignment
  cannot leak in.
- The country picker is driven by `IN_SCOPE_COUNTRIES` (exported from
  `cargoAnalysis.ts`); every entry must resolve to APAC/Middle East via
  `classifyRegion` (locked by an `it.each` invariant test), or an analyst could
  pick a value the override then silently refuses to promote.
- Downstream parity is automatic: all cargo surfaces converge through
  `cargoScope`/`classifyScope` reading full incident rows.
