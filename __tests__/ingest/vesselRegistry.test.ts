import {
  classifyVesselClass,
  readVesselRegistryConfig,
  isVesselRegistryConfigured,
  resolveVesselClasses,
} from "../../lib/ingest/src/vesselRegistry";
import { clearIntegrationEnv } from "../api-server/integrationEnvTestHelpers";

describe("classifyVesselClass", () => {
  it("maps bulk carriers to bulk", () => {
    expect(classifyVesselClass("Bulk Carrier")).toBe("bulk");
    expect(classifyVesselClass("Ore/Bulk/Oil Carrier")).toBe("bulk");
  });

  it("maps container ships to container", () => {
    expect(classifyVesselClass("Container Ship")).toBe("container");
    expect(classifyVesselClass("Fully Cellular Containership")).toBe("container");
  });

  it("maps gas carriers to lng-lpg", () => {
    expect(classifyVesselClass("LNG Tanker")).toBe("lng-lpg");
    expect(classifyVesselClass("LPG Tanker")).toBe("lng-lpg");
    expect(classifyVesselClass("Liquefied Gas Carrier")).toBe("lng-lpg");
    expect(classifyVesselClass("Gas Carrier")).toBe("lng-lpg");
  });

  it("prefers the more specific gas class over tanker", () => {
    // A gas carrier can also read as a 'tanker'; LNG/LPG must win.
    expect(classifyVesselClass("LNG Tanker, fully refrigerated")).toBe("lng-lpg");
  });

  it("returns 'other' for a resolved-but-untracked class", () => {
    expect(classifyVesselClass("Crude Oil Tanker")).toBe("other");
    expect(classifyVesselClass("General Cargo")).toBe("other");
    expect(classifyVesselClass("Passenger Ship")).toBe("other");
  });

  it("returns null for empty input", () => {
    expect(classifyVesselClass("")).toBeNull();
    expect(classifyVesselClass(null)).toBeNull();
    expect(classifyVesselClass(undefined)).toBeNull();
  });
});

describe("readVesselRegistryConfig", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    // Start from a known-clean integration env so ambient VESSEL_REGISTRY_*
    // secrets from the real workspace can't skew the config-resolution checks.
    clearIntegrationEnv();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reports not configured when the key is unset", () => {
    delete process.env.VESSEL_REGISTRY_API_KEY;
    const cfg = readVesselRegistryConfig();
    expect(cfg.configured).toBe(false);
    expect(isVesselRegistryConfigured()).toBe(false);
  });

  it("reads the key, defaults and clamps the lookup budget", () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    process.env.VESSEL_REGISTRY_MAX_LOOKUPS = "999999";
    const cfg = readVesselRegistryConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.provider).toBe("datalastic");
    expect(cfg.maxLookups).toBe(1000);
    expect(isVesselRegistryConfigured()).toBe(true);
  });

  it("honours the enabled kill-switch", () => {
    process.env.VESSEL_REGISTRY_API_KEY = "abc";
    process.env.VESSEL_REGISTRY_ENABLED = "false";
    expect(readVesselRegistryConfig().enabled).toBe(false);
  });
});

describe("resolveVesselClasses", () => {
  it("no-ops cleanly (no network) when the registry is not configured", async () => {
    const res = await resolveVesselClasses(
      [{ mmsi: 1, imo: 9000001 }],
      {
        config: {
          configured: false,
          enabled: true,
          provider: "datalastic",
          base: "https://example.invalid",
          apiKey: "",
          maxLookups: 150,
        },
      },
    );
    expect(res.configured).toBe(false);
    expect(res.lookups).toBe(0);
    expect(res.classByMmsi.size).toBe(0);
  });

  it("no-ops when disabled via the kill-switch", async () => {
    const res = await resolveVesselClasses(
      [{ mmsi: 1, imo: 9000001 }],
      {
        config: {
          configured: true,
          enabled: false,
          provider: "datalastic",
          base: "https://example.invalid",
          apiKey: "abc",
          maxLookups: 150,
        },
      },
    );
    expect(res.lookups).toBe(0);
    expect(res.classByMmsi.size).toBe(0);
  });

  it("rejects an unsupported provider without any network call", async () => {
    const res = await resolveVesselClasses(
      [{ mmsi: 1, imo: 9000001 }],
      {
        config: {
          configured: true,
          enabled: true,
          provider: "marinetraffic",
          base: "https://example.invalid",
          apiKey: "abc",
          maxLookups: 150,
        },
      },
    );
    expect(res.lookups).toBe(0);
    expect(res.errors[0]).toContain("unsupported");
  });
});

