import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// CORE PRODUCT INVARIANT under test (see lib/db/src/schema/socialRaw.ts):
// a Facebook OSINT post is supporting CONTEXT, NEVER an incident. The only path
// from the `social_raw` table into `incidents` is the explicit, server-RE-DERIVED
// PROMOTE action, and only for a post that is BOTH security-relevant AND credible
// (declared official/local-media page, linked credible domain, or cross-feed
// corroboration) AND not already a tracked incident.
//
// This regression test mounts the REAL incidents + social-raw routers on an
// Express app, drives them over HTTP, and backs them with a small STATEFUL
// in-memory DB so the cross-route count effect is exercised end to end:
//   - landing social_raw rows leaves GET /api/incidents?topic=flashpoint
//     unchanged (social rows never reach the incidents table);
//   - a non-promotable item cannot be promoted (409) and adds nothing;
//   - a promotable item adds EXACTLY one incident and back-links it;
//   - re-promoting returns 409 and adds nothing more;
//   - a post that duplicates a tracked incident is blocked (409).

import { db, incidentsTable, socialRawTable } from "@workspace/db";
import incidentsRouter from "../../artifacts/api-server/src/routes/incidents";
import socialRawRouter from "../../artifacts/api-server/src/routes/socialRaw";

// ---------------------------------------------------------------------------
// Stateful in-memory DB backing both routers.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let incidents: Row[] = [];
let socialItems: Row[] = [];
let nextIncidentId = 1;

// Recursively collect numeric bound values from a Drizzle where clause so the
// promote `where(eq(id, n))` lookup/update can filter by id. The incident
// candidate query filters by Date/string only (no numbers), so it never
// accidentally narrows; incident reads return the whole seeded set.
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
  if (table === incidentsTable)
    return Promise.resolve(incidents.map((r) => ({ ...r })));
  if (table === socialRawTable) {
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

// Apply an UPDATE against the in-memory socialItems, modelling the promote
// claim's `WHERE id = ? AND promoted_incident_id IS NULL` guard: a write that
// SETS promotedIncidentId only lands on rows still unpromoted (so a second,
// racing claim matches 0 rows). Returns the rows actually changed, mirroring
// Postgres `... RETURNING`. Memoised so awaiting AND calling .returning() on the
// same builder never double-applies.
function makeUpdateBuilder(table: unknown, vals: Row, cond: unknown) {
  let ran = false;
  let changed: Row[] = [];
  const apply = (): Row[] => {
    if (ran) return changed;
    ran = true;
    if (table === socialRawTable) {
      const ids: number[] = [];
      collectNumbers(cond, ids, new Set());
      const isClaim = Object.prototype.hasOwnProperty.call(
        vals,
        "promotedIncidentId",
      );
      for (const it of socialItems) {
        if (ids.length === 0 || ids.includes(it.id as number)) {
          if (isClaim && it.promotedIncidentId != null) continue;
          Object.assign(it, vals);
          changed.push(it);
        }
      }
    }
    return changed;
  };
  return {
    returning: async () => apply(),
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(apply()).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(apply()).catch(rej),
    finally: (f: () => void) => Promise.resolve(apply()).finally(f),
  };
}

function installDbStub(): void {
  jest.spyOn(db, "select").mockImplementation(() => selectChain() as never);

  // The only sanctioned incident write goes through promote's transaction, which
  // here SNAPSHOTS and ROLLS BACK on throw so a guard rejection (e.g. a lost
  // concurrent claim) undoes the speculative incident insert — exactly like a
  // real Postgres transaction.
  (db as unknown as { transaction: unknown }).transaction = jest.fn(
    async (fn: (tx: unknown) => unknown) => {
      const snapIncidents = incidents.map((r) => ({ ...r }));
      const snapSocial = socialItems.map((r) => ({ ...r }));
      const snapNext = nextIncidentId;
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
            where: (cond: unknown) => makeUpdateBuilder(table, vals, cond),
          }),
        }),
      };
      try {
        return await fn(tx);
      } catch (err) {
        incidents = snapIncidents;
        socialItems = snapSocial;
        nextIncidentId = snapNext;
        throw err;
      }
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
  app.use("/api", socialRawRouter);
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
  const res = await fetch(`${baseUrl}/api/social-raw/${id}/promote`, {
    method: "POST",
  });
  return { status: res.status, json: await res.json() };
}

function seedFlashpointIncidents(n: number): void {
  for (let i = 0; i < n; i++) {
    incidents.push({
      id: nextIncidentId++,
      topic: "flashpoint",
      title: `Existing flashpoint incident ${i}`,
      country: "Papua New Guinea",
      occurredAt: new Date("2026-06-15T00:00:00Z"),
      severity: "low",
      relevanceStatus: "relevant",
    });
  }
}

function seedSocialRawItem(over: Partial<Row> = {}): Row {
  const item: Row = {
    id: nextIncidentId++,
    sourceName: "facebook_osint",
    platform: "facebook",
    pageHandle: "papuanewsdesk",
    pageName: "Papua News Desk",
    sourceTier: "official",
    externalId: `fb_${Math.random().toString(36).slice(2)}`,
    postedAt: new Date("2026-06-20T00:00:00Z"),
    incidentDate: new Date("2026-06-20T00:00:00Z"),
    caption: "Armed robbery and shooting at a store in Port Moresby",
    imageUrls: [],
    links: [],
    detectedCredibleDomains: [],
    country: "Papua New Guinea",
    province: "National Capital District",
    location: "Port Moresby",
    category: "Armed robbery / hold-up",
    businessImpact: "Retail premises disrupted.",
    securityRelevant: true,
    credible: true,
    credibilityReason: "Monitored page is a declared official source",
    corroborated: false,
    corroborationReason: null,
    corroboratingIncidentId: null,
    promotionTopic: "conflict",
    url: "https://www.facebook.com/p/abc123/",
    classification: "context",
    promotable: true,
    promotedIncidentId: null,
    promotedAt: null,
    createdAt: new Date("2026-06-20T01:00:00Z"),
    updatedAt: new Date("2026-06-20T01:00:00Z"),
    ...over,
  };
  socialItems.push(item);
  return item;
}

