import {
  IMPACT_COLOR,
  IMPACT_ORDER,
  IMPACT_RANK,
  SEV_RANK,
  worstSeverityKey,
  impactForIncident,
  impactLevelForSet,
  businessRelevance,
  OPERATIONAL_MAP_HEADING,
  OPERATIONAL_MAP_SUBTITLE,
  OPERATIONAL_MAP_READ,
} from "../../artifacts/workbench/src/lib/operationalPinchPoints";

describe("operationalPinchPoints — impact-level model", () => {
  it("orders and colours impact levels with brand-safe, non-severity hues", () => {
    expect(IMPACT_ORDER).toEqual(["Direct impact", "Possible impact", "Monitor only"]);
    expect(IMPACT_COLOR["Direct impact"]).toBe("#0B0B3D"); // Midnight Blue
    expect(IMPACT_COLOR["Possible impact"]).toBe("#4655FF"); // Electric Blue
    expect(IMPACT_COLOR["Monitor only"]).toBe("#6B7280"); // neutral grey
    // Reserved severity tiers must never be reused as an impact-level colour.
    const hues = Object.values(IMPACT_COLOR).map((h) => h.toUpperCase());
    expect(hues).not.toContain("#A33232"); // Extreme-only
    expect(hues).not.toContain("#1B6B7A"); // Insignificant-only
    // Direct is the highest-ranked impact level.
    expect(IMPACT_RANK["Direct impact"]).toBeGreaterThan(IMPACT_RANK["Possible impact"]);
    expect(IMPACT_RANK["Possible impact"]).toBeGreaterThan(IMPACT_RANK["Monitor only"]);
  });

  it("derives ONE incident's impact level from its own words, not severity/count", () => {
    // Confirmed operational effect (fire at a site, closed road) → Direct impact,
    // regardless of how the row was severity-graded.
    expect(impactForIncident({ title: "Fire at Jakarta warehouse", severity: "low" })).toBe(
      "Direct impact",
    );
    expect(impactForIncident({ title: "Protesters block the toll road" })).toBe("Direct impact");
    // Unrest / security activity with no confirmed disruption → Possible impact.
    expect(impactForIncident({ title: "Gunmen ambush a convoy" })).toBe("Possible impact");
    expect(impactForIncident({ title: "Protest rally clears in Medan" })).toBe("Possible impact");
    // A natural hazard is indirect → Possible impact.
    expect(impactForIncident({ title: "Flood hits the district" })).toBe("Possible impact");
    // Isolated crime / policing with no unrest or security dimension → Monitor only,
    // however severe the wording sounds.
    expect(impactForIncident({ title: "Man arrested for theft" })).toBe("Monitor only");
    expect(impactForIncident({ title: "Quarterly economic update" })).toBe("Monitor only");
  });

  it("reads the worst impact level from a set (highest-impact event leads)", () => {
    expect(
      impactLevelForSet([
        { title: "Man arrested for theft" }, // Monitor only
        { title: "Gunmen ambush a convoy" }, // Possible impact
      ]),
    ).toBe("Possible impact");
    expect(
      impactLevelForSet([
        { title: "Gunmen ambush a convoy" }, // Possible impact
        { title: "Fire at Jakarta warehouse" }, // Direct impact
      ]),
    ).toBe("Direct impact");
    // Empty set defaults to the conservative floor.
    expect(impactLevelForSet([])).toBe("Monitor only");
  });

  it("reads the worst severity key from a set", () => {
    expect(SEV_RANK.extreme).toBeGreaterThan(SEV_RANK.high);
    expect(worstSeverityKey([{ severity: "low" }, { severity: "high" }, { severity: "moderate" }])).toBe("high");
    expect(worstSeverityKey([])).toBe("");
  });

  it("labels business relevance to MATCH the reported event and its impact", () => {
    // Direct impact wording is confirmed, event-specific.
    expect(businessRelevance({ title: "Fire at Jakarta warehouse" }, "Direct impact")).toBe(
      "Site, asset and business-continuity disruption",
    );
    expect(businessRelevance({ title: "Protesters block the toll road" }, "Direct impact")).toBe(
      "Confirmed movement and access disruption",
    );
    // Possible impact wording is hedged (near / if operating nearby).
    expect(businessRelevance({ title: "Protest rally near the plant" }, "Possible impact")).toBe(
      "Possible movement disruption near protest area",
    );
    expect(businessRelevance({ title: "Gunmen ambush a convoy" }, "Possible impact")).toBe(
      "Possible staff movement concern if operating nearby",
    );
    expect(businessRelevance({ title: "Flood hits the district" }, "Possible impact")).toBe(
      "Possible site or utility disruption if operating nearby",
    );
    // Monitor only — isolated crime carries a security-awareness note only, and
    // non-violent monitoring items carry no commercial-impact claim (no fabrication).
    expect(businessRelevance({ title: "Shooting suspect arrested" }, "Monitor only")).toBe(
      "Local security awareness only",
    );
    expect(businessRelevance({ topic: "shipping", title: "Quarterly update" }, "Monitor only")).toBe(
      "No reported commercial impact",
    );
  });

  it("pins the fixed owner-brief map wording", () => {
    expect(OPERATIONAL_MAP_HEADING).toBe("Operational Map");
    expect(OPERATIONAL_MAP_SUBTITLE).toBe("Reported operational issues this period");
    expect(OPERATIONAL_MAP_READ).toMatch(/^This map shows reported operationally relevant issues/);
    expect(OPERATIONAL_MAP_READ).toMatch(/Monitor only unless they affect operations directly\.$/);
  });
});
