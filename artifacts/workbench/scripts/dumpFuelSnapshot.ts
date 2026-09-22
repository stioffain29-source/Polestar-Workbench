/**
 * Read-only Fuel Watch snapshot dump.
 *
 * Writes the report row, its relevance-passing incident window (fuel plus the
 * shipping and energy cross-reads the editor fetches) and its cached prose to
 * a JSON file that verifyFuelReportCoverage.ts can replay in a real browser.
 *
 * SELECT only. Never writes to the database.
 *
 *   DATABASE_URL=... REPORT_ID=178 OUT_PATH=/tmp/fuel-178.json \
 *     pnpm exec tsx --import ./scripts/registerLoader.mjs scripts/dumpFuelSnapshot.ts
 */
import { writeFileSync } from "node:fs";
import { desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  pool,
  reportsTable,
  incidentsTable,
  reportProseTable,
} from "@workspace/db";

async function main() {
  const reportId = Number(process.env.REPORT_ID);
  if (!Number.isInteger(reportId)) throw new Error("REPORT_ID is required.");
  const outPath = process.env.OUT_PATH ?? `/tmp/fuel-report-${reportId}-snapshot.json`;

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, reportId));
  if (!report) throw new Error(`Report ${reportId} not found.`);

  const incidents = await db
    .select()
    .from(incidentsTable)
    .where(
      or(
        isNull(incidentsTable.relevanceStatus),
        ne(incidentsTable.relevanceStatus, "irrelevant"),
      ),
    )
    .orderBy(desc(incidentsTable.occurredAt));

  const scoped = incidents.filter((row) =>
    ["fuel", "shipping", "energy"].includes(row.topic ?? ""),
  );

  const [prose] = await db
    .select()
    .from(reportProseTable)
    .where(eq(reportProseTable.reportId, reportId));

  const snapshot = {
    report: JSON.parse(JSON.stringify(report)),
    incidents: scoped.map((row) => ({
      id: row.id,
      topic: row.topic,
      title: row.title,
      displayTitle: row.displayTitle ?? null,
      summary: row.summary ?? null,
      country: row.country ?? null,
      location: row.location ?? null,
      severity: row.severity ?? "",
      occurredAt:
        row.occurredAt instanceof Date
          ? row.occurredAt.toISOString()
          : row.occurredAt,
      source: row.source ?? null,
      sourceUrl: row.sourceUrl ?? null,
    })),
    proseCache: prose ? JSON.parse(JSON.stringify(prose)) : undefined,
    metadata: { dumpedAt: new Date().toISOString(), reportId },
  };
  writeFileSync(outPath, JSON.stringify(snapshot));
  console.log(
    JSON.stringify({
      outPath,
      reportId,
      topic: report.topic,
      issueDate: report.issueDate,
      incidents: snapshot.incidents.length,
      hasProse: !!prose,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
