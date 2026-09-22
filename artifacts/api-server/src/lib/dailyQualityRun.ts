import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import {
  db,
  pool,
  incidentsTable,
  reportsTable,
  countryReportsTable,
  dailyQualityRunsTable,
  dailyQualityTargetsTable,
  dailyQualityFindingsTable,
  type DailyQualityRun,
} from "@workspace/db";
import {
  DAILY_QUALITY_COVERAGE,
  DAILY_QUALITY_INTERVAL_MS,
  checkIncidentQuality,
  findDuplicateEventFindings,
  isDailyQualityDue,
  nextDailyQualityDueAt,
  type DailyQualityCandidate,
  type DailyQualityCoverageEntry,
  type DailyQualityOutcome,
} from "@workspace/ingest";
import { logger } from "./logger";

/**
 * Daily tracker quality refresh — orchestration.
 *
 * Runs in the API process, which identifies as a `polestar-app:v2` writer, so
 * every write here passes the ingest write fence rather than bypassing it. It
 * takes its OWN advisory lock, distinct from the ingest lock, so a due quality
 * sweep never blocks (or is blocked by) a collection run.
 */

/** "PolD" — distinct from INGEST_LOCK_KEY so the two never contend. */
export const DAILY_QUALITY_LOCK_KEY = 0x506f6c44;

/** A run still "running" past this is treated as abandoned by a restart. */
const RUN_STALE_MS = 60 * 60 * 1000;

/**
 * Report windows the sweep always revisits, regardless of rule version. Weekly
 * reports look back 7 days and monthly ones a calendar month; 35 days covers
 * both plus the reference period a report compares against.
 */
const DEFAULT_WINDOW_DAYS = 35;
const DEFAULT_WINDOW_BATCH = 400;
const DEFAULT_BACKLOG_BATCH = 200;

export interface DailyQualityRunOptions {
  trigger?: "schedule" | "boot-catchup" | "manual";
  now?: Date;
  /** Manual/owner-triggered runs bypass the due check. */
  force?: boolean;
  intervalMs?: number;
  windowDays?: number;
  windowBatch?: number;
  backlogBatch?: number;
  signal?: AbortSignal;
}

export interface DailyQualityRunResult {
  ran: boolean;
  reason?: "locked" | "not_due";
  runId?: string;
  status?: "completed" | "failed";
  checked: number;
  excluded: number;
  review: number;
  targets: number;
}

interface TargetResult {
  outcome: DailyQualityOutcome;
  detail?: string | null;
  checked: number;
  excluded: number;
  review: number;
  cursor?: number | null;
}

interface PendingFinding {
  targetKey: string;
  incidentId: number | null;
  kind: "excluded" | "review";
  checkName: string;
  reason: string;
  title?: string | null;
  sourceUrl?: string | null;
  ruleVersion?: string | null;
  beforeStatus?: string | null;
  afterStatus?: string | null;
}

/** Records this run excluded, kept in memory so report targets can cite them. */
interface ExcludedRecord {
  id: number;
  occurredAt: Date;
  country: string;
  topic: string;
}

export async function lastSuccessfulDailyQualityRun(): Promise<DailyQualityRun | undefined> {
  const [row] = await db
    .select()
    .from(dailyQualityRunsTable)
    .where(eq(dailyQualityRunsTable.status, "completed"))
    .orderBy(desc(dailyQualityRunsTable.finishedAt))
    .limit(1);
  return row;
}

export async function latestDailyQualityRun(): Promise<DailyQualityRun | undefined> {
  const [row] = await db
    .select()
    .from(dailyQualityRunsTable)
    .orderBy(desc(dailyQualityRunsTable.startedAt))
    .limit(1);
  return row;
}

/**
 * A process killed mid-run leaves its row "running" forever, which would both
 * hide the failure and block the next attempt from looking due. Close out
 * anything past the stale deadline as `interrupted` — deliberately NOT
 * `completed`, so it never advances the successful-completion clock.
 */
