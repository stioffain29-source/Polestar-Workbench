import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The shared country-report ENGINE routes (owner brief §7 review queue, §35
// reprocess, §37 admin controls). These guard the persistence + API shapes:
//   GET   /countries/:slug/engine            → { events, stats, overrides }
//   POST  /countries/:slug/engine/reprocess  → run stats (admin-token)
//   PATCH /countries/:slug/engine/events/:id → applies override, audit-logged
//   GET   /countries/:slug/engine/audit      → recent audit rows
//
// The pipeline module (artifacts/api-server/src/lib/countryEngine) is mocked so
// the tests never import the pure engine core (which may not have landed yet):
// runCountryEngine / applyOverride are jest.fn()s. The db layer is stubbed like
// the other route tests so a request round-trips through the route handler.

jest.mock("../../artifacts/api-server/src/lib/countryEngine", () => ({
  runCountryEngine: jest.fn(),
  applyOverride: jest.fn(),
  applyBulkOverride: jest.fn(),
}));

import {
  db,
  countryEngineEventsTable,
  countryEngineOverridesTable,
  countryEngineAuditTable,
  countryEngineRunsTable,
} from "@workspace/db";
import {
  runCountryEngine,
  applyOverride,
  applyBulkOverride,
} from "../../artifacts/api-server/src/lib/countryEngine";
import countryEngineRouter from "../../artifacts/api-server/src/routes/countryEngine";
import {
  adminAuthHeaders,
  installAdminTokenBeforeEach,
} from "./adminAuthTestHelpers";

type Rows = Record<string, unknown>[];

const SLUG = "papua-new-guinea";

// A resolved thenable chain that also supports .orderBy()/.limit()/.offset()
// and .groupBy(). The engine routes use db.select().from().where().orderBy()
// (optionally .limit()/.offset()), plus grouped count queries, so the stub's
// where() returns an object that IS a promise AND still chains everything.
function selectResult(rows: Rows): unknown {
  const p = Promise.resolve(rows) as Record<string, unknown> & Promise<Rows>;
  p.orderBy = () => p;
  p.groupBy = () => p;
  p.offset = () => Promise.resolve(rows);
  const lim = Promise.resolve(rows) as Record<string, unknown> & Promise<Rows>;
  lim.offset = () => Promise.resolve(rows);
  p.limit = () => lim;
  return p;
}

function stubSelect(byTable: Map<unknown, Rows>): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    let tbl: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        tbl = t;
        // The result is a REAL promise carrying chain methods; attach where()
        // so both from().where()… and from().groupBy()… (held-summary) work.
        const res = selectResult(byTable.get(tbl) ?? []) as Record<string, unknown>;
        res.where = () => selectResult(byTable.get(tbl) ?? []);
        return res;
      },
    };
    return chain as never;
  });
}

let app: Express;
let server: Server;
let baseUrl: string;

installAdminTokenBeforeEach();

