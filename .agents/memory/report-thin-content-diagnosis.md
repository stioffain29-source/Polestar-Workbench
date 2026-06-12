---
name: Report "thin content" diagnosis
description: When a topic report reads thin / shows a "Data quality issue" Fast Fact, the cause is usually TWO coupled things — a thin ReportPack AND a coarse classifier dumping records into "Other".
---

A user complaint that a topic report's "prose and content is thin" usually has two coupled causes, and BOTH must be fixed together:

1. **Thin ReportPack** in `artifacts/workbench/src/lib/draftReportProse.ts` — the per-topic pack returns single sentences instead of the multi-paragraph structure the FUEL/SHIPPING packs use (3-para exec, 2-para whatMatters, 5-bullet implications, 5-line watchNext). Mirror a rich pack; keep it data-driven from `ctx` and obey the no-count-annotation prose rule.

2. **Coarse classifier** in `incidentClassifier.ts` — when `classify<Topic>` dumps the plurality of records into `"Other <topic> incident"`, `sanitizeFactValue` (lib/relevance) maps that to `"Multiple <topic> incident types"` and `topicFastFacts.ts` then shows the **"Data quality issue"** note (it fires when `safeType !== topTypeLabel`). Broaden the buckets so a real type wins the plurality and the note disappears.

**Why:** the two surface independently but read as one "thin" problem — fixing only the prose still leaves the data-quality apology; fixing only the classifier still leaves shallow narrative.

**How to apply / verify:**
- `classifyIncidentType` is **display-only** (prose + Fast Facts). It does NOT gate relevance or severity, so broadening it is low-risk to data integrity.
- Reports seed prose live when the `reports` DB columns are empty (`pick(saved='', drafted) → drafted`), so a pack change updates an open report immediately — no reseed/staleness needed.
- Verify the classifier's new plurality against the **relevance-filtered + report-window** row set, NOT all topic rows. The report applies `relevance_status<>'irrelevant'` AND its cadence window (e.g. monthly ≈ last 30 days from issue date). Classifying the raw table over-counts "Other" with rows the report never shows.
- The reports table has NO `executive_summary` column; the exec summary is regenerated, not stored.
