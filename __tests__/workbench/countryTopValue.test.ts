import {
  scoreIncidentValue,
  scoreClusterValue,
} from "@/lib/countryTopValue";

describe("scoreIncidentValue — signals", () => {
  it("detects fatalities and injuries", () => {
    const r = scoreIncidentValue({ title: "Three killed, ten injured in clash" });
    expect(r.signals).toEqual(expect.arrayContaining(["fatalities", "injuries"]));
  });

  it("detects evacuation", () => {
    expect(
      scoreIncidentValue({ title: "Hundreds evacuated as floodwaters rise" }).signals,
    ).toContain("evacuation");
  });

  it("detects a MAJOR fire only when fire AND scale are present", () => {
    expect(
      scoreIncidentValue({ title: "Massive blaze guts warehouse" }).signals,
    ).toContain("major-fire");
    // A small fire with no scale cue does not earn the major-fire signal.
    expect(
      scoreIncidentValue({ title: "Small fire at kiosk quickly put out" }).signals,
    ).not.toContain("major-fire");
    // Scale words with no fire do not earn it either.
    expect(
      scoreIncidentValue({ title: "Massive crowd gathers for festival" }).signals,
    ).not.toContain("major-fire");
  });

  it("detects transport, road, security and protest disruption", () => {
    expect(
      scoreIncidentValue({ title: "Airport flights cancelled after incident" }).signals,
    ).toContain("transport-impact");
    expect(
      scoreIncidentValue({ title: "Highway blocked by landslide" }).signals,
    ).toContain("road-closure");
    expect(
      scoreIncidentValue({ title: "Curfew imposed as troops deployed" }).signals,
    ).toContain("security-deployment");
    expect(
      scoreIncidentValue({ title: "General strike brings city to a standstill" }).signals,
    ).toContain("protest-disruption");
  });

  it("detects regulatory-with-business-impact and commercial proximity", () => {
    const r = scoreIncidentValue({ title: "Regulator suspends licence of factory" });
    expect(r.signals).toEqual(
      expect.arrayContaining(["regulatory-business", "commercial-proximity"]),
    );
  });

  it("a routine, low-severity item with no operational signal scores low", () => {
    const r = scoreIncidentValue({ title: "Council debates new park bylaw", severityRank: 1 });
    expect(r.signals).toHaveLength(0);
    expect(r.score).toBeCloseTo(1.5); // severity contribution only
  });
});

describe("value scoring ranks operationally consequential stories above a bare high severity", () => {
  it("a deadly, transport-disrupting event outranks a high-severity but inert one", () => {
    const consequential = scoreIncidentValue({
      title: "Two killed as explosion forces airport evacuation",
      severityRank: 3, // High
    });
    const inertHigh = scoreIncidentValue({
      title: "Opposition figure criticises government policy",
      severityRank: 4, // Extreme by rating, but no operational signal
    });
    expect(consequential.score).toBeGreaterThan(inertHigh.score);
  });
});

describe("scoreClusterValue", () => {
  it("uses the best member and adds a capped corroboration bonus", () => {
    const single = scoreClusterValue([
      { title: "Massive blaze guts warehouse", severityRank: 3 },
    ]);
    const corroborated = scoreClusterValue([
      { title: "Massive blaze guts warehouse", severityRank: 3 },
      { title: "Warehouse fire update", severityRank: 3 },
      { title: "Footage shows warehouse blaze", severityRank: 3 },
    ]);
    expect(corroborated).toBeGreaterThan(single);
    // Corroboration bonus is capped (<= 1.5), so it never dwarfs the event itself.
    expect(corroborated - single).toBeLessThanOrEqual(1.5);
  });

  it("empty cluster scores zero", () => {
    expect(scoreClusterValue([])).toBe(0);
  });
});
