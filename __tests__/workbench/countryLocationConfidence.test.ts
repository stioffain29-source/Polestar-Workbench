import {
  classifyLocationConfidence,
  summariseLocationConfidence,
} from "@/lib/countryLocationConfidence";

describe("classifyLocationConfidence", () => {
  it("returns exact for explicit coordinates", () => {
    expect(
      classifyLocationConfidence({ location: "-6.2088, 106.8456" }).confidence,
    ).toBe("exact");
    expect(
      classifyLocationConfidence({ title: "Blast near -6.175, 106.827", location: "" })
        .plottable,
    ).toBe(true);
  });

  it("returns good-local for a sub-city street / admin fix", () => {
    expect(
      classifyLocationConfidence({ location: "Jalan Sudirman, Jakarta" }).confidence,
    ).toBe("good-local");
    expect(
      classifyLocationConfidence({ location: "Kelurahan Menteng, Central Jakarta" })
        .plottable,
    ).toBe(true);
    expect(
      classifyLocationConfidence({ title: "Fire near Tanjung Priok berth 3", location: "" })
        .confidence,
    ).toBe("good-local");
  });

  it("treats a bare city / regency as city-only and NOT plottable", () => {
    const r = classifyLocationConfidence({
      title: "Fire destroys sandal factory",
      location: "Jakarta",
    });
    expect(r.confidence).toBe("city-only");
    expect(r.plottable).toBe(false);
  });

  it("does NOT plot just because a named premises is in the title (false precision)", () => {
    // We know WHAT (the sandal factory) but only the city centroid for WHERE.
    expect(
      classifyLocationConfidence({
        title: "Sandal factory blaze in East Jakarta",
        location: "East Jakarta",
      }).plottable,
    ).toBe(false);
  });

  it("returns province-only when only a region marker is named", () => {
    expect(
      classifyLocationConfidence({ location: "Enga Province" }).confidence,
    ).toBe("province-only");
    expect(
      classifyLocationConfidence({ location: "Jayawijaya Regency" }).plottable,
    ).toBe(false);
  });

  it("returns unknown when no place text is present", () => {
    const r = classifyLocationConfidence({ title: "Government announces reshuffle", location: "" });
    expect(r.confidence).toBe("unknown");
    expect(r.plottable).toBe(false);
  });
});

describe("summariseLocationConfidence", () => {
  it("counts plottable vs vague vs unknown", () => {
    const s = summariseLocationConfidence([
      { location: "Jalan Thamrin, Jakarta" }, // good-local
      { location: "-6.208, 106.845" }, // exact
      { location: "Jakarta" }, // city-only
      { location: "Papua Province" }, // province-only
      { title: "Cabinet reshuffle", location: "" }, // unknown
    ]);
    expect(s.total).toBe(5);
    expect(s.plottable).toBe(2);
    expect(s.vague).toBe(2);
    expect(s.unknown).toBe(1);
    expect(s.byConfidence["good-local"]).toBe(1);
    expect(s.byConfidence.exact).toBe(1);
  });
});
