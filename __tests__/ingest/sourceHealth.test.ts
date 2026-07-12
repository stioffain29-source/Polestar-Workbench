import {
  recordSourceHealth,
  FAILURE_ESCALATION_THRESHOLD,
  categorizeFeedFailure,
} from "../../lib/ingest/src/sourceHealth";
import { db, sourcesTable } from "@workspace/db";

// Intercept drizzle's eq/and so we can assert what column/value the upsert is
// keyed on, while keeping the rest of drizzle-orm (and pgTable) real.
jest.mock("drizzle-orm", () => {
  const actual = jest.requireActual("drizzle-orm");
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
    and: (...args: unknown[]) => ({ __and: args }),
  };
});

interface Captured {
  selectWhere: any[];
  inserts: any[];
  updates: { set: any; where: any }[];
}

function setupDb(
  opts: {
    existing?: { id: number; consecutiveFailures?: number }[];
    throwOn?: "select" | "insert" | "update";
  } = {},
): Captured {
  const cap: Captured = { selectWhere: [], inserts: [], updates: [] };

  jest.spyOn(db, "select").mockImplementation(
    () =>
      ({
        from: () => ({
          where: (w: any) => {
            if (opts.throwOn === "select") throw new Error("db down");
            cap.selectWhere.push(w);
            return Promise.resolve(opts.existing ?? []);
          },
        }),
      }) as any,
  );

  jest.spyOn(db, "insert").mockImplementation(
    () =>
      ({
        values: (v: any) => {
          if (opts.throwOn === "insert") throw new Error("db down");
          cap.inserts.push(v);
          return Promise.resolve([]);
        },
      }) as any,
  );

  jest.spyOn(db, "update").mockImplementation(
    () =>
      ({
        set: (s: any) => ({
          where: (w: any) => {
            if (opts.throwOn === "update") throw new Error("db down");
            cap.updates.push({ set: s, where: w });
            return Promise.resolve([]);
          },
        }),
      }) as any,
  );

  return cap;
}

afterEach(() => jest.restoreAllMocks());

