import {
  normalisePeeringDbFac,
  buildPeeringDbFacUrl,
  peeringDbFacUrl,
  dedupePeeringDbBySourceUrl,
  findPeeringDbProximityWarnings,
  PEERINGDB_DC_COUNTRIES,
  type PeeringDbNormalisedFacility,
} from "@workspace/ingest";

describe("normalisePeeringDbFac", () => {
  it("keeps a named facility with coordinates and maps explicit fields only", () => {
    const raw = {
      id: 111,
      name: "Equinix SG3",
      org_name: "Equinix",
      city: "Singapore",
      state: "Central",
      country: "SG",
      latitude: 1.3521,
      longitude: 103.8198,
      status: "ok",
      notes: "carrier-neutral colocation",
    };
    const r = normalisePeeringDbFac(raw, "Singapore", "SG");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.facility;
    expect(f.peeringDbId).toBe(111);
    expect(f.name).toBe("Equinix SG3");
    expect(f.operator).toBe("Equinix");
    expect(f.city).toBe("Singapore");
    expect(f.region).toBe("Central");
    expect(f.notes).toBe("carrier-neutral colocation");
    expect(f.country).toBe("Singapore");
    expect(f.latitude).toBeCloseTo(1.3521);
    expect(f.longitude).toBeCloseTo(103.8198);
    expect(f.sourceUrl).toBe("https://www.peeringdb.com/fac/111");
  });

  it("stamps the canonical country name, not the ISO", () => {
    const r = normalisePeeringDbFac(
      { id: 1, name: "STT KL1", country: "MY", latitude: 3.1, longitude: 101.6 },
      "Malaysia",
      "MY",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.facility.country).toBe("Malaysia");
  });

  it("accepts string-typed coordinates (PeeringDB sometimes serialises them)", () => {
    const r = normalisePeeringDbFac(
      { id: 2, name: "Bangkok DC", country: "TH", latitude: "13.7563", longitude: "100.5018" },
      "Thailand",
      "TH",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facility.latitude).toBeCloseTo(13.7563);
    expect(r.facility.longitude).toBeCloseTo(100.5018);
  });

  it("keeps an org_name that is an email verbatim (no fabrication, no cleanup)", () => {
    const r = normalisePeeringDbFac(
      { id: 3, name: "Local IX", org_name: "noc@example.sg", country: "SG", latitude: 1.3, longitude: 103.8 },
      "Singapore",
      "SG",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.facility.operator).toBe("noc@example.sg");
  });

  it("NEVER promotes org_name into the name column", () => {
    const r = normalisePeeringDbFac(
      { id: 4, org_name: "Digital Realty", country: "SG", latitude: 1, longitude: 1 },
      "Singapore",
      "SG",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-name");
  });

  it("skips a facility without coordinates", () => {
    const r = normalisePeeringDbFac(
      { id: 5, name: "Unlocated DC", country: "JP", latitude: null, longitude: null },
      "Japan",
      "JP",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("does not treat an absent coordinate as (0,0)", () => {
    const r = normalisePeeringDbFac(
      { id: 6, name: "Half DC", country: "JP", latitude: 35.6, longitude: "" },
      "Japan",
      "JP",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("skips a null-island (0,0) point", () => {
    const r = normalisePeeringDbFac(
      { id: 7, name: "Null Island DC", country: "IN", latitude: 0, longitude: 0 },
      "India",
      "IN",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("skips out-of-range coordinates", () => {
    const r = normalisePeeringDbFac(
      { id: 8, name: "Bad DC", country: "IN", latitude: 999, longitude: 5 },
      "India",
      "IN",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("rejects a record whose country ISO does not match the requested country", () => {
    const r = normalisePeeringDbFac(
      { id: 9, name: "Wrong Country DC", country: "US", latitude: 40, longitude: -74 },
      "Singapore",
      "SG",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("country-mismatch");
  });

  it("rejects a non-integer / malformed id", () => {
    expect(normalisePeeringDbFac({ id: 1.5, name: "X", country: "SG", latitude: 1, longitude: 1 }, "Singapore", "SG").ok).toBe(false);
    expect(normalisePeeringDbFac({ name: "X", country: "SG", latitude: 1, longitude: 1 }, "Singapore", "SG").ok).toBe(false);
  });

  it("rejects a non-object / malformed record", () => {
    expect(normalisePeeringDbFac(null, "Singapore", "SG").ok).toBe(false);
    expect(normalisePeeringDbFac({ id: 1 }, "Singapore", "SG").ok).toBe(false);
  });
});

describe("buildPeeringDbFacUrl", () => {
  it("scopes to the ISO country and pages via limit + skip", () => {
    const url = buildPeeringDbFacUrl("SG", 0);
    expect(url).toContain("/fac?country__in=SG");
    expect(url).toContain("limit=250");
    expect(url).toContain("skip=0");
  });

  it("carries a non-zero skip and sanitises the ISO input", () => {
    const url = buildPeeringDbFacUrl('sg"];injection', 250);
    expect(url).toContain("country__in=SGINJECTION");
    expect(url).toContain("skip=250");
  });

  it("floors a negative skip to zero", () => {
    expect(buildPeeringDbFacUrl("MY", -5)).toContain("skip=0");
  });
});

describe("peeringDbFacUrl", () => {
  it("builds the canonical facility URL", () => {
    expect(peeringDbFacUrl(42)).toBe("https://www.peeringdb.com/fac/42");
  });
});

describe("dedupePeeringDbBySourceUrl", () => {
  it("keeps the first occurrence of each sourceUrl", () => {
    const mk = (id: number, url: string): PeeringDbNormalisedFacility => ({
      peeringDbId: id,
      name: `DC ${id}`,
      operator: null,
      country: "Singapore",
      region: null,
      city: null,
      latitude: 1,
      longitude: 1,
      notes: null,
      sourceUrl: url,
    });
    const out = dedupePeeringDbBySourceUrl([mk(1, "a"), mk(2, "b"), mk(3, "a")]);
    expect(out.map((f) => f.peeringDbId)).toEqual([1, 2]);
  });
});

describe("findPeeringDbProximityWarnings", () => {
  const base = {
    operator: null,
    country: "Singapore",
    region: null,
    city: null,
    notes: null,
  };
  it("flags same-named facilities mapped within the threshold", () => {
    const facs: PeeringDbNormalisedFacility[] = [
      { ...base, peeringDbId: 1, name: "Digital Realty SIN", latitude: 1.3, longitude: 103.8, sourceUrl: "f1" },
      { ...base, peeringDbId: 2, name: "digital realty sin", latitude: 1.30001, longitude: 103.80001, sourceUrl: "f2" },
    ];
    const warnings = findPeeringDbProximityWarnings(facs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Digital Realty SIN");
  });

  it("does not flag same-named facilities that are far apart", () => {
    const facs: PeeringDbNormalisedFacility[] = [
      { ...base, peeringDbId: 1, name: "DC", latitude: 1.3, longitude: 103.8, sourceUrl: "f1" },
      { ...base, peeringDbId: 2, name: "DC", latitude: 35.6, longitude: 139.7, sourceUrl: "f2" },
    ];
    expect(findPeeringDbProximityWarnings(facs)).toHaveLength(0);
  });

  it("does not flag differently-named nearby facilities", () => {
    const facs: PeeringDbNormalisedFacility[] = [
      { ...base, peeringDbId: 1, name: "DC One", latitude: 1.3, longitude: 103.8, sourceUrl: "f1" },
      { ...base, peeringDbId: 2, name: "DC Two", latitude: 1.30001, longitude: 103.80001, sourceUrl: "f2" },
    ];
    expect(findPeeringDbProximityWarnings(facs)).toHaveLength(0);
  });
});

describe("PEERINGDB_DC_COUNTRIES", () => {
  it("shares the OSM registry scope (13 tracked territories, ISO + canonical name)", () => {
    expect(PEERINGDB_DC_COUNTRIES.length).toBe(13);
    for (const c of PEERINGDB_DC_COUNTRIES) {
      expect(c.iso).toMatch(/^[A-Z]{2}$/);
      expect(c.country.length).toBeGreaterThan(0);
    }
    const sg = PEERINGDB_DC_COUNTRIES.find((c) => c.iso === "SG");
    expect(sg?.country).toBe("Singapore");
  });
});
