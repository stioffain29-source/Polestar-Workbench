import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Owner-gated Data Centre facility REGISTRY CRUD. Two guarantees under test:
//   1. Validation — required fields (name/country) and the constrained
//      status / planning-risk vocabularies are enforced (400 on bad input).
//   2. Status-transition stamping — a PATCH that changes `status` stamps
//      statusChanged=true + previousStatus + statusChangedAt; a PATCH that
//      leaves status unchanged does NOT stamp them.
// The router is mounted directly (requireOwner is applied at app level in
// routes/index.ts), so these tests exercise the handler logic in isolation.

import { db } from "@workspace/db";
import dataCentreFacilitiesRouter from "../../artifacts/api-server/src/routes/dataCentreFacilities";

type Rows = Record<string, unknown>[];

let capturedInsertValues: unknown;
let capturedUpdateValues: unknown;

function stubSelect(returnRows: Rows): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(returnRows),
      then: (resolve: (v: Rows) => unknown) => resolve(returnRows),
    };
    return chain as never;
  });
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

function stubUpdate(returnRows: Rows): void {
  jest.spyOn(db, "update").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      set: (v: unknown) => {
        capturedUpdateValues = v;
        return chain;
      },
      where: () => chain,
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
  app.use(express.json({ limit: "1mb" }));
  app.use(dataCentreFacilitiesRouter);
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
  capturedUpdateValues = undefined;
});

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/data-centre-facilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

async function patch(id: number, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/data-centre-facilities/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
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

describe("Data Centre facility registry — validation", () => {
  it("rejects a create with no name", async () => {
    const { status } = await post({ country: "Malaysia" });
    expect(status).toBe(400);
  });

  it("rejects a create with no country", async () => {
    const { status } = await post({ name: "Cyberjaya DC1" });
    expect(status).toBe(400);
  });

  it("rejects an out-of-vocabulary status", async () => {
    const { status } = await post({
      name: "Cyberjaya DC1",
      country: "Malaysia",
      status: "Exploding",
    });
    expect(status).toBe(400);
  });

  it("rejects an out-of-vocabulary planning risk", async () => {
    const { status } = await post({
      name: "Cyberjaya DC1",
      country: "Malaysia",
      planningRisk: "Vibes off",
    });
    expect(status).toBe(400);
  });

  it("accepts a valid minimal create", async () => {
    stubInsert([{ id: 1, name: "Cyberjaya DC1", country: "Malaysia", status: "Unknown" }]);
    const { status, json } = await post({ name: "Cyberjaya DC1", country: "Malaysia" });
    expect(status).toBe(201);
    expect(json.id).toBe(1);
    const v = capturedInsertValues as Record<string, unknown>;
    expect(v.name).toBe("Cyberjaya DC1");
    expect(v.country).toBe("Malaysia");
  });
});

describe("Data Centre facility registry — status transition stamping", () => {
  it("stamps the mover fields when status changes", async () => {
    stubSelect([{ id: 7, name: "DC7", country: "Singapore", status: "Under construction" }]);
    stubUpdate([{ id: 7, status: "Operational", statusChanged: true }]);

    const { status } = await patch(7, { status: "Operational" });
    expect(status).toBe(200);

    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.statusChanged).toBe(true);
    expect(v.previousStatus).toBe("Under construction");
    expect(v.statusChangedAt).toBeInstanceOf(Date);
  });

  it("does not stamp the mover fields when status is unchanged", async () => {
    stubSelect([{ id: 8, name: "DC8", country: "Singapore", status: "Operational" }]);
    stubUpdate([{ id: 8, status: "Operational" }]);

    const { status } = await patch(8, { status: "Operational", notes: "tweaked" });
    expect(status).toBe(200);

    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.statusChanged).toBeUndefined();
    expect(v.previousStatus).toBeUndefined();
    expect(v.statusChangedAt).toBeUndefined();
  });

  it("does not stamp the mover fields when status is absent from the patch", async () => {
    stubSelect([{ id: 9, name: "DC9", country: "Singapore", status: "Proposed" }]);
    stubUpdate([{ id: 9, status: "Proposed" }]);

    const { status } = await patch(9, { notes: "note only" });
    expect(status).toBe(200);

    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.statusChanged).toBeUndefined();
    expect(v.previousStatus).toBeUndefined();
  });

  it("404s a patch to a missing facility", async () => {
    stubSelect([]);
    const { status } = await patch(999, { status: "Operational" });
    expect(status).toBe(404);
  });
});
