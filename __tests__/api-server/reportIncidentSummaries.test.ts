import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The per-incident AI summaries feature has two behaviours that must never
// silently regress:
//   1. when the LLM is available, real summaries are generated, PERSISTED, and a
//      later request for the SAME data set returns them from cache (no second
//      model call);
//   2. when the LLM is unavailable, the route returns an "available:false"
//      payload and persists NOTHING (a transient/never-configured model must not
//      poison the cache with blank rows) so the client falls back to its
//      deterministic per-incident line.
// The PUT edit path is bound to the fingerprint it was written against: a stale
// fingerprint must be rejected (409) so an analyst edit can never describe a
// snapshot the data has moved past.
//
// These tests mount the real router on an Express app and drive it over HTTP,
// stubbing only the DB (so no DATABASE_URL is needed) and the two LLM helpers
// (isLlmAvailable / generateIncidentSummaries). The fingerprint helper is the
// REAL one — the cache hit/miss contract is exactly what we want to exercise.

jest.mock("../../artifacts/api-server/src/lib/countryProse", () => {
  const actual = jest.requireActual(
    "../../artifacts/api-server/src/lib/countryProse",
  );
  return {
    ...actual,
    isLlmAvailable: jest.fn(),
    generateIncidentSummaries: jest.fn(),
  };
});

import { db, reportsTable, reportIncidentSummariesTable } from "@workspace/db";
import {
  isLlmAvailable,
  generateIncidentSummaries,
  computeIncidentSummariesFingerprint,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";
import reportIncidentSummariesRouter from "../../artifacts/api-server/src/routes/reportIncidentSummaries";

type Rows = Record<string, unknown>[];

// Route db.select().from(table).where() to a per-table response so the report
// lookup and the cached-summaries lookup never collide on call order.
function stubSelect(byTable: Map<unknown, Rows>): void {
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

function stubInsert(returnRows: Rows): jest.SpyInstance {
  return jest.spyOn(db, "insert").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      values: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => Promise.resolve(returnRows),
    };
    return chain as never;
  });
}

function stubUpdate(returnRows: Rows): jest.SpyInstance {
  return jest.spyOn(db, "update").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      set: () => chain,
      where: () => chain,
      returning: () => Promise.resolve(returnRows),
    };
    return chain as never;
  });
}

const REPORT_ID = 42;

const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "a",
    topic: "cargo_watch",
    title: "Cargo theft on the Karachi corridor",
    summary: "A container lorry was hijacked outside the port.",
    location: "Karachi",
    country: "Pakistan",
    severity: "High",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "Reuters",
  },
  {
    id: "b",
    topic: "cargo_watch",
    title: "Warehouse break-in in Lahore",
    summary: "Goods were stolen from a bonded warehouse overnight.",
    location: "Lahore",
    country: "Pakistan",
    severity: "Moderate",
    occurredAt: "2026-06-10T00:00:00+00:00",
    source: "Dawn",
  },
];

const fingerprintFor = (incidents: ProseIncidentInput[]) =>
  computeIncidentSummariesFingerprint({
    scope: `report:${REPORT_ID}`,
    incidents,
  });

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  // pino-http normally attaches req.log; the router's error path calls
  // req.log.warn, so provide a no-op logger when mounting the router alone.
  app.use((req, _res, next) => {
    (req as unknown as { log: { warn: () => void } }).log = { warn: () => {} };
    next();
  });
  app.use("/api", reportIncidentSummariesRouter);
  server = app.listen(0, () => {
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => done());
});

afterEach(() => {
  jest.restoreAllMocks();
  (isLlmAvailable as jest.Mock).mockReset();
  (generateIncidentSummaries as jest.Mock).mockReset();
});