describe("recordSourceHealth", () => {
  it("inserts an operational row with lastSuccessAt set and the error cleared on a successful feed", async () => {
    const cap = setupDb();

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: true },
    ]);

    expect(cap.inserts).toHaveLength(1);
    expect(cap.updates).toHaveLength(0);
    const row = cap.inserts[0];
    expect(row.name).toBe("Feed A");
    expect(row.topic).toBe("shipping");
    expect(row.url).toBe("http://a.test/rss");
    expect(row.status).toBe("operational");
    expect(row.lastSuccessAt).toBeInstanceOf(Date);
    expect(row.lastFailureAt).toBeNull();
    expect(row.errorMessage).toBeNull();
  });

  it("keeps a feed operational with a transient note on the first failure (insert path)", async () => {
    const cap = setupDb();

    await recordSourceHealth("energy", [
      { name: "Bad Feed", url: "http://b.test/rss", ok: false, error: "timed out after 20000ms" },
    ]);

    expect(cap.inserts).toHaveLength(1);
    const row = cap.inserts[0];
    // A single transient timeout must NOT flip a healthy feed to "failing".
    expect(row.status).toBe("operational");
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastFailureAt).toBeInstanceOf(Date);
    expect(row.lastSuccessAt).toBeNull();
    expect(row.errorMessage).toBe(
      "Transient fetch issue (failed 1x, retrying next run): timed out after 20000ms",
    );
  });

  it("records a 'stale' status (not operational) when a fetched feed's data has frozen", async () => {
    const cap = setupDb();

    await recordSourceHealth("fertiliser", [
      {
        name: "World Bank Pink Sheet",
        url: "http://wb.test/CMO.xlsx",
        ok: true,
        stale: true,
        staleReason: "Latest urea observation 2026-01-15 lags 120d — beyond the ~monthly cadence.",
      },
    ]);

    expect(cap.inserts).toHaveLength(1);
    const row = cap.inserts[0];
    // A silent freeze fetches fine but must surface as "stale", not a green
    // "operational".
    expect(row.status).toBe("stale");
    expect(row.consecutiveFailures).toBe(0);
    // The fetch succeeded, so the success stamp is set and the reason is shown.
    expect(row.lastSuccessAt).toBeInstanceOf(Date);
    expect(row.errorMessage).toBe(
      "Latest urea observation 2026-01-15 lags 120d — beyond the ~monthly cadence.",
    );
  });

  it("treats a fetched feed as operational when stale is false (data still advancing)", async () => {
    const cap = setupDb();

    await recordSourceHealth("fertiliser", [
      { name: "World Bank Pink Sheet", url: "http://wb.test/CMO.xlsx", ok: true, stale: false },
    ]);

    expect(cap.inserts[0].status).toBe("operational");
  });

  it("truncates the error message to 500 characters", async () => {
    const cap = setupDb();

    await recordSourceHealth("fuel", [
      { name: "Noisy Feed", url: "http://c.test/rss", ok: false, error: "x".repeat(600) },
    ]);

    expect(cap.inserts[0].errorMessage).toHaveLength(500);
  });

  it("uses a default error message when a failed feed provides none", async () => {
    const cap = setupDb();

    await recordSourceHealth("fuel", [{ name: "Quiet Feed", url: "http://d.test/rss", ok: false }]);

    expect(cap.inserts[0].errorMessage).toBe(
      "Transient fetch issue (failed 1x, retrying next run): Feed fetch failed",
    );
  });

  it("skips feeds with no name", async () => {
    const cap = setupDb();

    await recordSourceHealth("fuel", [{ name: "", url: "http://e.test/rss", ok: true }]);

    expect(cap.inserts).toHaveLength(0);
    expect(cap.updates).toHaveLength(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("keys the upsert on (name, topic)", async () => {
    const cap = setupDb();

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: true },
    ]);

    expect(cap.selectWhere).toHaveLength(1);
    const predicate = cap.selectWhere[0];
    expect(predicate.__and).toBeDefined();
    const eqPairs = predicate.__and.map((e: any) => e.__eq);
    expect(eqPairs).toContainEqual([sourcesTable.name, "Feed A"]);
    expect(eqPairs).toContainEqual([sourcesTable.topic, "shipping"]);
  });

  it("updates the existing row instead of inserting when one already exists", async () => {
    const cap = setupDb({ existing: [{ id: 7, consecutiveFailures: 0 }] });

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: false, error: "boom" },
    ]);

    expect(cap.inserts).toHaveLength(0);
    expect(cap.updates).toHaveLength(1);
    // First failure off a healthy row stays operational (transient), counter -> 1.
    expect(cap.updates[0].set.status).toBe("operational");
    expect(cap.updates[0].set.consecutiveFailures).toBe(1);
    expect(cap.updates[0].set.lastFailureAt).toBeInstanceOf(Date);
    expect(cap.updates[0].set.errorMessage).toBe(
      "Transient fetch issue (failed 1x, retrying next run): boom",
    );
  });

  it("escalates to failing once consecutive failures reach the threshold", async () => {
    const cap = setupDb({
      existing: [{ id: 7, consecutiveFailures: FAILURE_ESCALATION_THRESHOLD - 1 }],
    });

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: false, error: "still down" },
    ]);

    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0].set.status).toBe("failing");
    expect(cap.updates[0].set.consecutiveFailures).toBe(FAILURE_ESCALATION_THRESHOLD);
    // Once escalated the raw error surfaces (no transient prefix) for operators.
    expect(cap.updates[0].set.errorMessage).toBe("still down");
    expect(cap.updates[0].set.lastFailureAt).toBeInstanceOf(Date);
  });

  it("resets the failure counter and clears the error on a successful fetch", async () => {
    const cap = setupDb({ existing: [{ id: 7, consecutiveFailures: 5 }] });

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: true },
    ]);

    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0].set.status).toBe("operational");
    expect(cap.updates[0].set.consecutiveFailures).toBe(0);
    expect(cap.updates[0].set.errorMessage).toBeNull();
    expect(cap.updates[0].set.lastSuccessAt).toBeInstanceOf(Date);
    // A success must not stamp a new failure timestamp (lets the UI see recovery).
    expect(cap.updates[0].set.lastFailureAt).toBeUndefined();
  });

  it("never throws when the database errors (best-effort telemetry)", async () => {
    setupDb({ throwOn: "insert" });

    await expect(
      recordSourceHealth("shipping", [{ name: "Feed A", url: "http://a.test/rss", ok: true }]),
    ).resolves.toBeUndefined();
  });
});

