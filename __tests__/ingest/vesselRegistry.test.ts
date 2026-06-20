import {
  classifyVesselClass,
  readVesselRegistryConfig,
  isVesselRegistryConfigured,
  resolveVesselClasses,
} from "../../lib/ingest/src/vesselRegistry";

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
