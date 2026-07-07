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

// --- Per-field analyst LOCK maintenance (import never overwrites a lock) ------

describe("Data Centre facility registry — enrichment lock maintenance", () => {
  it("auto-locks an enrichable field the analyst changes", async () => {
    stubSelect([
      { id: 11, name: "DC11", country: "Singapore", status: "Operational", capacityMw: null, enrichmentLocks: null },
    ]);
    stubUpdate([{ id: 11 }]);

    const { status } = await patch(11, { capacityMw: 30 });
    expect(status).toBe(200);

    const v = capturedUpdateValues as Record<string, Record<string, { lockedAt: unknown }>>;
    expect(v.enrichmentLocks.capacityMw.lockedAt).toBeTruthy();
    expect(v.enrichmentLocks.status).toBeUndefined();
  });

  it("does not touch locks when an enrichable field is unchanged", async () => {
    stubSelect([
      { id: 12, name: "DC12", country: "Singapore", status: "Operational", capacityMw: 30, enrichmentLocks: null },
    ]);
    stubUpdate([{ id: 12 }]);

    const { status } = await patch(12, { capacityMw: 30, notes: "same" });
    expect(status).toBe(200);
    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.enrichmentLocks).toBeUndefined();
  });

  it("replaces the lock map from an explicit body (unlock by omission)", async () => {
    stubSelect([
      {
        id: 13,
        name: "DC13",
        country: "Singapore",
        status: "Operational",
        capacityMw: 30,
        enrichmentLocks: { capacityMw: { lockedAt: "2026-01-01T00:00:00.000Z" }, status: { lockedAt: "2026-01-01T00:00:00.000Z" } },
      },
    ]);
    stubUpdate([{ id: 13 }]);

    const { status } = await patch(13, {
      enrichmentLocks: { status: { lockedAt: "2026-01-01T00:00:00.000Z" } },
    });
    expect(status).toBe(200);
    const v = capturedUpdateValues as Record<string, Record<string, unknown>>;
    expect(v.enrichmentLocks.status).toBeTruthy();
    expect(v.enrichmentLocks.capacityMw).toBeUndefined();
  });

  it("clears all locks when the body sends null", async () => {
    stubSelect([
      {
        id: 14,
        name: "DC14",
        country: "Singapore",
        status: "Operational",
        capacityMw: 30,
        enrichmentLocks: { capacityMw: { lockedAt: "2026-01-01T00:00:00.000Z" } },
      },
    ]);
    stubUpdate([{ id: 14 }]);

    const { status } = await patch(14, { enrichmentLocks: null });
    expect(status).toBe(200);
    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.enrichmentLocks).toBeNull();
  });
});

// --- Provider-agnostic enrichment endpoints ----------------------------------

async function getJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  let json: unknown = undefined;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  return { status: res.status, json, res };
}

async function enrich(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${path}`, {
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

const GENERIC_CSV = [
  "name,operator,country,city,latitude,longitude,status,facility_type,capacity_mw,it_load_mw,source_ref,as_of",
  "Jakarta JK1,,Indonesia,,,,Operational,,50,,ProviderRef,2026-01-01",
].join("\n");

function jakartaFacility(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Jakarta JK1",
    country: "Indonesia",
    city: null,
    latitude: null,
    longitude: null,
    status: "Unknown",
    facilityType: "Unknown / not reported",
    capacityMw: null,
    itLoadMw: null,
    enrichmentSources: null,
    enrichmentLocks: null,
    ...overrides,
  };
}

describe("Data Centre enrichment endpoints", () => {
  it("lists the generic provider", async () => {
    const { status, json } = await getJson("/data-centre-enrichment/providers");
    expect(status).toBe(200);
    const providers = json as { token: string; columns: string[] }[];
    const generic = providers.find((p) => p.token === "generic");
    expect(generic).toBeDefined();
    expect(generic!.columns).toContain("capacity_mw");
  });

  it("serves a downloadable CSV template with the canonical header", async () => {
    const res = await fetch(`${baseUrl}/data-centre-enrichment/template.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toContain("name,operator,country");
  });

  it("400s an unknown provider on preview", async () => {
    const { status } = await enrich("/data-centre-enrichment/preview", {
      provider: "nope",
      fileContent: GENERIC_CSV,
    });
    expect(status).toBe(400);
  });

  it("400s a missing fileContent on preview", async () => {
    const { status } = await enrich("/data-centre-enrichment/preview", {
      provider: "generic",
    });
    expect(status).toBe(400);
  });

  it("previews per-field diffs without writing (dry-run)", async () => {
    stubSelect([jakartaFacility()]);
    const updateSpy = jest.spyOn(db, "update");
    const { status, json } = await enrich("/data-centre-enrichment/preview", {
      provider: "generic",
      fileContent: GENERIC_CSV,
    });
    expect(status).toBe(200);
    expect(json.commit).toBe(false);
    expect(json.updatedRows).toBe(0);
    const fields = (json.diffs as { field: string }[]).map((d) => d.field);
    expect(fields).toContain("capacityMw");
    expect(fields).toContain("status");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("respects an analyst lock — a locked field is never proposed", async () => {
    stubSelect([
      jakartaFacility({ enrichmentLocks: { capacityMw: { lockedAt: "2026-01-01T00:00:00.000Z" } } }),
    ]);
    const { json } = await enrich("/data-centre-enrichment/preview", {
      provider: "generic",
      fileContent: GENERIC_CSV,
    });
    const fields = (json.diffs as { field: string }[]).map((d) => d.field);
    expect(fields).not.toContain("capacityMw");
    expect(fields).toContain("status");
  });

  it("commits writes with provenance but never writes locks", async () => {
    stubSelect([jakartaFacility()]);
    stubUpdate([{ id: 1 }]);
    const { status, json } = await enrich("/data-centre-enrichment/commit", {
      provider: "generic",
      fileContent: GENERIC_CSV,
    });
    expect(status).toBe(200);
    expect(json.commit).toBe(true);
    expect(json.updatedRows).toBe(1);
    const v = capturedUpdateValues as Record<string, unknown>;
    expect(v.enrichmentSources).toBeDefined();
    expect(v.capacityMw).toBe(50);
    expect("enrichmentLocks" in v).toBe(false);
  });
});