describe("recordSourceHealth — scrape-health telemetry", () => {
  it("writes the last-run funnel and stamps last-relevant when a successful run retained an in-scope item", async () => {
    const cap = setupDb();

    await recordSourceHealth("cargo_watch", [
      { name: "Port feed", url: "http://p.test/rss", ok: true, collected: 12, retained: 3, rejected: 9 },
    ]);

    const row = cap.inserts[0];
    expect(row.itemsCollected).toBe(12);
    expect(row.itemsRetained).toBe(3);
    expect(row.itemsRejected).toBe(9);
    // Retained > 0 -> a genuine in-scope item this run -> stamp the timestamp.
    expect(row.lastRelevantItemAt).toBeInstanceOf(Date);
    // A successful run clears any prior failure category.
    expect(row.failureReason).toBeNull();
  });

  it("records the funnel but does NOT stamp last-relevant when a successful run retained nothing", async () => {
    const cap = setupDb();

    await recordSourceHealth("cargo_watch", [
      { name: "Quiet port feed", url: "http://q.test/rss", ok: true, collected: 8, retained: 0, rejected: 8 },
    ]);

    const row = cap.inserts[0];
    expect(row.itemsCollected).toBe(8);
    expect(row.itemsRetained).toBe(0);
    // No in-scope item this run -> never fabricate a relevant-item timestamp.
    expect(row.lastRelevantItemAt).toBeUndefined();
  });

  it("leaves the funnel columns untouched (no fake 0) when the engine reports no counts", async () => {
    const cap = setupDb();

    await recordSourceHealth("shipping", [{ name: "Feed A", url: "http://a.test/rss", ok: true }]);

    const row = cap.inserts[0];
    expect(row).not.toHaveProperty("itemsCollected");
    expect(row).not.toHaveProperty("itemsRetained");
    expect(row).not.toHaveProperty("itemsRejected");
    expect(row).not.toHaveProperty("lastRelevantItemAt");
  });

  it("records the coarse failure category on a failed run and never stamps last-relevant", async () => {
    const cap = setupDb();

    await recordSourceHealth("cargo_watch", [
      {
        name: "Blocked feed",
        url: "http://b.test/rss",
        ok: false,
        error: "403 Forbidden",
        failureReason: "blocked_upstream",
        collected: 0,
        retained: 0,
        rejected: 0,
      },
    ]);

    const row = cap.inserts[0];
    expect(row.failureReason).toBe("blocked_upstream");
    expect(row.lastRelevantItemAt).toBeUndefined();
  });

  it("writes registry metadata (scrapeMethod/frequency from opts, language/location from feed)", async () => {
    const cap = setupDb();

    await recordSourceHealth(
      "cargo_watch",
      [
        {
          name: "APAC port feed",
          url: "http://r.test/rss",
          ok: true,
          retained: 1,
          language: "English",
          locationCovered: "APAC ports",
        },
      ],
      { scrapeMethod: "Google News RSS", scrapeFrequency: "Every 12h (scheduled)" },
    );

    const row = cap.inserts[0];
    expect(row.scrapeMethod).toBe("Google News RSS");
    expect(row.scrapeFrequency).toBe("Every 12h (scheduled)");
    expect(row.language).toBe("English");
    expect(row.locationCovered).toBe("APAC ports");
  });

  it("does not write registry metadata when none is supplied (leaves prior analyst values intact)", async () => {
    const cap = setupDb();

    await recordSourceHealth("shipping", [{ name: "Feed A", url: "http://a.test/rss", ok: true }]);

    const row = cap.inserts[0];
    expect(row).not.toHaveProperty("scrapeMethod");
    expect(row).not.toHaveProperty("scrapeFrequency");
    expect(row).not.toHaveProperty("language");
    expect(row).not.toHaveProperty("locationCovered");
  });

  it("carries telemetry on the UPDATE path for an existing row", async () => {
    const cap = setupDb({ existing: [{ id: 7, consecutiveFailures: 0 }] });

    await recordSourceHealth("cargo_watch", [
      { name: "Port feed", url: "http://p.test/rss", ok: true, collected: 5, retained: 2, rejected: 3 },
    ]);

    expect(cap.updates).toHaveLength(1);
    const set = cap.updates[0].set;
    expect(set.itemsCollected).toBe(5);
    expect(set.itemsRetained).toBe(2);
    expect(set.lastRelevantItemAt).toBeInstanceOf(Date);
    expect(set.failureReason).toBeNull();
  });
});