export async function closeInterruptedDailyQualityRuns(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(dailyQualityRunsTable)
    .set({
      status: "interrupted",
      finishedAt: now,
      error: "Run did not finish; the process was interrupted.",
      updatedAt: now,
    })
    .where(
      and(
        eq(dailyQualityRunsTable.status, "running"),
        lt(dailyQualityRunsTable.startedAt, new Date(now.getTime() - RUN_STALE_MS)),
      ),
    )
    .returning({ id: dailyQualityRunsTable.id });
  return rows.length;
}

/**
 * Pick the cursor each target resumes from. The LATEST row per target wins
 * even when its cursor is null: null is the exhaustion marker meaning the
 * backlog was walked to its end, so the next cycle starts again from the
 * oldest record. Skipping nulls resurrects a stale cursor from an earlier run
 * and the backlog never wraps — the oldest rows are then never rechecked.
 */
export function pickResumeCursors(
  rowsNewestFirst: readonly { targetKey: string; cursor: number | null }[],
): Map<string, number> {
  const cursors = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of rowsNewestFirst) {
    if (seen.has(row.targetKey)) continue;
    seen.add(row.targetKey);
    if (row.cursor !== null && row.cursor !== undefined) cursors.set(row.targetKey, row.cursor);
  }
  return cursors;
}

/** Latest known cursor per target, so an interrupted sweep resumes its backlog. */
async function loadCursors(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      targetKey: dailyQualityTargetsTable.targetKey,
      cursor: dailyQualityTargetsTable.cursor,
      id: dailyQualityTargetsTable.id,
    })
    .from(dailyQualityTargetsTable)
    .orderBy(desc(dailyQualityTargetsTable.id))
    .limit(400);
  return pickResumeCursors(rows);
}

function candidateFromRow(row: {
  id: number;
  topic: string;
  title: string;
  displayTitle: string | null;
  summary: string;
  country: string;
  location: string | null;
  category: string | null;
  source: string | null;
  sourceUrl: string | null;
  occurredAt: Date;
  incidentDate: Date | null;
  relevanceStatus: string | null;
  eventClusterKey: string | null;
  analystNotes: string | null;
}): DailyQualityCandidate {
  return row;
}

const CANDIDATE_COLUMNS = {
  id: incidentsTable.id,
  topic: incidentsTable.topic,
  title: incidentsTable.title,
  displayTitle: incidentsTable.displayTitle,
  summary: incidentsTable.summary,
  country: incidentsTable.country,
  location: incidentsTable.location,
  category: incidentsTable.category,
  source: incidentsTable.source,
  sourceUrl: incidentsTable.sourceUrl,
  occurredAt: incidentsTable.occurredAt,
  incidentDate: incidentsTable.incidentDate,
  relevanceStatus: incidentsTable.relevanceStatus,
  eventClusterKey: incidentsTable.eventClusterKey,
  analystNotes: incidentsTable.analystNotes,
} as const;

/** One exclusion and the evidence that justifies it, written together. */
export interface ExclusionCommit {
  runId: string;
  now: Date;
  finding: PendingFinding & { incidentId: number; ruleVersion: string };
}

/**
 * Persist one definite exclusion through the existing eligibility boundary,
 * TOGETHER with the finding that records it, in a single transaction.
 *
 * Both halves or neither: a record excluded without its before/after evidence
 * is an unexplained, unrecoverable change, which is exactly what a crash
 * between the two writes would leave behind.
 *
 * Compare-and-set on the status we read: a concurrent analyst change (or a
 * competing pass) wins, and nothing is deleted — the source record stays and
 * only its relevance decision moves, so the finding remains fully reversible.
 */
async function commitExclusion(input: ExclusionCommit): Promise<boolean> {
  const { runId, now, finding } = input;
  const beforeStatus = finding.beforeStatus ?? null;
  const statusMatches =
    beforeStatus === null
      ? sql`${incidentsTable.relevanceStatus} IS NULL`
      : sql`${incidentsTable.relevanceStatus} = ${beforeStatus}`;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(incidentsTable)
      .set({
        relevanceStatus: "irrelevant",
        relevanceReason: finding.reason.slice(0, 2_000),
        relevanceVersion: finding.ruleVersion,
        relevanceEvaluatedAt: now,
      })
      .where(and(eq(incidentsTable.id, finding.incidentId), statusMatches))
      .returning({ id: incidentsTable.id });
    if (rows.length === 0) return false;
    await tx.insert(dailyQualityFindingsTable).values({
      runId,
      targetKey: finding.targetKey,
      incidentId: finding.incidentId,
      kind: finding.kind,
      checkName: finding.checkName,
      reason: finding.reason.slice(0, 2_000),
      title: finding.title ?? null,
      sourceUrl: finding.sourceUrl ?? null,
      ruleVersion: finding.ruleVersion,
      beforeStatus: finding.beforeStatus ?? null,
      afterStatus: finding.afterStatus ?? null,
    });
    return true;
  });
}

