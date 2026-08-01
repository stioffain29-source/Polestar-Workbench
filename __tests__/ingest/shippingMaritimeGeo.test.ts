import { shippingTestHooks } from "../../lib/ingest/src/shipping";

// Locks the bug report: a vessel/chokepoint item that resolves to a bare
// country centroid (or a non-coastal city) must never be plotted there — a
// tanker cannot be sailing through the middle of the Arabian desert. It must
// fall through to a real chokepoint centroid instead.
const { sanitizeMaritimeGeo } = shippingTestHooks;

describe("shipping maritime geo sanitization", () => {
  it("clamps a Saudi Arabia country-centroid vessel item onto the Red Sea, not the desert", () => {
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
    expect(result.location).toBe("Red Sea");
    expect(result.latitude).not.toBe(23.89);
    expect(result.longitude).not.toBe(45.08);
  });

  it("keeps a genuine coastal-city match (Jeddah) for a vessel item", () => {
    const cityMatch = { latitude: 21.49, longitude: 39.19, location: "Jeddah" };
    const result = sanitizeMaritimeGeo(
      cityMatch,
      "Vessel · Vessel attacks",
      "Saudi Arabia",
      "Unknown",
      "Tanker attacked near Jeddah port",
    );
    expect(result.location).toBe("Jeddah");
    expect(result.latitude).toBe(21.49);
  });

  it("resolves a Chokepoint feed to its own strait centroid even with no city match", () => {
    const bareCentroid = { latitude: 15.55, longitude: 48.52, location: null };
    const result = sanitizeMaritimeGeo(
      bareCentroid,
      "Chokepoint · Bab el-Mandeb",
      "Yemen",
      "Yemen",
      "Houthi forces threaten shipping lanes",
    );
    expect(result.location).toBe("Bab el-Mandeb");
  });

  it("leaves the Singapore country centroid alone (island state, already coastal)", () => {
    const singaporeCentroid = { latitude: 1.35, longitude: 103.82, location: null };
    const result = sanitizeMaritimeGeo(
      singaporeCentroid,
      "Sea robbery (ReCAAP)",
      "Singapore",
      "Singapore",
      "ReCAAP reports armed robbery incident aboard a bulk carrier",
    );
    expect(result.latitude).toBe(1.35);
    expect(result.longitude).toBe(103.82);
  });

  it("falls back to the Singapore Strait for a Malaysia-defaulted vessel item with no city match", () => {
    const bareCentroid = { latitude: 4.21, longitude: 101.98, location: null };
    const result = sanitizeMaritimeGeo(
      bareCentroid,
      "Vessel · Vessel attacks",
      "Malaysia",
      "Malaysia",
      "Pirates board bulk carrier in regional waters",
    );
    expect(result.location).toBe("Singapore Strait");
  });
});
