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
