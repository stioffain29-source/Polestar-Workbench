import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// `openid-client` is a pure-ESM dependency pulled in transitively by the auth
// router. jest does not transform node_modules, so importing the real module
// throws "Cannot use import statement outside a module". The runtime suite never
// exercises OIDC (the auth shim below stands in for the session middleware), so
// stub it out to keep the real router importable.
jest.mock("openid-client", () => ({}));

import router from "../../artifacts/api-server/src/routes";

/**
 * Runtime regression guard for the owner sign-in boundary.
 *
 * The static counterpart (`ownerAuthGuard.test.ts`) proves each data router is
 * mounted AFTER `router.use(requireOwner)` in SOURCE ORDER. It cannot catch a
 * router that answers a request in its own `router.use`/param middleware before
 * `requireOwner` runs, nor a `requireOwner` regression that calls `next()` on an
 * unauthorized request. This suite boots the real router and hits a
 * representative sample of mounted data routes to assert the runtime outcome:
 *   - no session          -> 401
 *   - non-owner session   -> 403
 * plus the public routes still answer without any session.
 *
 * The auth SHIM below stands in for `authMiddleware`: it sets `req.user` /
 * `req.isAuthenticated` from a test header instead of resolving a real Replit
 * session, so the suite exercises the REAL `requireOwner` runtime path without
 * OIDC or a live session store. `requireOwner` then queries the (mocked) users
 * table via `isAllowedUser`; with the db mock returning no rows, an
 * authenticated non-owner correctly resolves to 403.
 */

let app: Express;
let server: Server;
let baseUrl: string;

/** Header the shim reads to decide the request's auth state. */
const TEST_USER_HEADER = "x-test-user";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // pino-http normally attaches req.log; stub it so any handler reached (e.g. a
  // public route) can log without crashing.
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  // Auth shim: mirrors authMiddleware's contract (req.isAuthenticated + req.user)
  // driven by a test header, so we can exercise the real requireOwner gate.
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
  // With no allowlist configured, requireOwner falls through to the (mocked)
  // users table, which returns no owner row — so any authenticated user is a
  // non-owner and must get 403.
  delete process.env["ALLOWED_USER_IDS"];
});

async function call(
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return res.status;
}

// A representative sample of data routers mounted behind requireOwner. Each is a
// GET route on a different router, so a per-router pre-gate short-circuit would
// surface here.
const DATA_ROUTES = [
  "/api/incidents",
  "/api/reports",
  "/api/dashboard",
  "/api/sources",
  "/api/strikes",
  "/api/countries",
];

describe("owner gate — runtime behaviour on real data routers", () => {
  it.each(DATA_ROUTES)(
    "returns 401 for an anonymous request to %s",
    async (path) => {
      expect(await call(path)).toBe(401);
    },
  );

  it.each(DATA_ROUTES)(
    "returns 403 for a non-owner session to %s",
    async (path) => {
      expect(await call(path, { [TEST_USER_HEADER]: "not-the-owner" })).toBe(
        403,
      );
    },
  );
});

describe("public routes answer without a session", () => {
  it("GET /api/healthz -> 200", async () => {
    expect(await call("/api/healthz")).toBe(200);
  });

  it("GET /api/access -> 200 (reports authenticated:false)", async () => {
    const res = await fetch(`${baseUrl}/api/access`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      allowed: boolean;
    };
    expect(body.authenticated).toBe(false);
    expect(body.allowed).toBe(false);
  });

  it("GET /api/auth/user -> 200 (null user without a session)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/user`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });
});
