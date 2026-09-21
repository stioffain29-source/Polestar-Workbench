import {
  buildRegionalReportMap,
  REGIONAL_MARKER_SEPARATION,
} from "../../artifacts/workbench/src/lib/regionalReportMap";
import type { RegionalMapPoint } from "../../artifacts/workbench/src/lib/regionalWeekly";

const point = (label: string, lat: number, lng: number): RegionalMapPoint => ({
  label, lat, lng, title: `${label} development`, summary: "Saved evidence.",
  severity: "Moderate", eventDate: "2026-09-21",
});
const latestLocations = [
  point("Pakistan", 30.38, 69.35),
  point("Nepal", 28.39, 84.12),
  point("Japan", 36.2, 138.25),
  point("New Zealand (country-level)", -41.29, 174.78),
  point("Thailand", 6.43, 101.82),
  point("Nepal", 28.39, 84.12),
];

test("preserves all saved locations and ordering without rewriting their coordinates", () => {
  const snapshot = JSON.stringify(latestLocations);
  const layout = buildRegionalReportMap(latestLocations, "apac_weekly");
  expect(layout.markers).toHaveLength(6);
  expect(layout.markers.map((marker) => marker.number)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(layout.markers.map((marker) => marker.point)).toEqual(latestLocations);
  expect(JSON.stringify(latestLocations)).toBe(snapshot);
});

test("both Nepal markers are visible but share the same truthful geographic anchor", () => {
  const layout = buildRegionalReportMap(latestLocations, "apac_weekly");
  const first = layout.markers[1];
  const second = layout.markers[5];
  expect(first.anchorX).toBe(second.anchorX);
  expect(first.anchorY).toBe(second.anchorY);
  expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(REGIONAL_MARKER_SEPARATION - 0.01);
  expect(second.displaced).toBe(true);
});

test("every badge is inside the viewport and separated, including eight co-located developments", () => {
  const layout = buildRegionalReportMap(Array.from({ length: 8 }, () => point("Nepal", 28.39, 84.12)), "apac_weekly");
  layout.markers.forEach((marker, index) => {
    expect(marker.x).toBeGreaterThan(0);
    expect(marker.x).toBeLessThan(layout.width);
    expect(marker.y).toBeGreaterThan(0);
    expect(marker.y).toBeLessThan(layout.height);
    for (const previous of layout.markers.slice(0, index)) {
      expect(Math.hypot(marker.x - previous.x, marker.y - previous.y)).toBeGreaterThanOrEqual(REGIONAL_MARKER_SEPARATION - 0.01);
    }
  });
});

test("tiles and markers use Web Mercator rather than a stretched latitude/longitude drawing", () => {
  const layout = buildRegionalReportMap([point("Equator", 0, 100), point("30 N", 30, 100), point("60 N", 60, 100)], "apac_weekly");
  const [equator, lower, upper] = layout.markers;
  expect(equator.anchorX).toBe(lower.anchorX);
  expect(lower.anchorX).toBe(upper.anchorX);
  expect(lower.anchorY - upper.anchorY).toBeGreaterThan(equator.anchorY - lower.anchorY);
  expect(layout.tiles.length).toBeGreaterThan(0);
  for (const tile of layout.tiles) {
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.x).toBeLessThan(2 ** tile.z);
    expect(tile.y).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeLessThan(2 ** tile.z);
  }
});

test("Pacific locations on both sides of the date line remain nearby and visible", () => {
  const layout = buildRegionalReportMap([point("Fiji east", -17.8, 179), point("Fiji west", -17.8, -179)], "apac_weekly");
  const [east, west] = layout.markers;
  expect(Math.abs(east.anchorX - west.anchorX)).toBeLessThan(15);
  expect(east.anchorX).toBeGreaterThan(0);
  expect(west.anchorX).toBeLessThan(layout.width);
});

test("Middle East uses its own regional frame and stable numbering", () => {
  const layout = buildRegionalReportMap([point("Lebanon", 33.9, 35.5), point("Oman", 23.6, 58.4)], "middle_east_weekly");
  expect(layout.regionLabel).toBe("Middle East");
  expect(layout.markers[0].anchorX).toBeLessThan(layout.markers[1].anchorX);
  expect(layout.markers[0].anchorY).toBeLessThan(layout.markers[1].anchorY);
  expect(layout.scaleBar.width).toBeGreaterThan(20);
  expect(layout.scaleBar.width).toBeLessThanOrEqual(115);
});

test("rejects invalid saved coordinates rather than silently dropping a development", () => {
  expect(() => buildRegionalReportMap([point("Unknown", Number.NaN, 20)], "apac_weekly")).toThrow("invalid coordinates");
});

test("is deterministic across preview, refresh and PDF rendering", () => {
  expect(buildRegionalReportMap(latestLocations, "apac_weekly"))
    .toEqual(buildRegionalReportMap(latestLocations, "apac_weekly"));
});