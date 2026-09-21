import { and, eq, sql } from "drizzle-orm";
import { db, pool, regionalReportJobsTable, reportsTable } from "@workspace/db";
import { buildRegionalReport } from "./lib/regionalReportBuild";
import { logger } from "./lib/logger";
import { installRegionalReportWorkerLifetime } from "./lib/regionalReportWorkerLifetime";
import {
  buildRegionalRebuildValues,
  getRegionalCoverageManifest,
  matchesExpectedReportVersion,
} from "./lib/regionalReportRebuild";

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
    const target = job.targetReportId
      ? (await db.select().from(reportsTable)
          .where(eq(reportsTable.id, job.targetReportId)))[0]
      : undefined;
    if (job.targetReportId && !target) {
      throw new Error("The regional report selected for refresh no longer exists.");
    }
    if (target && job.expectedUpdatedAt && !matchesExpectedReportVersion(target.updatedAt, job.expectedUpdatedAt)) {
      throw new Error("The report changed before analysis refresh began. Reload it before trying again.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const historicalRebuild = !!target && job.issueDate !== today;
    const priorCoverageManifest = target
      ? getRegionalCoverageManifest(target.hardNumbers)
      : null;
    if (historicalRebuild && !priorCoverageManifest) {
      throw new Error(
        "This historical report has no saved coverage manifest and cannot be safely refreshed without using current-day discovery.",
      );
    }
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
      historicalRebuild
        ? { collect: false, coverageManifest: priorCoverageManifest! }
        : undefined,
    );
    await db.transaction(async (tx) => {
      let report: { id: number };
      if (target && job.expectedUpdatedAt) {
        const updateValues = buildRegionalRebuildValues(target, values);
        const [updated] = await tx.update(reportsTable).set(updateValues).where(and(
          eq(reportsTable.id, target.id),
          // The API/JS version is millisecond-precision; PostgreSQL may retain
          // microseconds. Compare at the same precision, still inside the
          // atomic report/job transaction and run-token fence.
          sql`date_trunc('milliseconds', ${reportsTable.updatedAt}) = ${job.expectedUpdatedAt.toISOString()}`,
        )).returning({ id: reportsTable.id });
        if (!updated) {
          throw new Error(
            "The report changed while analysis was refreshing. No analyst edits were overwritten; reload and retry.",
          );
        }
        report = updated;
      } else {
        [report] = await tx.insert(reportsTable).values(values).returning({
          id: reportsTable.id,
        });
      }
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