---
name: Jakarta brief NULL-category → crime default
description: Why an unclassified incident reads as "crime" in the Jakarta/structured briefs, and how to add Bahasa verb-root category rules safely.
---

# Jakarta brief NULL-category defaults to the crime theme

An incident with `category = NULL` (e.g. an `apac_local`/`indonesia_local` row the
shared classifier never matched) is coerced to `DEFAULT_CATEGORY = "Other security"`
in `pngReportDataset.ts`, and `jakartaBrief.ts` `jakartaThemeForCategory` maps
anything unmapped to the **crime** theme (`?? "crime"`). So an unclassified item
(a road accident, a utility outage) silently surfaces as the "most serious reported
crime" — a no-fabrication defect, not a data problem.

**Why:** the theme default is optimistic ("if we can't place it, treat it as a
security event"); combined with a classifier gap this misrepresents the record.

**How to apply:** when a brief's crime lead looks wrong, first check the item's
stored `category`. A NULL there means the shared classifier
(`lib/ingest/src/structuredExtract.ts` `CATEGORY_RULES`) has a vocabulary gap, not
that the brief logic is broken. Fix it at the classifier.

## Bahasa verb-root gap (the recurring shape)

Bahasa headlines use bare verb roots the noun-based rules miss — e.g. `tabrak`
(collide) vs `tabrakan` (collision). Adding a rule for one:

- Place the new CATEGORY_RULE **after** the crime rules (theft / armed robbery /
  homicide) so a crime-primary headline that also contains the verb still
  classifies as crime.
- Gate against metaphor: `tabrak aturan` / `tabrak konstitusi` = "flout the
  rules/constitution", NOT a collision. Require a vehicle noun (or a fixed
  collision phrase like `tabrak lari` / `tabrak beruntun`) within a bounded
  same-sentence window; do not match on the bare verb alone.
- These verbs are Bahasa-only, so English theatres (PNG/West Papua/Thailand/
  Philippines) are structurally unaffected — the blast radius is Indonesia rows only.
- Note a pre-existing split: `tabrakan` reroutes to Natural hazard → Jakarta
  "flooding" theme, while bare `tabrak` stays "traffic". Near-identical crash
  headlines can land in different Jakarta themes.

Regression coverage lives in `__tests__/workbench/structuredExtractHazard.test.ts`
(the "bare-tabrak vehicle rule" describe block). No `RELEVANCE_RULE_VERSION` bump —
this is display categorisation, not the relevance gate.
