import { db } from "@workspace/db";
import {
  maritimeMovementTable,
  sourcesTable,
  incidentsTable,
  countryReportProseTable,
  incidentCorroborationsTable,
  reliefwebReportsTable,
  socialWatchItemsTable,
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
jest.mock("../../lib/ingest/src/openaiConfig", () => ({
  ...jest.requireActual("../../lib/ingest/src/openaiConfig"),
  isLlmAvailable: jest.fn(() => false),
}));

import { getIntegrationStatuses } from "../../artifacts/api-server/src/lib/integrationStatus";
import { isLlmAvailable } from "../../lib/ingest/src/openaiConfig";
import { getLiveuamapStatus } from "../../artifacts/api-server/src/lib/liveuamap";
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

describe("liveuamap integration status", () => {
  function stubLiveuamap(state: string, extra: Record<string, unknown> = {}) {
    (getLiveuamapStatus as jest.Mock).mockResolvedValue({
      state,
      configured: state !== "not_configured",
      events: 0,
      fetchedAt: null,
      freerequests: null,
      ...extra,
    });
  }

  it("surfaces working when the upstream proxy returns cached events", async () => {
    stubLiveuamap("working", {
      events: 12,
      fetchedAt: new Date("2026-06-15T00:00:00Z"),
      freerequests: 88,
    });
    const item = find(await statuses(), "liveuamap");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.summary).toContain("12");
    expect(item.metrics).toEqual(
      expect.arrayContaining([{ label: "Cached events", value: "12" }]),
    );
  });

  it("surfaces not_configured when the proxy reports no API key", async () => {
    stubLiveuamap("not_configured");
    const item = find(await statuses(), "liveuamap");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
    expect(item.summary).toContain("incident map is unaffected");
  });

  it("surfaces failing_upstream when the proxy reports the upstream unreachable", async () => {
    stubLiveuamap("failing_upstream");
    const item = find(await statuses(), "liveuamap");
    expect(item.status).toBe("failing_upstream");
    expect(item.summary).toContain("unreachable");
    expect(item.summary).toContain("allowlist");
  });

  it("surfaces no_data when the proxy is reachable but returns nothing", async () => {
    stubLiveuamap("no_data");
    const item = find(await statuses(), "liveuamap");
    expect(item.status).toBe("no_data");
    expect(item.summary).toContain("no events");
  });

  it("degrades to unknown when the proxy probe throws", async () => {
    (getLiveuamapStatus as jest.Mock).mockRejectedValue(new Error("boom"));
    const item = find(await statuses(), "liveuamap");
    expect(item.status).toBe("unknown");
  });
});

describe("openai integration status", () => {
  it("reports not_configured when the AI integration is unavailable", async () => {
    (isLlmAvailable as jest.Mock).mockReturnValue(false);
    const item = find(await statuses(), "openai");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
    expect(item.summary).toContain("deterministic template");
  });

  it("reports working with translated-headline and cached-narrative metrics", async () => {
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    const byTable = new Map<unknown, Rows>([
      [incidentsTable, [{ n: 7 }]],
      [countryReportProseTable, [{ n: 4 }]],
    ]);
    const item = find(await statuses(byTable), "openai");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.metrics).toEqual(
      expect.arrayContaining([
        { label: "Translated headlines", value: "7" },
        { label: "AI narratives cached", value: "4" },
      ]),
    );
  });
});

describe("reliefweb integration status (corroboration)", () => {
  it("reports not_configured when the appname is unset", async () => {
    delete process.env.RELIEFWEB_APPNAME;
    const item = find(await statuses(), "reliefweb");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
  });

  it("reports working when corroborations have matched", async () => {
    process.env.RELIEFWEB_APPNAME = "approved-name";
    const byTable = new Map<unknown, Rows>([
      [incidentCorroborationsTable, [{ n: 6, latest: new Date("2026-06-12T00:00:00Z") }]],
    ]);
    const item = find(await statuses(byTable), "reliefweb");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.summary).toContain("6");
  });

  it("reports no_data when configured but nothing has matched yet", async () => {
    process.env.RELIEFWEB_APPNAME = "approved-name";
    const byTable = new Map<unknown, Rows>([
      [incidentCorroborationsTable, [{ n: 0, latest: null }]],
    ]);
    const item = find(await statuses(byTable), "reliefweb");
    expect(item.status).toBe("no_data");
  });
});

describe("reliefweb_reports integration status (situational context)", () => {
  it("reports not_configured when the appname is unset", async () => {
    delete process.env.RELIEFWEB_APPNAME;
    const item = find(await statuses(), "reliefweb_reports");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
  });

  it("reports pending (non-alarming amber) when configured but no reports stored yet", async () => {
    process.env.RELIEFWEB_APPNAME = "approved-name";
    const byTable = new Map<unknown, Rows>([
      [reliefwebReportsTable, [{ n: 0, latest: null, countries: 0 }]],
    ]);
    const item = find(await statuses(byTable), "reliefweb_reports");
    expect(item.status).toBe("pending");
    expect(item.metrics).toEqual(
      expect.arrayContaining([{ label: "Live data", value: "pending" }]),
    );
  });

  it("reports working when situational reports are stored", async () => {
    process.env.RELIEFWEB_APPNAME = "approved-name";
    const byTable = new Map<unknown, Rows>([
      [reliefwebReportsTable, [{ n: 9, latest: new Date("2026-06-14T00:00:00Z"), countries: 3 }]],
    ]);
    const item = find(await statuses(byTable), "reliefweb_reports");
    expect(item.status).toBe("working");
    expect(item.summary).toContain("9");
    expect(item.metrics).toEqual(
      expect.arrayContaining([{ label: "Live data", value: "yes" }]),
    );
  });
});

