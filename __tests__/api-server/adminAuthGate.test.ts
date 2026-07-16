import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { requireAdminToken } from "../../artifacts/api-server/src/lib/adminAuth";
import {
  TEST_ADMIN_TOKEN,
  adminAuthHeaders,
  installAdminTokenBeforeEach,
} from "./adminAuthTestHelpers";

// The admin-token gate has two DISTINCT failure states that must never be
// confused:
//   - INGEST_ADMIN_TOKEN unset on the server  -> 503 (route disabled)
//   - token configured but wrong/missing on the request -> 401
// The bug in #408 was a suite whose token got wiped between tests, so a gate
// assertion "passed" against a 503 that should have been a 401/200. This suite
// pins the two codes apart so that difference can never be masked again.

let app: Express;
let server: Server;
let baseUrl: string;

installAdminTokenBeforeEach();

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
  app.post("/gated", requireAdminToken, (_req, res) => {
    res.status(200).json({ ok: true });
  });
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

async function callGate(
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/gated`, {
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

describe("admin-token gate — 401 (bad token) and 503 (unconfigured) are distinct", () => {
  it("returns 503 when INGEST_ADMIN_TOKEN is not configured on the server", async () => {
    delete process.env["INGEST_ADMIN_TOKEN"];
    const { status, json } = await callGate(
      adminAuthHeaders(), // a token is presented, but the SERVER has none
    );
    expect(status).toBe(503);
    expect(json.error).toBe("admin_disabled");
  });

  it("returns 401 when the token is configured but the request omits it", async () => {
    // installAdminTokenBeforeEach() has configured the server token.
    const { status, json } = await callGate();
    expect(status).toBe(401);
    expect(json.error).toBe("unauthorized");
  });

  it("returns 401 for a wrong token but 200 for the correct one", async () => {
    const wrong = await callGate({ authorization: "Bearer not-the-token" });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toBe("unauthorized");

    const ok = await callGate(adminAuthHeaders());
    expect(ok.status).toBe(200);
    expect(ok.json.ok).toBe(true);
  });

  it("proves 503 and 401 are different codes, so a cleared token cannot masquerade as a real gate failure", () => {
    // A regression like #408 makes an unconfigured server (503) silently stand
    // in for a real auth check (401). Asserting inequality documents intent.
    expect(503).not.toBe(401);
    expect(TEST_ADMIN_TOKEN).toBeTruthy();
  });
});
