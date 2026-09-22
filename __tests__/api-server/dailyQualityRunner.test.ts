/**
 * Daily tracker quality refresh — scheduling and run safety.
 *
 * Exercises the orchestration through injected dependencies, so 24-hour
 * cadence, restart recovery, concurrent triggers, termination and partial
 * failures are all deterministic and need no database.
 */
import {
  createDailyQualityRunner,
  pickResumeCursors,
  type DailyQualityRunnerDeps,
  type DailyQualityTargetContext,
} from "../../artifacts/api-server/src/lib/dailyQualityRun";
import type { DailyQualityCoverageEntry } from "../../lib/ingest/src/dailyQuality";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const COVERAGE: DailyQualityCoverageEntry[] = [
  { key: "alpha", label: "Alpha", kind: "incidents", topics: ["alpha"], collector: "runIngestOnce" },
  { key: "beta", label: "Beta", kind: "incidents", topics: ["beta"], collector: "runIngestOnce" },
  { key: "gamma", label: "Gamma", kind: "strikes", topics: [], collector: "runStrikesOnce" },
];

interface Recorded {
  started: Array<{ id: string; trigger: string; dueAt: Date }>;
  seeded: Array<{ runId: string; keys: string[] }>;
  targets: Array<{ runId: string; key: string; outcome: string }>;
  finished: Array<{ runId: string; status: string; error?: string }>;
  interruptedCalls: number;
  locksTaken: number;
  locksReleased: number;
}

function harness(
  overrides: Partial<DailyQualityRunnerDeps> = {},
  opts: { lastSuccessAt?: Date | null; lockAvailable?: boolean } = {},
) {
  const rec: Recorded = {
    started: [],
    seeded: [],
    targets: [],
    finished: [],
    interruptedCalls: 0,
    locksTaken: 0,
    locksReleased: 0,
  };
  let lockHeld = opts.lockAvailable === false;

  const deps: DailyQualityRunnerDeps = {
    coverage: COVERAGE,
    createRunId: () => "run-1",
    lastSuccessAt: async () => opts.lastSuccessAt ?? null,
    closeInterruptedRuns: async () => {
      rec.interruptedCalls += 1;
      return 0;
    },
    acquireLock: async () => {
      if (lockHeld) return null;
      lockHeld = true;
      rec.locksTaken += 1;
      return async () => {
        lockHeld = false;
        rec.locksReleased += 1;
      };
    },
    loadCursors: async () => new Map<string, number>(),
    startRun: async (run) => {
      rec.started.push({ id: run.id, trigger: run.trigger, dueAt: run.dueAt });
    },
    seedTargets: async (runId, entries) => {
      rec.seeded.push({ runId, keys: entries.map((e) => e.key) });
    },
    checkTarget: async () => ({ outcome: "checked", checked: 1, excluded: 0, review: 0 }),
    recordTarget: async (runId, entry, result) => {
      rec.targets.push({ runId, key: entry.key, outcome: result.outcome });
    },
    recordFindings: async () => undefined,
    finishRun: async (runId, status, _counts, error) => {
      rec.finished.push({ runId, status, error });
    },
    ...overrides,
  };
  return { deps, rec };
}

describe("daily tracker quality refresh — scheduling", () => {
  const now = new Date("2026-09-22T09:00:00.000Z");

  it("runs when a full 24 hours has elapsed since the last successful check", async () => {
    const { deps, rec } = harness({}, { lastSuccessAt: new Date(now.getTime() - DAY) });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(result.ran).toBe(true);
    expect(rec.finished[0]?.status).toBe("completed");
  });

  it("does not run again inside the 24-hour window", async () => {
    const { deps, rec } = harness({}, { lastSuccessAt: new Date(now.getTime() - 23 * HOUR) });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(result).toMatchObject({ ran: false, reason: "not_due" });
    expect(rec.started).toHaveLength(0);
  });

  it("catches up after downtime: an overdue check runs immediately at boot", async () => {
    const { deps, rec } = harness({}, { lastSuccessAt: new Date(now.getTime() - 5 * DAY) });
    const result = await createDailyQualityRunner(deps)({ now, trigger: "boot-catchup" });
    expect(result.ran).toBe(true);
    expect(rec.started[0]?.trigger).toBe("boot-catchup");
    // The due time it was claiming is the one it missed, not its own start.
    expect(rec.started[0]?.dueAt.getTime()).toBe(now.getTime() - 4 * DAY);
  });

  it("runs on a database that has never recorded a successful check", async () => {
    const { deps } = harness({}, { lastSuccessAt: null });
    expect((await createDailyQualityRunner(deps)({ now })).ran).toBe(true);
  });

  it("an owner-triggered run bypasses the due check", async () => {
    const { deps } = harness({}, { lastSuccessAt: new Date(now.getTime() - HOUR) });
    const result = await createDailyQualityRunner(deps)({ now, trigger: "manual", force: true });
    expect(result.ran).toBe(true);
  });
});