async function sweepIncidentTarget(
  entry: DailyQualityCoverageEntry,
  ctx: DailyQualityTargetContext,
): Promise<TargetResult> {
  const { now, cursor, cfg, findings, excluded, signal, runId } = ctx;
  const commit = ctx.commitExclusion;
  // Topics this tracker reads but does not own (Crime Watch reads apac_local).
  const borrowed = new Set(entry.borrowedTopics ?? []);
  const windowStart = new Date(now.getTime() - cfg.windowDays * 24 * 60 * 60 * 1000);

  // Current + reference report window. Always rechecked, even at the current
  // rule version — a version-gated backfill skips exactly these rows, which is
  // how a stored sports result survives inside a live reporting window.
  const windowRows = await db
    .select(CANDIDATE_COLUMNS)
    .from(incidentsTable)
    .where(and(inArray(incidentsTable.topic, entry.topics), gte(incidentsTable.occurredAt, windowStart)))
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(cfg.windowBatch);

  // Resumable baseline/backlog sweep. Ascending id from the stored cursor, so
  // every older record is eventually reached instead of being starved by the
  // constantly-refreshed window slice.
  const backlogRows = await db
    .select(CANDIDATE_COLUMNS)
    .from(incidentsTable)
    .where(
      and(
        inArray(incidentsTable.topic, entry.topics),
        lt(incidentsTable.occurredAt, windowStart),
        gt(incidentsTable.id, cursor ?? 0),
      ),
    )
    .orderBy(asc(incidentsTable.id))
    .limit(cfg.backlogBatch);

  const all = [...windowRows, ...backlogRows].map(candidateFromRow);
  let checked = 0;
  let excludedCount = 0;
  let reviewCount = 0;

  for (const row of all) {
    if (signal?.aborted) {
      return {
        outcome: "incomplete",
        detail: "Run was cancelled before this tracker finished.",
        checked,
        excluded: excludedCount,
        review: reviewCount,
        cursor,
      };
    }
    checked += 1;
    const verdict = checkIncidentQuality(row, now, {
      policyTopic: entry.policyTopic,
      borrowed: borrowed.has(row.topic),
    });
    if (verdict.kind === "exclude") {
      // The record and the evidence that explains it are written in ONE
      // transaction, so a crash can never leave a row excluded with no
      // recoverable before/after trail. Deliberately NOT queued into
      // `findings` afterwards: that batch is written at the end of the run.
      const applied = await commit({
        runId,
        now,
        finding: {
          targetKey: entry.key,
          incidentId: row.id,
          kind: "excluded",
          checkName: verdict.checkName,
          reason: verdict.reason,
          title: row.displayTitle ?? row.title,
          sourceUrl: row.sourceUrl ?? null,
          ruleVersion: verdict.ruleVersion,
          beforeStatus: verdict.beforeStatus,
          afterStatus: verdict.afterStatus,
        },
      });
      if (!applied) continue; // a concurrent change won; leave it alone
      excludedCount += 1;
      excluded.push({ id: row.id, occurredAt: row.occurredAt, country: row.country, topic: row.topic });
    } else if (verdict.kind === "review") {
      reviewCount += 1;
      findings.push({
        targetKey: entry.key,
        incidentId: row.id,
        kind: "review",
        checkName: verdict.checkName,
        reason: verdict.reason,
        title: row.displayTitle ?? row.title,
        sourceUrl: row.sourceUrl ?? null,
        ruleVersion: verdict.ruleVersion,
        beforeStatus: verdict.beforeStatus,
        afterStatus: verdict.afterStatus,
      });
    }
  }

  // Duplicate-event review across the current window only, via the product's
  // existing cluster authority. Flagged, never removed.
  for (const duplicate of findDuplicateEventFindings(windowRows.map(candidateFromRow))) {
    reviewCount += 1;
    const source = windowRows.find((r) => r.id === duplicate.incidentId);
    findings.push({
      targetKey: entry.key,
      incidentId: duplicate.incidentId,
      kind: "review",
      checkName: "duplicate",
      reason: duplicate.reason,
      title: source?.displayTitle ?? source?.title ?? null,
      sourceUrl: source?.sourceUrl ?? null,
    });
  }

  // Wrap the backlog cursor once exhausted so older rows are revisited on a
  // later cycle rather than being permanently skipped.
  const nextCursor =
    backlogRows.length === 0 ? null : backlogRows[backlogRows.length - 1]!.id;

  if (entry.collector === null) {
    return {
      outcome: "no_collector",
      detail: entry.note ?? "This tracker has no dedicated scheduled collector.",
      checked,
      excluded: excludedCount,
      review: reviewCount,
      cursor: nextCursor,
    };
  }
  if (checked === 0) {
    return {
      outcome: "no_new_records",
      detail: "Checked successfully; no records in the current window or backlog.",
      checked: 0,
      excluded: 0,
      review: 0,
      cursor: nextCursor,
    };
  }
  return {
    outcome: "checked",
    detail: null,
    checked,
    excluded: excludedCount,
    review: reviewCount,
    cursor: nextCursor,
  };
}

