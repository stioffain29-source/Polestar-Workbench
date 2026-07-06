import {
  normaliseOsmElement,
  buildOverpassQuery,
  osmElementUrl,
  dedupeBySourceUrl,
  findProximityWarnings,
  type NormalisedFacility,
} from "@workspace/ingest";

describe("normaliseOsmElement", () => {
  it("keeps a named node with coordinates and maps explicit tags only", () => {
    const el = {
      type: "node",
      id: 111,
      lat: 1.3521,
      lon: 103.8198,
      tags: {
        name: "Local Name DC",
        "name:en": "Equinix SG3",
        operator: "Equinix",
        "addr:city": "Singapore",
        "addr:state": "Central",
        description: "colocation facility",
        telecom: "data_center",
      },
    };
    const r = normaliseOsmElement(el, "Singapore");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.facility;
    // name:en preferred over the local name tag.
    expect(f.name).toBe("Equinix SG3");
    expect(f.operator).toBe("Equinix");
    expect(f.city).toBe("Singapore");
    expect(f.region).toBe("Central");
    expect(f.notes).toBe("colocation facility");
    expect(f.country).toBe("Singapore");
    expect(f.latitude).toBeCloseTo(1.3521);
    expect(f.longitude).toBeCloseTo(103.8198);
    expect(f.sourceUrl).toBe("https://www.openstreetmap.org/node/111");
  });

  it("uses the local name tag when name:en is absent", () => {
    const r = normaliseOsmElement(
      { type: "node", id: 1, lat: 10, lon: 20, tags: { name: "STT KL1" } },
      "Malaysia",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.facility.name).toBe("STT KL1");
  });

  it("takes coordinates from center for ways/relations", () => {
    const r = normaliseOsmElement(
      {
        type: "way",
        id: 42,
        center: { lat: 13.7563, lon: 100.5018 },
        tags: { name: "Bangkok DC", man_made: "data_center" },
      },
      "Thailand",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facility.latitude).toBeCloseTo(13.7563);
    expect(r.facility.longitude).toBeCloseTo(100.5018);
    expect(r.facility.sourceUrl).toBe("https://www.openstreetmap.org/way/42");
  });

  it("NEVER fabricates an operator from brand", () => {
    const r = normaliseOsmElement(
      { type: "node", id: 5, lat: 1, lon: 1, tags: { name: "DC", brand: "AWS" } },
      "Singapore",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.facility.operator).toBeNull();
  });

  it("skips an element with no name (no operator fallback)", () => {
    const r = normaliseOsmElement(
      { type: "node", id: 7, lat: 1, lon: 1, tags: { operator: "Digital Realty", telecom: "data_center" } },
      "Singapore",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-name");
  });

  it("skips an element without coordinates", () => {
    const r = normaliseOsmElement(
      { type: "way", id: 8, tags: { name: "Unlocated DC" } },
      "Japan",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("skips a null-island (0,0) point", () => {
    const r = normaliseOsmElement(
      { type: "node", id: 9, lat: 0, lon: 0, tags: { name: "Null Island DC" } },
      "India",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("skips out-of-range coordinates", () => {
    const r = normaliseOsmElement(
      { type: "node", id: 10, lat: 999, lon: 5, tags: { name: "Bad DC" } },
      "India",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-coords");
  });

  it("rejects a non-object / malformed element", () => {
    expect(normaliseOsmElement(null, "Singapore").ok).toBe(false);
    expect(normaliseOsmElement({ type: "node" }, "Singapore").ok).toBe(false);
  });
});

describe("buildOverpassQuery", () => {
  it("scopes to the ISO area and unions the data-centre tags", () => {
    const q = buildOverpassQuery("SG");
    expect(q).toContain('area["ISO3166-1"="SG"]');
    expect(q).toContain('nwr["telecom"="data_center"](area.a);');
    expect(q).toContain('nwr["man_made"="data_center"](area.a);');
    expect(q).toContain('nwr["building"="data_center"](area.a);');
    expect(q).toContain("out center;");
    expect(q).toContain("[out:json]");
    // ISO alone (no admin_level pin).
    expect(q).not.toContain("admin_level");
  });

  it("sanitises the ISO input", () => {
    expect(buildOverpassQuery('sg"];injection')).toContain('"ISO3166-1"="SGINJECTION"');
  });
});

describe("osmElementUrl", () => {
  it("builds the canonical element URL", () => {
    expect(osmElementUrl("relation", 3)).toBe("https://www.openstreetmap.org/relation/3");
  });
});

describe("dedupeBySourceUrl", () => {
  it("keeps the first occurrence of each sourceUrl", () => {
    const mk = (id: number, url: string): NormalisedFacility => ({
      osmType: "node",
      osmId: id,
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
    const out = dedupeBySourceUrl([
      mk(1, "a"),
      mk(2, "b"),
      mk(3, "a"),
    ]);
    expect(out.map((f) => f.osmId)).toEqual([1, 2]);
  });
});

describe("findProximityWarnings", () => {
  const base = {
    operator: null,
    country: "Singapore",
    region: null,
    city: null,
    notes: null,
  };
  it("flags same-named facilities mapped within the threshold", () => {
    const facs: NormalisedFacility[] = [
      { ...base, osmType: "node", osmId: 1, name: "Digital Realty SIN", latitude: 1.3, longitude: 103.8, sourceUrl: "n1" },
      { ...base, osmType: "way", osmId: 2, name: "digital realty sin", latitude: 1.30001, longitude: 103.80001, sourceUrl: "w2" },
    ];
    const warnings = findProximityWarnings(facs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Digital Realty SIN");
  });

  it("does not flag same-named facilities that are far apart", () => {
    const facs: NormalisedFacility[] = [
      { ...base, osmType: "node", osmId: 1, name: "DC", latitude: 1.3, longitude: 103.8, sourceUrl: "n1" },
      { ...base, osmType: "node", osmId: 2, name: "DC", latitude: 35.6, longitude: 139.7, sourceUrl: "n2" },
    ];
    expect(findProximityWarnings(facs)).toHaveLength(0);
  });

  it("does not flag differently-named nearby facilities", () => {
    const facs: NormalisedFacility[] = [
      { ...base, osmType: "node", osmId: 1, name: "DC One", latitude: 1.3, longitude: 103.8, sourceUrl: "n1" },
      { ...base, osmType: "node", osmId: 2, name: "DC Two", latitude: 1.30001, longitude: 103.80001, sourceUrl: "n2" },
    ];
    expect(findProximityWarnings(facs)).toHaveLength(0);
  });
});
