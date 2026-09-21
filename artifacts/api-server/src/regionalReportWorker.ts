import { and, eq } from "drizzle-orm";
import { db, pool, regionalReportJobsTable, reportsTable } from "@workspace/db";
import { buildRegionalReport } from "./lib/regionalReportBuild";
import { logger } from "./lib/logger";
import { installRegionalReportWorkerLifetime } from "./lib/regionalReportWorkerLifetime";

const jobId = process.argv[2] ?? "";
const runToken = process.argv[3] ?? "";

async function main(): Promise<void> {
  const [job] = await db.update(regionalReportJobsTable).set({
    stage: "collecting",
    updatedAt: new Date(),
  }).where(and(
    eq(regionalReportJobsTable.id, jobId),
    eq(regionalReportJobsTable.status, "running"),
    eq(regionalReportJobsTable.runToken, runToken),
  )).returning();
  if (!job) return;
  logger.info({ jobId }, "regional report build started");
  try {
    const values = await buildRegionalReport(
      job.topic as "apac_weekly" | "middle_east_weekly",
      job.issueDate,
      async (stage) => {
        const updated = await db.update(regionalReportJobsTable).set({
          stage,
          updatedAt: new Date(),
        }).where(and(
          eq(regionalReportJobsTable.id, jobId),
          eq(regionalReportJobsTable.runToken, runToken),
          eq(regionalReportJobsTable.status, "running"),
        )).returning({ id: regionalReportJobsTable.id });
        if (updated.length === 0) throw new Error("Regional report job ownership was lost.");
      },
    );
    await db.transaction(async (tx) => {
      const [report] = await tx.insert(reportsTable).values(values).returning();
      const completed = await tx.update(regionalReportJobsTable).set({
        status: "completed",
        stage: "completed",
        reportId: report.id,
        error: null,
        runToken: null,
        updatedAt: new Date(),
      }).where(and(
        eq(regionalReportJobsTable.id, jobId),
        eq(regionalReportJobsTable.runToken, runToken),
        eq(regionalReportJobsTable.status, "running"),
      )).returning({ id: regionalReportJobsTable.id });
      if (completed.length === 0) throw new Error("Regional report job ownership was lost before save.");
    });
    logger.info({ jobId }, "regional report build completed");
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    await db.update(regionalReportJobsTable).set({
      status: "failed",
      stage: "failed",
      error: error.slice(0, 8_000),
      runToken: null,
      updatedAt: new Date(),
    }).where(and(
      eq(regionalReportJobsTable.id, jobId),
      eq(regionalReportJobsTable.runToken, runToken),
      eq(regionalReportJobsTable.status, "running"),
    ));
    logger.error({ err: cause, jobId }, "regional report build failed");
    process.exitCode = 1;
  }
}

const workerTimeoutMs =
  Math.max(1, Number(process.env.REGIONAL_REPORT_TIMEOUT_MINUTES ?? 5) || 5) * 60_000;
const clearLifetime = installRegionalReportWorkerLifetime({
  timeoutMs: workerTimeoutMs,
  onTerminate: (reason) => {
    logger.error({ jobId, reason }, "regional report worker forcibly terminating");
    process.exit(reason === "deadline" ? 124 : 125);
  },
});

void main()
  .catch((cause) => {
    logger.error({ err: cause, jobId }, "regional report worker fatal error");
    process.exitCode = 1;
  })
  .finally(async () => {
    clearLifetime();
    await pool.end();
  });