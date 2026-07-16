import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { TEST_ADMIN_TOKEN, adminAuthHeaders } from "./adminAuthTestHelpers";

// `openid-client` is a pure-ESM dependency pulled in transitively by the auth
// router. jest does not transform node_modules, so importing the real module
// throws "Cannot use import statement outside a module". The runtime suite never
// exercises OIDC, so stub it out to keep the real router importable.
jest.mock("openid-client", () => ({}));

import router from "../../artifacts/api-server/src/routes";

/**
 * Runtime regression guard for the admin-token privilege boundary.
 *
 * The owner gate has a runtime suite (`ownerAuthRuntime.test.ts`), but the
 * SECOND boundary — `requireAdminToken` on the admin ingest, source-mutation,
 * and backfill routers — was only exercised against a synthetic minimal app
 * (`adminAuthGate.test.ts`). That cannot catch a router that mounts the gate
 * incorrectly, forgets it on a new mutation, or that ends up AFTER
 * `requireOwner` (which would make a browser session, not the token, the gate).
 *
 * This suite boots the REAL `routes/index.ts` router and hits the token-gated
 * mutation routes on their actual mount paths with:
 *   - a token, no server token   -> 503 (route disabled, never runs unauthed)
 *   - no token, server configured -> 401
 *   - wrong token                 -> 401
 * All calls carry NO session, which additionally proves these routers sit
 * BEFORE `requireOwner`: an anonymous request that reaches them at all (503 /
 * token-based 401, never the owner gate) can only happen if the token gate runs
 * first. A 401 alone would be ambiguous with the owner gate's 401, so the
 * unconfigured-server 503 is the load-bearing assertion.
 */

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // pino-http normally attaches req.log; stub it so any handler reached can log
  // without crashing.
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  // Auth shim mirroring authMiddleware, but deliberately NEVER setting a user:
  // every request in this suite is anonymous, so if the token gate did not run
  // before requireOwner the anonymous request would be rejected by the owner
  // gate instead of the token gate.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = function (this: Request) {
      return this.user != null;
    } as Request["isAuthenticated"];
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

async function post(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
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

// Token-gated mutation routes on their REAL mount paths. Each sits before
// requireOwner in routes/index.ts. `unconfiguredError` is the specific error
// body the route returns when INGEST_ADMIN_TOKEN is unset — asserting it proves
// the token gate (not the owner gate) answered the anonymous request.
const ADMIN_ROUTES = [
  { path: "/api/admin/ingest", unconfiguredError: "ingestion_disabled" },
  { path: "/api/admin/reliefweb-reports", unconfiguredError: "ingestion_disabled" },
  { path: "/api/admin/icc-piracy", unconfiguredError: "ingestion_disabled" },
  { path: "/api/admin/gdelt-structured", unconfiguredError: "ingestion_disabled" },
  { path: "/api/admin/incidents/backfill", unconfiguredError: "admin_disabled" },
  {
    path: "/api/admin/data-centre-facilities/backfill",
    unconfiguredError: "admin_disabled",
  },
];

describe("admin-token gate — runtime behaviour on real mounted routers", () => {
  it.each(ADMIN_ROUTES)(
    "returns 503 (route disabled) when the server token is unset for $path",
    async ({ path, unconfiguredError }) => {
      // The global jest.setup beforeEach clears INGEST_ADMIN_TOKEN, so it is
      // already unset here. An anonymous request that lands on a 503 — rather
      // than the owner gate's 401 — proves the router runs before requireOwner.
      const { status, json } = await post(path, adminAuthHeaders());
      expect(status).toBe(503);
      expect(json.error).toBe(unconfiguredError);
    },
  );

  it.each(ADMIN_ROUTES)(
    "returns 401 when the token is configured but the request omits it for $path",
    async ({ path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status, json } = await post(path);
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    },
  );

  it.each(ADMIN_ROUTES)(
    "returns 401 for a wrong token for $path",
    async ({ path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status, json } = await post(path, {
        authorization: "Bearer not-the-token",
      });
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    },
  );
});
