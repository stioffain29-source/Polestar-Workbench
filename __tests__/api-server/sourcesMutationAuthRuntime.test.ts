import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import {
  TEST_ADMIN_TOKEN,
  adminAuthHeaders,
  installAdminTokenBeforeEach,
} from "./adminAuthTestHelpers";

// The global jest.setup beforeEach deletes INGEST_ADMIN_TOKEN before every
// test; re-install it per test so the double-gate assertions exercise the
// real token gate (tests also set it explicitly for clarity).
installAdminTokenBeforeEach();

// `openid-client` is a pure-ESM dependency pulled in transitively by the auth
// router. jest does not transform node_modules, so importing the real module
// throws "Cannot use import statement outside a module". The runtime suite never
// exercises OIDC (the auth shim below stands in for the session middleware), so
// stub it out to keep the real router importable.
jest.mock("openid-client", () => ({}));

import router from "../../artifacts/api-server/src/routes";

/**
 * Runtime regression guard for the DOUBLE gate on `sources` mutations.
 *
 * The admin-token runtime suite (`adminAuthRuntime.test.ts`) proves the token
 * gate on routers that sit BEFORE `requireOwner` (admin ingest / backfill),
 * where an anonymous request must reach the token gate. The `sources` mutation
 * router is different: it is mounted AFTER `requireOwner`, so per replit.md the
 * owner logs in (session) AND still pastes the admin token to mutate sources.
 *
 * A regression that dropped `requireAdminToken` from a sources mutation while
 * keeping the owner gate would let ANY signed-in owner mutate sources without
 * the token — contrary to the documented contract. The static counterparts
 * cannot catch that at runtime. This suite boots the REAL router, authenticates
 * as the owner (auth shim + ALLOWED_USER_IDS allowlist, mirroring
 * ownerAuthRuntime.test.ts), and hits the create/update/delete routes to assert:
 *   - owner session, no admin token  -> 401 (owner session alone is NOT enough)
 *   - owner session, wrong token     -> 401
 *   - owner session, correct token   -> proceeds PAST the gate (never 401/403/503)
 *   - anonymous, even with the token  -> 401 (owner gate runs first; the token
 *     never substitutes for the session)
 */

let app: Express;
let server: Server;
let baseUrl: string;

/** Header the shim reads to decide the request's auth state. */
const TEST_USER_HEADER = "x-test-user";
/** The user id the allowlist recognises as the owner in this suite. */
const OWNER_ID = "test-owner";

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
  // Auth shim: mirrors authMiddleware's contract (req.isAuthenticated + req.user)
  // driven by a test header, so we exercise the real requireOwner gate.
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
  // Recognise the test owner via the explicit allowlist so requireOwner passes
  // for the owner session (the mocked users table returns no is_owner row).
  process.env["ALLOWED_USER_IDS"] = OWNER_ID;
});

afterEach(() => {
  delete process.env["ALLOWED_USER_IDS"];
  delete process.env["INGEST_ADMIN_TOKEN"];
});

async function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "Test Source", topic: "flashpoint", url: "https://example.com" }),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { [TEST_USER_HEADER]: OWNER_ID, ...extra };
}

// The token-gated sources mutation routes on their REAL mount paths. Each sits
// AFTER requireOwner in routes/index.ts and additionally carries
// requireAdminToken in sources.ts.
const MUTATION_ROUTES = [
  { method: "POST", path: "/api/sources" },
  { method: "PATCH", path: "/api/sources/1" },
  { method: "DELETE", path: "/api/sources/1" },
];

describe("sources mutations — owner session does NOT satisfy the admin-token gate", () => {
  it.each(MUTATION_ROUTES)(
    "returns 401 for an owner session with NO admin token: $method $path",
    async ({ method, path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status, json } = await request(method, path, ownerHeaders());
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    },
  );

  it.each(MUTATION_ROUTES)(
    "returns 401 for an owner session with the WRONG admin token: $method $path",
    async ({ method, path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status, json } = await request(
        method,
        path,
        ownerHeaders({ authorization: "Bearer not-the-token" }),
      );
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    },
  );
});

describe("sources mutations — owner session AND correct token proceeds past both gates", () => {
  it.each(MUTATION_ROUTES)(
    "does not return an auth error: $method $path",
    async ({ method, path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status } = await request(
        method,
        path,
        ownerHeaders(adminAuthHeaders()),
      );
      // Past both gates the handler runs against the mocked db: the exact
      // success/validation status varies per route, but it must NEVER be the
      // owner gate (401/403) or the token-disabled gate (503).
      expect([401, 403, 503]).not.toContain(status);
    },
  );
});

describe("sources mutations — the admin token does NOT substitute for the owner session", () => {
  it.each(MUTATION_ROUTES)(
    "returns 401 for an anonymous request even WITH the correct token: $method $path",
    async ({ method, path }) => {
      process.env["INGEST_ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
      const { status, json } = await request(method, path, adminAuthHeaders());
      // requireOwner runs first, so an anonymous request is rejected by the
      // owner gate before the token is ever checked.
      expect(status).toBe(401);
      expect(json.error).toBe("unauthorized");
    },
  );
});