describe("recordSourceHealth — flashpoint sustained-outage escalation", () => {
  // Regression guard for the original frozen-green defect: a flashpoint feed
  // that fails on enough CONSECUTIVE ingest runs must escalate from
  // "operational" to "failing", and a later success must reset it. This drives
  // the real flashpoint call shape (ok derived from the per-feed error, the
  // coarse failureReason via categorizeFeedFailure) across a sequence of runs,
  // feeding each run's resulting counter back in as the next run's existing row.
  const FEED = { name: "PNG flashpoint feed", url: "http://png.test/rss" };

  async function runFailingRun(consecutiveFailures: number) {
    const cap = setupDb({ existing: [{ id: 42, consecutiveFailures }] });
    const error = "timed out after 20000ms";
    await recordSourceHealth("flashpoint", [
      {
        name: FEED.name,
        url: FEED.url,
        ok: false,
        error,
        failureReason: categorizeFeedFailure(error),
      },
    ]);
    expect(cap.updates).toHaveLength(1);
    return cap.updates[0].set;
  }

  it("stays operational for the first two consecutive failures, then flips to failing on the third", async () => {
    // Run 1: healthy row (streak 0) fails once -> transient, still operational.
    const run1 = await runFailingRun(0);
    expect(run1.status).toBe("operational");
    expect(run1.consecutiveFailures).toBe(1);
    expect(run1.failureReason).toBe("timeout");

    // Run 2: streak 1 fails again -> still below threshold, still operational.
    const run2 = await runFailingRun(run1.consecutiveFailures);
    expect(run2.status).toBe("operational");
    expect(run2.consecutiveFailures).toBe(2);

    // Run 3: streak 2 fails a third time -> crosses the threshold -> failing.
    const run3 = await runFailingRun(run2.consecutiveFailures);
    expect(run3.consecutiveFailures).toBe(FAILURE_ESCALATION_THRESHOLD);
    expect(run3.status).toBe("failing");
    // Once escalated the raw error surfaces (no transient prefix) for operators.
    expect(run3.errorMessage).toBe("timed out after 20000ms");
    expect(run3.lastFailureAt).toBeInstanceOf(Date);
  });

  it("resets a failing flashpoint feed back to operational on the next successful run", async () => {
    // A feed sitting at/above the threshold (currently "failing").
    const cap = setupDb({
      existing: [{ id: 42, consecutiveFailures: FAILURE_ESCALATION_THRESHOLD }],
    });

    await recordSourceHealth("flashpoint", [
      { name: FEED.name, url: FEED.url, ok: true },
    ]);

    expect(cap.updates).toHaveLength(1);
    const set = cap.updates[0].set;
    expect(set.status).toBe("operational");
    expect(set.consecutiveFailures).toBe(0);
    expect(set.errorMessage).toBeNull();
    expect(set.lastSuccessAt).toBeInstanceOf(Date);
    // A success must not stamp a new failure timestamp (lets the UI see recovery).
    expect(set.lastFailureAt).toBeUndefined();
  });
});

describe("categorizeFeedFailure", () => {
  it("returns null for an absent error (nothing failed)", () => {
    expect(categorizeFeedFailure(null)).toBeNull();
    expect(categorizeFeedFailure(undefined)).toBeNull();
    expect(categorizeFeedFailure("")).toBeNull();
  });

  it("maps recognised error text to its coarse category", () => {
    expect(categorizeFeedFailure("timed out after 20000ms")).toBe("timeout");
    expect(categorizeFeedFailure("403 Forbidden")).toBe("blocked_upstream");
    expect(categorizeFeedFailure("Cloudflare challenge")).toBe("blocked_upstream");
    expect(categorizeFeedFailure("401 Unauthorized: bad api key")).toBe("auth_error");
    expect(categorizeFeedFailure("404 Not Found")).toBe("not_found");
    expect(categorizeFeedFailure("502 Bad Gateway")).toBe("upstream_error");
    expect(categorizeFeedFailure("invalid xml: malformed feed body")).toBe("parse_error");
    expect(categorizeFeedFailure("ENOTFOUND getaddrinfo")).toBe("fetch_error");
  });

  it("falls back to fetch_error for an unrecognised error (the fetch still threw)", () => {
    expect(categorizeFeedFailure("something weird happened")).toBe("fetch_error");
  });
});