describe("daily tracker quality refresh — run safety", () => {
  const now = new Date("2026-09-22T09:00:00.000Z");

  it("closes an abandoned run from a previous process before reading the clock", async () => {
    const calls: string[] = [];
    const { deps } = harness({
      closeInterruptedRuns: async () => {
        calls.push("close");
        return 1;
      },
      lastSuccessAt: async () => {
        calls.push("read");
        return null;
      },
    });
    await createDailyQualityRunner(deps)({ now });
    expect(calls).toEqual(["close", "read"]);
  });

  it("a second concurrent trigger is refused by the lock, not raced", async () => {
    const { deps, rec } = harness({}, { lockAvailable: false });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(result).toMatchObject({ ran: false, reason: "locked" });
    expect(rec.started).toHaveLength(0);
  });

  it("releases the lock even when the run throws", async () => {
    const { deps, rec } = harness({
      startRun: async () => {
        throw new Error("insert failed");
      },
    });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(result.status).toBe("failed");
    expect(rec.locksReleased).toBe(1);
    expect(rec.finished[0]).toMatchObject({ status: "failed" });
  });

  it("one failed tracker does not suppress the others", async () => {
    const { deps, rec } = harness({
      checkTarget: async (entry) => {
        if (entry.key === "beta") throw new Error("beta source exploded");
        return { outcome: "checked", checked: 1, excluded: 0, review: 0 };
      },
    });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(result.ran).toBe(true);
    expect(rec.targets.map((t) => `${t.key}:${t.outcome}`)).toEqual([
      "alpha:checked",
      "beta:error",
      "gamma:checked",
    ]);
  });

  it("seeds every covered tracker up front so an unreached one is visible", async () => {
    const { deps, rec } = harness();
    await createDailyQualityRunner(deps)({ now });
    expect(rec.seeded[0]?.keys).toEqual(["alpha", "beta", "gamma"]);
  });

  it("termination mid-run records an interrupted run, not a completed one", async () => {
    const controller = new AbortController();
    const { deps, rec } = harness({
      checkTarget: async (entry: DailyQualityCoverageEntry, _ctx: DailyQualityTargetContext) => {
        if (entry.key === "alpha") controller.abort();
        return { outcome: "checked", checked: 1, excluded: 0, review: 0 };
      },
    });
    const result = await createDailyQualityRunner(deps)({ now, signal: controller.signal });
    // Alpha completed; beta and gamma were never reached and stay `skipped`.
    expect(rec.targets.map((t) => t.key)).toEqual(["alpha"]);
    expect(rec.finished[0]?.status).toBe("interrupted");
    // An interrupted run must NOT report itself as a successful completion.
    expect(result.status).not.toBe("completed");
  });

  it("an unfinished tracker scan marks the whole run interrupted", async () => {
    const { deps, rec } = harness({
      checkTarget: async (entry) =>
        entry.key === "beta"
          ? { outcome: "incomplete", checked: 3, excluded: 0, review: 0 }
          : { outcome: "checked", checked: 1, excluded: 0, review: 0 },
    });
    await createDailyQualityRunner(deps)({ now });
    expect(rec.finished[0]?.status).toBe("interrupted");
  });

  it("a quiet feed is a successful check, distinct from a broken one", async () => {
    const { deps, rec } = harness({
      checkTarget: async (entry) =>
        entry.key === "alpha"
          ? { outcome: "no_new_records", checked: 0, excluded: 0, review: 0 }
          : entry.key === "beta"
            ? { outcome: "source_failed", checked: 0, excluded: 0, review: 1 }
            : { outcome: "no_collector", checked: 0, excluded: 0, review: 0 },
    });
    const result = await createDailyQualityRunner(deps)({ now });
    expect(rec.targets.map((t) => t.outcome)).toEqual([
      "no_new_records",
      "source_failed",
      "no_collector",
    ]);
    // None of these are collapsed into a single pass/fail.
    expect(result.status).toBe("completed");
  });

  it("carries a stored cursor into the next run so a batch resumes", async () => {
    const seen: Array<number | null> = [];
    const { deps } = harness({
      loadCursors: async () => new Map([["alpha", 4_200]]),
      checkTarget: async (_entry, ctx) => {
        seen.push(ctx.cursor);
        return { outcome: "checked", checked: 1, excluded: 0, review: 0 };
      },
    });
    await createDailyQualityRunner(deps)({ now });
    expect(seen).toEqual([4_200, null, null]);
  });
});

