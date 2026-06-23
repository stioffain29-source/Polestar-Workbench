import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// CORE PRODUCT INVARIANT under test (see lib/db/src/schema/socialWatchItems.ts):
// a KAMMI social-watch post is supporting CONTEXT, NEVER an incident. The only
// path from the social_watch_items table into `incidents` is the explicit,
// server-re-derived PROMOTE action, and only for an item whose stored
// status/caption confirms the protest is actually active.
//
// This regression test locks that invariant in (it was previously only verified
// by hand). It mounts the REAL incidents + social-watch routers on an Express
// app, drives them over HTTP, and backs them with a small STATEFUL in-memory DB
// so the cross-route count effect is exercised end to end:
//   - ingesting/seeding social posts leaves GET /api/incidents?topic=flashpoint
//     unchanged (social rows never reach the incidents table);
//   - a non-promotable (planned) item cannot be promoted (409) and adds nothing;
//   - promoting a promotable item adds EXACTLY one incident and back-links it;
//   - re-promoting the same item returns 409 and adds nothing more.
//
// A second block pins the ingest side: runSocialWatchIngest never inserts into,
// or opens a transaction against, the incidents table.

import {
  db,
  incidentsTable,
  incidentCorroborationsTable,
  socialWatchItemsTable,
} from "@workspace/db";
import { runSocialWatchIngest } from "@workspace/ingest";
import incidentsRouter from "../../artifacts/api-server/src/routes/incidents";
import socialWatchRouter from "../../artifacts/api-server/src/routes/socialWatch";
import {
  adminAuthHeaders,
  enableTestAdminToken,
} from "./adminAuthTestHelpers";

// ---------------------------------------------------------------------------
// Stateful in-memory DB backing both routers.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let incidents: Row[] = [];
let socialItems: Row[] = [];
let nextIncidentId = 1;

// Recursively collect numeric bound values from a Drizzle where clause so the
// promote `where(eq(id, n))` lookup/update can filter by id. Scoped to the
// social-watch table only (incident reads return the whole seeded set, which is
// all flashpoint), so the relevance clause's strings never interfere.
function collectNumbers(node: unknown, out: number[], seen: Set<unknown>): void {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  const rec = node as Record<string, unknown>;
  if (typeof rec.value === "number") out.push(rec.value);
  for (const v of Object.values(rec)) {
    if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out, seen));
    else if (v && typeof v === "object") collectNumbers(v, out, seen);
  }
}

function resolveSelect(table: unknown, where: unknown): Promise<Row[]> {
  if (table === incidentsTable) return Promise.resolve(incidents.map((r) => ({ ...r })));
  if (table === incidentCorroborationsTable) return Promise.resolve([]);
  if (table === socialWatchItemsTable) {
    const ids: number[] = [];
    collectNumbers(where, ids, new Set());
    const rows = ids.length
      ? socialItems.filter((i) => ids.includes(i.id as number))
      : socialItems;
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }
  return Promise.resolve([]);
}

function selectChain(): Record<string, unknown> {
  const state: { table: unknown; where: unknown } = { table: null, where: null };
  const settle = () => resolveSelect(state.table, state.where);
  const chain: Record<string, unknown> = {
    from: (t: unknown) => {
      state.table = t;
      return chain;
    },
    where: (c: unknown) => {
      state.where = c;
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      settle().then(res, rej),
    catch: (rej: (e: unknown) => unknown) => settle().catch(rej),
    finally: (f: () => void) => settle().finally(f),
  };
  return chain;
}

function installDbStub(): void {
  jest.spyOn(db, "select").mockImplementation(() => selectChain() as never);

  // The only sanctioned incident write goes through promote's transaction.
  (db as unknown as { transaction: unknown }).transaction = jest.fn(
    async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: (table: unknown) => ({
          values: (vals: Row) => ({
            returning: async () => {
              if (table === incidentsTable) {
                const row = { id: nextIncidentId++, ...vals };
                incidents.push(row);
                return [row];
              }
              return [];
            },
          }),
        }),
        update: (table: unknown) => ({
          set: (vals: Row) => ({
            where: async (cond: unknown) => {
              if (table === socialWatchItemsTable) {
                const ids: number[] = [];
                collectNumbers(cond, ids, new Set());
                for (const it of socialItems) {
                  if (ids.length === 0 || ids.includes(it.id as number)) {
                    Object.assign(it, vals);
                  }
                }
              }
              return undefined;
            },
          }),
        }),
      };
      return fn(tx);
    },
  );
}

// ---------------------------------------------------------------------------
// Express harness.
// ---------------------------------------------------------------------------

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll((done) => {
  enableTestAdminToken();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { info: () => void; warn: () => void } }).log = {
      info: () => {},
      warn: () => {},
    };
    next();
  });
  app.use("/api", incidentsRouter);
  app.use("/api", socialWatchRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => done());
});

