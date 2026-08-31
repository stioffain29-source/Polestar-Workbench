import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { TEST_ADMIN_TOKEN, installAdminTokenBeforeEach } from "./adminAuthTestHelpers";

// The global jest.setup beforeEach deletes INGEST_ADMIN_TOKEN before every
// test; re-install it per test so the "token still works" assertion exercises
// the real fallback branch.
installAdminTokenBeforeEach();

// `openid-client` is a pure-ESM dependency pulled in transitively by the auth
// router. jest does not transform node_modules, so importing the real module
// throws "Cannot use import statement outside a module". This suite never
// exercises OIDC (the shim below stands in for the session middleware), so
// stub it out to keep the real router importable.
jest.mock("openid-client", () => ({}));

// Stub the actual ingest chain so this suite never makes real network calls.
// The mock's job is only to prove which HTTP auth branch let the request
// through — success/failure of the (fake) ingest run confirms the request
// reached the handler body at all, which only happens if it passed the gate.
const runIngestProcess = jest.fn();
jest.mock("../../artifacts/api-server/src/lib/ingestProcess", () => ({
  runIngestProcess: (...args: unknown[]) => runIngestProcess(...args),
}));

import router from "../../artifacts/api-server/src/routes";

/**
 * Runtime regression guard for the NEW owner-session bypass on
 * POST /api/admin/ingest.
 *
 * `adminAuthRuntime.test.ts` proves the anonymous/token-only boundary is
 * unchanged. This suite proves the ADDED branch: a request carrying a valid
 * owner session must reach the real ingest handler (i.e. actually calls
 * runIngestProcess) with NO token present at all, and a non-owner session must
 * still be rejected exactly like an anonymous one (503 when no token is
 * configured) rather than silently being let through.
 */

let app: Express;
let server: Server;
let baseUrl: string;

const TEST_USER_HEADER = "x-test-user";
const OWNER_ID = "owner-123";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  // Auth shim mirroring authMiddleware's contract, driven by a test header —
  // same pattern as ownerAuthRuntime.test.ts.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header(TEST_USER_HEADER);
    req.isAuthenticated = function (this: Request) {
      return this.user != null;
    } as Request["isAuthenticated"];
    if (userId) {
      req.user = { id: userId } as Express.User;
    }
    next();
  });
  app.use("/api", router);

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
  runIngestProcess.mockReset();
  // ALLOWED_USER_IDS makes isAllowedUser resolve purely from the env var,
  // with no db round trip — OWNER_ID is the allowed owner, anyone else isn't.
  process.env["ALLOWED_USER_IDS"] = OWNER_ID;
});

