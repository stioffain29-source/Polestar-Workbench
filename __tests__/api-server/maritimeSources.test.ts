import { db, maritimeMovementTable, sourcesTable } from "@workspace/db";
import { getMaritimeSourceHealth } from "../../artifacts/api-server/src/lib/maritimeSources";
import type { MaritimeSourceHealthItem } from "@workspace/api-zod";

// The maritime source-health board (`getMaritimeSourceHealth`) feeds the
// `maritimeSources` array on /api/integrations/status and drives the AIS
// ship-movement row on Source Health. Its live/stale/unavailable mapping and
// the 14-day freshness window (FRESH_DAYS) are hand-rolled, so a future edit
// could silently mislabel a stale or failing AIS feed as healthy. These tests
// pin the state the AIS probe derives for representative rows, stubbing both the
// env vars and the DB so they run without a live database. (Kept in its own file
// because integrationStatus.test.ts jest.mock()s this module away.)

type Rows = Record<string, unknown>[];

// Route each probe's `db.select().from(table).where()` to a per-table response.
// The AIS and manual probes both read maritime_movement, so they share the same
// stubbed rows — these tests only assert the AIS item, which is fine.
function stubDb(byTable: Map<unknown, Rows>): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    let tbl: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        tbl = t;
        return chain;
      },
      where: () => Promise.resolve(byTable.get(tbl) ?? []),
    };
    return chain as never;
  });
}

function find(items: MaritimeSourceHealthItem[], key: string): MaritimeSourceHealthItem {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`maritime source "${key}" missing from response`);
  return item;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// Serialise the literal text of a Drizzle `sql` where clause by concatenating
// its string chunks. The manual-upload query builds its NOT ILIKE exclusions as
// literal SQL text (not bound params), so this surfaces the "%ais%"/"%windward%"
// patterns the exclusion filter depends on.
function whereText(clause: unknown): string {
  const chunks = (clause as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return "";
  let out = "";
  for (const c of chunks) {
    const v = (c as { value?: unknown }).value;
    if (Array.isArray(v)) out += " " + v.join(" ");
    else if (typeof v === "string") out += " " + v;
  }
  return out.toLowerCase();
}

// Does a movement row survive the manual-upload where clause? Models the
// `source_name NOT ILIKE '%ais%' AND ... NOT ILIKE '%windward%'` exclusion so
// the stub honours the real filter the code emits — if the filter is dropped or
// its pattern changes, the where text changes and AIS/Windward rows leak in.
function rowMatchesWhere(sourceName: string, whereTextLower: string): boolean {
  const name = sourceName.toLowerCase();
  if (whereTextLower.includes("not ilike") && whereTextLower.includes("ais") && name.includes("ais")) {
    return false;
  }
  if (whereTextLower.includes("not ilike") && whereTextLower.includes("windward") && name.includes("windward")) {
    return false;
  }
  return true;
}

// A richer stub that, for maritime_movement, APPLIES the query's where clause to
// the supplied rows (filtering by source_name) and returns the `max(data_as_of)`
// aggregate the real query would compute. The sources table is routed verbatim.
function stubDbHonoringMovementFilter(
  movementRows: { sourceName: string; dataAsOf: Date }[],
  sourcesRows: Rows = [],
): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    let tbl: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        tbl = t;
        return chain;
      },
      where: (clause: unknown) => {
        if (tbl === sourcesTable) return Promise.resolve(sourcesRows);
        const text = whereText(clause);
        const matched = movementRows.filter((r) => rowMatchesWhere(r.sourceName, text));
        const latest = matched.length
          ? new Date(Math.max(...matched.map((r) => r.dataAsOf.getTime())))
          : null;
        return Promise.resolve([{ latest }]);
      },
    };
    return chain as never;
  });
}

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  jest.restoreAllMocks();
});