/** Latest timestamp in a supporting store, or null when the store is absent. */
async function latestStoreTimestamp(table: string, column: string): Promise<Date | null | "missing"> {
  const exists = await db.execute(
    sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`,
  );
  const present = (exists.rows?.[0] as { present?: boolean } | undefined)?.present;
  if (!present) return "missing";
  const hasColumn = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `);
  if ((hasColumn.rowCount ?? 0) === 0) return "missing";
  const result = await db.execute(
    sql`SELECT max(${sql.identifier(column)}) AS latest FROM ${sql.identifier(table)}`,
  );
  const latest = (result.rows?.[0] as { latest?: string | Date | null } | undefined)?.latest;
  if (!latest) return null;
  return latest instanceof Date ? latest : new Date(latest);
}

interface StoreSpec {
  table: string;
  column: string;
  maxAgeHours: number;
}

/**
 * Supporting stores are freshness-checked only. Prices, vessel positions and
 * piracy events are not ordinary incidents and must never be swept as such.
 */
const STORE_SPECS: Record<string, StoreSpec> = {
  strikes: { table: "strikes", column: "occurred_at", maxAgeHours: 24 * 14 },
  maritime_movement: { table: "maritime_movement", column: "data_as_of", maxAgeHours: 48 },
  maritime_security: { table: "maritime_security_events", column: "incident_date", maxAgeHours: 24 * 45 },
};

async function checkStoreTarget(
  entry: DailyQualityCoverageEntry,
  now: Date,
): Promise<TargetResult> {
  const spec = STORE_SPECS[entry.key];
  if (!spec) {
    return {
      outcome: "no_collector",
      detail: entry.note ?? "No supporting store is mapped for this tracker.",
      checked: 0,
      excluded: 0,
      review: 0,
    };
  }
  const latest = await latestStoreTimestamp(spec.table, spec.column);
  if (latest === "missing") {
    return {
      outcome: "no_collector",
      detail: `The ${spec.table} store is not present in this environment, so its freshness cannot be confirmed.`,
      checked: 0,
      excluded: 0,
      review: 0,
    };
  }
  if (latest === null) {
    return {
      outcome: "provider_disabled",
      detail:
        `${entry.label} holds no records. ` +
        (entry.note ?? "Its provider is unavailable or switched off; this is not a successful refresh."),
      checked: 0,
      excluded: 0,
      review: 0,
    };
  }
  const ageHours = (now.getTime() - latest.getTime()) / (60 * 60 * 1000);
  if (ageHours > spec.maxAgeHours) {
    return {
      outcome: "source_failed",
      detail: `Newest ${entry.label} record is ${Math.round(ageHours)}h old (limit ${spec.maxAgeHours}h).`,
      checked: 1,
      excluded: 0,
      review: 1,
    };
  }
  return {
    outcome: "checked",
    detail: `Newest record ${Math.round(ageHours)}h old.`,
    checked: 1,
    excluded: 0,
    review: 0,
  };
}

