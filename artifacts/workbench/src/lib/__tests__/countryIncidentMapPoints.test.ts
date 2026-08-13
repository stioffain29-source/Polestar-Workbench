import { buildCountryIncidentMapPoints } from "../countryIncidentMapPoints";
import type { CountryFastFactsIncident } from "../countryFastFacts";

const inc = (over: Partial<CountryFastFactsIncident>): CountryFastFactsIncident => ({
  topic: "apac_local",
  title: "t",
  severity: "Low",
  occurredAt: "2026-08-10T00:00:00Z",
  ...over,
});

describe("buildCountryIncidentMapPoints", () => {
  it("drops rows without numeric coordinates (never invents locations)", () => {
    const pts = buildCountryIncidentMapPoints([
      inc({ title: "no coords" }),
      inc({ title: "has coords", latitude: -5.2, longitude: 145.8 }),
      inc({ title: "nan", latitude: NaN, longitude: 145.8 }),
    ]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lat: -5.2, lng: 145.8 });
  });

  it("coalesces identical coordinates into one dot with the worst severity", () => {
    const pts = buildCountryIncidentMapPoints([
      inc({ title: "A", severity: "Low", latitude: -6.2, longitude: 106.8 }),
      inc({ title: "B", severity: "High", latitude: -6.2, longitude: 106.8 }),
      inc({ title: "C", severity: "Moderate", latitude: -6.2, longitude: 106.8 }),
    ]);
    expect(pts).toHaveLength(1);
    expect(pts[0].severity).toBe("high");
    expect(pts[0].title).toMatch(/^3 incidents: /);
    expect(pts[0].title).toContain("A");
    expect(pts[0].title).toContain("B");
  });

  it("prefers displayTitle and keeps distinct points separate", () => {
    const pts = buildCountryIncidentMapPoints([
      inc({ title: "raw", displayTitle: "Clean English", latitude: 1, longitude: 2 }),
      inc({ title: "other", latitude: 3, longitude: 4, location: "Enga" }),
    ]);
    expect(pts).toHaveLength(2);
    expect(pts.find((p) => p.lat === 1)?.title).toBe("Clean English");
    expect(pts.find((p) => p.lat === 3)?.label).toBe("Enga");
  });
});
