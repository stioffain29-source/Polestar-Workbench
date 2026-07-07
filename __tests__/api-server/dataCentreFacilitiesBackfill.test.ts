import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Token-gated Data Centre facility REGISTRY backfill. Guarantees under test:
//   1. Auth — the route is gated by INGEST_ADMIN_TOKEN (401 without a token).
//   2. Validation — body must be { facilities: [...] } with non-empty
//      name/country per row (400 otherwise).
//   3. Idempotency — a row whose source_url already exists is skipped.
//   4. Safety — linkedIncidentId is never carried across databases (forced null)
//      and blank status/planningRisk fall back to their "Unknown" defaults.
// The router is mounted directly; requireAdminToken runs inside it.

import { db } from "@workspace/db";
import backfillRouter from "../../artifacts/api-server/src/routes/backfill";

type Rows = Record<string, unknown>[];

let capturedInsertValues: unknown;
let capturedWhere: unknown[] = [];

function stubSelect(returnRows: Rows): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        capturedWhere.push(cond);
        return chain;
      },
      limit: () => Promise.resolve(returnRows),
      then: (resolve: (v: Rows) => unknown) => resolve(returnRows),
    };
    return chain as never;
  });
}

// Walk a (real) Drizzle SQL condition and collect the SQL column names it
// references. Used to prove the idempotency match keys on source_url ALONE
// (never the non-discriminating name/country natural key) when a source_url
// is present. WeakSet guards against the column<->table back-reference cycle.
function collectColumnNames(
  node: unknown,
  acc: Set<string> = new Set(),
  seen: WeakSet<object> = new WeakSet(),
): Set<string> {
  if (!node || typeof node !== "object") return acc;
  if (seen.has(node)) return acc;
  seen.add(node);
  const n = node as Record<string, unknown>;
  // A Drizzle Column carries a string `name` plus a `columnType` tag; record
  // it and do NOT recurse (its `.table` points back at all sibling columns).
  if (typeof n["name"] === "string" && typeof n["columnType"] === "string") {
    acc.add(n["name"] as string);
    return acc;
  }
  const chunks = n["queryChunks"];
  if (Array.isArray(chunks)) {
    for (const c of chunks) collectColumnNames(c, acc, seen);
  }
  return acc;
}

function stubInsert(returnRows: Rows): void {
  jest.spyOn(db, "insert").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      values: (v: unknown) => {
        capturedInsertValues = v;
        return chain;
      },
      returning: () => Promise.resolve(returnRows),
    };
    return chain as never;
  });
}

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "8mb" }));
  // Bare-express harness has no pino logger; stub req.log so route handlers
  // that call req.log.* don't throw (→ HTML 500 → res.json parse failure).
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    next();
  });
  app.use(backfillRouter);
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
  capturedInsertValues = undefined;
  capturedWhere = [];
  // The global jest.setup clears integration env before each test; set the
  // admin token AFTER that so requireAdminToken sees it (503 -> 401/200).
  process.env["INGEST_ADMIN_TOKEN"] = "test-token";
});

async function post(body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/admin/data-centre-facilities/backfill`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

describe("Data Centre facility backfill — auth & validation", () => {
  it("401s without a token", async () => {
    const { status } = await post({ facilities: [{ name: "A", country: "Malaysia" }] });
    expect(status).toBe(401);
  });

  it("400s on a non-array body", async () => {
    const { status } = await post({ facilities: {} }, "test-token");
    expect(status).toBe(400);
  });

  it("400s when a row is missing name", async () => {
    const { status } = await post({ facilities: [{ country: "Malaysia" }] }, "test-token");
    expect(status).toBe(400);
  });
});

describe("Data Centre facility backfill — insert & idempotency", () => {
  it("inserts a new facility, forcing linkedIncidentId null and Unknown defaults", async () => {
    stubSelect([]); // not already present
    stubInsert([{ id: 42 }]);

    const { status, json } = await post(
      {
        facilities: [
          {
            name: "Cyberjaya DC1",
            country: "Malaysia",
            latitude: 2.9,
            longitude: 101.6,
            sourceUrl: "https://www.openstreetmap.org/way/1",
          },
        ],
      },
      "test-token",
    );

    expect(status).toBe(200);
    expect(json.insertedCount).toBe(1);
    const v = capturedInsertValues as Record<string, unknown>;
    expect(v.name).toBe("Cyberjaya DC1");
    expect(v.country).toBe("Malaysia");
    expect(v.status).toBe("Unknown");
    expect(v.planningRisk).toBe("Unknown");
    expect(v.facilityType).toBe("Unknown / not reported");
    expect(v.linkedIncidentId).toBeNull();
  });

  it("skips a facility already present by source_url", async () => {
    stubSelect([{ id: 7 }]); // already present
    stubInsert([{ id: 999 }]);

    const { status, json } = await post(
      {
        facilities: [
          {
            name: "Cyberjaya DC1",
            country: "Malaysia",
            sourceUrl: "https://www.openstreetmap.org/way/1",
          },
        ],
      },
      "test-token",
    );

    expect(status).toBe(200);
    expect(json.insertedCount).toBe(0);
    expect(Array.isArray(json.skipped)).toBe(true);
    expect((json.skipped as unknown[]).length).toBe(1);
  });

  it("inserts two distinct facilities sharing name+country but with different source_urls", async () => {
    // Regression guard: (name, country) is NOT discriminating — 43 dev rows
    // share a pair (e.g. many "NTT | Japan"). The idempotency check must key on
    // source_url ALONE when present, else the second row is wrongly skipped and
    // prod ends up with fewer facilities than dev (253 instead of 296).
    stubSelect([]); // neither present
    stubInsert([{ id: 1 }]);

    const { status, json } = await post(
      {
        facilities: [
          {
            name: "NTT DC",
            country: "Japan",
            latitude: 35.6,
            longitude: 139.7,
            sourceUrl: "https://www.openstreetmap.org/way/100",
          },
          {
            name: "NTT DC",
            country: "Japan",
            latitude: 34.7,
            longitude: 135.5,
            sourceUrl: "https://www.openstreetmap.org/way/200",
          },
        ],
      },
      "test-token",
    );

    expect(status).toBe(200);
    expect(json.insertedCount).toBe(2);
    // Each presence probe must match on source_url ALONE (never name/country).
    expect(capturedWhere.length).toBe(2);
    for (const cond of capturedWhere) {
      const cols = collectColumnNames(cond);
      expect(cols.has("source_url")).toBe(true);
      expect(cols.has("name")).toBe(false);
      expect(cols.has("country")).toBe(false);
    }
  });
});
