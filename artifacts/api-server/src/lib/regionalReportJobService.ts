import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  regionalReportJobsTable,
  type RegionalReportJobRow,
} from "@workspace/db";
import { logger } from "./logger";
import type { RegionalReportTopic } from "./regionalReportBuild";
import type { RegionalReportJob } from "@workspace/api-zod";

export function toRegionalReportJob(row: RegionalReportJobRow): RegionalReportJob {
  return {
    id: row.id,
    topic: row.topic as RegionalReportTopic,
    issueDate: row.issueDate,
    status: row.status as RegionalReportJob["status"],
    stage: row.stage as RegionalReportJob["stage"],
    reportId: row.reportId,
    error: row.error,
  };
}

const timeoutMs = Math.max(1, Number(process.env.REGIONAL_REPORT_TIMEOUT_MINUTES ?? 5) || 5) * 60_000;
const graceMs = 5_000;
const workerPath = path.resolve(path.dirname(process.argv[1] ?? process.cwd()), "regionalReportWorker.mjs");
const active = new Map<string, ChildProcess>();
let recoveryTimer: NodeJS.Timeout | undefined;

export function regionalReportWorkerAppName(jobId: string, runToken: string): string {
  return `polestar-app:v2:regional-report:${jobId.slice(0, 8)}:${runToken.slice(0, 16)}`;
}

export async function getRegionalReportJob(id: string): Promise<RegionalReportJobRow | undefined> {
  const [row] = await db.select().from(regionalReportJobsTable)
    .where(eq(regionalReportJobsTable.id, id));
  return row;
}

async function failOwnedJob(jobId: string, runToken: string, error: string): Promise<void> {
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
}

function logFailureUpdateRejection(jobId: string, err: unknown): void {
  logger.error({ err, jobId }, "regional report job failure update rejected");
}

export async function launchRegionalReportJob(
  jobId: string,
  options: {
    forkWorker?: (jobId: string, runToken: string) => ChildProcess;
    timeout?: number;
    grace?: number;
  } = {},
): Promise<void> {
  if (active.has(jobId)) return;
  const runToken = randomUUID();
  // Reserve ownership in PostgreSQL before spawning. This is the cross-process
  // CAS: a spawn failure and every later parent failure can only mutate this
  // exact run token, never a queued replacement or a newer retry.
  const [reserved] = await db.update(regionalReportJobsTable).set({
    status: "running",
    stage: "collecting",
    runToken,
    startedAt: new Date(),
    error: null,
    updatedAt: new Date(),
    attempt: sql`${regionalReportJobsTable.attempt} + 1`,
  }).where(and(
    eq(regionalReportJobsTable.id, jobId),
    eq(regionalReportJobsTable.status, "queued"),
    isNull(regionalReportJobsTable.runToken),
  )).returning({ id: regionalReportJobsTable.id });
  if (!reserved) return;
  let child: ChildProcess;
  try {
    child = (options.forkWorker ?? ((id, token) => fork(workerPath, [id, token], {
      execArgv: ["--enable-source-maps"],
      // This is a normal v2 application writer, not the globally fenced ingest
      // protocol. Keep the label under PostgreSQL's 63-byte application_name
      // limit while retaining enough job/run identity for diagnostics.
      env: {
        ...process.env,
        PGAPPNAME: regionalReportWorkerAppName(id, token),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    })))(jobId, runToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failOwnedJob(jobId, runToken, message);
    throw err;
  }
  active.set(jobId, child);
  logger.info({ jobId }, "regional report job worker started");
  let timedOut = false;
  let processError: Error | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, options.grace ?? graceMs);
    killTimer.unref?.();
  }, options.timeout ?? timeoutMs);
  timer.unref?.();
  child.once("error", (err) => {
    processError = err;
    // A spawn failure has no process that can still write. Other ChildProcess
    // errors are not terminal: wait for exit so a live worker is never fenced
    // as failed while it can continue collecting or saving.
    if (child.pid === undefined) {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      active.delete(jobId);
      void failOwnedJob(jobId, runToken, err.message).catch((failureErr) => {
        logFailureUpdateRejection(jobId, failureErr);
      });
    }
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    active.delete(jobId);
    const error = timedOut
      ? `Regional report worker timed out after ${options.timeout ?? timeoutMs}ms`
      : code === 0
        ? null
        : processError?.message ??
          `Regional report worker exited (code=${code}, signal=${signal ?? "none"})`;
    if (error) {
      void failOwnedJob(jobId, runToken, error).catch((failureErr) => {
        logFailureUpdateRejection(jobId, failureErr);
      });
    }
    logger[error ? "error" : "info"]({ jobId, code, signal, error }, "regional report job worker finished");
  });
}

export async function createOrResumeRegionalReportJob(input: {
  requestId: string;
  topic: RegionalReportTopic;
  issueDate: string;
}): Promise<{ job: RegionalReportJobRow; conflict: boolean }> {
  await db.insert(regionalReportJobsTable).values({
    id: input.requestId,
    topic: input.topic,
    issueDate: input.issueDate,
  }).onConflictDoNothing();
  let job = await getRegionalReportJob(input.requestId);
  if (!job) throw new Error("Regional report job could not be created.");
  if (job.topic !== input.topic || job.issueDate !== input.issueDate) {
    return { job, conflict: true };
  }
  if (job.status === "failed" && job.reportId === null) {
    const [retried] = await db.update(regionalReportJobsTable).set({
      status: "queued",
      stage: "queued",
      error: null,
      runToken: null,
      startedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(regionalReportJobsTable.id, input.requestId),
      eq(regionalReportJobsTable.status, "failed"),
    )).returning();
    if (retried) job = retried;
  }
  if (job.status === "queued") {
    void launchRegionalReportJob(job.id).catch((err) => {
      logger.error({ err, jobId: job.id }, "regional report worker launch failed");
    });
  }
  return { job, conflict: false };
}

export async function recoverRegionalReportJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - timeoutMs - graceMs);
  await db.update(regionalReportJobsTable).set({
    status: "queued",
    stage: "queued",
    runToken: null,
    startedAt: null,
    error: null,
    updatedAt: new Date(),
  }).where(and(
    eq(regionalReportJobsTable.status, "running"),
    or(
      lt(regionalReportJobsTable.startedAt, staleBefore),
      isNull(regionalReportJobsTable.startedAt),
    ),
  ));
  const queued = await db.select().from(regionalReportJobsTable)
    .where(eq(regionalReportJobsTable.status, "queued"));
  for (const job of queued) {
    void launchRegionalReportJob(job.id).catch((err) => {
      logger.error({ err, jobId: job.id }, "recovered regional report worker launch failed");
    });
  }
  logger.info({ count: queued.length }, "regional report jobs recovered");
  if (!recoveryTimer) {
    // A worker can outlive a rolling API restart. Leave its lease intact, then
    // periodically reclaim it only after the hard worker deadline has passed.
    recoveryTimer = setInterval(() => {
      void recoverRegionalReportJobs().catch((err) => {
        logger.error({ err }, "regional report periodic recovery failed");
      });
    }, 60_000);
    recoveryTimer.unref?.();
  }
}