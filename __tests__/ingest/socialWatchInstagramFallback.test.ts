import {
  readSocialWatchConfig,
  fetchInstagramPosts,
  isApifyAuthError,
} from "../../lib/ingest/src/socialWatch";
import { clearIntegrationEnv } from "../api-server/integrationEnvTestHelpers";

// The Instagram social-watch scraper uses Apify's ASYNCHRONOUS run-and-poll
// pattern: START an actor run, POLL its status until terminal, then FETCH the
// run's dataset items. (The old synchronous run-sync endpoint was always
// aborted at the 20s fetch timeout before the multi-minute scrape finished.)
//
// It also accepts APIFY_TOKEN as a fallback Apify credential. That fallback is
// used when INSTAGRAM_API_KEY is unset, AND it is tried when the primary key is
// REJECTED with an auth error (HTTP 401/403) on the run-START call — e.g. a
// stale/wrong value left in INSTAGRAM_API_KEY. The fallback must advance to the
// next token ONLY on 401/403 (which start no paid Apify run); any other error
// must fail without burning a second (potentially paid) attempt. These tests
// pin that behaviour by mocking fetch — they never reach the network or the DB.

const RUN_ID = "run_test_1";
const DATASET_ID = "ds_test_1";

interface MockResp {
  ok: boolean;
  status?: number;
  json?: unknown;
}

