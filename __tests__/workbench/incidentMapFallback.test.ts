import { incidentMapFallback } from "../../artifacts/workbench/src/lib/incidentMapFallback";

describe("incidentMapFallback", () => {
  it("uses a recognised state capital before the national capital", () => {
    expect(incidentMapFallback("Australia", "Industrial action affects Queensland freight")).toEqual({
      latitude: -27.47,
      longitude: 153.03,
      location: "Brisbane (state-capital fallback)",
    });
  });

  it("uses the country capital when no locality is available", () => {
    expect(incidentMapFallback("New Zealand", "A national protest was announced")).toEqual({
      latitude: -41.29,
      longitude: 174.78,
      location: "Wellington (capital fallback)",
    });
  });

  it("covers countries previously absent from the map", () => {
    expect(incidentMapFallback("Cambodia")?.location).toBe("Phnom Penh (capital fallback)");
    expect(incidentMapFallback("Laos")?.location).toBe("Vientiane (capital fallback)");
    expect(incidentMapFallback("Vietnam")?.location).toBe("Hanoi (capital fallback)");
  });

  it("does not fabricate a fallback for an unknown country", () => {
    expect(incidentMapFallback("Unknown")).toBeNull();
  });
});