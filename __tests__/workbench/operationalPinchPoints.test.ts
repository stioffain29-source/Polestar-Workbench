import {
  POSTURE_COLOR,
  POSTURE_ORDER,
  SEV_RANK,
  worstSeverityKey,
  postureFor,
  businessRelevance,
  OPERATIONAL_MAP_HEADING,
  OPERATIONAL_MAP_SUBTITLE,
  OPERATIONAL_MAP_READ,
} from "../../artifacts/workbench/src/lib/operationalPinchPoints";

describe("operationalPinchPoints — posture model", () => {
  it("orders and colours postures with brand-safe, non-severity hues", () => {
    expect(POSTURE_ORDER).toEqual(["Primary", "Secondary", "Watch"]);
    expect(POSTURE_COLOR.Primary).toBe("#0B0B3D"); // Midnight Blue
    expect(POSTURE_COLOR.Secondary).toBe("#4655FF"); // Electric Blue
    expect(POSTURE_COLOR.Watch).toBe("#6B7280"); // neutral grey
    // Reserved severity tiers must never be reused as a posture colour.
    const hues = Object.values(POSTURE_COLOR).map((h) => h.toUpperCase());
    expect(hues).not.toContain("#A33232"); // Extreme-only
    expect(hues).not.toContain("#1B6B7A"); // Insignificant-only
  });

  it("derives posture from frequency + business impact", () => {
    // count >= 2 → Primary regardless of severity
    expect(postureFor(2, "low")).toBe("Primary");
    expect(postureFor(3, "insignificant")).toBe("Primary");
    // single high/extreme → Primary
    expect(postureFor(1, "high")).toBe("Primary");
    expect(postureFor(1, "extreme")).toBe("Primary");
    // single moderate → Secondary
    expect(postureFor(1, "moderate")).toBe("Secondary");
    // single low/insignificant → Watch
    expect(postureFor(1, "low")).toBe("Watch");
    expect(postureFor(1, "insignificant")).toBe("Watch");
    // defensive: count 0 → Watch (unmapped locations are dropped upstream)
    expect(postureFor(0, "")).toBe("Watch");
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
    expect(OPERATIONAL_MAP_SUBTITLE).toBe("Reported operational pinch points for this period");
    expect(OPERATIONAL_MAP_READ).toMatch(/not standing background risk\.$/);
  });
});