beforeEach(() => {
  incidents = [];
  socialItems = [];
  nextIncidentId = 1;
  installDbStub();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flashpointIncidentCount(): Promise<number> {
  const res = await fetch(`${baseUrl}/api/incidents?topic=flashpoint`);
  const body = (await res.json()) as unknown[];
  expect(res.status).toBe(200);
  return body.length;
}

async function promote(id: number) {
  const res = await fetch(`${baseUrl}/api/social-watch/${id}/promote`, {
    method: "POST",
    headers: adminAuthHeaders(),
  });
  return { status: res.status, json: await res.json() };
}

function seedFlashpointIncidents(n: number): void {
  for (let i = 0; i < n; i++) {
    incidents.push({
      id: nextIncidentId++,
      topic: "flashpoint",
      title: `Existing flashpoint incident ${i}`,
      country: "Indonesia",
      occurredAt: new Date("2026-06-15T00:00:00Z"),
      severity: "Low",
      relevanceStatus: "relevant",
    });
  }
}

function seedSocialItem(over: Partial<Row> = {}): Row {
  const item: Row = {
    id: nextIncidentId++,
    sourceName: "social_watch",
    platform: "instagram",
    channel: "kammi.pusat",
    actor: "KAMMI Pusat",
    externalId: `ig_${Math.random().toString(36).slice(2)}`,
    postedAt: new Date("2026-06-20T00:00:00Z"),
    eventDate: new Date("2026-06-20T05:00:00Z"),
    eventTimeText: "12.00 WIB",
    caption: "Massa memadati Gedung DPR/MPR RI, aksi sedang berlangsung.",
    imageUrls: [],
    location: "Gedung DPR/MPR RI",
    city: "Jakarta",
    province: "DKI Jakarta",
    issue: "Reformasi Indonesia",
    status: "active",
    confidence: "high",
    url: "https://www.instagram.com/p/abc123/",
    country: "Indonesia",
    topic: "flashpoint",
    classification: "context",
    alertReasons: [],
    promotable: true,
    promotedIncidentId: null,
    promotedAt: null,
    ...over,
  };
  socialItems.push(item);
  return item;
}

describe("social-watch posts never inflate the incident count", () => {
  it("leaves the flashpoint incident count unchanged when social posts are ingested", async () => {
    seedFlashpointIncidents(3);
    const before = await flashpointIncidentCount();
    expect(before).toBe(3);

    // Ingesting/landing social-watch rows must not touch the incidents table.
    seedSocialItem({ status: "active", promotable: true });
    seedSocialItem({ status: "planned", promotable: false });
    seedSocialItem({ status: "active", promotable: true });

    expect(await flashpointIncidentCount()).toBe(3);
  });

  it("refuses to promote a non-promotable (planned) item and adds no incident", async () => {
    seedFlashpointIncidents(2);
    const planned = seedSocialItem({
      status: "planned",
      promotable: false,
      caption: "Ajakan aksi besok, mari bergabung. #ReformasiIndonesia",
    });

    const before = await flashpointIncidentCount();
    const { status, json } = await promote(planned.id as number);

    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/not promotable/i);
    expect(await flashpointIncidentCount()).toBe(before);
    // The watch item must remain unpromoted.
    expect(planned.promotedIncidentId).toBeNull();
  });

  it("adds exactly one incident when a promotable item is promoted and back-links it", async () => {
    seedFlashpointIncidents(4);
    const item = seedSocialItem({ status: "active", promotable: true });

    const before = await flashpointIncidentCount();
    expect(before).toBe(4);

    const { status, json } = await promote(item.id as number);

    expect(status).toBe(201);
    expect(json.topic).toBe("flashpoint");
    expect(typeof json.id).toBe("number");

    // Exactly +1 — no more, no fewer.
    expect(await flashpointIncidentCount()).toBe(before + 1);

    // The watch item now carries the back-link to the incident it created.
    expect(item.promotedIncidentId).toBe(json.id);
    expect(item.promotedAt).not.toBeNull();
  });

  it("returns 409 on re-promote and never creates a second incident", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialItem({ status: "active", promotable: true });

    const first = await promote(item.id as number);
    expect(first.status).toBe(201);
    const afterFirst = await flashpointIncidentCount();
    expect(afterFirst).toBe(2);

    const second = await promote(item.id as number);
    expect(second.status).toBe(409);
    expect(String(second.json.error)).toMatch(/already promoted/i);
    expect(second.json.incidentId).toBe(first.json.id);

    // No second incident was created.
    expect(await flashpointIncidentCount()).toBe(afterFirst);
  });

  it("the promoted item is reported with its promotedIncidentId on GET /social-watch", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialItem({ status: "active", promotable: true });
    const { json: created } = await promote(item.id as number);

    const res = await fetch(`${baseUrl}/api/social-watch`);
    const rows = (await res.json()) as Row[];
    expect(res.status).toBe(200);
    const promoted = rows.find((r) => r.id === item.id);
    expect(promoted).toBeDefined();
    expect(promoted!.promotedIncidentId).toBe(created.id);
  });

  it("404s when promoting a social-watch item that does not exist", async () => {
    seedFlashpointIncidents(1);
    const before = await flashpointIncidentCount();
    const { status } = await promote(99999);
    expect(status).toBe(404);
    expect(await flashpointIncidentCount()).toBe(before);
  });
});

describe("social-watch ingest never writes the incidents table", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it("runSocialWatchIngest performs no incident insert and opens no transaction", async () => {
    // Switch the whole source off so the run does no network fetch and stays
    // fully deterministic; the assertion is about which TABLES it could write.
    process.env.SOCIAL_WATCH_ENABLED = "false";

    const insertSpy = jest
      .spyOn(db, "insert")
      .mockImplementation(() => {
        const chain: Record<string, unknown> = {
          values: () => chain,
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => Promise.resolve([]),
          then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res),
        };
        return chain as never;
      });
    const updateSpy = jest.spyOn(db, "update").mockImplementation(() => {
      const chain: Record<string, unknown> = {
        set: () => chain,
        where: () => Promise.resolve(undefined),
      };
      return chain as never;
    });
    jest.spyOn(db, "select").mockImplementation(() => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res),
      };
      return chain as never;
    });
    const txSpy = jest.fn();
    (db as unknown as { transaction: unknown }).transaction = txSpy;

    await runSocialWatchIngest({ commit: true });

    for (const call of insertSpy.mock.calls) {
      expect(call[0]).not.toBe(incidentsTable);
    }
    for (const call of updateSpy.mock.calls) {
      expect(call[0]).not.toBe(incidentsTable);
    }
    expect(txSpy).not.toHaveBeenCalled();
  });
});
