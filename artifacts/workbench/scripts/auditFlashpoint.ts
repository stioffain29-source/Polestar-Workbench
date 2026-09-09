/**
 * Audit dump: prints the ACTUAL records that survive into the report and the
 * ACTUAL records that get dropped, straight from live data, so a human can
 * verify by eye that (a) nothing junk got in and (b) nothing real got out.
 *   PROD_DATABASE_URL=... pnpm --filter @workspace/workbench exec tsx scripts/auditFlashpoint.ts
 */
import {
  buildFlashpointReportDataset,
  selectFlashpointUsable,
  validateFlashpointReportDataset,
  resolveFlashpointRenderedModel,
  validateFlashpointRenderedModel,
  type FlashpointReportIncident,
} from "../src/lib/flashpointReportDataset";
import { FLASHPOINT_VALIDITY_VERSION } from "@workspace/relevance";

const TOPIC = process.env.TOPIC ?? "protests";
const ISSUE = process.env.ISSUE ?? new Date().toISOString().slice(0, 10);

async function main() {
  const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("PROD_DATABASE_URL or DATABASE_URL is required");
  process.env.DATABASE_URL = databaseUrl;

  // Direct read-only replay is intentional: normal incident routes are
  // owner-session protected, and an audit must not weaken that boundary.
  const {
    db,
    incidentsTable,
    reportsTable,
    reportProseTable,
    incidentValidityAuditTable,
  } = await import("@workspace/db");
  const { and, desc, eq, gte, or, sql } = await import("drizzle-orm");
  const since = new Date(`${ISSUE}T23:59:59.999Z`);
  since.setUTCDate(since.getUTCDate() - 365);
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(and(
      or(
        eq(incidentsTable.topic, "flashpoint"),
        eq(incidentsTable.topic, "protests"),
      ),
      gte(incidentsTable.occurredAt, since),
    ))
    .orderBy(desc(incidentsTable.occurredAt));
  const incidents: FlashpointReportIncident[] = rows.map((row) => ({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    incidentDate: row.incidentDate?.toISOString() ?? null,
  }));

  const selection = selectFlashpointUsable(incidents, TOPIC, ISSUE);
  const ds = buildFlashpointReportDataset(incidents, TOPIC, ISSUE);
  const validationErrors = validateFlashpointReportDataset(ds);
  const reports = await db
    .select()
    .from(reportsTable)
    .where(and(eq(reportsTable.topic, TOPIC), eq(reportsTable.issueDate, ISSUE)))
    .orderBy(desc(reportsTable.createdAt));
  const persistedReport = reports[0] ?? null;
  const proseRows = persistedReport
    ? await db.select().from(reportProseTable).where(eq(reportProseTable.reportId, persistedReport.id))
    : [];
  const persistedProse = proseRows[0] ?? null;
  const validityAuditGroups = await db
    .select({
      classifierVersion: incidentValidityAuditTable.classifierVersion,
      verdict: incidentValidityAuditTable.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(incidentValidityAuditTable)
    .groupBy(
      incidentValidityAuditTable.classifierVersion,
      incidentValidityAuditTable.verdict,
    )
    .orderBy(
      incidentValidityAuditTable.classifierVersion,
      incidentValidityAuditTable.verdict,
    );
  const persistedAiBasis = persistedProse
    ? (
        persistedProse.edited
          ? persistedProse.editedGenerationBasisFingerprint
          : persistedProse.generationBasisFingerprint
      ) ?? null
    : null;
  const reportBasisMatches =
    !persistedReport ||
    persistedReport.proseBasisFingerprint === ds.canonical.fingerprint;
  const proseBasisMatches =
    !persistedProse || persistedAiBasis === ds.canonical.fingerprint;
  const finalModel = resolveFlashpointRenderedModel({
    dataset: ds,
    report: persistedReport
      ? {
          ...persistedReport,
          datasetFingerprint: persistedReport.proseBasisFingerprint,
        }
      : null,
    ai: persistedProse
      ? {
          ...(persistedProse.edited ?? persistedProse.sections ?? {}),
          datasetFingerprint: persistedAiBasis,
          stale: !proseBasisMatches,
        }
      : null,
  });
  const finalValidationErrors = validateFlashpointRenderedModel(finalModel);
  const stageCounts = Object.fromEntries(
    [...new Set(selection.rejected.map((r) => r.stage))]
      .sort()
      .map((stage) => [
        stage,
        selection.rejected.filter((r) => r.stage === stage).length,
      ]),
  );
  const semanticStatusCounts = incidents.reduce<Record<string, number>>((out, row) => {
    const status = row.validityStatus == null ? "legacy_null" : row.validityStatus.trim().toLowerCase() || "blank";
    out[status] = (out[status] ?? 0) + 1;
    return out;
  }, {});
  const rejectionReasonCounts = selection.rejected.reduce<Record<string, number>>((out, row) => {
    out[row.reason] = (out[row.reason] ?? 0) + 1;
    return out;
  }, {});
  const currentVersionCount = incidents.filter(
    (row) =>
      row.validityVersion === FLASHPOINT_VALIDITY_VERSION &&
      row.validityGates?.version === FLASHPOINT_VALIDITY_VERSION,
  ).length;
  const incidentsById = new Map(incidents.map((row) => [String(row.id), row]));
  const hasCurrentSemanticDecision = (id: string | number) => {
    const row = incidentsById.get(String(id));
    return Boolean(
      row?.validityStatus &&
      row.validityVersion === FLASHPOINT_VALIDITY_VERSION &&
      row.validityGates?.version === FLASHPOINT_VALIDITY_VERSION,
    );
  };
  const unadjudicatedWindowCount = selection.rejected.filter(
    (row) =>
      row.stage === "semantic-validity" &&
      !hasCurrentSemanticDecision(row.id),
  ).length;
  const heldForReviewWindowCount = selection.rejected.filter(
    (row) =>
      row.stage === "semantic-validity" &&
      hasCurrentSemanticDecision(row.id) &&
      incidentsById.get(String(row.id))?.validityStatus === "needs_review",
  ).length;
  const acceptedIdsConsistent =
    JSON.stringify(selection.enriched.map((r) => String(r.id)).sort()) ===
    JSON.stringify(ds.canonical.acceptedIds.map(String).sort());
  const chartTotal = ds.countryRows.reduce((sum, r) => sum + r.value, 0);
  const chartCountries = new Set(ds.countryRows.map((r) => r.label));
  const canonicalChartGroupingCount = ds.canonical.periodRows.filter(
    (r) => r.country && chartCountries.has(r.country),
  ).length;

  console.log(JSON.stringify({
    topic: TOPIC,
    issueDate: ISSUE,
    fetched: incidents.length,
    rawWindowCount: selection.rawWindowCount,
    semanticStatusCounts,
    gateStageCounts: stageCounts,
    rejectionReasonCounts,
    auditTableCounts: {
      reports: reports.length,
      persistedProseRows: proseRows.length,
      rejectionLedgerRows: ds.canonical.rejected.length,
    },
    validityAuditByClassifierVersionAndVerdict: validityAuditGroups,
    reportProseBasisMatchesCanonical: reportBasisMatches,
    generatedProseBasisMatchesCanonical: proseBasisMatches,
    currentVersionCount,
    currentVersionCoverage: incidents.length ? currentVersionCount / incidents.length : 1,
    currentWindowVersionCoverage: selection.rawWindowCount
      ? (selection.rawWindowCount - unadjudicatedWindowCount) / selection.rawWindowCount
      : 1,
    unadjudicatedWindowCount,
    heldForReviewWindowCount,
    acceptedCount: selection.enriched.length,
    rejectedCount: selection.rejected.length,
    duplicateCollapse: selection.dedupedDropped,
    canonicalCount: ds.canonical.acceptedIds.length,
    canonicalPeriodCount: ds.canonical.periodRows.length,
    canonicalFutureCount: ds.canonical.futureRows.length,
    fingerprint: ds.canonical.fingerprint,
    acceptedIdsConsistent,
    chartTotal,
    canonicalChartGroupingCount,
    chartCountConsistent: chartTotal === canonicalChartGroupingCount,
    validation: validationErrors.length === 0 ? "pass" : "fail",
    validationErrors,
    finalResolvedProseValidation:
      finalValidationErrors.length === 0 ? "pass" : "fail",
    finalResolvedProseValidationErrors: finalValidationErrors,
  }, null, 2));
  if (
    validationErrors.length ||
    finalValidationErrors.length ||
    unadjudicatedWindowCount > 0 ||
    !acceptedIdsConsistent
    || !reportBasisMatches
    || !proseBasisMatches
  ) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
