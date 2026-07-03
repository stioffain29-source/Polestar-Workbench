---
name: PNG stored-severity inversion (display-layer demote hedge)
description: Why the PNG country report led with assistance PR and buried crime, and the no-fabrication demote-only corrector that fixes it at the display layer.
---

# PNG severity inversion

The upstream ingest severity classifier rates Papua New Guinea rows BACKWARDS:
non-kinetic assistance / prevention / ceremonial PR ("Community leaders trained
to help stop sorcery violence", "Tribal foundation helped displaced SARV
victims") is stored **high/extreme**, while genuine crime ("Armed suspect shot
during robbery", gang jailings) is stored **low**. Result: the structured PNG
brief led with hyperbole (asserting High-severity violence when the only High
rows were aid PR) and appeared to surface zero crime.

**Fix (display-layer only):** `artifacts/workbench/src/lib/pngSeverityCorrection.ts`
demotes clearly non-kinetic assistance items to Low. It is **DEMOTE-ONLY** —
capping a bad High is safe, but UP-rating a stored Low would invent severity
(fabrication), which is forbidden. Predicate = assistance-lexicon hit AND NOT a
kinetic veto (perpetrator act verbs, violent-actor nouns, explicit casualty
counts, homicide terms). Veto is checked FIRST so a real event with an
assistance word ("aid convoy ambushed") is never demoted.

**Why:** STRICT no-fabrication. The classifier is the real bug; this is a hedge.

**How to apply:**
- Gated to PNG ONLY via config flag `demoteNonKineticWire` (set only on
  `PNG_REPORT_CONFIG` in `pngReportDataset.ts`) + `structuredTheatre === "png"`
  guard in `CountryReport.tsx`. West Papua / Indonesia / Jakarta stay
  byte-identical (corrector inert unless the flag is set).
- Injection points that fully cover screen + BOTH PDF paths: (1) `toItem()` in
  `pngReportDataset.ts` applies it BEFORE severityLabel/severityRank derive, so
  the structured brief (screen body + headless PDF, which returns early and
  renders only from the builder) inherits it; (2) the `facts` useMemo in
  `CountryReport.tsx` corrects the `computeCountryFastFacts` inputs so the
  on-screen map/Fast Facts agree; the in-app "Download PDF" rasterises the DOM
  so it inherits the screen correction automatically. `exportCountryReportPdf.ts`
  needs NO change (structured path never calls drawFastFactsKpiCards).
- **Veto must cover homicide vocab.** The assistance lexicon has broad tokens
  (`launch*`, `commission*`) that collide with real headlines ("Police launch
  manhunt after double murder", "Commissioner probes killings"), so
  `KINETIC_ACT_RE` must include `murder*/killing(s)/massacre*/manslaughter`.
  Any new broad assistance token needs a matching veto audit.
- Durable follow-up (NOT done): fix the ingest severity classifier in
  `lib/ingest` so this display hedge can be retired.
