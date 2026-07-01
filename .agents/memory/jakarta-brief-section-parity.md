---
name: Jakarta city brief — section parity chain
description: How to add/remove/reorder a Jakarta report section without breaking the parity + font gate; crime-read no-fabrication gate; spec-§ vs rendered-§ numbering.
---

The Jakarta country report is a dedicated multi-section CITY brief (NOT the
generic country renderer). City-vs-country framing lives in a small registry
(`reportKind.ts`: `isCityReport` / `reportKindLabel`; jakarta = city; manila /
bangkok are commented-out placeholders, uncomment to add — no data needed).

## Section parity lockstep (the trap)
Adding, removing, or reordering ANY Jakarta brief section must be done in
lockstep across FOUR surfaces or the parity gate fails:
1. the builder in `jakartaBrief.ts`,
2. the on-screen preview `JakartaReportBody.tsx`,
3. the headless PDF `renderJakartaBrief` in `exportCountryReportPdf.ts`,
4. `CANONICAL_SECTIONS` in `scripts/auditJakartaPdf.ts`.

`auditJakartaPdf.ts` asserts on-screen == offline-PDF == canonical order AND
Roboto-only fonts; `scripts/validateFonts.sh` is the CI font gate (needs
`DATABASE_URL`, reads Postgres directly because /api is owner-gated).

**Why:** preview==in-app-PDF parity is a hard product rule; the audit is the
only automated proof. A section added to only one surface silently diverges and
fails the audit with a confusing "canonical vs on-screen" order mismatch.

## Crime this-period read — no-fabrication gate
`buildJakartaCrimeTrends` must gate its "this period featured …" read on
`crimeItems.length` (i.e. category maps to the crime theme), NOT on whether a
crime-type token or area was extracted. A classified-but-thin crime item with no
matched token/area must still produce a read (generic "crime and public-safety
incidents"), otherwise it falls through to "No fresh crime-specific reporting" —
a false negative that contradicts the record.

## Spec §N vs rendered §N (don't renumber blindly)
Comments prefixed "Spec §N" / "spec §N" reference the EXTERNAL design-spec
document numbering, a SEPARATE system from the rendered brief order. When the
rendered order shifts (e.g. inserting the crime section bumped the map from §13
to §14), update rendered-position comments but leave "Spec §N" comments alone.
`countryCustomerRelevance.ts` is the shared generic-country builder — its
"spec §13" has nothing to do with the Jakarta brief.