/**
 * Price freshness comes from the market feed's own source-health row, not from
 * an incident date. A price series is not an incident stream and must not be
 * judged by one.
 */
async function checkMarketTarget(entry: DailyQualityCoverageEntry, now: Date): Promise<TargetResult> {
  const result = await db.execute(sql`
    SELECT max(last_success_at) AS latest
    FROM sources
    WHERE topic = 'fuel'
      AND (name ILIKE '%price%' OR name ILIKE '%fred%' OR source_type ILIKE '%price%')
  `);
  const raw = (result.rows?.[0] as { latest?: string | Date | null } | undefined)?.latest;
  if (!raw) {
    return {
      outcome: "no_collector",
      detail: "No market price feed is registered in source health, so price freshness cannot be confirmed.",
      checked: 0,
      excluded: 0,
      review: 0,
    };
  }
  const latest = raw instanceof Date ? raw : new Date(raw);
  const ageHours = (now.getTime() - latest.getTime()) / (60 * 60 * 1000);
  if (ageHours > 26) {
    return {
      outcome: "source_failed",
      detail: `Last successful price refresh was ${Math.round(ageHours)}h ago.`,
      checked: 1,
      excluded: 0,
      review: 1,
    };
  }
  return {
    outcome: "checked",
    detail: `Last successful price refresh ${Math.round(ageHours)}h ago. ${entry.note ?? ""}`.trim(),
    checked: 1,
    excluded: 0,
    review: 0,
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Revalidate a saved report against its OWN period. If this run excluded a
 * record inside that window, the report's curated evidence may no longer hold,
 * so it gets an actionable review finding. The report's text, issue date and
 * reporting window are never touched — a saved snapshot and analyst prose are
 * flagged, not rewritten.
 */
async function checkRegionalReportTarget(
  entry: DailyQualityCoverageEntry,
  excluded: readonly ExcludedRecord[],
  findings: PendingFinding[],
): Promise<TargetResult> {
  const [report] = await db
    .select({ id: reportsTable.id, title: reportsTable.title, issueDate: reportsTable.issueDate })
    .from(reportsTable)
    .where(eq(reportsTable.topic, entry.key))
    .orderBy(desc(reportsTable.issueDate))
    .limit(1);
  if (!report) {
    return {
      outcome: "no_new_records",
      detail: "No saved report exists for this region yet.",
      checked: 0,
      excluded: 0,
      review: 0,
    };
  }
  const issued = new Date(`${report.issueDate}T00:00:00.000Z`);
  const windowStart = new Date(issued.getTime() - WEEK_MS);
  const affected = excluded.filter(
    (row) => row.occurredAt >= windowStart && row.occurredAt <= issued,
  );
  if (affected.length === 0) {
    return {
      outcome: "checked",
      detail: `Evidence for "${report.title}" (${report.issueDate}) still holds.`,
      checked: 1,
      excluded: 0,
      review: 0,
    };
  }
  findings.push({
    targetKey: entry.key,
    incidentId: null,
    kind: "review",
    checkName: "relevance",
    reason:
      `"${report.title}" (${report.issueDate}) cites a period in which ${affected.length} ` +
      `record(s) were excluded today. Review its evidence before reissuing; its text and issue date are unchanged.`,
    title: report.title,
  });
  return {
    outcome: "checked",
    detail: `${affected.length} excluded record(s) fall inside this report's period.`,
    checked: 1,
    excluded: 0,
    review: 1,
  };
}

async function checkCountryBriefTarget(
  entry: DailyQualityCoverageEntry,
  now: Date,
  excluded: readonly ExcludedRecord[],
  findings: PendingFinding[],
): Promise<TargetResult> {
  const briefs = await db
    .select({
      id: countryReportsTable.id,
      slug: countryReportsTable.slug,
      name: countryReportsTable.name,
    })
    .from(countryReportsTable)
    .orderBy(asc(countryReportsTable.name));
  if (briefs.length === 0) {
    return { outcome: "no_new_records", detail: "No saved country briefs.", checked: 0, excluded: 0, review: 0 };
  }
  // Country and city briefs render a rolling weekly window rather than a fixed
  // issue date, so each is revalidated against that same window.
  const windowStart = new Date(now.getTime() - WEEK_MS);
  let review = 0;
  for (const brief of briefs) {
    const affected = excluded.filter(
      (row) =>
        row.occurredAt >= windowStart &&
        row.country.toLowerCase() === brief.name.toLowerCase(),
    );
    if (affected.length === 0) continue;
    review += 1;
    findings.push({
      targetKey: entry.key,
      incidentId: null,
      kind: "review",
      checkName: "relevance",
      reason:
        `The ${brief.name} brief covers a window in which ${affected.length} record(s) were excluded ` +
        `today. Review its evidence; its saved prose and window are unchanged.`,
      title: brief.name,
    });
  }
  return {
    outcome: "checked",
    detail: `${briefs.length} brief(s) revalidated against their own windows.`,
    checked: briefs.length,
    excluded: 0,
    review,
  };
}

async function runTarget(
  entry: DailyQualityCoverageEntry,
  ctx: DailyQualityTargetContext,
): Promise<TargetResult> {
  switch (entry.kind) {
    case "incidents":
      return sweepIncidentTarget(entry, ctx);
    case "strikes":
    case "maritime":
      return checkStoreTarget(entry, ctx.now);
    case "market":
      return checkMarketTarget(entry, ctx.now);
    case "report":
      return entry.key === "country_briefs"
        ? checkCountryBriefTarget(entry, ctx.now, ctx.excluded, ctx.findings)
        : checkRegionalReportTarget(entry, ctx.excluded, ctx.findings);
    default:
      return {
        outcome: "skipped",
        detail: "No check is mapped for this tracker kind.",
        checked: 0,
        excluded: 0,
        review: 0,
      };
  }
}


/** Everything a target check needs, passed explicitly so it stays testable. */
export interface DailyQualityTargetContext {
  runId: string;
  now: Date;
  cursor: number | null;
  cfg: { windowDays: number; windowBatch: number; backlogBatch: number };
  findings: PendingFinding[];
  excluded: ExcludedRecord[];
  /**
   * Writes one exclusion and its finding atomically. Injected so a failure
   * between the two halves can be exercised without a database.
   */
  commitExclusion: (input: ExclusionCommit) => Promise<boolean>;
  signal?: AbortSignal;
}

/**
 * The I/O the run performs, injected so scheduling, locking, restart recovery
 * and partial-failure behaviour can be exercised deterministically without a
 * database. `runDailyQualityCheck` below binds the real implementations.
 */
export interface DailyQualityRunnerDeps {
  lastSuccessAt: () => Promise<Date | null>;
  closeInterruptedRuns: (now: Date) => Promise<number>;
  /** Resolves to a release function when the lock was taken, else null. */
  acquireLock: () => Promise<(() => Promise<void>) | null>;
  loadCursors: () => Promise<Map<string, number>>;
  startRun: (run: {
    id: string;
    trigger: string;
    startedAt: Date;
    dueAt: Date;
  }) => Promise<void>;
  seedTargets: (
    runId: string,
    entries: readonly DailyQualityCoverageEntry[],
    cursors: Map<string, number>,
  ) => Promise<void>;
  checkTarget: (
    entry: DailyQualityCoverageEntry,
    ctx: DailyQualityTargetContext,
  ) => Promise<TargetResult>;
  recordTarget: (
    runId: string,
    entry: DailyQualityCoverageEntry,
    result: TargetResult,
    startedAt: Date,
  ) => Promise<void>;
  /** Defaults to the real transactional writer. */
  commitExclusion?: (input: ExclusionCommit) => Promise<boolean>;
  /** Review findings only; exclusions are written with their record. */
  recordFindings: (runId: string, findings: readonly PendingFinding[]) => Promise<void>;
  finishRun: (
    runId: string,
    status: "completed" | "failed" | "interrupted",
    counts: { checked: number; excluded: number; review: number },
    error?: string,
  ) => Promise<void>;
  createRunId?: () => string;
  coverage?: readonly DailyQualityCoverageEntry[];
}

export function createDailyQualityRunner(
  deps: DailyQualityRunnerDeps,
): (options?: DailyQualityRunOptions) => Promise<DailyQualityRunResult> {
  const coverage = deps.coverage ?? DAILY_QUALITY_COVERAGE;
  const createRunId = deps.createRunId ?? (() => randomUUID());

  return async function runDailyQuality(
    options: DailyQualityRunOptions = {},
  ): Promise<DailyQualityRunResult> {
    const now = options.now ?? new Date();
    const intervalMs = options.intervalMs ?? DAILY_QUALITY_INTERVAL_MS;
    const cfg = {
      windowDays: options.windowDays ?? DEFAULT_WINDOW_DAYS,
      windowBatch: options.windowBatch ?? DEFAULT_WINDOW_BATCH,
      backlogBatch: options.backlogBatch ?? DEFAULT_BACKLOG_BATCH,
    };
    const empty = { checked: 0, excluded: 0, review: 0, targets: 0 };

    // Restart recovery: a process killed mid-run left its row "running". Close
    // it as interrupted BEFORE reading the completion clock, so an abandoned
    // run neither hides the failure nor blocks the next attempt.
    await deps.closeInterruptedRuns(now);

    const lastSuccess = await deps.lastSuccessAt();
    if (!options.force && !isDailyQualityDue(lastSuccess, now, intervalMs)) {
      return { ran: false, reason: "not_due", ...empty };
    }

    // Concurrent triggers (two instances, or a manual click during the
    // scheduled run) are resolved by the lock, not by racing writes.
    const release = await deps.acquireLock();
    if (!release) return { ran: false, reason: "locked", ...empty };

    const runId = createRunId();
    try {
      const due = nextDailyQualityDueAt(lastSuccess, intervalMs);
      await deps.startRun({
        id: runId,
        trigger: options.trigger ?? "schedule",
        startedAt: now,
        dueAt: due.getTime() === 0 ? now : due,
      });

      const cursors = await deps.loadCursors();
      // Seed EVERY covered tracker up front as `skipped`, so a tracker the run
      // never reaches is visibly unreached rather than silently absent.
      await deps.seedTargets(runId, coverage, cursors);

      const findings: PendingFinding[] = [];
      const excluded: ExcludedRecord[] = [];
      let checked = 0;
      let excludedCount = 0;
      let review = 0;
      let aborted = false;

      for (const entry of coverage) {
        const startedAt = new Date();
        let result: TargetResult;
        if (options.signal?.aborted) {
          // Terminated mid-run. Remaining trackers stay `skipped`; the run is
          // recorded as interrupted so it never advances the success clock.
          aborted = true;
          break;
        }
        try {
          result = await deps.checkTarget(entry, {
            runId,
            now,
            cursor: cursors.get(entry.key) ?? null,
            cfg,
            findings,
            excluded,
            commitExclusion: deps.commitExclusion ?? commitExclusion,
            signal: options.signal,
          });
        } catch (err) {
          // One failed tracker must never suppress the others.
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, target: entry.key }, "daily quality target failed");
          result = {
            outcome: "error",
            detail: message.slice(0, 1_000),
            checked: 0,
            excluded: 0,
            review: 0,
          };
        }
        checked += result.checked;
        excludedCount += result.excluded;
        review += result.review;
        if (result.outcome === "incomplete") aborted = true;
        await deps.recordTarget(runId, entry, result, startedAt);
      }

      if (findings.length > 0) await deps.recordFindings(runId, findings);

      const status = aborted ? "interrupted" : "completed";
      await deps.finishRun(
        runId,
        status,
        { checked, excluded: excludedCount, review },
        aborted ? "Run was terminated before every tracker finished." : undefined,
      );

      logger.info(
        { runId, status, checked, excluded: excludedCount, review },
        "daily quality refresh finished",
      );
      return {
        ran: true,
        runId,
        status: status === "completed" ? "completed" : "failed",
        checked,
        excluded: excludedCount,
        review,
        targets: coverage.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "daily quality refresh failed");
      await deps
        .finishRun(runId, "failed", { checked: 0, excluded: 0, review: 0 }, message.slice(0, 4_000))
        .catch(() => undefined);
      return { ran: true, runId, status: "failed", checked: 0, excluded: 0, review: 0, targets: 0 };
    } finally {
      await release().catch(() => undefined);
    }
  };
}

