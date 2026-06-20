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
