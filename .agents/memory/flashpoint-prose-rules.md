---
name: Flashpoint prose rules
description: Style constraints for auto-generated Flashpoint report prose builders.
---

Rule: report prose builders must read as analyst judgement, not count narration. Banned idioms include "N records on file", "highest severity of <tier>", "the mix breaks down as protest (N) and strike (N)", "covers N APAC countries", "A further N countries".

**Why:** User brief explicitly forbids count-led/severity-stat openings; they read as machine output and undercut the analyst voice. Counts already appear in Fast Facts KPI cards, the country chart, and the Related Incidents / Activism / Civil Unrest / Forecast tables — repeating them in prose is redundant.

**How to apply:** In `flashpointReportDataset.ts` prose builders (`buildAutoExecutiveSummary`, `buildActivismRead`, `buildCivilUnrestRead`, `buildForecastRead`, `buildRegionalCountryRead`, `buildWhatMatters`, `buildImplications`, `buildPolestarView`), describe trajectory, drivers, state posture, geography spread, and operational implications without numeric narration. Qualitative ranking is fine ("lead geography", "second-heaviest", "the heaviest concentration"). Polestar View must open with a one-sentence directional verdict before supporting paragraphs.
