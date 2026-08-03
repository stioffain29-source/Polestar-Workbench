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
    expect(IMPACT_ORDER).toEqual(["Direct impact", "Indirect impact", "Monitor only"]);
    expect(IMPACT_COLOR["Direct impact"]).toBe("#0b0a3d"); // Midnight Blue
    expect(IMPACT_COLOR["Indirect impact"]).toBe("#465bff"); // Electric Blue
    expect(IMPACT_COLOR["Monitor only"]).toBe("#6B7280"); // neutral grey
    // Reserved severity tiers must never be reused as an impact-level colour.
    const hues = Object.values(IMPACT_COLOR).map((h) => h.toUpperCase());
    expect(hues).not.toContain("#A33232"); // Extreme-only
    expect(hues).not.toContain("#1B6B7A"); // Insignificant-only
    // Direct is the highest-ranked impact level.
    expect(IMPACT_RANK["Direct impact"]).toBeGreaterThan(IMPACT_RANK["Indirect impact"]);
    expect(IMPACT_RANK["Indirect impact"]).toBeGreaterThan(IMPACT_RANK["Monitor only"]);
  });

  it("derives ONE incident's impact level from its own words, not severity/count", () => {
    // Confirmed operational effect (closed road, halted production) → Direct impact,
    // regardless of how the row was severity-graded.
    expect(impactForIncident({ title: "Protesters block the toll road" })).toBe("Direct impact");
    expect(impactForIncident({ title: "Fire halts production at Bekasi plant" })).toBe(
      "Direct impact",
    );
    expect(impactForIncident({ title: "Power outage cripples Java factories" })).toBe(
      "Direct impact",
    );
    // Unrest / security activity with no confirmed disruption → Indirect impact.
    expect(impactForIncident({ title: "Gunmen ambush a convoy" })).toBe("Indirect impact");
    expect(impactForIncident({ title: "Protest rally clears in Medan" })).toBe("Indirect impact");
    // A natural hazard is indirect → Indirect impact.
    expect(impactForIncident({ title: "Flood hits the district" })).toBe("Indirect impact");
    // Isolated crime / policing with no unrest or security dimension → Monitor only,
    // however severe the wording sounds.
    expect(impactForIncident({ title: "Man arrested for theft" })).toBe("Monitor only");
    expect(impactForIncident({ title: "Quarterly economic update" })).toBe("Monitor only");
  });

  // The owner's Indonesia-map corrections: a relevant event in a client region is
  // NOT Direct unless the reporting states an operational consequence. A bare site
  // fire or utility outage is Indirect; a preparedness meeting or corruption probe
  // is Monitor only.
  it("does NOT over-classify relevant-but-indirect Indonesia events as Direct impact", () => {
    // Preparedness meeting (background activity) → Monitor only, not Direct/Indirect.
    expect(
      impactForIncident({ title: "Cilegon city government holds flood preparedness meeting" }),
    ).toBe("Monitor only");
    // Bare site fires → Indirect (no stated route/logistics/site-continuity effect).
    expect(impactForIncident({ title: "Semarang warehouse fire" })).toBe("Indirect impact");
    expect(impactForIncident({ title: "Kendari market fire" })).toBe("Indirect impact");
    // Power corruption / outage reporting → Indirect (a probe is not a live outage;
    // no confirmed operational effect stated).
    expect(
      impactForIncident({ title: "Sumatra power corruption case, outage reporting continues" }),
    ).toBe("Indirect impact");
    expect(
      impactForIncident({ title: "Kalimantan coal corruption probe amid power outage reporting" }),
    ).toBe("Indirect impact");
    // Isolated theft with police movement → Monitor only, and the copy must never
    // say "evacuated" (police MOVED a suspect; it was not a danger evacuation).
    const mataram = { title: "Mataram donation box theft suspect moved by police" };
    expect(impactForIncident(mataram)).toBe("Monitor only");
    expect(
      businessRelevance(mataram, impactForIncident(mataram)).toLowerCase(),
    ).not.toContain("evacuat");
  });

  // A site fire or outage DOES reach Direct once the reporting states a concrete
  // operational consequence (route closure, production halt, confirmed effect).
  it("promotes a site fire or outage to Direct only when a consequence is stated", () => {
    expect(impactForIncident({ title: "Fire shuts factory, production suspended" })).toBe(
      "Direct impact",
    );
    expect(
      impactForIncident({ title: "Warehouse fire forces evacuation and road closure" }),
    ).toBe("Direct impact");
    expect(impactForIncident({ title: "Blackout halts operations at Cikarang plant" })).toBe(
      "Direct impact",
    );
  });

  it("reads the worst impact level from a set (highest-impact event leads)", () => {
    expect(
      impactLevelForSet([
        { title: "Man arrested for theft" }, // Monitor only
        { title: "Gunmen ambush a convoy" }, // Indirect impact
      ]),
    ).toBe("Indirect impact");
    expect(
      impactLevelForSet([
        { title: "Gunmen ambush a convoy" }, // Indirect impact
        { title: "Protesters block the toll road" }, // Direct impact
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
    expect(businessRelevance({ title: "Fire halts production at plant" }, "Direct impact")).toBe(
      "Site, asset and business-continuity disruption",
    );
    expect(businessRelevance({ title: "Protesters block the toll road" }, "Direct impact")).toBe(
      "Confirmed movement and access disruption",
    );
    // Indirect impact wording is hedged (near / if operating nearby).
    expect(businessRelevance({ title: "Protest rally near the plant" }, "Indirect impact")).toBe(
      "Possible movement disruption near protest area",
    );
    expect(businessRelevance({ title: "Gunmen ambush a convoy" }, "Indirect impact")).toBe(
      "Possible staff movement concern if operating nearby",
    );
    // A bare site fire, classified Indirect, gets a site-specific hedged line.
    expect(businessRelevance({ title: "Semarang warehouse fire" }, "Indirect impact")).toBe(
      "Possible site or asset disruption if operating nearby",
    );
    expect(businessRelevance({ title: "Flood hits the district" }, "Indirect impact")).toBe(
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
    // Describes all three tiers in the revised logic.
    expect(OPERATIONAL_MAP_READ).toContain("Direct impact is used only where");
    expect(OPERATIONAL_MAP_READ).toContain("Indirect impact marks issues relevant to the operating environment");
    expect(OPERATIONAL_MAP_READ).toMatch(/Monitor only unless a clear operational effect is reported\.$/);
  });
});
