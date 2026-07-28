---
name: Headless exporter report-row pass-through
description: The headless PDF exporter spreads the entire fetched report row; parity suites guard preview==PDF for saved prose overrides. Don't reintroduce hand-mapped field lists.
---

**Rule:** `exportReportPdfHeadless.ts` no longer hand-maps report columns — it spreads the ENTIRE fetched row via `scripts/headlessReportData.ts` (`buildHeadlessReportData`; only specials: ISSUE_DATE override + executiveSummary→situation fallback). Never reintroduce a hand-built field list; new report prose columns pass through automatically.

**Why:** The old hand-mapped `data` object silently dropped saved prose overrides (flashpoint reads first, and it had ALSO been missing every shipping/cargo/fuel/conflict read) so the headless PDF rendered auto-prose while the preview showed the owner's text.

**How to apply:** Guards live in `__tests__/workbench/headlessReportDataPassthrough.test.ts` (schema-derived: every `reportsTable` column survives the builder) and `reportProseOverridePdf.test.ts` + `reportProseOverridePreview.test.tsx` (same sentinel fixtures via `prosePassthroughTestHelpers.ts` prove each editable section's saved text reaches BOTH the PDF text stream and the preview markup). When testing PDF prose with the recording `pdfChrome` stub, record `renderProse`/`drawSectionWithProse`/`drawBulletSection` bodies — prose never hits raw `pdf.text`. Also: ad-hoc dump scripts with reduced row shapes under-count vs the real path; boot relevance backfill runs async after api-server restart — poll persisted `relevance_status` before re-exporting.