beforeAll(() => {
  app = express();
  app.use(express.json());
  // The real api-server attaches `req.log` via pino-http; this bare test app
  // does not, so stub a no-op logger before the router (repo convention).
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  app.use(countryEngineRouter);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

beforeEach(() => {
  jest.restoreAllMocks();
  (runCountryEngine as jest.Mock).mockReset();
  (applyOverride as jest.Mock).mockReset();
  (applyBulkOverride as jest.Mock).mockReset();
});

describe("GET /countries/:slug/engine", () => {
  it("returns events (from payloads), latest-run stats and overrides", async () => {
    const event = { eventId: "42", eventTitle: "Enga clash", inclusionStatus: "included" };
    const override = { eventId: "42", severity: "High" };
    const stats = { sourcesProcessed: 10, excluded: 3, held: 1, duplicatesMerged: 2, reattributed: 1 };
    stubSelect(
      new Map<unknown, Rows>([
        [countryEngineEventsTable, [{ payload: event }]],
        [countryEngineRunsTable, [{ stats }]],
        [countryEngineOverridesTable, [{ override }]],
      ]),
    );

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine`);
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.events).toEqual([event]);
    expect(json.stats).toEqual(stats);
    expect(json.overrides).toEqual([override]);
  });

  it("returns null stats when no run has been recorded", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryEngineEventsTable, []],
        [countryEngineRunsTable, []],
        [countryEngineOverridesTable, []],
      ]),
    );
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine`);
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(json.stats).toBeNull();
    expect(json.events).toEqual([]);
  });
});

describe("POST /countries/:slug/engine/reprocess", () => {
  it("runs the engine and returns the run stats (admin token)", async () => {
    (runCountryEngine as jest.Mock).mockResolvedValue({
      stats: { sourcesProcessed: 5, excluded: 1, held: 0, duplicatesMerged: 0, reattributed: 0 },
      events: [{}, {}],
      included: [{}],
      held: [],
      excluded: [{}],
    });

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/reprocess`, {
      method: "POST",
      headers: adminAuthHeaders(),
    });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(runCountryEngine).toHaveBeenCalledWith(SLUG);
    expect(json.eventsTotal).toBe(2);
    expect(json.included).toBe(1);
    expect(json.excluded).toBe(1);
  });

  it("rejects a reprocess without the admin token", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/reprocess`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(runCountryEngine).not.toHaveBeenCalled();
  });
});

describe("PATCH /countries/:slug/engine/events/:eventId", () => {
  it("applies the override with eventId from the path and returns the updated event", async () => {
    (applyOverride as jest.Mock).mockResolvedValue({});
    const updated = { eventId: "42", eventTitle: "Enga clash", severity: "High" };
    stubSelect(new Map<unknown, Rows>([[countryEngineEventsTable, [{ payload: updated }]]]));

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/events/42`, {
      method: "PATCH",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ severity: "High", inclusionStatus: "included" }),
    });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(applyOverride).toHaveBeenCalledTimes(1);
    const [slugArg, overrideArg] = (applyOverride as jest.Mock).mock.calls[0];
    expect(slugArg).toBe(SLUG);
    expect(overrideArg).toMatchObject({ eventId: "42", severity: "High", inclusionStatus: "included" });
    expect(json).toEqual(updated);
  });

  it("returns 404 when the event does not exist after applying", async () => {
    (applyOverride as jest.Mock).mockResolvedValue({});
    stubSelect(new Map<unknown, Rows>([[countryEngineEventsTable, []]]));

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/events/999`, {
      method: "PATCH",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ severity: "High" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an unknown override field (strict body)", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/events/42`, {
      method: "PATCH",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ bogusField: true }),
    });
    expect(res.status).toBe(400);
    expect(applyOverride).not.toHaveBeenCalled();
  });

  it("rejects an override without the admin token", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/events/42`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ severity: "High" }),
    });
    expect(res.status).toBe(401);
    expect(applyOverride).not.toHaveBeenCalled();
  });
});

describe("POST /countries/:slug/engine/bulk", () => {
  it("applies a bulk override and returns the result (admin token)", async () => {
    const bulkResult = {
      matched: 42,
      applied: 42,
      dryRun: false,
      sample: [{ eventId: "1", eventTitle: "t", issueCategory: "Civil unrest", eventDate: null }],
      stats: { held: 100 },
    };
    (applyBulkOverride as jest.Mock).mockResolvedValue(bulkResult);

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/bulk`, {
      method: "POST",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        filter: { issueCategory: "Civil unrest", maxConfidence: 69 },
        set: { inclusionStatus: "included" },
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json).toEqual(bulkResult);
    const [slugArg, filterArg, setArg, actorArg, dryRunArg] =
      (applyBulkOverride as jest.Mock).mock.calls[0];
    expect(slugArg).toBe(SLUG);
    expect(filterArg).toEqual({ issueCategory: "Civil unrest", maxConfidence: 69 });
    expect(setArg).toEqual({ inclusionStatus: "included" });
    expect(actorArg).toBe("admin-token");
    expect(dryRunArg).toBe(false);
  });

  it("passes dryRun through", async () => {
    (applyBulkOverride as jest.Mock).mockResolvedValue({
      matched: 5, applied: 0, dryRun: true, sample: [], stats: null,
    });
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/bulk`, {
      method: "POST",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ set: { inclusionStatus: "included" }, dryRun: true }),
    });
    expect(res.status).toBe(200);
    expect((applyBulkOverride as jest.Mock).mock.calls[0][4]).toBe(true);
  });

  it("rejects a bulk EXCLUDE without an exclusionReason", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/bulk`, {
      method: "POST",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ set: { inclusionStatus: "excluded" } }),
    });
    expect(res.status).toBe(400);
    expect(applyBulkOverride).not.toHaveBeenCalled();
  });

  it("rejects an unknown filter field (strict body)", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/bulk`, {
      method: "POST",
      headers: adminAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ filter: { bogus: 1 }, set: { inclusionStatus: "included" } }),
    });
    expect(res.status).toBe(400);
    expect(applyBulkOverride).not.toHaveBeenCalled();
  });

  it("rejects a bulk action without the admin token", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set: { inclusionStatus: "included" } }),
    });
    expect(res.status).toBe(401);
    expect(applyBulkOverride).not.toHaveBeenCalled();
  });
});

describe("GET /country-engine/held-summary", () => {
  it("aggregates per-country status counts sorted by held desc", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [
          countryEngineEventsTable,
          [
            { countrySlug: "indonesia", inclusionStatus: "held", n: 11300 },
            { countrySlug: "indonesia", inclusionStatus: "included", n: 200 },
            { countrySlug: "jakarta", inclusionStatus: "held", n: 11800 },
            { countrySlug: "jakarta", inclusionStatus: "excluded", n: 50 },
          ],
        ],
      ]),
    );
    const res = await fetch(`${baseUrl}/country-engine/held-summary`);
    const json = (await res.json()) as Rows;
    expect(res.status).toBe(200);
    expect(json).toEqual([
      { countrySlug: "jakarta", included: 0, excluded: 50, held: 11800, total: 11850 },
      { countrySlug: "indonesia", included: 200, excluded: 0, held: 11300, total: 11500 },
    ]);
  });
});

describe("GET /countries/:slug/engine/audit", () => {
  it("returns recent audit rows", async () => {
    const auditRow = {
      id: 1,
      countrySlug: SLUG,
      eventId: "42",
      action: "override",
      detail: { severity: "High" },
      actor: "user-1",
      createdAt: "2026-06-13T00:00:00.000Z",
    };
    stubSelect(new Map<unknown, Rows>([[countryEngineAuditTable, [auditRow]]]));

    const res = await fetch(`${baseUrl}/countries/${SLUG}/engine/audit`);
    const json = (await res.json()) as Rows;

    expect(res.status).toBe(200);
    expect(json).toEqual([auditRow]);
  });
});
