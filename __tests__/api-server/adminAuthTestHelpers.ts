/** Shared admin-token setup for API route tests that exercise mutations. */
export const TEST_ADMIN_TOKEN = "test-admin-token";

export function adminAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
    ...extra,
  };
}

export function enableTestAdminToken(): void {
  process.env.INGEST_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
}

/**
 * Register a `beforeEach` that re-installs the admin token for every test.
 *
 * The global `jest.setup.ts` `beforeEach` runs `clearIntegrationEnv()`, which
 * deletes `INGEST_ADMIN_TOKEN` before EACH test. A suite that only calls
 * `enableTestAdminToken()` in `beforeAll` therefore loses the token for every
 * test after the first, so the admin-token gate returns an unconfigured 503 and
 * its 200/401/403 assertions never exercise the real gate. Suites that mutate
 * admin-gated routes must re-enable the token per test — call this helper (or
 * add `enableTestAdminToken()` to their own `beforeEach`) to guarantee that.
 */
export function installAdminTokenBeforeEach(): void {
  beforeEach(() => {
    enableTestAdminToken();
  });
}