describe("resolveVesselClasses against datalastic response shapes", () => {
  const realFetch = global.fetch;
  const cfg = {
    configured: true,
    enabled: true,
    provider: "datalastic",
    base: "https://api.datalastic.com/api/v0",
    apiKey: "abc",
    maxLookups: 150,
  };
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetch(handler: (url: string) => unknown) {
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      const body = handler(url);
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    }) as typeof fetch;
  }

  // The single-vessel endpoint (/vessel?imo=…|&mmsi=…) wraps the record in a
  // `data` OBJECT — the exact shape published at docs.datalastic.com.
  it("classifies a datalastic single-vessel object envelope (type_specific)", async () => {
    mockFetch(() => ({
      data: {
        uuid: "b8625b67",
        name: "MAERSK CHENNAI",
        mmsi: "566093000",
        imo: "9525338",
        type: "Cargo - Hazard A (Major)",
        type_specific: "Container Ship",
      },
      meta: { success: true },
    }));
    const res = await resolveVesselClasses([{ mmsi: 566093000, imo: 9525338 }], {
      config: cfg,
    });
    expect(res.lookups).toBe(1);
    expect(res.resolved).toBe(1);
    expect(res.classByMmsi.get(566093000)).toBe("container");
  });

  it("falls back to the parent `type` when `type_specific` is absent", async () => {
    mockFetch(() => ({
      data: { mmsi: "100", type: "Bulk Carrier" },
      meta: { success: true },
    }));
    const res = await resolveVesselClasses([{ mmsi: 100, imo: null }], {
      config: cfg,
    });
    expect(res.classByMmsi.get(100)).toBe("bulk");
  });

  it("classifies an LNG tanker via type_specific", async () => {
    mockFetch(() => ({
      data: { mmsi: "200", type: "Tanker", type_specific: "LNG Tanker" },
      meta: { success: true },
    }));
    const res = await resolveVesselClasses([{ mmsi: 200, imo: 9000200 }], {
      config: cfg,
    });
    expect(res.classByMmsi.get(200)).toBe("lng-lpg");
  });

  // Datalastic's multi-vessel / bulk endpoints return `data` as an ARRAY; the
  // parser accepts a single-element array defensively.
  it("classifies a datalastic array envelope (single element)", async () => {
    mockFetch(() => ({
      data: [{ mmsi: "300", type: "Cargo", type_specific: "Bulk Carrier" }],
      meta: { total: 1, success: true },
    }));
    const res = await resolveVesselClasses([{ mmsi: 300, imo: 9000300 }], {
      config: cfg,
    });
    expect(res.classByMmsi.get(300)).toBe("bulk");
  });

  it("prefers IMO over MMSI in the lookup URL", async () => {
    let seen = "";
    mockFetch((url) => {
      seen = url;
      return { data: { type_specific: "Container Ship" }, meta: {} };
    });
    await resolveVesselClasses([{ mmsi: 566093000, imo: 9525338 }], {
      config: cfg,
    });
    expect(seen).toContain("imo=9525338");
    expect(seen).not.toContain("mmsi=");
    expect(seen).toContain("api-key=abc");
  });

  it("falls back to MMSI when no IMO is available", async () => {
    let seen = "";
    mockFetch((url) => {
      seen = url;
      return { data: { type_specific: "Container Ship" }, meta: {} };
    });
    await resolveVesselClasses([{ mmsi: 566093000, imo: null }], {
      config: cfg,
    });
    expect(seen).toContain("mmsi=566093000");
    expect(seen).not.toContain("imo=");
  });

  it("leaves a vessel unclassified when the registry has no record (404)", async () => {
    global.fetch = (async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response) as typeof fetch;
    const res = await resolveVesselClasses([{ mmsi: 400, imo: 9000400 }], {
      config: cfg,
    });
    expect(res.lookups).toBe(1);
    expect(res.resolved).toBe(0);
    expect(res.classByMmsi.has(400)).toBe(false);
    expect(res.errors).toHaveLength(0);
  });
});
