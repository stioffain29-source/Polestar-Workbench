import { geocode } from "@workspace/ingest";

describe("geocode", () => {
  it("resolves a known city inside the attributed country", () => {
    const result = geocode("India", "Protest erupts in Mumbai");
    expect(result).toEqual({
      latitude: 19.08,
      longitude: 72.88,
      location: "Mumbai",
    });
  });

  it("falls back to country centroid when no city matches", () => {
    const result = geocode("Thailand", "Protest outside parliament");
    expect(result).toEqual({
      latitude: 15.87,
      longitude: 100.99,
      location: null,
    });
  });

  it("ignores foreign cities that are too far from the attributed country", () => {
    const result = geocode("Iran", "Missile strike; analysts cite Taipei tensions");
    expect(result).toEqual({
      latitude: 32.43,
      longitude: 53.69,
      location: null,
    });
  });

  it("returns null for countries outside the lookup table", () => {
    expect(geocode("Nigeria", "Incident in Lagos")).toBeNull();
  });

  it("anchors combined Papua tags on the first semicolon component", () => {
    const result = geocode("West Papua; Papua New Guinea", "Clash in Jayapura");
    expect(result?.location).toBe("Jayapura");
    expect(result?.latitude).toBe(-2.53);
  });

  it("places a Crimea/Balaklava energy incident within Ukraine", () => {
    const result = geocode(
      "Ukraine",
      "Massive blackout in Crimea after a likely strike on the Balaklava Thermal Power Plant",
    );
    expect(result).toEqual({
      latitude: 44.5,
      longitude: 33.6,
      location: "Balaklava",
    });
  });
});
