import { clearIntegrationEnv } from "./integrationEnvTestHelpers";

const originalFetch = global.fetch;

describe("getLiveuamapEvents upstream failure", () => {
  beforeEach(() => {
    jest.resetModules();
    clearIntegrationEnv();
    process.env.LIVEUAMAP_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.LIVEUAMAP_API_KEY;
  });

  it("leaves fetchedAt null when upstream returns 403 (egress IP block)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as typeof fetch;

    const { getLiveuamapEvents } = await import("../../artifacts/api-server/src/lib/liveuamap");
    const result = await getLiveuamapEvents("asia", 10);

    expect(result.configured).toBe(true);
    expect(result.fetchedAt).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("returns configured:false without calling upstream when the key is unset", async () => {
    delete process.env.LIVEUAMAP_API_KEY;
    global.fetch = jest.fn() as typeof fetch;

    const { getLiveuamapEvents } = await import("../../artifacts/api-server/src/lib/liveuamap");
    const result = await getLiveuamapEvents("asia", 10);

    expect(result.configured).toBe(false);
    expect(result.fetchedAt).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
