/**
 * Static Energy Situation country visual shared by the report preview and PDF.
 *
 * The monitor's CountryChoroplethMap is intentionally interactive Leaflet and
 * cannot be mounted by the PDF export's off-screen renderer. This component
 * uses the same world GeoJSON and count-band primitives as that monitor, but
 * emits plain SVG so html2canvas can rasterise it deterministically.
 */

import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useId, useLayoutEffect, useRef, useState } from "react";
import worldCompleteGeo from "@/assets/worldComplete.geo.json";
import {
  COUNT_BANDS,
  countBandColor,
  featureCountryName,
} from "@/lib/cargoChoropleth";

const DUSK = "#363636";
const NAVY = "#0b0a3d";
const POLAR = "#e2e2e2";
const BORDER = "#8A94A6";
const EMPTY_FILL = "#f2f3f7";

type CountryFeatureProperties = { name?: string };
type CountryGeo = FeatureCollection<Geometry, CountryFeatureProperties>;

// This is deliberately a complete world, rather than the monitor's selected
// country scope. Painting a selected-country collection as the basemap makes
// every country that is not currently selected disappear from this report map.
const worldGeo = worldCompleteGeo as unknown as CountryGeo;

const SVG_WIDTH = 500;
const DEFAULT_MAP_HEIGHT = 300;
const MAP_PADDING = 12;

interface LongitudeBounds {
  min: number;
  max: number;
  center: number;
  span: number;
}

interface GeographicBounds {
  longitude: LongitudeBounds;
  minLat: number;
  maxLat: number;
}

interface MapProjection {
  width: number;
  height: number;
  centerLongitude: number;
  project: (lon: number, lat: number) => [number, number];
  projectUnwrapped: (lon: number, lat: number) => [number, number];
  unwrapLongitude: (lon: number) => number;
}

interface PlacedLabel {
  key: string;
  name: string;
  count: number;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function normaliseLongitude(lon: number): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Put a longitude on the copy of the globe nearest `center`. This is used for
 * both framing and paths so a focus around 180°E does not explode into a
 * 360-degree bounding box.
 */
function unwrapLongitude(lon: number, center: number): number {
  let unwrapped = normaliseLongitude(lon);
  while (unwrapped - center > 180) unwrapped -= 360;
  while (unwrapped - center < -180) unwrapped += 360;
  return unwrapped;
}

function walkCoordinates(
  coordinates: unknown,
  visit: (lon: number, lat: number) => void,
): void {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const coordinate of coordinates) walkCoordinates(coordinate, visit);
}

function featureCoordinates(
  feature: Feature<Geometry, CountryFeatureProperties>,
  visit: (lon: number, lat: number) => void,
): void {
  const geometry = feature.geometry as { coordinates?: unknown } | null;
  if (geometry && "coordinates" in geometry) {
    walkCoordinates(geometry.coordinates, visit);
  }
}

/**
 * Find the shortest circular longitude interval containing all coordinates.
 * Sorting longitudes on a circle and removing the largest empty gap handles
 * countries and data clusters that straddle the antimeridian.
 */
function circularLongitudeBounds(longitudes: number[]): LongitudeBounds | null {
  if (longitudes.length === 0) return null;
  const values = Array.from(
    new Set(
      longitudes
        .map((lon) => ((lon % 360) + 360) % 360)
        .map((lon) => Math.round(lon * 100) / 100),
    ),
  ).sort((a, b) => a - b);
  if (values.length === 1) {
    const center = normaliseLongitude(values[0]);
    return { min: center, max: center, center, span: 0 };
  }

  let largestGap = -1;
  let largestGapIndex = 0;
  for (let i = 0; i < values.length; i++) {
    const next = i === values.length - 1 ? values[0] + 360 : values[i + 1];
    const gap = next - values[i];
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = i;
    }
  }

  const span = Math.max(0, 360 - largestGap);
  const start = values[(largestGapIndex + 1) % values.length];
  const center = normaliseLongitude(start + span / 2);
  return {
    min: center - span / 2,
    max: center + span / 2,
    center,
    span,
  };
}

