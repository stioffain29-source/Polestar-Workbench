---
name: Cargo Watch dead read columns
description: cargoSecurityRead/logisticsHubRead editor fields save but never render on the cargo pattern report
---
The Cargo Watch editor still exposes "Cargo Security Read", "Logistics Hub Read" and "Regional Read" textareas (persisted to reports.cargo_security_read etc.), but the CURRENT cargo pattern report (CargoReportPreview + exportTopicReportPdf's cargo branch) never renders those columns. They only render in the generic ReportPreview's legacy cargo branch, which is unreachable — ReportEditor routes cargo_watch to CargoReportPreview.

**Why:** discovered while writing the cargo prose-override parity tests; sentinels on those fields can never appear on either surface, so the parity suites deliberately cover the sections that DO render (executiveSummary + situation/whatMatters/implications/watchNext/polestarView via resolveSimpleProse, under the hard validation gate).

**How to apply:** if the owner reports "my Cargo Security Read edit doesn't show up", this is the cause — either wire the reads into the pattern report (both surfaces + gate implications) or remove the dead editor fields; don't chase a pass-through bug. The gate-passing cargo fixture in prosePassthroughTestHelpers.ts (distinct per-section text, ≥120-word Polestar, no sensational/evidence-claim vocab, in-scope APAC theft incidents) is a reusable template for any test that must survive the 10-check gate.
