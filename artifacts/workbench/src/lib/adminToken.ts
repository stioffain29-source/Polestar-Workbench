const ADMIN_TOKEN_KEY = "workbench_admin_token";

export function getStoredAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredAdminToken(token: string): void {
  try {
    if (token.trim()) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // sessionStorage unavailable (SSR/tests) — no-op
  }
}

export function adminBearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token.trim()}` };
}

export function adminMutationErrorMessage(status?: number): string | null {
  if (status === 401) {
    return "Unauthorized — the admin token is missing or incorrect.";
  }
  if (status === 503) {
    return "Admin controls disabled — INGEST_ADMIN_TOKEN is not configured on the server.";
  }
  return null;
}