function boundsForFeatures(
  features: Feature<Geometry, CountryFeatureProperties>[],
): GeographicBounds | null {
  const longitudes: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const feature of features) {
    featureCoordinates(feature, (lon, lat) => {
      longitudes.push(lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
  }
  const longitude = circularLongitudeBounds(longitudes);
  if (!longitude || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return null;
  }
  return { longitude, minLat, maxLat };
}

function worldFallbackBounds(): GeographicBounds {
  const bounds = boundsForFeatures(worldGeo.features);
  return {
    // A full [-180, 180] extent keeps edge countries at the expected map
    // edges, while the latitude padding keeps the complete base geography
    // visible without adding an Antarctica-shaped empty feature.
    longitude: { min: -180, max: 180, center: 0, span: 360 },
    minLat: Math.max(-90, (bounds?.minLat ?? -60) - 4),
    maxLat: Math.min(90, (bounds?.maxLat ?? 85) + 4),
  };
}

/** Natural world aspect ratio: remove empty canvas, not geographic detail. */
export const ENERGY_REPORT_MAP_HEIGHT = (() => {
  const bounds = worldFallbackBounds();
  const latitudeSpan = bounds.maxLat - bounds.minLat;
  const midLatitude = (bounds.maxLat + bounds.minLat) / 2;
  const geographicWidth = 360 * Math.cos(midLatitude * Math.PI / 180);
  return Math.ceil((SVG_WIDTH - MAP_PADDING * 2) * latitudeSpan / geographicWidth + MAP_PADDING * 2);
})();

function countForFeature(
  name: string,
  intensity: Map<string, number>,
): number {
  const direct = intensity.get(name);
  if (direct !== undefined) return direct;

  // The monitor already folds UAE into the polygon spelling. These aliases
  // only make this renderer tolerant of an older saved report's spelling; the
  // caller's intensity map is never changed.
  const aliases: Record<string, string[]> = {
    UAE: ["United Arab Emirates"],
    "United States": ["United States of America"],
    "United States of America": ["United States"],
  };
  for (const alias of aliases[name] ?? []) {
    const count = intensity.get(alias);
    if (count !== undefined) return count;
  }
  return 0;
}

function buildProjection(
  bounds: GeographicBounds,
  width: number,
  height: number,
): MapProjection {
  const minLon = bounds.longitude.min;
  const maxLon = bounds.longitude.max;
  const centerLongitude = bounds.longitude.center;
  const minLat = bounds.minLat;
  const maxLat = bounds.maxLat;
  const lonSpan = Math.max(maxLon - minLon, 1);
  const latSpan = Math.max(maxLat - minLat, 1);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
  const geoWidth = lonSpan * lonScale;
  const geoHeight = latSpan;
  const scale = Math.min(
    Math.max(width - MAP_PADDING * 2, 1) / geoWidth,
    Math.max(height - MAP_PADDING * 2, 1) / geoHeight,
  );
  const drawnWidth = geoWidth * scale;
  const drawnHeight = geoHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const projectUnwrapped = (lon: number, lat: number): [number, number] => [
    offsetX + (lon - minLon) * lonScale * scale,
    offsetY + (maxLat - lat) * scale,
  ];
  const project = (lon: number, lat: number): [number, number] =>
    projectUnwrapped(unwrapLongitude(lon, centerLongitude), lat);

  return {
    width,
    height,
    centerLongitude,
    project,
    projectUnwrapped,
    unwrapLongitude: (lon) => unwrapLongitude(lon, centerLongitude),
  };
}

/**
 * A focus is useful for a compact activity cluster, but a zoomed map becomes
 * actively misleading when incidents span multiple continents. Keep the
 * thresholds geographic (not count-based) so changing the incident volume
 * does not change the map's meaning.
 */
function focusBounds(
  affectedFeatures: Feature<Geometry, CountryFeatureProperties>[],
): GeographicBounds | null {
  if (affectedFeatures.length === 0) return null;
  const raw = boundsForFeatures(affectedFeatures);
  if (!raw) return null;
  const rawLonSpan = raw.longitude.span;
  const rawLatSpan = raw.maxLat - raw.minLat;
  const clustered =
    affectedFeatures.length === 1 ||
    (rawLonSpan <= 150 && rawLatSpan <= 110);
  if (!clustered) return null;

  // Geographic padding gives a country on the edge enough breathing room for
  // its label. Minimum spans stop a single small country becoming unreadably
  // magnified, while the world fallback remains stable for dispersed data.
  const lonSpan = Math.max(rawLonSpan, 12);
  const latSpan = Math.max(rawLatSpan, 8);
  const lonPadding = Math.max(lonSpan * 0.2, 3);
  const latPadding = Math.max(latSpan * 0.2, 3);
  return {
    longitude: {
      min: raw.longitude.center - lonSpan / 2 - lonPadding,
      max: raw.longitude.center + lonSpan / 2 + lonPadding,
      center: raw.longitude.center,
      span: lonSpan + lonPadding * 2,
    },
    minLat: Math.max(-90, raw.minLat - latPadding),
    maxLat: Math.min(90, raw.maxLat + latPadding),
  };
}

function ringPath(
  ring: number[][],
  projection: MapProjection,
): string {
  if (ring.length === 0) return "";
  let path = "";
  let previousLongitude: number | null = null;
  ring.forEach(([lon, lat], index) => {
    let unwrapped = projection.unwrapLongitude(lon);
    if (previousLongitude !== null) {
      while (unwrapped - previousLongitude > 180) unwrapped -= 360;
      while (unwrapped - previousLongitude < -180) unwrapped += 360;
    }
    const [x, y] = projection.projectUnwrapped(unwrapped, lat);
    path += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    previousLongitude = unwrapped;
  });
  return `${path}Z`;
}

function projectedFeaturePath(
  feature: Feature<Geometry, CountryFeatureProperties>,
  projection: MapProjection,
): string {
  const geometry = feature.geometry as
    | { type: string; coordinates: number[][][] | number[][][][] }
    | null;
  if (!geometry) return "";
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][])
      .map((ring) => ringPath(ring, projection))
      .join("");
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][])
      .flatMap((polygon) => polygon.map((ring) => ringPath(ring, projection)))
      .join("");
  }
  return "";
}

