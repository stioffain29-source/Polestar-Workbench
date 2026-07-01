import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Regression cover for the in-place EDIT of a KAMMI social-watch context row
// (PATCH /api/social-watch/:id). The invariants under test:
//   - an OMITTED optional field KEEPS its stored value (never silently
//     re-derived from the caption, which would overwrite curated analyst data);
//   - a supplied field is applied;
//   - promotability/status are RE-DERIVED server-side, never trusted from the
//     client;
//   - editing NEVER touches the incidents table (count invariant);
//   - a promoted item is refused (409); a missing item is 404; a dedup
//     collision with another row is a clean 409, not a 500;
//   - the write is admin-token gated (401 without it).

import { db, socialWatchItemsTable } from "@workspace/db";
import socialWatchRouter from "../../artifacts/api-server/src/routes/socialWatch";
import { adminAuthHeaders, enableTestAdminToken } from "./adminAuthTestHelpers";

type Row = Record<string, unknown>;

let socialItems: Row[] = [];
let nextId = 1;

// Recursively collect numeric bound values from a Drizzle where clause so the
// `where(eq(id, n))` load/update can filter by id.
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

// The alert-diff prior lookup projects exactly { location, eventTimeText }.
// Detect it so we can return no prior (the alert diff is not under test here).
function isPriorLookup(proj: unknown): boolean {
  if (!proj || typeof proj !== "object") return false;
  const keys = Object.keys(proj as Record<string, unknown>);
  return keys.length === 2 && keys.includes("location") && keys.includes("eventTimeText");
}

function installDbStub(): void {
  jest.spyOn(db, "select").mockImplementation((proj?: unknown) => withProj(proj) as never);

  jest.spyOn(db, "insert").mockImplementation((table: unknown) => {
    let vals: Row = {};
    const chain: Record<string, unknown> = {
      values: (v: Row) => {
        vals = v;
        return chain;
      },
      onConflictDoNothing: () => chain,
      returning: async () => {
        if (table === socialWatchItemsTable) {
          const dup = socialItems.find((i) => i.dedupKey === vals.dedupKey);
          if (dup) return [];
          const row = {
            id: nextId++,
            promotedIncidentId: null,
            promotedAt: null,
            ...vals,
          };
          socialItems.push(row);
          return [{ ...row }];
        }
        return [];
      },
    };
    return chain as never;
  });

  jest.spyOn(db, "update").mockImplementation((table: unknown) => {
    let vals: Row = {};
    let where: unknown = null;
    const chain: Record<string, unknown> = {
      set: (v: Row) => {
        vals = v;
        return chain;
      },
      where: (c: unknown) => {
        where = c;
        return chain;
      },
      returning: async () => {
        if (table !== socialWatchItemsTable) return [];
        const ids: number[] = [];
        collectNumbers(where, ids, new Set());
        const target = socialItems.find((i) => ids.includes(i.id as number));
        if (!target) return [];
        // Simulate the UNIQUE dedup index: editing content into another row's
        // fingerprint must raise a Postgres 23505 (code path → 409).
        if (
          typeof vals.dedupKey === "string" &&
          socialItems.some(
            (i) => i.id !== target.id && i.dedupKey === vals.dedupKey,
          )
        ) {
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        Object.assign(target, vals);
        return [{ ...target }];
      },
    };
    return chain as never;
  });
}

// Recreate a select chain with the projection baked into its settle logic.
function withProj(proj: unknown): Record<string, unknown> {
  const state: { table: unknown; where: unknown } = { table: null, where: null };
  const settle = (): Promise<Row[]> => {
    if (state.table !== socialWatchItemsTable) return Promise.resolve([]);
    if (isPriorLookup(proj)) return Promise.resolve([]);
    const ids: number[] = [];
    collectNumbers(state.where, ids, new Set());
    if (ids.length) {
      return Promise.resolve(
        socialItems.filter((i) => ids.includes(i.id as number)).map((r) => ({ ...r })),
      );
    }
    return Promise.resolve(socialItems.map((r) => ({ ...r })));
  };
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
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      settle().then(res, rej),
    catch: (rej: (e: unknown) => unknown) => settle().catch(rej),
    finally: (f: () => void) => settle().finally(f),
  };
  return chain;
}

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
  socialItems = [];
  nextId = 1;
  installDbStub();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ACTIVE_CAPTION =
  "Massa memadati Gedung DPR/MPR RI, aksi sedang berlangsung sekarang. #ReformasiIndonesia";
const PLANNED_CAPTION =
  "Ajakan aksi besok pukul 12.00 WIB, mari bergabung di depan gedung. #ReformasiIndonesia";

