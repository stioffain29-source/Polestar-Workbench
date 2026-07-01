import {
  readSocialWatchConfig,
  fetchInstagramPosts,
  isApifyAuthError,
} from "../../lib/ingest/src/socialWatch";
import { clearIntegrationEnv } from "../api-server/integrationEnvTestHelpers";

// The Instagram social-watch scraper accepts APIFY_TOKEN as a fallback Apify
// credential. It is used when INSTAGRAM_API_KEY is unset, AND it is tried when
// the primary key is REJECTED with an auth error (HTTP 401/403) — e.g. a
// stale/wrong value left in INSTAGRAM_API_KEY. The fallback must advance to the
// next token ONLY on 401/403 (which start no paid Apify run); any other error
// must fail without burning a second (potentially paid) attempt. These tests
// pin that behaviour by mocking fetch — they never reach the network or the DB.

describe("instagram apify-token fallback", () => {
  const savedEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    // Start from a known-clean integration env so a real INSTAGRAM_API_KEY /
    // APIFY_TOKEN in the workspace can't shadow the fixed test tokens below.
    clearIntegrationEnv();
    process.env.INSTAGRAM_PROVIDER = "apify";
    process.env.INSTAGRAM_API_KEY = "primary-token";
    process.env.APIFY_TOKEN = "apify_api_fallback";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  function mockFetchSequence(
    responses: Array<{ ok: boolean; status?: number; json?: unknown }>,
  ): () => number {
    let call = 0;
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      const r = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: async () => r.json ?? [],
      } as Response;
    });
    return () => call;
  }

  it("matches only 401/403 as an apify auth error", () => {
    expect(isApifyAuthError(new Error("status 401"))).toBe(true);
    expect(isApifyAuthError(new Error("status 403"))).toBe(true);
    expect(isApifyAuthError(new Error("status 404"))).toBe(false);
    expect(isApifyAuthError(new Error("status 500"))).toBe(false);
    expect(isApifyAuthError(new Error("status 429"))).toBe(false);
    expect(isApifyAuthError(new Error("timed out after 20000ms"))).toBe(false);
  });

  it("resolves an ordered, deduped candidate list (primary then APIFY_TOKEN)", () => {
    const cfg = readSocialWatchConfig();
    expect(cfg.instagram.apiKeys).toEqual(["primary-token", "apify_api_fallback"]);
    expect(cfg.instagram.configured).toBe(true);
  });

  it("falls back to APIFY_TOKEN when the primary key is rejected (401)", async () => {
    const cfg = readSocialWatchConfig();
    const calls = mockFetchSequence([
      { ok: false, status: 401 },
      { ok: true, json: [] },
    ]);
    await expect(fetchInstagramPosts(cfg)).resolves.toEqual([]);
    expect(calls()).toBe(2);
    const firstUrl = String(fetchSpy!.mock.calls[0]![0]);
    const secondUrl = String(fetchSpy!.mock.calls[1]![0]);
    expect(firstUrl).toContain("token=primary-token");
    expect(secondUrl).toContain("token=apify_api_fallback");
  });

  it("falls back on a 403 rejection too", async () => {
    const cfg = readSocialWatchConfig();
    const calls = mockFetchSequence([
      { ok: false, status: 403 },
      { ok: true, json: [] },
    ]);
    await expect(fetchInstagramPosts(cfg)).resolves.toEqual([]);
    expect(calls()).toBe(2);
  });

  it("does NOT fall back on a non-auth error (404) — fails fast, single attempt", async () => {
    const cfg = readSocialWatchConfig();
    const calls = mockFetchSequence([{ ok: false, status: 404 }]);
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow("status 404");
    expect(calls()).toBe(1);
  });

  it("throws (no fallback) when APIFY_TOKEN is the only token and it is rejected", async () => {
    delete process.env.INSTAGRAM_API_KEY;
    const cfg = readSocialWatchConfig();
    expect(cfg.instagram.apiKeys).toEqual(["apify_api_fallback"]);
    const calls = mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow("status 401");
    expect(calls()).toBe(1);
  });
});