function ringAnchor(
  ring: number[][],
  projection: MapProjection,
): { lon: number; lat: number; area: number } | null {
  if (ring.length < 3) return null;
  const points: Array<[number, number]> = [];
  let previousLongitude: number | null = null;
  for (const [lon, lat] of ring) {
    let unwrapped = projection.unwrapLongitude(lon);
    if (previousLongitude !== null) {
      while (unwrapped - previousLongitude > 180) unwrapped -= 360;
      while (unwrapped - previousLongitude < -180) unwrapped += 360;
    }
    points.push([unwrapped, lat]);
    previousLongitude = unwrapped;
  }
  const closed =
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1];
  const count = closed ? points.length - 1 : points.length;
  if (count < 3) return null;
  let twiceArea = 0;
  let centroidLon = 0;
  let centroidLat = 0;
  for (let i = 0; i < count; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % count];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    centroidLon += (x0 + x1) * cross;
    centroidLat += (y0 + y1) * cross;
  }
  if (twiceArea === 0) return null;
  return {
    lon: centroidLon / (3 * twiceArea),
    lat: centroidLat / (3 * twiceArea),
    area: Math.abs(twiceArea / 2),
  };
}

function featureAnchor(
  feature: Feature<Geometry, CountryFeatureProperties>,
  projection: MapProjection,
): [number, number] | null {
  const geometry = feature.geometry as
    | { type: string; coordinates: number[][][] | number[][][][] }
    | null;
  if (!geometry) return null;
  const rings: number[][][] =
    geometry.type === "Polygon"
      ? [(geometry.coordinates as number[][][])[0]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][]).map((polygon) => polygon[0])
        : [];
  let largest: { lon: number; lat: number; area: number } | null = null;
  for (const ring of rings) {
    const anchor = ringAnchor(ring, projection);
    if (anchor && (!largest || anchor.area > largest.area)) largest = anchor;
  }
  return largest
    ? projection.projectUnwrapped(largest.lon, largest.lat)
    : null;
}

function labelsOverlap(a: PlacedLabel, b: PlacedLabel): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2
  );
}

function clampLabel(label: PlacedLabel, width: number, height: number): void {
  label.x = Math.max(label.width / 2 + 2, Math.min(width - label.width / 2 - 2, label.x));
  label.y = Math.max(label.height / 2 + 2, Math.min(height - label.height / 2 - 2, label.y));
}

function resolveLabels(
  features: Feature<Geometry, CountryFeatureProperties>[],
  intensity: Map<string, number>,
  projection: MapProjection,
): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  features.forEach((feature, index) => {
    const name = featureCountryName(feature);
    const count = countForFeature(name, intensity);
    if (count <= 0) return;
    const anchor = featureAnchor(feature, projection);
    if (!anchor) return;
    const text = `${name}: ${count}`;
    labels.push({
      key: `affected-${name || index}`,
      name: text,
      count,
      anchorX: anchor[0],
      anchorY: anchor[1],
      x: anchor[0],
      y: anchor[1],
      width: Math.min(150, Math.max(30, text.length * 5.1 + 10)),
      height: 16,
    });
  });

  for (const label of labels) clampLabel(label, projection.width, projection.height);
  for (let iteration = 0; iteration < 10; iteration++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const first = labels[i];
        const second = labels[j];
        if (!labelsOverlap(first, second)) continue;
        const push = (first.height + second.height) / 2 - Math.abs(first.y - second.y) + 2;
        if (first.y <= second.y) {
          first.y -= push / 2;
          second.y += push / 2;
        } else {
          first.y += push / 2;
          second.y -= push / 2;
        }
        clampLabel(first, projection.width, projection.height);
        clampLabel(second, projection.width, projection.height);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return labels;
}