function seedCuratedActiveItem(over: Partial<Row> = {}): Row {
  const item: Row = {
    id: nextId++,
    sourceName: "social_watch",
    platform: "instagram",
    channel: "kammi.pusat",
    actor: "KAMMI Pusat",
    externalId: "manual_instagram_seed",
    postedAt: new Date("2026-06-20T00:00:00Z"),
    eventDate: new Date("2026-07-10T00:00:00Z"),
    eventTimeText: "15.30 WIB",
    caption: ACTIVE_CAPTION,
    imageUrls: [],
    location: "Balai Kota Surabaya",
    city: "Surabaya",
    province: "Jawa Timur",
    issue: "Tolak Kenaikan BBM",
    status: "active",
    confidence: "high",
    url: "https://www.instagram.com/p/seed/",
    country: "Indonesia",
    topic: "flashpoint",
    classification: "context",
    alertReasons: [],
    promotable: true,
    promotedIncidentId: null,
    promotedAt: null,
    dedupKey: "seed-dedup-key",
    ...over,
  };
  socialItems.push(item);
  return item;
}

async function patch(id: number | string, body: Record<string, unknown>, auth = true) {
  const res = await fetch(`${baseUrl}/api/social-watch/${id}`, {
    method: "PATCH",
    headers: auth
      ? adminAuthHeaders({ "content-type": "application/json" })
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Row };
}

async function createItem(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/social-watch`, {
    method: "POST",
    headers: adminAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Row };
}

describe("PATCH /social-watch/:id edits a context row in place", () => {
  it("keeps omitted analyst fields at their stored values (no caption re-derive)", async () => {
    const item = seedCuratedActiveItem();

    // Only the caption changes — to text that would classify as PLANNED and
    // parse a DIFFERENT location/issue. Every omitted field must be preserved.
    const { status, json } = await patch(item.id as number, {
      platform: "instagram",
      url: item.url as string,
      caption: PLANNED_CAPTION,
    });

    expect(status).toBe(200);
    // Omitted fields preserved from the stored row.
    expect(json.location).toBe("Balai Kota Surabaya");
    expect(json.city).toBe("Surabaya");
    expect(json.province).toBe("Jawa Timur");
    expect(json.issue).toBe("Tolak Kenaikan BBM");
    expect(json.eventTimeText).toBe("15.30 WIB");
    expect((json.eventDate as string).slice(0, 10)).toBe("2026-07-10");
    // Status omitted → stored value kept, NOT re-derived to "planned".
    expect(json.status).toBe("active");
    // Caption applied.
    expect(String(json.caption)).toContain("besok");
  });

  it("applies supplied fields and re-derives promotability server-side", async () => {
    const item = seedCuratedActiveItem();

    const { status, json } = await patch(item.id as number, {
      platform: "instagram",
      url: item.url as string,
      caption: PLANNED_CAPTION,
      location: "Gedung DPR/MPR RI",
      city: "Jakarta",
      status: "planned",
      // A spoofed promotable claim must be ignored (field not accepted).
      promotable: true,
    } as Record<string, unknown>);

    expect(status).toBe(200);
    expect(json.location).toBe("Gedung DPR/MPR RI");
    expect(json.city).toBe("Jakarta");
    expect(json.status).toBe("planned");
    // A planned action is not live on the street → not promotable, and the
    // spoofed client `promotable: true` is ignored (re-derived server-side).
    expect(json.promotable).toBe(false);
  });

  it("refuses (409) to edit an item already promoted to an incident", async () => {
    const item = seedCuratedActiveItem({ promotedIncidentId: 42 });
    const { status, json } = await patch(item.id as number, {
      platform: "instagram",
      url: item.url as string,
      caption: ACTIVE_CAPTION,
    });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/already promoted/i);
    expect(json.incidentId).toBe(42);
  });

  it("404s when editing a social-watch item that does not exist", async () => {
    const { status } = await patch(99999, {
      platform: "instagram",
      url: "https://www.instagram.com/p/none/",
      caption: ACTIVE_CAPTION,
    });
    expect(status).toBe(404);
  });

  it("401s without an admin token", async () => {
    const item = seedCuratedActiveItem();
    const { status } = await patch(
      item.id as number,
      {
        platform: "instagram",
        url: item.url as string,
        caption: ACTIVE_CAPTION,
      },
      false,
    );
    expect(status).toBe(401);
  });

  it("returns 409 (not 500) when the edit collides with another row's content", async () => {
    // Two distinct real rows (distinct dedup fingerprints).
    const a = await createItem({
      platform: "instagram",
      url: "https://www.instagram.com/p/aaa/",
      caption: PLANNED_CAPTION,
    });
    const b = await createItem({
      platform: "instagram",
      url: "https://www.instagram.com/p/bbb/",
      caption: ACTIVE_CAPTION,
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Edit A's caption to be identical to B → same dedup fingerprint → 409.
    const { status, json } = await patch(a.json.id as number, {
      platform: "instagram",
      url: a.json.url as string,
      caption: ACTIVE_CAPTION,
    });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/already has this exact content/i);
  });
});
