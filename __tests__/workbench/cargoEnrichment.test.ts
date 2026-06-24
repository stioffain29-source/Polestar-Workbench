import {
  enrichCargoIncident,
  deriveConfidence,
  deriveImpact,
  deriveStatus,
  extractVessel,
  extractCompany,
  extractCargoType,
  extractIncidentTime,
  derivePortLocation,
  deriveWatchItem,
  displayCargoField,
  isAuthoritativeSource,
  isSpeculative,
  NOT_REPORTED,
  type CargoEnrichmentInput,
} from "../../artifacts/workbench/src/lib/cargoEnrichment";

function inc(p: Partial<CargoEnrichmentInput>): CargoEnrichmentInput {
  return { title: "", summary: "", ...p };
}

describe("cargo enrichment — confidence (source authority + corroboration)", () => {
  it("High: authoritative source corroborated by a second report", () => {
    const i = inc({ title: "Police seize cocaine in container at Port Klang", source: "Reuters" });
    expect(isAuthoritativeSource(i)).toBe(true);
    expect(deriveConfidence(i, { clusterSize: 2 })).toBe("High");
  });

  it("High: three or more independent reports even without an authoritative source", () => {
    const i = inc({ title: "Warehouse theft ring busted in Jakarta", source: "Local Daily" });
    expect(deriveConfidence(i, { clusterSize: 3 })).toBe("High");
  });

  it("Medium: a single authoritative source", () => {
    const i = inc({ title: "Customs intercept smuggled goods at Jebel Ali", source: "Customs" });
    expect(deriveConfidence(i, { clusterSize: 1 })).toBe("Medium");
  });

  it("Low: a single, non-authoritative, uncorroborated report", () => {
    const i = inc({ title: "Truck goods stolen near Surabaya", source: "Blog" });
    expect(deriveConfidence(i, { clusterSize: 1 })).toBe("Low");
  });

  it("Low: speculative framing caps confidence even with corroboration + authority", () => {
    const i = inc({ title: "Police probe alleged container theft at Colombo port", source: "Reuters" });
    expect(isSpeculative(i)).toBe(true);
    expect(deriveConfidence(i, { clusterSize: 5 })).toBe("Low");
  });
});

describe("cargo enrichment — impact is a 0-4 projection of the named tier", () => {
  const cases: Array<[string, number, string]> = [
    ["insignificant", 0, "Insignificant"],
    ["low", 1, "Low"],
    ["moderate", 2, "Moderate"],
    ["high", 3, "High"],
    ["extreme", 4, "Extreme"],
  ];
  it.each(cases)("%s => score %d, label %s", (sev, score, label) => {
    const r = deriveImpact(inc({ title: "x", severity: sev }));
    expect(r.impactScore).toBe(score);
    expect(r.impactLabel).toBe(label);
  });

  it("missing severity falls to the Low floor, never invents Extreme", () => {
    const r = deriveImpact(inc({ title: "x", severity: null }));
    expect(r.impactLabel).toBe("Low");
    expect(r.impactScore).toBe(1);
  });
});

describe("cargo enrichment — lifecycle status", () => {
  it("Unconfirmed when the source hedges", () => {
    expect(deriveStatus(inc({ title: "Suspected cargo theft at Tanjung Priok" }))).toBe("Unconfirmed");
  });

  it("Resolved on an arrest / recovery cue (wins over recency)", () => {
    const i = inc({ title: "Three arrested over warehouse theft in Shanghai", occurredAt: "2026-06-20" });
    expect(deriveStatus(i, { referenceDate: "2026-06-22" })).toBe("Resolved");
  });

  it("Updated on a follow-up cue (with no terminal-resolution cue)", () => {
    expect(deriveStatus(inc({ title: "Latest developments in the Port Klang container theft probe" }))).toBe("Updated");
  });

  it("New when within 7 days of the reference date", () => {
    const i = inc({ title: "Containers stolen at Colombo port", occurredAt: "2026-06-21" });
    expect(deriveStatus(i, { referenceDate: "2026-06-24" })).toBe("New");
  });

  it("Ongoing when older than the recency window and no terminal cue", () => {
    const i = inc({ title: "Containers stolen at Colombo port", occurredAt: "2026-05-01" });
    expect(deriveStatus(i, { referenceDate: "2026-06-24" })).toBe("Ongoing");
  });
});