describe("daily tracker quality refresh — durable exclusion evidence", () => {
  const now = new Date("2026-09-22T09:00:00.000Z");

  it("writes an exclusion and its finding through one atomic call, never the end-of-run batch", async () => {
    const commits: Array<{ runId: string; incidentId: number }> = [];
    const batched: string[] = [];
    const { deps } = harness({
      commitExclusion: async (input) => {
        commits.push({ runId: input.runId, incidentId: input.finding.incidentId });
        return true;
      },
      checkTarget: async (entry, ctx: DailyQualityTargetContext) => {
        if (entry.key !== "alpha") {
          return { outcome: "checked", checked: 1, excluded: 0, review: 0 };
        }
        const applied = await ctx.commitExclusion({
          runId: ctx.runId,
          now: ctx.now,
          finding: {
            targetKey: entry.key,
            incidentId: 77,
            kind: "excluded",
            checkName: "sports_noise",
            reason: "Sports fixture result, not a security incident.",
            ruleVersion: "v1",
            beforeStatus: null,
            afterStatus: "irrelevant",
          },
        });
        return { outcome: "checked", checked: 1, excluded: applied ? 1 : 0, review: 0 };
      },
      recordFindings: async (_runId, findings) => {
        for (const f of findings) batched.push(f.kind);
      },
    });

    const result = await createDailyQualityRunner(deps)({ now, force: true });
    expect(result.excluded).toBe(1);
    expect(commits).toEqual([{ runId: "run-1", incidentId: 77 }]);
    // The evidence travels WITH the record change; nothing about the exclusion
    // waits in memory for the end of the run.
    expect(batched).not.toContain("excluded");
  });

  it("keeps one tracker's failed exclusion write from suppressing the others", async () => {
    const { deps, rec } = harness({
      commitExclusion: async () => {
        throw new Error("transaction rolled back");
      },
      checkTarget: async (entry, ctx: DailyQualityTargetContext) => {
        if (entry.key !== "alpha") {
          return { outcome: "checked", checked: 1, excluded: 0, review: 0 };
        }
        await ctx.commitExclusion({
          runId: ctx.runId,
          now: ctx.now,
          finding: {
            targetKey: entry.key,
            incidentId: 9,
            kind: "excluded",
            checkName: "sports_noise",
            reason: "Sports fixture result, not a security incident.",
            ruleVersion: "v1",
            beforeStatus: null,
            afterStatus: "irrelevant",
          },
        });
        return { outcome: "checked", checked: 1, excluded: 1, review: 0 };
      },
    });

    const result = await createDailyQualityRunner(deps)({ now, force: true });
    expect(rec.targets.find((t) => t.key === "alpha")?.outcome).toBe("error");
    expect(rec.targets.find((t) => t.key === "beta")?.outcome).toBe("checked");
    // A rolled-back write must not be counted as an applied exclusion.
    expect(result.excluded).toBe(0);
  });
});

describe("daily tracker quality refresh — backlog cursor wraparound", () => {
  it("starts the backlog over once a target has walked it to the end", () => {
    // Newest row first. The null cursor is the exhaustion marker.
    const cursors = pickResumeCursors([
      { targetKey: "alpha", cursor: null },
      { targetKey: "alpha", cursor: 500 },
      { targetKey: "beta", cursor: 120 },
    ]);
    expect(cursors.has("alpha")).toBe(false);
    expect(cursors.get("beta")).toBe(120);
  });

  it("resumes an interrupted sweep from its latest cursor, not an older one", () => {
    const cursors = pickResumeCursors([
      { targetKey: "alpha", cursor: 900 },
      { targetKey: "alpha", cursor: null },
      { targetKey: "alpha", cursor: 100 },
    ]);
    expect(cursors.get("alpha")).toBe(900);
  });
});