describe("maritime AIS source health", () => {
  it("reports live when a fresh AIS snapshot is inside the freshness window", async () => {
    process.env.AIS_API_KEY = "key";
    delete process.env.AIS_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ latest: daysAgo(2) }]],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "ais");
    expect(item.status).toBe("live");
    expect(item.asOf).not.toBeNull();
  });

  it("reports stale when the newest AIS snapshot is past the freshness window", async () => {
    process.env.AIS_API_KEY = "key";
    delete process.env.AIS_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ latest: daysAgo(30) }]],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "ais");
    expect(item.status).toBe("stale");
    expect(item.asOf).not.toBeNull();
  });

  it("reports stale (configured, awaiting data) when keyed but no movement rows exist", async () => {
    process.env.AIS_API_KEY = "key";
    delete process.env.AIS_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, []],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "ais");
    expect(item.status).toBe("stale");
    expect(item.asOf).toBeNull();
  });

  it("reports unavailable (not a false outage) when AIS is unconfigured", async () => {
    delete process.env.AIS_API_KEY;
    delete process.env.AIS_ENABLED;
    stubDb(new Map());
    const item = find(await getMaritimeSourceHealth(), "ais");
    expect(item.status).toBe("unavailable");
    expect(item.asOf).toBeNull();
  });

  it("reports disabled when switched off via the kill-switch even with a key", async () => {
    process.env.AIS_API_KEY = "key";
    process.env.AIS_ENABLED = "false";
    stubDb(new Map());
    const item = find(await getMaritimeSourceHealth(), "ais");
    expect(item.status).toBe("disabled");
    expect(item.asOf).toBeNull();
  });
});

describe("maritime news-verification feed source health", () => {
  it("reports live when a shipping feed is operational with a fresh poll", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [sourcesTable, [{ status: "operational", lastSuccessAt: daysAgo(1) }]],
      [maritimeMovementTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "news");
    expect(item.status).toBe("live");
    expect(item.asOf).not.toBeNull();
  });

  it("reports stale when the newest successful poll is past the freshness window", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [sourcesTable, [{ status: "operational", lastSuccessAt: daysAgo(30) }]],
      [maritimeMovementTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "news");
    expect(item.status).toBe("stale");
    expect(item.asOf).not.toBeNull();
  });

  it("reports unavailable when no shipping feed telemetry exists", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [sourcesTable, []],
      [maritimeMovementTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "news");
    expect(item.status).toBe("unavailable");
    expect(item.asOf).toBeNull();
  });

  it("takes the newest poll across feeds and stays unavailable when none succeeded recently", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [
        sourcesTable,
        [
          { status: "failing", lastSuccessAt: null },
          { status: "failing", lastSuccessAt: null },
        ],
      ],
      [maritimeMovementTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "news");
    expect(item.status).toBe("unavailable");
  });
});

describe("maritime manual-upload source health", () => {
  it("reports live for a recent manual movement-context upload", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ latest: daysAgo(3) }]],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "manual_upload");
    expect(item.status).toBe("live");
    expect(item.asOf).not.toBeNull();
  });

  it("reports stale for a manual upload older than the freshness window", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ latest: daysAgo(40) }]],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "manual_upload");
    expect(item.status).toBe("stale");
    expect(item.asOf).not.toBeNull();
  });

  it("reports unavailable when no manual upload exists", async () => {
    delete process.env.AIS_API_KEY;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, []],
      [sourcesTable, []],
    ]);
    stubDb(byTable);
    const item = find(await getMaritimeSourceHealth(), "manual_upload");
    expect(item.status).toBe("unavailable");
    expect(item.asOf).toBeNull();
  });

  it("excludes AIS- and Windward-fed rows so a live provider feed never reads as a manual upload", async () => {
    delete process.env.AIS_API_KEY;
    delete process.env.WINDWARD_API_KEY;
    stubDbHonoringMovementFilter([
      { sourceName: "aisstream", dataAsOf: daysAgo(1) },
      { sourceName: "windward-api", dataAsOf: daysAgo(1) },
    ]);
    const item = find(await getMaritimeSourceHealth(), "manual_upload");
    expect(item.status).toBe("unavailable");
    expect(item.asOf).toBeNull();
  });

  it("keys the manual state off the genuine operator upload, ignoring fresher provider rows", async () => {
    delete process.env.AIS_API_KEY;
    delete process.env.WINDWARD_API_KEY;
    stubDbHonoringMovementFilter([
      { sourceName: "aisstream", dataAsOf: daysAgo(1) },
      { sourceName: "operator-manual-upload", dataAsOf: daysAgo(40) },
    ]);
    const item = find(await getMaritimeSourceHealth(), "manual_upload");
    expect(item.status).toBe("stale");
    expect(item.asOf).not.toBeNull();
  });
});