/** Real database-backed dependencies. */
function databaseDeps(): DailyQualityRunnerDeps {
  return {
    lastSuccessAt: async () => (await lastSuccessfulDailyQualityRun())?.finishedAt ?? null,
    closeInterruptedRuns: (now) => closeInterruptedDailyQualityRuns(now),
    acquireLock: async () => {
      const client = await pool.connect();
      try {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1) AS locked",
          [DAILY_QUALITY_LOCK_KEY],
        );
        if (result.rows[0]?.locked !== true) {
          client.release();
          return null;
        }
      } catch (err) {
        client.release();
        throw err;
      }
      return async () => {
        await client
          .query("SELECT pg_advisory_unlock($1)", [DAILY_QUALITY_LOCK_KEY])
          .catch(() => undefined);
        client.release();
      };
    },
    loadCursors,
    startRun: async (run) => {
      await db.insert(dailyQualityRunsTable).values({
        id: run.id,
        trigger: run.trigger,
        status: "running",
        startedAt: run.startedAt,
        dueAt: run.dueAt,
        updatedAt: run.startedAt,
      });
    },
    seedTargets: async (runId, entries, cursors) => {
      await db.insert(dailyQualityTargetsTable).values(
        entries.map((entry) => ({
          runId,
          targetKey: entry.key,
          label: entry.label,
          kind: entry.kind,
          outcome: "skipped" satisfies DailyQualityOutcome,
          detail: "Not reached by this run.",
          cursor: cursors.get(entry.key) ?? null,
        })),
      );
    },
    commitExclusion,
    checkTarget: (entry, ctx) => runTarget(entry, ctx),
    recordTarget: async (runId, entry, result, startedAt) => {
      await db
        .update(dailyQualityTargetsTable)
        .set({
          outcome: result.outcome,
          detail: result.detail ?? null,
          checkedCount: result.checked,
          excludedCount: result.excluded,
          reviewCount: result.review,
          cursor: result.cursor ?? null,
          startedAt,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(dailyQualityTargetsTable.runId, runId),
            eq(dailyQualityTargetsTable.targetKey, entry.key),
          ),
        );
    },
    recordFindings: async (runId, findings) => {
      // Chunked so a large sweep cannot exceed the bind-parameter limit.
      for (let i = 0; i < findings.length; i += 200) {
        await db.insert(dailyQualityFindingsTable).values(
          findings.slice(i, i + 200).map((finding) => ({
            runId,
            targetKey: finding.targetKey,
            incidentId: finding.incidentId,
            kind: finding.kind,
            checkName: finding.checkName,
            reason: finding.reason.slice(0, 2_000),
            title: finding.title ?? null,
            sourceUrl: finding.sourceUrl ?? null,
            ruleVersion: finding.ruleVersion ?? null,
            beforeStatus: finding.beforeStatus ?? null,
            afterStatus: finding.afterStatus ?? null,
          })),
        );
      }
    },
    finishRun: async (runId, status, counts, error) => {
      const finishedAt = new Date();
      await db
        .update(dailyQualityRunsTable)
        .set({
          status,
          finishedAt,
          error: error ?? null,
          checkedCount: counts.checked,
          excludedCount: counts.excluded,
          reviewCount: counts.review,
          updatedAt: finishedAt,
        })
        .where(eq(dailyQualityRunsTable.id, runId));
    },
  };
}

/**
 * Run the daily quality refresh once against the real database. Returns
 * without running when it is not due, or when another instance holds the
 * lock — neither is a failure, and neither advances the completion clock.
 */
export async function runDailyQualityCheck(
  options: DailyQualityRunOptions = {},
): Promise<DailyQualityRunResult> {
  return createDailyQualityRunner(databaseDeps())(options);
}