export interface EnergySituationVisualProps {
  intensity: Map<string, number>;
  /** Maximum viewport height; projection always preserves the full bounds. */
  mapHeight?: number;
  /** Preview only: fit to the remaining overview space after cards and BLUF. */
  fitToPage?: boolean;
}

export function EnergySituationVisual({
  intensity,
  mapHeight = DEFAULT_MAP_HEIGHT,
  fitToPage = false,
}: EnergySituationVisualProps) {
  const clipId = `energy-world-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(mapHeight);
  useLayoutEffect(() => {
    if (!fitToPage) return;
    const root = rootRef.current;
    const slot = root?.closest<HTMLElement>("[data-energy-map-slot]");
    if (!root || !slot) return;
    const measure = () => {
      const legendHeight = root.lastElementChild?.getBoundingClientRect().height ?? 36;
      const section = root.closest<HTMLElement>(".report-section");
      const trailing = section ? parseFloat(getComputedStyle(section).marginBottom) || 0 : 0;
      const space = slot.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      setAvailableHeight(Math.max(120, Math.min(mapHeight, Math.floor(space - legendHeight - trailing - 4))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(root);
    let active = true;
    document.fonts.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, [fitToPage, mapHeight, intensity.size]);
  if (intensity.size === 0) {
    return (
      <div
        style={{
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        No identified countries available for this view.
      </div>
    );
  }

  // Use one stable world frame, with the seam at ±180°. A data-centred
  // longitude frame cut through the Americas; independently unwrapped
  // country rings then placed North and South America on opposite edges.
  const bounds = worldFallbackBounds();
  const viewportHeight = Math.max(120, fitToPage ? availableHeight : mapHeight);
  const projection = buildProjection(bounds, SVG_WIDTH, viewportHeight);
  const [worldLeft, worldTop] = projection.projectUnwrapped(-180, bounds.maxLat);
  const [worldRight, worldBottom] = projection.projectUnwrapped(180, bounds.minLat);
  const worldWidth = worldRight - worldLeft;

  return (
    <div
      ref={rootRef}
      data-report-raster-scale="4"
      style={{
        color: DUSK,
        fontFamily: "Roboto, sans-serif",
        width: "100%",
      }}
    >
      <svg
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        width={SVG_WIDTH}
        height={viewportHeight}
        preserveAspectRatio="xMidYMid meet"
        style={{
          background: "#f8f9fb",
          border: `1px solid ${POLAR}`,
          boxSizing: "border-box",
          display: "block",
          maxWidth: SVG_WIDTH,
          width: "100%",
        }}
      >
        <rect
          x="0"
          y="0"
          width={projection.width}
          height={projection.height}
          fill="#f8f9fb"
        />
        <defs>
          <clipPath id={clipId}>
            <rect x={worldLeft} y={worldTop} width={worldWidth} height={worldBottom - worldTop} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
        {worldGeo.features.flatMap((feature, index) => {
          const country = featureCountryName(feature);
          const count = countForFeature(country, intensity);
          const fill = countBandColor(count);
          const path = projectedFeaturePath(feature, projection);
          // Date-line-crossing Russia/Fiji rings extend beyond one edge.
          // Wrapped copies, clipped to the SAME world rectangle, preserve
          // those fragments without connecting them across the ocean.
          return [-1, 0, 1].map((copy) => (
            <path
              key={`${country || "country"}-${index}-${copy}`}
              data-country={country}
              data-world-copy={copy}
              transform={`translate(${copy * worldWidth} 0)`}
              d={path}
              fill={fill ?? EMPTY_FILL}
              fillOpacity={fill ? 0.9 : 1}
              stroke={BORDER}
              strokeWidth={0.6}
            />
          ));
        })}
        </g>
      </svg>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          padding: "8px 4px 2px",
          fontSize: 10,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            color: NAVY,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Energy incidents
        </span>
        {COUNT_BANDS.map((band) => (
          <span
            key={band.label}
            style={{ alignItems: "center", display: "inline-flex", gap: 4 }}
          >
            <span
              style={{
                background: band.color,
                border: `1px solid ${BORDER}`,
                display: "inline-block",
                height: 10,
                width: 10,
              }}
            />
            <span>{band.label}</span>
          </span>
        ))}
        <span style={{ alignItems: "center", display: "inline-flex", gap: 4 }}>
          <span
            style={{
              background: "transparent",
              border: `1px solid ${BORDER}`,
              display: "inline-block",
              height: 10,
              width: 10,
            }}
          />
          <span>0 (none)</span>
        </span>
      </div>
    </div>
  );
}

export default EnergySituationVisual;