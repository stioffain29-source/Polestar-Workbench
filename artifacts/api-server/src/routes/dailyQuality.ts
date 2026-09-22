import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  dailyQualityRunsTable,
  dailyQualityTargetsTable,
  dailyQualityFindingsTable,
} from "@workspace/db";
import { DAILY_QUALITY_COVERAGE, nextDailyQualityDueAt } from "@workspace/ingest";
import {
  latestDailyQualityRun,
  lastSuccessfulDailyQualityRun,
  runDailyQualityCheck,
} from "../lib/dailyQualityRun";
import { logger } from "../lib/logger";

/**
 * Daily tracker quality refresh — operational status and manual rerun.
 *
 * Mounted BELOW the owner gate in routes/index.ts: this exposes internal run
 * diagnostics, which belong in Source Health and nowhere near a report page or
 * an exported document.
 */
const router: IRouter = Router();

const MAX_FINDINGS = 200;

async function buildStatus() {
  const [latest, lastSuccess] = await Promise.all([
    latestDailyQualityRun(),
    lastSuccessfulDailyQualityRun(),
  ]);

  // Per-tracker rows always come from the LATEST attempt, so a failed run shows
  // what it managed and what it did not — not the last good run's results.
  const targets = latest
    ? await db
        .select()
        .from(dailyQualityTargetsTable)
        .where(eq(dailyQualityTargetsTable.runId, latest.id))
        .orderBy(dailyQualityTargetsTable.id)
    : [];

  const findings = latest
    ? await db
        .select()
        .from(dailyQualityFindingsTable)
        .where(eq(dailyQualityFindingsTable.runId, latest.id))
        .orderBy(desc(dailyQualityFindingsTable.id))
        .limit(MAX_FINDINGS)
    : [];

  const byKey = new Map(targets.map((t) => [t.targetKey, t]));

  return {
    // Last ATTEMPT and last SUCCESS are separate on purpose: an attempt that
    // failed must not make the product look freshly checked.
    lastAttemptAt: latest?.startedAt?.toISOString() ?? null,
    lastAttemptStatus: latest?.status ?? null,
    lastAttemptTrigger: latest?.trigger ?? null,
    lastAttemptError: latest?.error ?? null,
    lastSuccessAt: lastSuccess?.finishedAt?.toISOString() ?? null,
    nextDueAt: lastSuccess?.finishedAt
      ? nextDailyQualityDueAt(lastSuccess.finishedAt).toISOString()
      : null,
    running: latest?.status === "running",
    checkedCount: latest?.checkedCount ?? 0,
    excludedCount: latest?.excludedCount ?? 0,
    reviewCount: latest?.reviewCount ?? 0,
    // Driven by the coverage map, not by what happened to be written, so a
    // tracker the run never reached is still listed — as unreached.
    targets: DAILY_QUALITY_COVERAGE.map((entry) => {
      const row = byKey.get(entry.key);
      return {
        key: entry.key,
        label: entry.label,
        kind: entry.kind,
        outcome: row?.outcome ?? "skipped",
        detail: row?.detail ?? (latest ? null : "No daily check has run yet."),
        checkedCount: row?.checkedCount ?? 0,
        excludedCount: row?.excludedCount ?? 0,
        reviewCount: row?.reviewCount ?? 0,
        finishedAt: row?.finishedAt?.toISOString() ?? null,
      };
    }),
    findings: findings.map((f) => ({
      id: f.id,
      targetKey: f.targetKey,
      incidentId: f.incidentId,
      kind: f.kind,
      check: f.checkName,
      reason: f.reason,
      title: f.title,
      sourceUrl: f.sourceUrl,
      ruleVersion: f.ruleVersion,
      beforeStatus: f.beforeStatus,
      afterStatus: f.afterStatus,
      createdAt: f.createdAt?.toISOString() ?? null,
    })),
  };
}

router.get("/daily-quality", async (_req: Request, res: Response) => {
  try {
    res.json(await buildStatus());
  } catch (err) {
    logger.error({ err }, "daily quality status failed");
    res.status(500).json({ error: "daily_quality_status_failed" });
  }
});

router.post("/daily-quality/run", async (_req: Request, res: Response) => {
  try {
    const result = await runDailyQualityCheck({ trigger: "manual", force: true });
    if (!result.ran && result.reason === "locked") {
      res.status(409).json({ error: "already_running", message: "A daily check is already in progress." });
      return;
    }
    res.json({ ...result, status: await buildStatus() });
  } catch (err) {
    logger.error({ err }, "manual daily quality run failed");
    res.status(500).json({ error: "daily_quality_run_failed" });
  }
});

export default router;
