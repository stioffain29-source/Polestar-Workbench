/**
 * @jest-environment jsdom
 */
import L from "leaflet";
import { boundsForPoints, flooredZoom } from "../../artifacts/workbench/src/components/CountryReportMap";

// Regression guard for the "marker '12' sitting in blank/unlabelled terrain"
// bug: a country report with only ONE plotted location (all incidents for the
// period sharing one coordinate) used to call `map.setView(point, 8|6)`,
// zooming in on that single point with zero surrounding context. If that
// coordinate isn't next to a labelled town on the basemap (open country,
// coastline, forest), the view rendered as a mostly blank/pale tile with no
// visible place context, even though the underlying coordinate was correct.
//
// The fix pads a lone point out into a small bounding box before it reaches
// Leaflet's fitBounds, so a single marker always gets the same guaranteed
// minimum geographic context (nearby coastline, place labels) that
// multi-marker reports already receive from fitBounds' own padding.
describe("boundsForPoints (Operational Map lone-marker context)", () => {
  it("pads a single point out into a non-zero bounding box", () => {
    const lat = -6.31;
    const lng = 143.96;
    const bounds = boundsForPoints([[lat, lng]]);

    // A non-zero box means fitBounds computes a real zoom level instead of
    // snapping to the fixed high zoom that produced the blank-terrain bug.
    expect(bounds.getSouthWest().lat).toBeLessThan(lat);
    expect(bounds.getNorthEast().lat).toBeGreaterThan(lat);
    expect(bounds.getSouthWest().lng).toBeLessThan(lng);
    expect(bounds.getNorthEast().lng).toBeGreaterThan(lng);

    // The lone point must still be contained within its own padded box.
    expect(bounds.contains([lat, lng])).toBe(true);
  });

  it("keeps the box small enough to stay a regional (not country-wide) view", () => {
    const bounds = boundsForPoints([[1, 1]]);
    const latSpan = bounds.getNorthEast().lat - bounds.getSouthWest().lat;
    const lngSpan = bounds.getNorthEast().lng - bounds.getSouthWest().lng;
    // 1.2 degrees square (±0.6°) — enough context without regressing back to
    // a full country view for a single incident.
    expect(latSpan).toBeCloseTo(1.2, 5);
    expect(lngSpan).toBeCloseTo(1.2, 5);
  });

  it("passes multi-point bounds through unchanged (existing multi-marker behaviour)", () => {
    const points: L.LatLngExpression[] = [
      [-6.2, 106.8],
      [-7.8, 110.4],
    ];
    const bounds = boundsForPoints(points);
    const expected = L.latLngBounds(points);
    expect(bounds.getSouthWest().lat).toBeCloseTo(expected.getSouthWest().lat, 6);
    expect(bounds.getSouthWest().lng).toBeCloseTo(expected.getSouthWest().lng, 6);
    expect(bounds.getNorthEast().lat).toBeCloseTo(expected.getNorthEast().lat, 6);
    expect(bounds.getNorthEast().lng).toBeCloseTo(expected.getNorthEast().lng, 6);
  });
});

// Regression guard for the "Thailand map shows Yemen to Malaysia" bug: a
// tall/narrow point spread (e.g. Chiang Rai in the north to Narathiwat in the
// south, all within ~2 degrees of longitude) forced fitBounds to zoom out far
// enough to fit the full latitude spread, and the same zoom then rendered a
// slice of longitude many times wider than the incidents actually span,
// because fitBounds always fills the whole (wide/short) container rather
// than cropping to just the bounds box. The fix reuses each country's own
// hand-tuned COUNTRY_VIEW zoom (already used for the zero-incident fallback)
// as a floor: fitBounds may still zoom in past it, but never out past it.
describe("flooredZoom (Operational Map zoom-out cap)", () => {
  it("raises a too-far-zoomed-out result up to the country floor", () => {
    // A wide latitude spread (Chiang Rai to Narathiwat) forces fitBounds to a
    // very low zoom in a wide/short container -- simulated here as zoom 3.
    expect(flooredZoom(3, 5)).toBe(5);
  });

  it("leaves an already-tight zoom untouched when it is above the floor", () => {
    // A tightly clustered report (e.g. all incidents in central Bangkok)
    // should keep its own, more zoomed-in, fitBounds result.
    expect(flooredZoom(8, 5)).toBe(8);
  });

  it("is a no-op for countries with no configured floor", () => {
    expect(flooredZoom(2, null)).toBe(2);
    expect(flooredZoom(2, undefined)).toBe(2);
  });

  it("treats an exact match at the floor as unchanged", () => {
    expect(flooredZoom(5, 5)).toBe(5);
  });
});
