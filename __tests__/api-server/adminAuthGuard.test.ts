import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lint-style regression guard for admin-gated route test suites.
 *
 * The global `jest.setup.ts` `beforeEach` deletes `INGEST_ADMIN_TOKEN` before
 * EVERY test. A suite that enables the admin token only in `beforeAll` therefore
 * loses it for every test after the first — the admin gate then returns an
 * unconfigured 503 and its 200/401/403 assertions pass for the wrong reason
 * (the bug fixed in #408). The canonical fix is `installAdminTokenBeforeEach()`.
 *
 * This guard scans every admin-gated route test file and fails if it does not
 * re-install the token per test. "Admin-gated route suite" = a file that imports
 * from `./adminAuthTestHelpers` (i.e. uses `enableTestAdminToken` /
 * `adminAuthHeaders` / `installAdminTokenBeforeEach`). Suites that merely read
 * the token as an env-loading or status-reporting subject (e.g. loadDevEnv,
 * integrationStatus) don't import the helper and are correctly ignored.
 */
const TEST_DIR = __dirname;

/** Remove `//` and block comments so their text can't satisfy a code check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Return the balanced body (inside the outer `(...)`) of every `hook(` call in
 * `src`, e.g. `hookBodies(src, "beforeEach")` for all beforeEach blocks.
 */
function hookBodies(src: string, hook: string): string[] {
  const bodies: string[] = [];
  const marker = `${hook}(`;
  let from = 0;
  for (;;) {
    const start = src.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + hook.length; // at the "("
    const bodyStart = i + 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    bodies.push(src.slice(bodyStart, i));
    from = i + 1;
  }
  return bodies;
}

/** True if a hook body actually configures the admin token (not in a comment). */
function configuresToken(body: string): boolean {
  return (
    /enableTestAdminToken\s*\(\s*\)/.test(body) ||
    /INGEST_ADMIN_TOKEN["'\]]?\s*=/.test(body)
  );
}

function adminGatedRouteSuites(): string[] {
  return readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => {
      const src = readFileSync(join(TEST_DIR, f), "utf8");
      return /from\s+["']\.\/adminAuthTestHelpers["']/.test(src);
    });
}

describe("admin-gated route suites re-install the token per test", () => {
  const suites = adminGatedRouteSuites();

  it("finds admin-gated route suites to check", () => {
    // If this hits zero the detection heuristic has drifted and the guard below
    // would vacuously pass — fail loudly instead.
    expect(suites.length).toBeGreaterThan(0);
  });

  it.each(suites)(
    "%s re-installs the admin token per test (helper or beforeEach)",
    (file) => {
      const src = stripComments(readFileSync(join(TEST_DIR, file), "utf8"));
      const usesHelper = /installAdminTokenBeforeEach\s*\(\s*\)/.test(src);
      const enablesPerTest = hookBodies(src, "beforeEach").some(configuresToken);
      expect(usesHelper || enablesPerTest).toBe(true);
    },
  );

  it.each(suites)(
    "%s never relies on a beforeAll-only admin token",
    (file) => {
      const src = stripComments(readFileSync(join(TEST_DIR, file), "utf8"));
      const beforeAllEnables = hookBodies(src, "beforeAll").some(configuresToken);
      const reInstallsPerTest =
        /installAdminTokenBeforeEach\s*\(\s*\)/.test(src) ||
        hookBodies(src, "beforeEach").some(configuresToken);
      // A beforeAll token is fine ONLY if the suite also re-installs it per test.
      if (beforeAllEnables) {
        expect(reInstallsPerTest).toBe(true);
      }
    },
  );
});
