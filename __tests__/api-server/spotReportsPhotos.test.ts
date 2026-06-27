import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Spot-report photos travel as base64 image data URLs inside the JSON body.
// Two things must hold: (1) the body parser limit is large enough that a normal
// multi-photo save isn't rejected with 413 before reaching the route, and
// (2) the route caps count / per-photo size / content-type so oversized or
// non-image payloads are refused with 400 (never written to jsonb).

import { db } from "@workspace/db";
import spotReportsRouter from "../../artifacts/api-server/src/routes/spotReports";

type Rows = Record<string, unknown>[];

let capturedInsertValues: unknown;
let capturedUpdateValues: unknown;

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

function jpegDataUrl(payloadBytes: number): string {
  return "data:image/jpeg;base64," + "A".repeat(payloadBytes);
}

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  // Match the production body-parser limit from app.ts.
  app.use(express.json({ limit: "32mb" }));
  app.use(spotReportsRouter);
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
  const res = await fetch(`${baseUrl}/spot-reports`, {
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
  const res = await fetch(`${baseUrl}/spot-reports/${id}`, {
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

describe("POST /spot-reports — photos body limit & validation", () => {
  it("accepts a photo data URL larger than the old 100 KB body limit", async () => {
    stubInsert([{ id: 1, title: "T", photos: [] }]);
    const photo = { dataUrl: jpegDataUrl(200_000), caption: "Scene" };

    const { status } = await post({ title: "Test", photos: [photo] });

    expect(status).toBe(201);
    const sent = (capturedInsertValues as { photos?: unknown[] }).photos ?? [];
    expect(sent).toHaveLength(1);
    expect((sent[0] as { caption?: string }).caption).toBe("Scene");
  });

  it("rejects a non-image data URL with 400", async () => {
    stubInsert([{ id: 1 }]);
    const { status, json } = await post({
      title: "Test",
      photos: [{ dataUrl: "data:application/pdf;base64,AAAA" }],
    });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/image data URL/i);
    expect(capturedInsertValues).toBeUndefined();
  });

  it("rejects a single oversized photo with 400", async () => {
    stubInsert([{ id: 1 }]);
    const { status } = await post({
      title: "Test",
      photos: [{ dataUrl: jpegDataUrl(5 * 1024 * 1024) }],
    });
    expect(status).toBe(400);
    expect(capturedInsertValues).toBeUndefined();
  });

  it("rejects too many photos with 400", async () => {
    stubInsert([{ id: 1 }]);
    const photos = Array.from({ length: 25 }, () => ({
      dataUrl: jpegDataUrl(100),
    }));
    const { status, json } = await post({ title: "Test", photos });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/too many/i);
    expect(capturedInsertValues).toBeUndefined();
  });
});

describe("PATCH /spot-reports/:id — photos", () => {
  it("threads a valid photos array into the update", async () => {
    stubUpdate([{ id: 7, title: "T", photos: [] }]);
    const photo = { dataUrl: jpegDataUrl(150_000), caption: "Updated" };

    const { status } = await patch(7, { photos: [photo] });

    expect(status).toBe(200);
    const sent = (capturedUpdateValues as { photos?: unknown[] }).photos ?? [];
    expect(sent).toHaveLength(1);
  });

  it("rejects an oversized photo on update with 400", async () => {
    stubUpdate([{ id: 7 }]);
    const { status } = await patch(7, {
      photos: [{ dataUrl: jpegDataUrl(5 * 1024 * 1024) }],
    });
    expect(status).toBe(400);
    expect(capturedUpdateValues).toBeUndefined();
  });
});
