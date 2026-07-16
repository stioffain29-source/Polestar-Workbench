import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static regression guard for the owner sign-in boundary.
 *
 * `requireOwner` (Replit Auth session) is the broad privilege gate: it must sit
 * in front of EVERY data router mounted in `routes/index.ts`. The mounts before
 * `router.use(requireOwner)` are the only routes reachable by an anonymous
 * caller, and that set is intentionally tiny and documented:
 *   - health  (deployment health checks)
 *   - auth    (the login/callback/logout + session probe flow)
 *   - access  (lets the browser learn whether the session is the owner)
 *   - admin   (token-gated via requireAdminToken, for external schedulers/curl)
 *   - backfill(token-gated via requireAdminToken)
 *
 * A newly added data router accidentally mounted BEFORE the `requireOwner` line
 * (or a router that forgets the gate entirely) would silently expose operational
 * data to the public internet. This guard parses the mount order and fails
 * loudly if any router other than the documented public five is mounted before
 * the owner gate — or if the owner gate is missing altogether.
 */
const INDEX_PATH = join(
  __dirname,
  "../../artifacts/api-server/src/routes/index.ts",
);

/** Routers intentionally mounted BEFORE `requireOwner` (public or token-gated). */
const PUBLIC_ROUTERS = new Set([
  "healthRouter",
  "authRouter",
  "accessRouter",
  "adminRouter",
  "backfillRouter",
]);

const OWNER_GATE = "requireOwner";

function indexSource(): string {
  return readFileSync(INDEX_PATH, "utf8");
}

/** Strip comments so their text can't satisfy a code check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Return the ordered list of things passed to `router.use(...)` — either a
 * router identifier (e.g. `incidentsRouter`) or the owner gate (`requireOwner`).
 */
function mountOrder(src: string): string[] {
  const mounts: string[] = [];
  const re = /router\.use\(\s*([A-Za-z0-9_]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    mounts.push(m[1]!);
  }
  return mounts;
}

describe("owner sign-in gate protects every data router", () => {
  const src = stripComments(indexSource());
  const mounts = mountOrder(src);

  it("mounts the requireOwner gate exactly once", () => {
    const gateCount = mounts.filter((name) => name === OWNER_GATE).length;
    expect(gateCount).toBe(1);
  });

  it("finds data routers mounted after the owner gate", () => {
    // If this hits zero, the parse heuristic drifted and the checks below would
    // vacuously pass — fail loudly instead.
    const gateIdx = mounts.indexOf(OWNER_GATE);
    const afterGate = mounts.slice(gateIdx + 1);
    expect(afterGate.length).toBeGreaterThan(0);
  });

  it("mounts only the documented public routers before requireOwner", () => {
    const gateIdx = mounts.indexOf(OWNER_GATE);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    const beforeGate = mounts.slice(0, gateIdx);
    const ungated = beforeGate.filter((name) => !PUBLIC_ROUTERS.has(name));
    // Any router here is reachable WITHOUT an owner session. If a new router
    // shows up, either it belongs behind requireOwner (move it below the gate)
    // or it is a deliberate public/token-gated route (add it to PUBLIC_ROUTERS
    // AND to the public-route documentation in index.ts + replit.md).
    expect(ungated).toEqual([]);
  });

  it("mounts every non-public router after requireOwner", () => {
    const gateIdx = mounts.indexOf(OWNER_GATE);
    const afterGate = new Set(mounts.slice(gateIdx + 1));
    const dataRouters = mounts.filter(
      (name) => name !== OWNER_GATE && !PUBLIC_ROUTERS.has(name),
    );
    for (const name of dataRouters) {
      expect(afterGate.has(name)).toBe(true);
    }
  });

  it("mounts every router imported into index.ts (no silent unmounted router)", () => {
    // An imported-but-unmounted router is dead code, but a router imported and
    // then only conditionally/partially mounted is the more dangerous drift.
    // Enumerate `import xRouter from "./x"` and assert each appears in a mount.
    const importRe = /import\s+([A-Za-z0-9_]+Router)\s+from\s+["']\.\//g;
    const mounted = new Set(mounts);
    let m: RegExpExecArray | null;
    const importedRouters: string[] = [];
    while ((m = importRe.exec(src)) !== null) {
      importedRouters.push(m[1]!);
    }
    expect(importedRouters.length).toBeGreaterThan(0);
    for (const name of importedRouters) {
      expect(mounted.has(name)).toBe(true);
    }
  });
});
