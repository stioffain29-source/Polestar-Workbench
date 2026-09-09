import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  FLASHPOINT_CONFIDENCE_THRESHOLDS,
  FLASHPOINT_VALIDITY_VERSION,
} from "@workspace/relevance";
import { flashpointValidityValuesEligible } from "../../artifacts/api-server/src/lib/relevanceFilter";

const mockBackfill = jest.fn(async (limit: number) => ({ considered: limit, updated: limit }));
jest.mock("@workspace/ingest", () => {
  const actual = jest.requireActual("@workspace/ingest");
  return { ...actual, backfillFlashpointValidity: (limit: number) => mockBackfill(limit) };
});

const validGates = {
  version: FLASHPOINT_VALIDITY_VERSION,
  verdict: "valid",
  eventOccurred: true,
  actor: "dock workers",
  activity: "began a strike",
  physicalLocation: "Manila port",
  country: "Philippines",
  eventType: "labour_strike",
  eventDate: "2026-09-09",
  currentness: "current",
  assignedCountrySupported: true,
  confidence: { ...FLASHPOINT_CONFIDENCE_THRESHOLDS },
  contradictions: [],
};

describe("Flashpoint API value boundary", () => {
  it("accepts only coherent gate values, not merely present keys", () => {
    const eligible = (validityGates: unknown, validityVersion = FLASHPOINT_VALIDITY_VERSION) =>
      flashpointValidityValuesEligible({ validityStatus: "valid", validityVersion, validityGates });
    expect(eligible(validGates)).toBe(true);
    for (const mutation of [
      { eventOccurred: false },
      { actor: " " },
      { activity: "" },
      { physicalLocation: null },
      { country: "" },
      { eventType: "unknown" },
      { eventType: "court_ruling" },
      { eventDate: "2026-02-30" },
      { currentness: "historical" },
      { assignedCountrySupported: false },
      { contradictions: ["location conflict"] },
      { confidence: { ...validGates.confidence, event: .74 } },
      { confidence: { ...validGates.confidence, date: 1.01 } },
      { confidence: { ...validGates.confidence, geography: Number.NaN } },
      { confidence: { ...validGates.confidence, classification: Number.POSITIVE_INFINITY } },
      { confidence: { ...validGates.confidence, event: "0.99" } },
    ]) expect(eligible({ ...validGates, ...mutation })).toBe(false);
    expect(eligible(validGates, "2026-09-09.semantic.3")).toBe(false);
  });
});

describe("Flashpoint backfill route authentication", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env["INGEST_ADMIN_TOKEN"] = "route-test-token";
    const { default: router } = await import("../../artifacts/api-server/src/routes/flashpointValidityAdmin");
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { log: { warn: () => void } }).log = { warn() {} };
      next();
    });
    app.use(router);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const call = (authorization?: string) => fetch(`${baseUrl}/admin/flashpoint-validity-backfill`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ limit: 150 }),
  });

  it("rejects missing/wrong tokens and invokes backfill only for the configured token", async () => {
    process.env["INGEST_ADMIN_TOKEN"] = "route-test-token";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("Bearer route-test-token")).status).toBe(200);
    expect(mockBackfill).toHaveBeenCalledWith(150);
  });
});