---
name: Cargo Watch dead read columns
description: cargoSecurityRead/logisticsHubRead editor fields save but never render on the cargo pattern report
---
The three cargo reads — "Cargo Security Read" (`cargoSecurityRead`), "Logistics Hub Read" (`logisticsHubRead`), and "Regional Read" (`regionalCountryRead`) — are now WIRED into both CargoReportPreview and exportTopicReportPdf's cargo branch. They appear after enforcement activity and before the Situation section.

**Why:** previously they only rendered in the unreachable legacy ReportPreview cargo branch. The fix hoisted a shared `cargoNarrativeIncidents` array so all four builders (buildCargoPatternModel + the three reads) derive from the same windowed set.

**How to apply:** auto-text comes from `buildCargoSecurityRead` / `buildLogisticsHubRead` / `buildCargoCountryBreakdown(…).regionalRead`; editor override via `pickRead` wins as with all other cargo reads. Section keys: `cargo-security-read`, `logistics-hub-read`, `regional-read`. All three are covered by CARGO_SENTINELS in prosePassthroughTestHelpers.ts (both parity suites). The gate-passing cargo fixture (distinct per-section text, ≥120-word Polestar, no sensational/evidence-claim vocab, in-scope APAC theft incidents) is still the reusable template for any test that must survive the 10-check gate.