describe("cargo enrichment — structured field extraction (no fabrication)", () => {
  it("extracts a vessel name from an MV/MT prefix, else null", () => {
    expect(extractVessel(inc({ title: "Robbers boarded MV Pacific Star at anchorage" }))).toBe("Pacific Star");
    expect(extractVessel(inc({ title: "Cargo theft at the port" }))).toBeNull();
  });

  it("extracts a company only on a clear cue or corporate suffix, else null", () => {
    expect(extractCompany(inc({ title: "Goods operated by Maersk Logistics stolen" }))).toBe("Maersk Logistics");
    expect(extractCompany(inc({ title: "Theft hits Evergreen Shipping depot" }))).toBe("Evergreen Shipping");
    expect(extractCompany(inc({ title: "Cargo stolen from a depot" }))).toBeNull();
  });

  it("maps cargo type from commodity vocabulary, with Other => null", () => {
    expect(extractCargoType(inc({ title: "Smartphones stolen from container" }))).toBe("Electronics");
    expect(extractCargoType(inc({ title: "Diesel siphoned from tanker truck" }))).toBe("Fuel");
    expect(extractCargoType(inc({ title: "Goods stolen", summary: "" }))).toBe("General Cargo");
    expect(extractCargoType(inc({ title: "An unspecified incident occurred" }))).toBeNull();
  });

  it("extracts an explicit time or daypart, else null", () => {
    expect(extractIncidentTime(inc({ title: "Theft reported at 3am at the depot" }))).toBe("3am");
    expect(extractIncidentTime(inc({ title: "Overnight raid on the warehouse" }))).toBe("overnight");
    expect(extractIncidentTime(inc({ title: "Theft at the depot" }))).toBeNull();
  });

  it("returns a gazetteer port as approximate, an explicit location as exact, else null", () => {
    const port = derivePortLocation(inc({ title: "Cargo theft at Port Klang" }));
    expect(port.portLocation).toBe("Port Klang");
    expect(port.locationApproximate).toBe(true);

    const exact = derivePortLocation(inc({ title: "Theft", location: "Jurong Industrial Estate" }));
    expect(exact.portLocation).toBe("Jurong Industrial Estate");
    expect(exact.locationApproximate).toBe(false);

    const none = derivePortLocation(inc({ title: "Theft somewhere" }));
    expect(none.portLocation).toBeNull();
  });
});

describe("cargo enrichment — recommended watch item", () => {
  it("returns a concrete, category-specific action for a real category", () => {
    expect(deriveWatchItem("Port armed robbery")).toMatch(/port/i);
    expect(deriveWatchItem("Stowaway incident")).toMatch(/stowaway/i);
  });

  it("omits (null) for the cargo floor / not-relevant sentinel — never generic filler", () => {
    expect(deriveWatchItem("Other cargo security incident")).toBeNull();
    expect(deriveWatchItem("Not relevant")).toBeNull();
  });
});

describe("cargo enrichment — display fallback", () => {
  it("renders the exact 'not reported.' string for empty values", () => {
    expect(displayCargoField(null)).toBe(NOT_REPORTED);
    expect(displayCargoField("")).toBe(NOT_REPORTED);
    expect(displayCargoField("  ")).toBe(NOT_REPORTED);
    expect(displayCargoField("Pacific Star")).toBe("Pacific Star");
  });
});

describe("cargo enrichment — top-level enrich() ties it together", () => {
  it("produces a fully-formed, honest enrichment for a port narcotics seizure", () => {
    const i = inc({
      title: "Police seize cocaine in container at Port Klang at 2am",
      source: "Reuters",
      severity: "high",
      occurredAt: "2026-06-22",
    });
    const e = enrichCargoIncident(i, { clusterSize: 2, referenceDate: "2026-06-24" });
    expect(e.category).toBe("Narcotics seizure (cargo / port)");
    expect(e.group).toBe("port");
    expect(e.confidence).toBe("High");
    expect(e.impactLabel).toBe("High");
    expect(e.impactScore).toBe(3);
    expect(e.status).toBe("New");
    expect(e.cargoType).toBe("General Cargo");
    expect(e.incidentTime).toBe("2am");
    expect(e.portLocation).toBe("Port Klang");
    expect(e.locationApproximate).toBe(true);
    expect(e.watchItem).toMatch(/screening|scanning|inspection/i);
  });
});
