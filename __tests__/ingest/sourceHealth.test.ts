import { recordSourceHealth } from "../../lib/ingest/src/sourceHealth";
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
  opts: { existing?: { id: number }[]; throwOn?: "select" | "insert" | "update" } = {},
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

  it("inserts a failing row with lastFailureAt and the error message on a failed feed", async () => {
    const cap = setupDb();

    await recordSourceHealth("energy", [
      { name: "Bad Feed", url: "http://b.test/rss", ok: false, error: "timed out after 20000ms" },
    ]);

    expect(cap.inserts).toHaveLength(1);
    const row = cap.inserts[0];
    expect(row.status).toBe("failing");
    expect(row.lastFailureAt).toBeInstanceOf(Date);
    expect(row.lastSuccessAt).toBeNull();
    expect(row.errorMessage).toBe("timed out after 20000ms");
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

    expect(cap.inserts[0].errorMessage).toBe("Feed fetch failed");
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
    const cap = setupDb({ existing: [{ id: 7 }] });

    await recordSourceHealth("shipping", [
      { name: "Feed A", url: "http://a.test/rss", ok: false, error: "boom" },
    ]);

    expect(cap.inserts).toHaveLength(0);
    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0].set.status).toBe("failing");
    expect(cap.updates[0].set.lastFailureAt).toBeInstanceOf(Date);
    expect(cap.updates[0].set.errorMessage).toBe("boom");
  });

  it("never throws when the database errors (best-effort telemetry)", async () => {
    setupDb({ throwOn: "insert" });

    await expect(
      recordSourceHealth("shipping", [{ name: "Feed A", url: "http://a.test/rss", ok: true }]),
    ).resolves.toBeUndefined();
  });
});
