import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Owner-gated per-country DATA-CENTRE RISK FRAMEWORK CRUD. Guarantees under test:
//   1. Validation — `country` is required (400 on bad input).
//   2. Country normalisation — country is trimmed on write.
//   3. Case-insensitive uniqueness — a create for a country already on file is
//      rejected 409 (never a duplicate row).
//   4. Full-object replace — a PATCH `dimensions` overwrites the assessment map
//      wholesale (captured verbatim, no per-key merge).
//   5. 404 on a patch to a missing row.
// The router is mounted directly (requireOwner is applied at app level in
// routes/index.ts), so these tests exercise the handler logic in isolation.

import { db } from "@workspace/db";
import dataCentreCountryRiskRouter from "../../artifacts/api-server/src/routes/dataCentreCountryRisk";

type Rows = Record<string, unknown>[];

let capturedInsertValues: unknown;
let capturedUpdateValues: unknown;
let insertCalled = false;

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
    insertCalled = true;
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
  app.use(dataCentreCountryRiskRouter);
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
  insertCalled = false;
});

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/data-centre-country-risk`, {
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
  const res = await fetch(`${baseUrl}/data-centre-country-risk/${id}`, {
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

const DIM = {
  rating: "High",
  rationale: "seeded from index",
  source: "TI CPI 2024",
  analystNote: "",
  provisional: true,
  overridden: false,
  seededFrom: "TI CPI 2024",
};

describe("Data Centre country-risk framework — validation & normalisation", () => {
  it("rejects a create with no country", async () => {
    const { status } = await post({ overallNote: "orphan" });
    expect(status).toBe(400);
  });

  it("trims the country on a valid create", async () => {
    stubSelect([]); // no existing row → not a duplicate
    stubInsert([{ id: 1, country: "Malaysia", dimensions: {} }]);
    const { status, json } = await post({ country: "  Malaysia  " });
    expect(status).toBe(201);
    expect(json.id).toBe(1);
    const v = capturedInsertValues as Record<string, unknown>;
    expect(v.country).toBe("Malaysia");
  });

  it("rejects a duplicate country (case-insensitive) with 409", async () => {
    stubSelect([{ id: 42 }]); // a row already exists for this country
    stubInsert([{ id: 99 }]);
    const { status } = await post({ country: "malaysia" });
    expect(status).toBe(409);
    expect(insertCalled).toBe(false);
  });
});

describe("Data Centre country-risk framework — full-object replace", () => {
  it("replaces the dimensions map wholesale on PATCH", async () => {
    stubSelect([{ id: 7, country: "Malaysia", dimensions: {} }]);
    stubUpdate([{ id: 7, country: "Malaysia", dimensions: { corruption: DIM } }]);

    const { status } = await patch(7, { dimensions: { corruption: DIM } });
    expect(status).toBe(200);

    const v = capturedUpdateValues as Record<string, unknown>;
    const dims = v.dimensions as Record<string, Record<string, unknown>>;
    expect(dims.corruption.rating).toBe("High");
    expect(dims.corruption.provisional).toBe(true);
    expect(v.updatedAt).toBeInstanceOf(Date);
  });

  it("404s a patch to a missing country-risk row", async () => {
    stubSelect([]);
    const { status } = await patch(999, { overallNote: "x" });
    expect(status).toBe(404);
  });
});
