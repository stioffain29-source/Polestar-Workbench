/**
 * Headless-PDF report field pass-through guard (task 448).
 *
 * Task 445 found the headless flashpoint PDF silently ignored four saved prose
 * sections because `exportReportPdfHeadless.ts` hand-mapped the report columns
 * and omitted them — the preview showed the owner's text while the exported
 * PDF fell back to auto-prose. The exporter now spreads the ENTIRE fetched
 * report row via `buildHeadlessReportData`, so a saved prose override can
 * never render as auto-prose in the headless PDF.
 *
 * This suite derives the expected pass-through from the LIVE Drizzle reports
 * schema: it builds a fake report row with a distinct sentinel in EVERY column
 * and asserts each value survives `buildHeadlessReportData` unchanged (modulo
 * the two documented specials: the ISSUE_DATE override and the
 * executiveSummary→situation fallback). Adding a new prose column to the
 * reports table therefore cannot silently regress the headless PDF — the row
 * spread carries it through automatically, and this test proves it against
 * the real column list.
 */
import { getTableColumns } from "drizzle-orm";
import { reportsTable } from "@workspace/db";

import { buildHeadlessReportData } from "../../artifacts/workbench/scripts/headlessReportData";

const COLUMNS = Object.keys(getTableColumns(reportsTable));

function sentinelRow(): Record<string, unknown> & { issueDate: string } {
  const row: Record<string, unknown> = {};
  for (const key of COLUMNS) row[key] = `__SENTINEL_${key}__`;
  row.issueDate = "2026-07-01";
  return row as Record<string, unknown> & { issueDate: string };
}

describe("buildHeadlessReportData — every reports column passes through", () => {
  it("carries every schema column of the report row into the exporter data", () => {
    const row = sentinelRow();
    const data = buildHeadlessReportData(row) as Record<string, unknown>;
    for (const key of COLUMNS) {
      // Both specials still pass the saved value through when it is set.
      expect(data[key]).toBe(row[key]);
    }
  });

  it("sanity: the schema actually contains the prose/read columns this guards", () => {
    // A representative cross-topic sample — if a rename drops one of these the
    // pass-through test above would silently guard the wrong thing.
    for (const key of [
      "executiveSummary",
      "situation",
      "whatHappened",
      "whatMatters",
      "implications",
      "watchNext",
      "polestarView",
      "activismRead",
      "civilUnrestRead",
      "forecastRead",
      "regionalCountryRead",
      "chokepointRouteRead",
      "vesselPiracyRead",
      "commercialImpactRead",
      "maritimeSecurityRead",
      "cargoSecurityRead",
      "logisticsHubRead",
      "fuelMarketRead",
      "fuelOperationalRead",
      "fuelRegionalHighlights",
      "conflictOtherWatchedRead",
      "conflictAreaReads",
      "sectionOverrides",
      "hardNumbers",
    ]) {
      expect(COLUMNS).toContain(key);
    }
  });

  it("applies the ISSUE_DATE override only when provided", () => {
    const row = sentinelRow();
    expect(buildHeadlessReportData(row).issueDate).toBe("2026-07-01");
    expect(buildHeadlessReportData(row, "  ").issueDate).toBe("2026-07-01");
    expect(buildHeadlessReportData(row, "2026-07-15").issueDate).toBe("2026-07-15");
  });

  it("falls back executiveSummary → situation only when unset", () => {
    const row = sentinelRow();
    expect(buildHeadlessReportData(row).executiveSummary).toBe(
      "__SENTINEL_executiveSummary__",
    );
    const noExec = { ...row, executiveSummary: null };
    expect(buildHeadlessReportData(noExec).executiveSummary).toBe(
      "__SENTINEL_situation__",
    );
  });
});