describe("admin_controls status", () => {
  it("is not_configured when INGEST_ADMIN_TOKEN is unset", async () => {
    delete process.env.INGEST_ADMIN_TOKEN;
    const item = find(await statuses(), "admin_controls");
    expect(item.status).toBe("not_configured");
    expect(item.optional).toBe(false);
    expect(item.configured).toBe(false);
  });

  it("is working when INGEST_ADMIN_TOKEN is set", async () => {
    process.env.INGEST_ADMIN_TOKEN = "operator-token";
    const item = find(await statuses(), "admin_controls");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
  });
});

describe("social-watch instagram integration status (freshness honesty)", () => {
  function configureIg(): void {
    delete process.env.SOCIAL_WATCH_ENABLED;
    delete process.env.INSTAGRAM_ENABLED;
    process.env.INSTAGRAM_API_KEY = "apify-key";
  }
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("reports working when the newest post is inside the freshness window", async () => {
    configureIg();
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 4, latest: daysAgo(3) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.summary).toContain("4 KAMMI Instagram post");
  });

  it("reports dormant with an N-day-old summary when the newest post is past the window", async () => {
    configureIg();
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 2, latest: daysAgo(120) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.status).toBe("dormant");
    expect(item.summary).toContain("dormant");
    expect(item.summary).toMatch(/\d+ day\(s\) old/);
    expect(item.summary).toContain("30-day freshness window");
  });

  it("reports no_data when configured but the table is empty", async () => {
    configureIg();
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 0, latest: null }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.status).toBe("no_data");
  });

  it("keeps not_configured when neither INSTAGRAM_API_KEY nor APIFY_TOKEN is set (freshness branch unreached)", async () => {
    delete process.env.SOCIAL_WATCH_ENABLED;
    delete process.env.INSTAGRAM_ENABLED;
    delete process.env.INSTAGRAM_API_KEY;
    delete process.env.APIFY_TOKEN;
    // Even with a months-stale row present, the not_configured branch wins.
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 5, latest: daysAgo(200) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.status).toBe("not_configured");
    expect(item.configured).toBe(false);
  });

  it("reports configured when only APIFY_TOKEN is set (fallback credential)", async () => {
    delete process.env.SOCIAL_WATCH_ENABLED;
    delete process.env.INSTAGRAM_ENABLED;
    delete process.env.INSTAGRAM_API_KEY;
    process.env.APIFY_TOKEN = "apify_api_fallback";
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 3, latest: daysAgo(2) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.configured).toBe(true);
    expect(item.status).toBe("working");
  });

  it("keeps disabled when switched off, even with a stale row present", async () => {
    process.env.SOCIAL_WATCH_ENABLED = "false";
    process.env.INSTAGRAM_API_KEY = "apify-key";
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 5, latest: daysAgo(200) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_instagram");
    expect(item.status).toBe("disabled");
  });
});

describe("social-watch telegram integration status (freshness honesty)", () => {
  function configureTg(): void {
    delete process.env.SOCIAL_WATCH_ENABLED;
    delete process.env.TELEGRAM_ENABLED;
    process.env.KAMMI_TELEGRAM_CHANNEL = "kammipusat";
  }
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("reports working when the newest post is inside the freshness window", async () => {
    configureTg();
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 6, latest: daysAgo(10) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_telegram");
    expect(item.status).toBe("working");
    expect(item.configured).toBe(true);
    expect(item.summary).toContain("6 KAMMI Telegram post");
  });

  it("reports dormant with an N-day-old summary when the newest post is past the window", async () => {
    configureTg();
    // Mirrors the real-world KAMMI channel, last active in 2016.
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 3, latest: daysAgo(365) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_telegram");
    expect(item.status).toBe("dormant");
    expect(item.summary).toContain("dormant");
    expect(item.summary).toMatch(/\d+ day\(s\) old/);
    expect(item.summary).toContain("30-day freshness window");
  });

  it("reports no_data when configured but the table is empty", async () => {
    configureTg();
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 0, latest: null }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_telegram");
    expect(item.status).toBe("no_data");
  });

  it("keeps disabled when the telegram source is switched off, even with a stale row present", async () => {
    delete process.env.SOCIAL_WATCH_ENABLED;
    process.env.TELEGRAM_ENABLED = "false";
    process.env.KAMMI_TELEGRAM_CHANNEL = "kammipusat";
    const byTable = new Map<unknown, Rows>([
      [socialWatchItemsTable, [{ n: 5, latest: daysAgo(200) }]],
    ]);
    const item = find(await statuses(byTable), "social_watch_telegram");
    expect(item.status).toBe("disabled");
  });
});

describe("getIntegrationStatuses envelope", () => {
  it("returns every integration plus a generation timestamp", async () => {
    (isLlmAvailable as jest.Mock).mockReturnValue(false);
    const resp = await statuses();
    expect(resp.generatedAt).toBeInstanceOf(Date);
    const keys = resp.integrations.map((i) => i.key).sort();
    expect(keys).toEqual(
      [
        "admin_controls",
        "ais_movement",
        "gdelt",
        "liveuamap",
        "openai",
        "reliefweb",
        "reliefweb_reports",
        "social_watch_instagram",
        "social_watch_telegram",
        "tapa_iis",
        "vessel_registry",
        "x_cargo_osint",
      ].sort(),
    );
    expect(Array.isArray(resp.maritimeSources)).toBe(true);
    // Optional external integrations are flagged optional; admin_controls is operational.
    for (const item of resp.integrations.filter((i) => i.key !== "admin_controls")) {
      expect(item.optional).toBe(true);
    }
    expect(find(resp, "admin_controls").optional).toBe(false);
  });
});
