// Shared report-row → exporter-data pass-through for the headless PDF exporter.
//
// Task 445 found the headless flashpoint PDF silently ignored four saved prose
// sections because exportReportPdfHeadless.ts hand-mapped the report columns
// and omitted them — the preview showed the owner's text while the exported
// PDF fell back to auto-prose. The same hand-mapping pattern would have
// regressed again the next time a prose column was added (and in fact already
// missed the shipping/cargo/fuel/conflict "reads").
//
// The fix is structural: SPREAD the fetched report row so EVERY column —
// including any prose/read column added in the future — reaches the per-topic
// exporters exactly as the on-screen preview sees it. Only two fields are
// deliberately adjusted, mirroring the editor's behaviour:
//   - issueDate: an optional ISSUE_DATE override so a headless run can
//     reproduce the editor's effective reporting window; and
//   - executiveSummary: falls back to `situation` when unset (same fallback
//     the in-app export path applies).
//
// Kept as a tiny pure module (no side effects, no db import) so jest can
// assert the pass-through against the live Drizzle reports schema without
// pulling in the exporter script's fetch/jsPDF patches.

export interface HeadlessReportRow {
  issueDate: string;
  executiveSummary?: string | null;
  situation?: string | null;
  [key: string]: unknown;
}

export function buildHeadlessReportData<T extends HeadlessReportRow>(
  report: T,
  issueDateOverride?: string | null,
): T {
  const override = issueDateOverride?.trim();
  return {
    ...report,
    issueDate: override || report.issueDate,
    executiveSummary: report.executiveSummary ?? report.situation,
  };
}