describe("Facebook OSINT posts never inflate the incident count", () => {
  it("leaves the incident count unchanged when social_raw rows land", async () => {
    seedFlashpointIncidents(3);
    const before = await flashpointIncidentCount();
    expect(before).toBe(3);

    seedSocialRawItem({ promotable: true });
    seedSocialRawItem({ promotable: false, sourceTier: "osint", credible: false });
    seedSocialRawItem({ promotable: true });

    expect(await flashpointIncidentCount()).toBe(3);
  });

  it("404s when promoting an item that does not exist", async () => {
    seedFlashpointIncidents(1);
    const before = await flashpointIncidentCount();
    const { status } = await promote(999999);
    expect(status).toBe(404);
    expect(await flashpointIncidentCount()).toBe(before);
  });

  it("refuses to promote an unverified OSINT item (no credible signal)", async () => {
    seedFlashpointIncidents(2);
    // The server RE-DERIVES eligibility from the stored row, so even though this
    // seed says promotable:true, an osint tier with no domains / corroboration
    // is re-derived as NOT credible and rejected.
    const item = seedSocialRawItem({
      sourceTier: "osint",
      detectedCredibleDomains: [],
      corroborated: false,
      promotable: true,
    });
    const before = await flashpointIncidentCount();
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/not promotable/i);
    expect(await flashpointIncidentCount()).toBe(before);
    expect(item.promotedIncidentId).toBeNull();
  });

  it("refuses to promote a non-security category", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({
      category: "Other security",
      sourceTier: "official",
    });
    const before = await flashpointIncidentCount();
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/security-relevant/i);
    expect(await flashpointIncidentCount()).toBe(before);
  });

  it("adds exactly one incident when a credible item is promoted and back-links it", async () => {
    seedFlashpointIncidents(4);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const before = await flashpointIncidentCount();
    expect(before).toBe(4);

    const { status, json } = await promote(item.id as number);
    expect(status).toBe(201);
    expect(json.topic).toBe("conflict"); // armed robbery -> conflict
    expect(typeof json.id).toBe("number");

    expect(await flashpointIncidentCount()).toBe(before + 1);
    expect(item.promotedIncidentId).toBe(json.id);
    expect(item.promotedAt).not.toBeNull();
  });

  it("returns 409 on re-promote and never creates a second incident", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({ sourceTier: "official" });

    const first = await promote(item.id as number);
    expect(first.status).toBe(201);
    const afterFirst = await flashpointIncidentCount();

    const second = await promote(item.id as number);
    expect(second.status).toBe(409);
    expect(String(second.json.error)).toMatch(/already promoted/i);
    expect(second.json.incidentId).toBe(first.json.id);
    expect(await flashpointIncidentCount()).toBe(afterFirst);
  });

  it("creates exactly one incident under two concurrent promotes", async () => {
    seedFlashpointIncidents(2);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const before = await flashpointIncidentCount();

    // Fire both promotes without awaiting in between so they race. Whichever
    // ordering the event loop picks, the pre-check OR the in-transaction
    // `promoted_incident_id IS NULL` claim must let exactly one win; the loser's
    // speculative incident insert rolls back.
    const [a, b] = await Promise.all([
      promote(item.id as number),
      promote(item.id as number),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    expect(await flashpointIncidentCount()).toBe(before + 1);
    expect(item.promotedIncidentId).toBe(winner.json.id);
  });

  it("blocks promotion of a post that duplicates a tracked incident", async () => {
    // A live incident the post would double-count: same country, same day, same
    // category, high token overlap.
    incidents.push({
      id: nextIncidentId++,
      topic: "flashpoint",
      title: "Violent demonstration blockade outside parliament damages vehicles",
      summary: "Protesters blockaded the parliament building and damaged vehicles",
      country: "Papua New Guinea",
      province: "National Capital District",
      category: "Civil unrest / protest",
      occurredAt: new Date("2026-06-20T00:00:00Z"),
      incidentDate: new Date("2026-06-20T00:00:00Z"),
    });
    const before = await flashpointIncidentCount();

    const item = seedSocialRawItem({
      category: "Civil unrest / protest",
      sourceTier: "official",
      promotionTopic: "flashpoint",
      caption:
        "Violent demonstration blockade outside parliament building damaged vehicles",
      location: "National Capital District",
    });
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/duplicate/i);
    expect(typeof json.incidentId).toBe("number");
    expect(await flashpointIncidentCount()).toBe(before);
    expect(item.promotedIncidentId).toBeNull();
  });

  it("reports the promoted item with its promotedIncidentId on GET /social-raw", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const { json: created } = await promote(item.id as number);

    const res = await fetch(`${baseUrl}/api/social-raw`);
    const rows = (await res.json()) as Row[];
    expect(res.status).toBe(200);
    const promoted = rows.find((r) => r.id === item.id);
    expect(promoted).toBeDefined();
    expect(promoted!.promotedIncidentId).toBe(created.id);
  });
});
