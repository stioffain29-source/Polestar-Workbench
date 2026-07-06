import {
  IMPACT_COLOR,
  IMPACT_ORDER,
  SEV_RANK,
  worstSeverityKey,
  impactLevelFor,
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
  });

  it("derives impact level from frequency + business impact", () => {
    // count >= 2 → Direct impact regardless of severity
    expect(impactLevelFor(2, "low")).toBe("Direct impact");
    expect(impactLevelFor(3, "insignificant")).toBe("Direct impact");
    // a SINGLE report is never Direct impact, however severe — indirect until repeated
    expect(impactLevelFor(1, "high")).toBe("Possible impact");
    expect(impactLevelFor(1, "extreme")).toBe("Possible impact");
    // single moderate → Possible impact
    expect(impactLevelFor(1, "moderate")).toBe("Possible impact");
    // single low/insignificant → Monitor only
    expect(impactLevelFor(1, "low")).toBe("Monitor only");
    expect(impactLevelFor(1, "insignificant")).toBe("Monitor only");
    // defensive: count 0 → Monitor only (unmapped locations are dropped upstream)
    expect(impactLevelFor(0, "")).toBe("Monitor only");
  });

  it("reads the worst severity key from a set", () => {
    expect(SEV_RANK.extreme).toBeGreaterThan(SEV_RANK.high);
    expect(worstSeverityKey([{ severity: "low" }, { severity: "high" }, { severity: "moderate" }])).toBe("high");
    expect(worstSeverityKey([])).toBe("");
  });

  it("labels business relevance from the headline first, topic as fallback", () => {
    expect(businessRelevance({ title: "Fire at Jakarta warehouse" })).toBe(
      "Site, asset and business-continuity exposure",
    );
    expect(businessRelevance({ title: "Protesters block the toll road" })).toBe(
      "Movement and site-access disruption",
    );
    expect(businessRelevance({ title: "Gunmen ambush a convoy" })).toBe(
      "Security and personnel-safety exposure",
    );
    // No headline cue → topic fallback.
    expect(businessRelevance({ topic: "shipping", title: "Quarterly update" })).toBe(
      "Logistics and movement disruption",
    );
    // Unknown topic and no cue → generic monitoring label (never fabricated risk).
    expect(businessRelevance({ topic: "mystery", title: "Quarterly update" })).toBe(
      "Operational monitoring relevance",
    );
    // displayTitle (translated) is considered too.
    expect(
      businessRelevance({ topic: "flashpoint", title: "banjir bandang", displayTitle: "Flash flood hits district" }),
    ).toBe("Utilities and site-continuity disruption");
  });

  it("pins the fixed owner-brief map wording", () => {
    expect(OPERATIONAL_MAP_HEADING).toBe("Operational Map");
    expect(OPERATIONAL_MAP_SUBTITLE).toBe("Reported operational issues this period");
    expect(OPERATIONAL_MAP_READ).toMatch(/not standing background risk\.$/);
  });
});
