import { and, eq, inArray, sql } from "drizzle-orm";
import { db, reportsTable } from "@workspace/db";
import {
  regionalCanonicalReportFromHardNumbers,
  validateRegionalCanonicalIntegrity,
  type RegionalCanonicalReport,
} from "../../../workbench/src/lib/regionalWeekly";
import { logger } from "./logger";

const FINAL_TARGETS = new Map<number, "apac_weekly" | "middle_east_weekly">([
  [166, "apac_weekly"],
  [167, "middle_east_weekly"],
]);
const FINAL_ISSUE_DATE = "2026-09-22";

export type RegionalFinalContentEntry = {
  id: number;
  topic: string;
  issueDate: string;
  expectedUpdatedAt: string;
  hardNumbers: unknown;
};

export type RegionalFinalContentResult = {
  status: "applied" | "skipped" | "dry-run";
  reason?: "target_changed";
};

type LockedReport = {
  id: number;
  topic: string;
  issueDate: string;
  updatedAt: Date | null;
  hardNumbers: unknown;
};

type RegionalFinalContentTransaction = {
  lock(ids: number[]): Promise<LockedReport[]>;
  update(
    entry: RegionalFinalContentEntry,
    mergedHardNumbers: unknown,
    updatedAt: Date,
  ): Promise<boolean>;
};

type RegionalFinalContentStore = {
  transaction<T>(
    callback: (tx: RegionalFinalContentTransaction) => Promise<T>,
  ): Promise<T>;
};

const productionStore: RegionalFinalContentStore = {
  transaction: (callback) => db.transaction(async (tx) => callback({
    lock: async (ids) => tx.select({
      id: reportsTable.id,
      topic: reportsTable.topic,
      issueDate: reportsTable.issueDate,
      updatedAt: reportsTable.updatedAt,
      hardNumbers: reportsTable.hardNumbers,
    }).from(reportsTable).where(inArray(reportsTable.id, ids)).for("update"),
    update: async (entry, hardNumbers, updatedAt) => {
      const [updated] = await tx.update(reportsTable).set({
        hardNumbers: hardNumbers as typeof reportsTable.$inferInsert.hardNumbers,
        updatedAt,
      }).where(and(
        eq(reportsTable.id, entry.id),
        eq(reportsTable.topic, entry.topic),
        eq(reportsTable.issueDate, entry.issueDate),
        sql`date_trunc('milliseconds', ${reportsTable.updatedAt}) = ${new Date(entry.expectedUpdatedAt).toISOString()}`,
      )).returning({ id: reportsTable.id });
      return !!updated;
    },
  })),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeHardNumbers(existing: unknown, replacement: unknown): unknown {
  if (!isObject(existing) || !isObject(replacement)) return replacement;
  return { ...existing, ...replacement };
}

function validatePayload(payload: RegionalFinalContentEntry[]): void {
  if (!Array.isArray(payload) || payload.length !== FINAL_TARGETS.size) {
    throw new Error("Regional final content manifest must contain exactly the two approved reports.");
  }
  const seen = new Set<number>();
  for (const entry of payload) {
    const expectedTopic = FINAL_TARGETS.get(entry.id);
    if (
      !expectedTopic ||
      seen.has(entry.id) ||
      entry.topic !== expectedTopic ||
      entry.issueDate !== FINAL_ISSUE_DATE ||
      !Number.isFinite(new Date(entry.expectedUpdatedAt).getTime())
    ) {
      throw new Error("Regional final content manifest target identity is invalid.");
    }
    seen.add(entry.id);
    if (!isObject(entry.hardNumbers) || !isObject(entry.hardNumbers.regionalCanonicalReport)) {
      throw new Error("Regional final content manifest has no canonical report.");
    }
    const canonical = entry.hardNumbers.regionalCanonicalReport as unknown as RegionalCanonicalReport;
    let errors: string[];
    try {
      errors = validateRegionalCanonicalIntegrity(canonical);
    } catch {
      errors = ["Canonical report structure is malformed."];
    }
    if (
      errors.length > 0 ||
      !regionalCanonicalReportFromHardNumbers(entry.hardNumbers, expectedTopic, FINAL_ISSUE_DATE)
    ) {
      throw new Error("Regional final content manifest failed canonical validation.");
    }
  }
}

/**
 * Applies the paired final editions only when both saved rows still match the
 * versions reviewed by editorial. A stale or absent row makes the whole pair a
 * normal, fail-closed no-op.
 */
export async function applyRegionalFinalContentCorrections(
  payload: RegionalFinalContentEntry[],
  options: {
    dryRun?: boolean;
    store?: RegionalFinalContentStore;
    now?: () => Date;
  } = {},
): Promise<RegionalFinalContentResult> {
  validatePayload(payload);
  const store = options.store ?? productionStore;
  const result = await store.transaction(async (tx): Promise<RegionalFinalContentResult> => {
    const rows = await tx.lock(payload.map((entry) => entry.id));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const matches = payload.every((entry) => {
      const row = byId.get(entry.id);
      return row?.topic === entry.topic &&
        row.issueDate === entry.issueDate &&
        row.updatedAt?.getTime() === new Date(entry.expectedUpdatedAt).getTime();
    });
    if (!matches) return { status: "skipped", reason: "target_changed" };
    if (options.dryRun) return { status: "dry-run" };

    const updatedAt = (options.now ?? (() => new Date()))();
    for (const entry of payload) {
      const row = byId.get(entry.id)!;
      const updated = await tx.update(
        entry,
        mergeHardNumbers(row.hardNumbers, entry.hardNumbers),
        updatedAt,
      );
      // Rows are locked, but retain the CAS on the writes as a final fence.
      if (!updated) throw new Error("Regional final content CAS failed after target lock.");
    }
    return { status: "applied" };
  });
  logger.info(
    { status: result.status, reason: result.reason, reportIds: [...FINAL_TARGETS.keys()] },
    "regional final content correction",
  );
  return result;
}