async function postSummaries(body: unknown) {
  const res = await fetch(`${baseUrl}/api/reports/${REPORT_ID}/incident-summaries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function putEdit(body: unknown) {
  const res = await fetch(
    `${baseUrl}/api/reports/${REPORT_ID}/incident-summaries/edit`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: res.status, json: await res.json() };
}

describe("POST /reports/:id/incident-summaries — cache hit", () => {
  it("returns available:true with cached summaries on a fingerprint hit and does NOT call the LLM", async () => {
    const fingerprint = fingerprintFor(INCIDENTS);
    const cached = { a: "Lorry hijacked near the port.", b: "Warehouse goods stolen overnight." };
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint,
              summaries: cached,
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-13T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.fingerprint).toBe(fingerprint);
    expect(json.summaries).toEqual(cached);
    expect(json.model).toBe("gpt-5.4");
    // A cache hit must never call the model nor write the cache again.
    expect(generateIncidentSummaries as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /reports/:id/incident-summaries — cache miss with the LLM available", () => {
  it("generates, persists, and returns available:true", async () => {
    // No existing cache row → miss → generate.
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [reportIncidentSummariesTable, []],
      ]),
    );
    const fingerprint = fingerprintFor(INCIDENTS);
    const generated = { a: "Container lorry hijacked.", b: "Bonded warehouse robbed." };
    const insertSpy = stubInsert([
      {
        reportId: REPORT_ID,
        fingerprint,
        summaries: generated,
        edited: null,
        model: "gpt-5.4",
        generatedAt: new Date("2026-06-14T00:00:00Z"),
      },
    ]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateIncidentSummaries as jest.Mock).mockResolvedValue({
      ok: true,
      summaries: generated,
      model: "gpt-5.4",
    });

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.summaries).toEqual(generated);
    expect(json.fingerprint).toBe(fingerprint);
    expect(generateIncidentSummaries as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a stale cached fingerprint as a miss and regenerates", async () => {
    // Cache row present but keyed to a DIFFERENT fingerprint (data moved on).
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint: "stale-fingerprint",
              summaries: { a: "old" },
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-01T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const fingerprint = fingerprintFor(INCIDENTS);
    const insertSpy = stubInsert([
      {
        reportId: REPORT_ID,
        fingerprint,
        summaries: { a: "fresh" },
        edited: null,
        model: "gpt-5.4",
        generatedAt: new Date(),
      },
    ]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateIncidentSummaries as jest.Mock).mockResolvedValue({
      ok: true,
      summaries: { a: "fresh" },
      model: "gpt-5.4",
    });

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.fingerprint).toBe(fingerprint);
    expect(generateIncidentSummaries as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("POST /reports/:id/incident-summaries — LLM unavailable", () => {
  it("returns available:false and persists nothing", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [reportIncidentSummariesTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.summaries).toEqual({});
    expect(json.model).toBe("unavailable");
    // The fingerprint is still returned (the client may reuse it), but no model
    // call and no cache write happened.
    expect(json.fingerprint).toBe(fingerprintFor(INCIDENTS));
    expect(generateIncidentSummaries as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns available:false and persists nothing when generation fails", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [reportIncidentSummariesTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateIncidentSummaries as jest.Mock).mockResolvedValue({
      ok: false,
      error: "timeout",
    });

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.summaries).toEqual({});
    expect(generateIncidentSummaries as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("still serves a cache hit even when the LLM is unavailable", async () => {
    const fingerprint = fingerprintFor(INCIDENTS);
    const cached = { a: "cached summary", b: "another cached summary" };
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint,
              summaries: cached,
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-13T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postSummaries({ incidents: INCIDENTS });

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.summaries).toEqual(cached);
    expect(generateIncidentSummaries as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /reports/:id/incident-summaries — guards", () => {
  it("404s when the report does not exist", async () => {
    stubSelect(new Map<unknown, Rows>([[reportsTable, []]]));
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    const { status } = await postSummaries({ incidents: INCIDENTS });
    expect(status).toBe(404);
  });
});

describe("PUT /reports/:id/incident-summaries/edit — stale-fingerprint guard", () => {
  it("rejects an edit whose fingerprint no longer matches the stored row (409)", async () => {
    const stored = fingerprintFor(INCIDENTS);
    stubSelect(
      new Map<unknown, Rows>([
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint: stored,
              summaries: { a: "x", b: "y" },
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date(),
            },
          ],
        ],
      ]),
    );
    const updateSpy = stubUpdate([]);

    const { status, json } = await putEdit({
      fingerprint: "an-old-fingerprint",
      summaries: { a: "edited" },
    });

    expect(status).toBe(409);
    expect(json.error).toBe("stale");
    expect(json.fingerprint).toBe(stored);
    // A stale edit must never be written.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("404s when there are no generated summaries to edit", async () => {
    stubSelect(new Map<unknown, Rows>([[reportIncidentSummariesTable, []]]));
    const updateSpy = stubUpdate([]);
    const { status } = await putEdit({
      fingerprint: "anything",
      summaries: { a: "edited" },
    });
    expect(status).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("stores the edit when the fingerprint matches", async () => {
    const stored = fingerprintFor(INCIDENTS);
    const edited = { a: "analyst override", b: "another override" };
    stubSelect(
      new Map<unknown, Rows>([
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint: stored,
              summaries: { a: "x", b: "y" },
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-14T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const updateSpy = stubUpdate([
      {
        reportId: REPORT_ID,
        fingerprint: stored,
        summaries: { a: "x", b: "y" },
        edited,
        model: "gpt-5.4",
        generatedAt: new Date("2026-06-14T00:00:00Z"),
      },
    ]);

    const { status, json } = await putEdit({ fingerprint: stored, summaries: edited });

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.edited).toEqual(edited);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
