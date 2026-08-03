import {
  projectLatLngToPixel,
  clusterPointsByZoom,
  DEFAULT_CLUSTER_PIXEL_RADIUS,
  type Clusterable,
} from "@/lib/mapClustering";

// Regression coverage for the reported bug: incident clusters did not split
// apart as the analyst zoomed in, because the old grouping key was an exact
// lat/lng string match that never changed with zoom. These tests prove the
// pixel-distance-at-zoom clustering actually decomposes as zoom increases,
// while still merging genuinely-identical (fallback-centroid) coordinates at
// every zoom level.

function pt(over: Partial<Clusterable> = {}): Clusterable {
  return { id: "p", lat: 0, lng: 0, rating: "low", ...over };
}

describe("projectLatLngToPixel", () => {
  it("increasing zoom scales pixel distance between two points", () => {
    const a1 = projectLatLngToPixel(-6.2, 106.8, 4);
    const b1 = projectLatLngToPixel(-6.2, 107.1, 4);
    const a2 = projectLatLngToPixel(-6.2, 106.8, 12);
    const b2 = projectLatLngToPixel(-6.2, 107.1, 12);
    const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    const d2 = Math.hypot(b2.x - a2.x, b2.y - a2.y);
    expect(d2).toBeGreaterThan(d1);
  });
});

describe("clusterPointsByZoom", () => {
  const nearby = [
    pt({ id: "i-1", lat: -6.2, lng: 106.8, rating: "low" }),
    pt({ id: "i-2", lat: -6.2, lng: 107.1, rating: "high" }), // ~33km away
  ];

  it("merges two nearby-but-distinct points into one cluster at low zoom", () => {
    const result = clusterPointsByZoom(nearby, 6, DEFAULT_CLUSTER_PIXEL_RADIUS);
    expect(result).toHaveLength(1);
    expect(result[0].clusterSize).toBe(2);
    // Styled by the highest severity present in the group.
    expect(result[0].rating).toBe("high");
  });

  it("splits the SAME two points into individual markers once zoomed in far enough", () => {
    const result = clusterPointsByZoom(nearby, 12, DEFAULT_CLUSTER_PIXEL_RADIUS);
    expect(result).toHaveLength(2);
    expect(result.every((p) => !p.clusterSize)).toBe(true);
    // Each point renders at its own true coordinate — nothing fabricated.
    expect(result.map((p) => p.id).sort()).toEqual(["i-1", "i-2"]);
  });

  it("always merges points sharing the exact same fallback coordinate, at any zoom", () => {
    const stacked = [
      pt({ id: "i-a", lat: -2.5, lng: 140.7, rating: "low" }),
      pt({ id: "i-b", lat: -2.5, lng: 140.7, rating: "moderate" }),
      pt({ id: "i-c", lat: -2.5, lng: 140.7, rating: "insignificant" }),
    ];
    for (const zoom of [2, 6, 10, 16]) {
      const result = clusterPointsByZoom(stacked, zoom);
      expect(result).toHaveLength(1);
      expect(result[0].clusterSize).toBe(3);
    }
  });

  it("leaves a single isolated point unchanged (no clusterSize)", () => {
    const result = clusterPointsByZoom([pt({ id: "solo" })], 8);
    expect(result).toEqual([pt({ id: "solo" })]);
  });

  it("returns an empty array for an empty input", () => {
    expect(clusterPointsByZoom([], 8)).toEqual([]);
  });
});
