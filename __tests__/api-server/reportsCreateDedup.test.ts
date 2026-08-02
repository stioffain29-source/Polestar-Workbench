import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// "New Report" is a single client button that can fire twice (slow network,
// an impatient re-click before the dialog closes), and drafts have
// accumulated in exactly this way. POST /reports must be idempotent for
// draft creates: an identical topic + issueDate + title + status:"draft"
// retry must return the EXISTING row, not insert a duplicate. Distinct
// drafts (different title, topic, date, or non-draft status) must always
// insert normally.

import { db } from "@workspace/db";
import reportsRouter from "../../artifacts/api-server/src/routes/reports";
import { adminAuthHeaders, installAdminTokenBeforeEach } from "./adminAuthTestHelpers";

type Rows = Record<string, unknown>[];

let capturedInsertValues: unknown;
let insertCallCount = 0;
let selectQueue: Rows[] = [];

function stubSelectQueue(queue: Rows[]): void {
  selectQueue = [...queue];
  jest.spyOn(db, "select").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(selectQueue.shift() ?? []),
    };
    return chain as never;
  });
}

function stubInsert(returnRows: Rows): void {
  jest.spyOn(db, "insert").mockImplementation(() => {
    insertCallCount++;
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

installAdminTokenBeforeEach();

beforeAll((done) => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { warn: () => void } }).log = { warn: () => {} };
    next();
  });
  app.use(reportsRouter);
  server = app.listen(0, () => {
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
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
  insertCallCount = 0;
  selectQueue = [];
});

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/reports`, {
    method: "POST",
    headers: adminAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

const draftBody = {
  title: "Fuel Watch — 3 Aug",
  topic: "fuel",
  issueDate: "2026-08-03",
  status: "draft",
};

describe("POST /reports — duplicate-draft accumulation guard", () => {
  it("returns the existing draft (200) instead of inserting a duplicate when topic+issueDate+title+status match", async () => {
    const existingRow = { id: 42, ...draftBody };
    stubSelectQueue([[existingRow]]);
    stubInsert([{ id: 999, ...draftBody }]);

    const { status, json } = await post(draftBody);

    expect(status).toBe(200);
    expect(json).toEqual(existingRow);
    expect(insertCallCount).toBe(0);
  });

  it("inserts normally (201) when no matching draft exists yet", async () => {
    stubSelectQueue([[]]);
    stubInsert([{ id: 1, ...draftBody }]);

    const { status, json } = await post(draftBody);

    expect(status).toBe(201);
    expect(json).toEqual({ id: 1, ...draftBody });
    expect(insertCallCount).toBe(1);
  });

  it("does not dedupe non-draft statuses (review/published are deliberate transitions)", async () => {
    stubSelectQueue([]); // select must never be called for non-draft status
    stubInsert([{ id: 2, ...draftBody, status: "review" }]);

    const { status } = await post({ ...draftBody, status: "review" });

    expect(status).toBe(201);
    expect(insertCallCount).toBe(1);
  });

  it("does not block a genuinely distinct draft with a different title for the same topic/date", async () => {
    stubSelectQueue([[]]); // no existing row matches this different title
    stubInsert([{ id: 3, ...draftBody, title: "Fuel Watch — Supplemental" }]);

    const { status } = await post({ ...draftBody, title: "Fuel Watch — Supplemental" });

    expect(status).toBe(201);
    expect(insertCallCount).toBe(1);
  });
});
