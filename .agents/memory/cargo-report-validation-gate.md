---
name: Cargo Watch report validation gate
description: The HARD generation gate for Cargo Watch reports and the two invariants that keep it satisfiable and spec-compliant.
---

# Cargo Watch report validation gate

`cargoReportValidation.ts` runs a HARD, fail-closed validation gate over the
`buildCargoPatternModel` output: `validateCargoReport` (~10 checks incl.
TOTALS_RECONCILE, ENFORCEMENT_IN_TOTALS, PERIOD_ALIGNMENT, WATERWAY_AS_ROAD,
DRIVER_NO_EVIDENCE, DUPLICATE_TEXT, SENSATIONAL_HEADLINE, KEY_INCIDENT_NO_SOURCE,
POLESTAR_TOO_SHORT, IMPLICATION_NOT_TRACEABLE). The PDF exporter calls
`assertCargoReportValid` before drawing (throws `CargoReportValidationError`);
the preview computes the same issues and early-returns a blocking panel. Both
surfaces run the SAME function over the SAME model + override fields, so
preview == PDF holds. The gate SKIPS when `model.isEmpty || totalUnique === 0`.

## INVARIANT 1 — neutraliser must be a superset of the gate's sensational regex

`cargoPatternModel.ts`'s `neutraliseSummary` SENSATIONAL_RE (strips tabloid words
from DISPLAYED summaries) MUST remain a strict SUPERSET of the gate's
`SENSATIONAL_RE` in `cargoReportValidation.ts`.

**Why:** Key-Incident / appendix summaries are derived from ingested incident
text and are NOT editable in the report editor. If a scraped summary contains a
word the gate detects (e.g. `terroris*`, `maraud*`, `fearless`, `rampag*`) but
the neutraliser does NOT strip, the whole report hard-blocks with no in-editor
remedy — an unsatisfiable gate. Keeping the strip vocabulary a superset makes
`SENSATIONAL_HEADLINE` pass by construction on model-derived text.

**How to apply:** Any time you add a term to the gate's SENSATIONAL_RE, add a
covering term to the model's SENSATIONAL_RE in lockstep (use `\w*` stems, e.g.
`terror\w*` covers terroriz*/terroris*/reign-of-terror once "terror" is stripped;
`daring` breaks "daring raid").

## INVARIANT 2 — Polestar View 120–160 words: gate is FLOOR-only

The spec requires the Polestar View to be 120–160 words, but the spec's own
enumerated failure list only gates the FLOOR (`POLESTAR_TOO_SHORT`, < 120). There
is deliberately NO 160-word ceiling check.

**Why:** A ceiling gate would self-block, and the ceiling is a content guideline,
not a generation-failure condition per the spec. The 120–160 range is instead met
BY CONSTRUCTION: `buildPolestarView` emits six fixed sentences (judgement,
supports, not-support, limitations, outlook, confidence) sized to land ~137–157
words. Word count swings with the `geo` (a `topCountry` result, 1–3 words) and
lead-pattern fills, so keep the sentences tight — a verbose rewrite can push the
realistic worst case (3-word country + multi-word patterns) back over 160.

**How to apply:** If you edit `buildPolestarView`, re-measure across fills
(no-geo/lean → 3-word-country/long-patterns) and keep every case within 120–160;
never drop one of the six required elements to save words.