describe("instagram apify async run-and-poll + token fallback", () => {
  const savedEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    // Start from a known-clean integration env so a real INSTAGRAM_API_KEY /
    // APIFY_TOKEN in the workspace can't shadow the fixed test tokens below.
    clearIntegrationEnv();
    process.env.INSTAGRAM_PROVIDER = "apify";
    process.env.INSTAGRAM_API_KEY = "primary-token";
    process.env.APIFY_TOKEN = "apify_api_fallback";
    // Keep the poll loop fast in tests (real default is 5s).
    process.env.INSTAGRAM_RUN_POLL_MS = "1";
    process.env.INSTAGRAM_RUN_MAX_WAIT_MS = "2000";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  /**
   * Mock fetch by URL. `handler(url, callIndex)` returns the response for each
   * call; falls back to sensible defaults (SUCCEEDED run, empty dataset) so a
   * test only needs to describe the parts it cares about.
   */
  function mockByUrl(
    handler: (url: string, call: number) => MockResp | undefined,
  ): () => number {
    let call = 0;
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        const idx = call;
        call += 1;
        let r = handler(url, idx);
        if (!r) {
          if (/\/runs\?/.test(url)) {
            r = {
              ok: true,
              json: {
                data: {
                  id: RUN_ID,
                  status: "SUCCEEDED",
                  defaultDatasetId: DATASET_ID,
                },
              },
            };
          } else if (/\/actor-runs\/[^/]+\/abort/.test(url)) {
            r = { ok: true, json: { data: { id: RUN_ID, status: "ABORTED" } } };
          } else if (/\/actor-runs\//.test(url)) {
            r = {
              ok: true,
              json: {
                data: {
                  id: RUN_ID,
                  status: "SUCCEEDED",
                  defaultDatasetId: DATASET_ID,
                },
              },
            };
          } else if (/\/datasets\//.test(url)) {
            r = { ok: true, json: [] };
          } else {
            r = { ok: true, json: [] };
          }
        }
        return {
          ok: r.ok,
          status: r.status ?? (r.ok ? 200 : 500),
          json: async () => r!.json ?? [],
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
    expect(cfg.instagram.apiKeys).toEqual([
      "primary-token",
      "apify_api_fallback",
    ]);
    expect(cfg.instagram.configured).toBe(true);
  });

  it("completes via start -> poll -> dataset (async run-and-poll)", async () => {
    const cfg = readSocialWatchConfig();
    const post = {
      id: "abc123",
      shortCode: "abc123",
      url: "https://www.instagram.com/p/abc123/",
      caption: "aksi damai",
      displayUrl: "https://cdn/x.jpg",
      timestamp: "2026-07-01T00:00:00Z",
    };
    mockByUrl((url, call) => {
      if (/\/runs\?/.test(url)) {
        // Run starts RUNNING (not yet terminal) so the poll loop must iterate.
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status: "RUNNING", defaultDatasetId: DATASET_ID },
          },
        };
      }
      if (/\/actor-runs\//.test(url)) {
        // First poll still RUNNING, second poll SUCCEEDED.
        const status = call <= 1 ? "RUNNING" : "SUCCEEDED";
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status, defaultDatasetId: DATASET_ID },
          },
        };
      }
      if (/\/datasets\//.test(url)) {
        return { ok: true, json: [post] };
      }
      return undefined;
    });
    const posts = await fetchInstagramPosts(cfg);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.externalId).toBe("ig_abc123");
    // START call uses the primary token; the dataset call was reached.
    const startUrl = String(fetchSpy!.mock.calls[0]![0]);
    expect(startUrl).toContain("/runs?");
    expect(startUrl).toContain("token=primary-token");
    const lastUrl = String(
      fetchSpy!.mock.calls[fetchSpy!.mock.calls.length - 1]![0],
    );
    expect(lastUrl).toContain("/datasets/");
  });

  it("falls back to APIFY_TOKEN when the primary key is rejected (401) on run start", async () => {
    const cfg = readSocialWatchConfig();
    let startCalls = 0;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        startCalls += 1;
        // First start (primary) rejected 401; second start (fallback) succeeds.
        if (startCalls === 1) return { ok: false, status: 401 };
        return {
          ok: true,
          json: {
            data: {
              id: RUN_ID,
              status: "SUCCEEDED",
              defaultDatasetId: DATASET_ID,
            },
          },
        };
      }
      return undefined; // dataset -> default []
    });
    await expect(fetchInstagramPosts(cfg)).resolves.toEqual([]);
    expect(startCalls).toBe(2);
    const firstStart = String(fetchSpy!.mock.calls[0]![0]);
    const secondStart = String(fetchSpy!.mock.calls[1]![0]);
    expect(firstStart).toContain("token=primary-token");
    expect(secondStart).toContain("token=apify_api_fallback");
  });

  it("falls back on a 403 rejection too", async () => {
    const cfg = readSocialWatchConfig();
    let startCalls = 0;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        startCalls += 1;
        if (startCalls === 1) return { ok: false, status: 403 };
        return {
          ok: true,
          json: {
            data: {
              id: RUN_ID,
              status: "SUCCEEDED",
              defaultDatasetId: DATASET_ID,
            },
          },
        };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).resolves.toEqual([]);
    expect(startCalls).toBe(2);
  });

  it("does NOT fall back on a non-auth error (404) — fails fast, single start", async () => {
    const cfg = readSocialWatchConfig();
    let startCalls = 0;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        startCalls += 1;
        return { ok: false, status: 404 };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow("status 404");
    expect(startCalls).toBe(1);
  });

  it("throws (no fallback) when APIFY_TOKEN is the only token and start is rejected", async () => {
    delete process.env.INSTAGRAM_API_KEY;
    const cfg = readSocialWatchConfig();
    expect(cfg.instagram.apiKeys).toEqual(["apify_api_fallback"]);
    let startCalls = 0;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        startCalls += 1;
        return { ok: false, status: 401 };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow("status 401");
    expect(startCalls).toBe(1);
  });

  it("does NOT fall back when an auth error (401) surfaces AFTER the run started (polling)", async () => {
    // Once the primary token successfully STARTS a run, that run has been paid
    // for. A 401 during polling must NOT roll over to the fallback token (which
    // would start a second, extra-cost run). It must surface as-is instead.
    const cfg = readSocialWatchConfig();
    let startCalls = 0;
    let pollCalls = 0;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        startCalls += 1;
        // Primary start SUCCEEDS (run created), leaves the run RUNNING so the
        // poll loop must iterate at least once.
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status: "RUNNING", defaultDatasetId: DATASET_ID },
          },
        };
      }
      if (/\/actor-runs\/[^/]+\/abort/.test(url)) {
        return { ok: true, json: { data: { id: RUN_ID, status: "ABORTED" } } };
      }
      if (/\/actor-runs\//.test(url)) {
        pollCalls += 1;
        // Poll returns 401 — but the run already started, so no fallback.
        return { ok: false, status: 401 };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow("status 401");
    // Exactly ONE start (no fallback START with the second token).
    expect(startCalls).toBe(1);
    expect(pollCalls).toBe(1);
    // No dataset fetch ever happened, and no second /runs? call was made.
    const startUrlCalls = fetchSpy!.mock.calls.filter((c) =>
      /\/runs\?/.test(String(c[0])),
    );
    expect(startUrlCalls).toHaveLength(1);
    expect(String(startUrlCalls[0]![0])).toContain("token=primary-token");
  });

  it("throws when a started run ends in a non-SUCCEEDED terminal state (FAILED)", async () => {
    const cfg = readSocialWatchConfig();
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status: "FAILED", defaultDatasetId: DATASET_ID },
          },
        };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow(
      "Apify run did not succeed (status FAILED)",
    );
  });

  it("times out (and aborts the run) when the run never reaches a terminal state", async () => {
    process.env.INSTAGRAM_RUN_MAX_WAIT_MS = "20";
    process.env.INSTAGRAM_RUN_POLL_MS = "1";
    const cfg = readSocialWatchConfig();
    let abortCalled = false;
    mockByUrl((url) => {
      if (/\/runs\?/.test(url)) {
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status: "RUNNING", defaultDatasetId: DATASET_ID },
          },
        };
      }
      if (/\/actor-runs\/[^/]+\/abort/.test(url)) {
        abortCalled = true;
        return { ok: true, json: { data: { id: RUN_ID, status: "ABORTED" } } };
      }
      if (/\/actor-runs\//.test(url)) {
        // Never terminal — forces the budget to expire.
        return {
          ok: true,
          json: {
            data: { id: RUN_ID, status: "RUNNING", defaultDatasetId: DATASET_ID },
          },
        };
      }
      return undefined;
    });
    await expect(fetchInstagramPosts(cfg)).rejects.toThrow(/timed out/);
    expect(abortCalled).toBe(true);
  });
});
