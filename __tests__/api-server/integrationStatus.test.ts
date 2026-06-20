import { db } from "@workspace/db";
import {
  maritimeMovementTable,
  sourcesTable,
  incidentsTable,
} from "@workspace/db";

// The integration-status probes derive a public STATE + EVIDENCE for each
// optional external integration. The mapping (not_configured / disabled /
// failing_upstream / working / no_data / pending) is hand-rolled per probe, so
// a future edit could silently mislabel a configured-but-broken upstream as
// "working" and mislead an operator with no test catching it. These tests pin
// the state each probe derives for representative inputs, stubbing both the env
// vars and the DB so they run without a live database.

// The non-DB sibling probes (Liveuamap network proxy, maritime source health,
// the LLM availability check) are replaced so this test exercises only the
// state-mapping logic, never a network call. Paths resolve to the SAME modules
// integrationStatus.ts imports via "./liveuamap" etc.
jest.mock("../../artifacts/api-server/src/lib/liveuamap", () => ({
  getLiveuamapStatus: jest.fn(async () => ({
    state: "not_configured",
    configured: false,
    events: 0,
    fetchedAt: null,
    freerequests: null,
  })),
}));
jest.mock("../../artifacts/api-server/src/lib/maritimeSources", () => ({
  getMaritimeSourceHealth: jest.fn(async () => []),
}));
jest.mock("../../artifacts/api-server/src/lib/countryProse", () => ({
  isLlmAvailable: jest.fn(() => false),
}));

import { getIntegrationStatuses } from "../../artifacts/api-server/src/lib/integrationStatus";
import { isLlmAvailable } from "../../artifacts/api-server/src/lib/countryProse";
import type {
  IntegrationStatusItem,
  IntegrationStatusResponse,
} from "@workspace/api-zod";

type Rows = Record<string, unknown>[];

// Route each probe's `db.select().from(table).where()` to a per-table response
// so the concurrently-run probes never collide on call order.
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

async function statuses(byTable: Map<unknown, Rows> = new Map()): Promise<IntegrationStatusResponse> {
  stubDb(byTable);
  return getIntegrationStatuses();
}

function find(resp: IntegrationStatusResponse, key: string): IntegrationStatusItem {
  const item = resp.integrations.find((i) => i.key === key);
  if (!item) throw new Error(`integration "${key}" missing from response`);
  return item;
}

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  jest.restoreAllMocks();
});

describe("vessel registry integration status", () => {
  it("reports not_configured when the API key is unset", async () => {
    delete process.env.VESSEL_REGISTRY_API_KEY;
    delete process.env.VESSEL_REGISTRY_ENABLED;
    const item = find(await statuses(), "vessel_registry");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
  });

  it("reports disabled when switched off via the kill-switch even with a key", async () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    process.env.VESSEL_REGISTRY_ENABLED = "false";
    const item = find(await statuses(), "vessel_registry");
    expect(item.status).toBe("disabled");
  });

  it("reports working when a movement snapshot carries a resolved cargo-type split", async () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    delete process.env.VESSEL_REGISTRY_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ n: 3, latest: new Date("2026-06-01T00:00:00Z") }]],
      [sourcesTable, [{ status: "live" }]],
    ]);
    const item = find(await statuses(byTable), "vessel_registry");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.metrics).toEqual(
      expect.arrayContaining([{ label: "Snapshots with split", value: "3" }]),
    );
  });

  it("reports failing_upstream when the recorded health row is 'failing' (even with rows resolved)", async () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    delete process.env.VESSEL_REGISTRY_ENABLED;
    // A failing upstream must NOT be masked by previously-resolved snapshots.
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ n: 3, latest: new Date("2026-06-01T00:00:00Z") }]],
      [sourcesTable, [{ status: "failing" }]],
    ]);
    const item = find(await statuses(byTable), "vessel_registry");
    expect(item.status).toBe("failing_upstream");
  });

  it("reports no_data when configured but nothing has resolved yet", async () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    delete process.env.VESSEL_REGISTRY_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [maritimeMovementTable, [{ n: 0, latest: null }]],
      [sourcesTable, []],
    ]);
    const item = find(await statuses(byTable), "vessel_registry");
    expect(item.status).toBe("no_data");
  });
});

describe("gdelt integration status (shared shape lock)", () => {
  it("reports not_configured when no API key is present", async () => {
    delete process.env.GDELT_CLOUD_API_KEY;
    delete process.env.GDELT_ENRICH_ENABLED;
    const item = find(await statuses(), "gdelt");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
  });

  it("reports disabled when enrichment is switched off", async () => {
    process.env.GDELT_CLOUD_API_KEY = "key";
    process.env.GDELT_ENRICH_ENABLED = "false";
    const item = find(await statuses(), "gdelt");
    expect(item.status).toBe("disabled");
  });

  it("reports working and exposes the shared item shape when incidents are enriched", async () => {
    process.env.GDELT_CLOUD_API_KEY = "key";
    delete process.env.GDELT_ENRICH_ENABLED;
    const byTable = new Map<unknown, Rows>([
      [incidentsTable, [{ n: 5, latest: new Date("2026-06-10T00:00:00Z") }]],
    ]);
    const item = find(await statuses(byTable), "gdelt");
    expect(item.status).toBe("working");
    // Lock the contract every probe shares so a refactor can't drop a field.
    expect(item).toEqual(
      expect.objectContaining({
        key: "gdelt",
        label: expect.any(String),
        status: "working",
        summary: expect.any(String),
        configured: true,
        optional: true,
        envVars: expect.arrayContaining(["GDELT_CLOUD_API_KEY"]),
        metrics: expect.any(Array),
      }),
    );
  });
});

describe("getIntegrationStatuses envelope", () => {
  it("returns every optional integration plus a generation timestamp", async () => {
    (isLlmAvailable as jest.Mock).mockReturnValue(false);
    const resp = await statuses();
    expect(resp.generatedAt).toBeInstanceOf(Date);
    const keys = resp.integrations.map((i) => i.key).sort();
    expect(keys).toEqual(
      [
        "gdelt",
        "liveuamap",
        "openai",
        "reliefweb",
        "reliefweb_reports",
        "vessel_registry",
      ].sort(),
    );
    expect(Array.isArray(resp.maritimeSources)).toBe(true);
    // Every item is flagged optional (none of these gate the core product).
    for (const item of resp.integrations) {
      expect(item.optional).toBe(true);
    }
  });
});