async function postIngest(
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/admin/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({}),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

describe("POST /api/admin/ingest — owner-session bypass", () => {
  it("owner session with NO token configured and NO token header still runs ingest (200)", async () => {
    delete process.env["INGEST_ADMIN_TOKEN"];
    runIngestProcess.mockResolvedValue(FAKE_INGEST_RESULT());

    const { status, json } = await postIngest({ [TEST_USER_HEADER]: OWNER_ID });

    expect(runIngestProcess).toHaveBeenCalledTimes(1);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("owner session takes priority even when a server token IS configured and absent from the request", async () => {
    process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
    runIngestProcess.mockResolvedValue(FAKE_INGEST_RESULT());

    const { status } = await postIngest({ [TEST_USER_HEADER]: OWNER_ID });

    expect(runIngestProcess).toHaveBeenCalledTimes(1);
    expect(status).toBe(200);
  });

  it("non-owner session with no token configured is still rejected (503), not silently allowed", async () => {
    delete process.env["INGEST_ADMIN_TOKEN"];

    const { status, json } = await postIngest({ [TEST_USER_HEADER]: "not-the-owner" });

    expect(runIngestProcess).not.toHaveBeenCalled();
    expect(status).toBe(503);
    expect(json.error).toBe("ingestion_disabled");
  });

  it("non-owner session can still fall back to a valid admin token", async () => {
    process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
    runIngestProcess.mockResolvedValue(FAKE_INGEST_RESULT());

    const { status } = await postIngest({
      [TEST_USER_HEADER]: "not-the-owner",
      authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
    });

    expect(runIngestProcess).toHaveBeenCalledTimes(1);
    expect(status).toBe(200);
  });

  it("anonymous request (no session, no token) is unaffected — still 503 when unconfigured", async () => {
    delete process.env["INGEST_ADMIN_TOKEN"];

    const { status, json } = await postIngest();

    expect(runIngestProcess).not.toHaveBeenCalled();
    expect(status).toBe(503);
    expect(json.error).toBe("ingestion_disabled");
  });

  it("reports a supervised timeout explicitly", async () => {
    runIngestProcess.mockResolvedValue({
      ran: false,
      reason: "timed_out",
      runId: "timeout-test",
      lastStage: "hung test stage",
      termination: "sigkill",
    });

    const { status, json } = await postIngest({ [TEST_USER_HEADER]: OWNER_ID });

    expect(status).toBe(504);
    expect(json).toMatchObject({
      error: "ingestion_timed_out",
      runId: "timeout-test",
      lastStage: "hung test stage",
      termination: "sigkill",
    });
  });

  it("reports supervised cancellation explicitly", async () => {
    runIngestProcess.mockResolvedValue({
      ran: false,
      reason: "cancelled",
      runId: "cancel-test",
      lastStage: "cancelled test stage",
      termination: "sigterm",
    });

    const { status, json } = await postIngest({ [TEST_USER_HEADER]: OWNER_ID });

    expect(status).toBe(499);
    expect(json).toMatchObject({
      error: "ingestion_cancelled",
      runId: "cancel-test",
      lastStage: "cancelled test stage",
      termination: "sigterm",
    });
  });
});

function zeroSummary(topic: string) {
  return {
    topic,
    mode: "test",
    sourcesFetched: 0,
    itemsConsidered: 0,
    acceptedUnique: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    rejected: 0,
    totalAfter: 0,
    latestRecord: null,
    lastUpdated: null,
    countryCoverage: {},
    perFeed: [],
    // summarizeIngestFailures() scans logLines for an "ingest failed" line;
    // it must exist even when empty or topicFailureMessage() throws.
    logLines: [],
  };
}

function FAKE_INGEST_RESULT() {
  return {
    ran: true,
    startedAt: new Date("2026-08-01T00:00:00Z"),
    finishedAt: new Date("2026-08-01T00:00:01Z"),
    durationMs: 1000,
    flashpoint: zeroSummary("flashpoint"),
    cargoWatch: zeroSummary("cargoWatch"),
    shipping: zeroSummary("shipping"),
    energy: zeroSummary("energy"),
    fertiliser: zeroSummary("fertiliser"),
    fuel: zeroSummary("fuel"),
    dataCentres: zeroSummary("dataCentres"),
    indonesiaLocal: zeroSummary("indonesiaLocal"),
    apacLocal: zeroSummary("apacLocal"),
    // summarizeIngestFailures() reads result.conflict directly (it's not in
    // the response body's trimmedSummary() calls, but IS required for the
    // failure rollup that runs before the response is built).
    conflict: zeroSummary("conflict"),
    strikes: {
      ...zeroSummary("strikes"),
      byTheatre: {},
      byCountry: {},
    },
    marketPrices: {
      seriesFetched: 0,
      // Array of {id, error}, not a count — summarizeIngestFailures() maps
      // over it directly.
      seriesErrors: [] as { id: string; error: string }[],
      reportsConsidered: 0,
      reportsUpdated: 0,
      latest: null,
    },
    marketSnapshot: {
      upserted: 0,
      considered: 0,
      // Array of {key, error}, not a count — same as seriesErrors above.
      errors: [] as { key: string; error: string }[],
    },
  };
}
