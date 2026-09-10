import { shippingTestHooks } from "../../lib/ingest/src/shipping";

// A vessel/chokepoint item that resolves only to a bare country centroid must
// remain unplotted until semantic physical geography is verified.
const { sanitizeMaritimeGeo } = shippingTestHooks;

describe("shipping maritime geo sanitization", () => {
  it("drops a Saudi Arabia country-centroid vessel item instead of plotting the desert", () => {
    // Bare country centroid: geocode() found no in-text city, so location is
    // null. This is exactly the "vessel in the centre of Saudi Arabia" bug.
    const bareCentroid = { latitude: 23.89, longitude: 45.08, location: null };
    const result = sanitizeMaritimeGeo(
      bareCentroid,
      "Vessel · Vessel attacks",
      "Saudi Arabia",
      "Unknown",
      "Houthi drone strikes tanker in the Red Sea off the coast near Saudi Arabia",
    );
    expect(result).toBeNull();
  });

  it("keeps a genuine physical city match", () => {
    const cityMatch = { latitude: 21.49, longitude: 39.19, location: "Jeddah" };
    const result = sanitizeMaritimeGeo(cityMatch);
    expect(result.location).toBe("Jeddah");
    expect(result.latitude).toBe(21.49);
  });

  it("does not synthesize a chokepoint centroid from a feed label", () => {
    const bareCentroid = { latitude: 15.55, longitude: 48.52, location: null };
    const result = sanitizeMaritimeGeo(
      bareCentroid,
      "Chokepoint · Bab el-Mandeb",
      "Yemen",
      "Yemen",
      "Houthi forces threaten shipping lanes",
    );
    expect(result).toBeNull();
  });

  it("does not accept a Singapore country centroid", () => {
    const singaporeCentroid = { latitude: 1.35, longitude: 103.82, location: null };
    const result = sanitizeMaritimeGeo(
      singaporeCentroid,
      "Sea robbery (ReCAAP)",
      "Singapore",
      "Singapore",
      "ReCAAP reports armed robbery incident aboard a bulk carrier",
    );
    expect(result).toBeNull();
  });

  it("does not synthesize Singapore Strait from a Malaysia feed default", () => {
    const bareCentroid = { latitude: 4.21, longitude: 101.98, location: null };
    const result = sanitizeMaritimeGeo(
      bareCentroid,
      "Vessel · Vessel attacks",
      "Malaysia",
      "Malaysia",
      "Pirates board bulk carrier in regional waters",
    );
    expect(result).toBeNull();
  });
});
