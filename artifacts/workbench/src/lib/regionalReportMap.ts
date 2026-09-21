import type { RegionalMapPoint } from "./regionalWeekly";

export interface RegionalReportMapTile {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
}

export interface RegionalReportMapMarker {
  number: number;
  point: RegionalMapPoint;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  displaced: boolean;
}

export interface RegionalReportMapLayout {
  width: number;
  height: number;
  zoom: number;
  tiles: RegionalReportMapTile[];
  markers: RegionalReportMapMarker[];
  scaleBar: { width: number; label: string };
  regionLabel: string;
}

const MERCATOR_LIMIT = 85.05112878;
export const REGIONAL_MARKER_SEPARATION = 38;
const MARKER_EDGE = 24;

function mercatorY(lat: number): number {
  const radians = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2;
}

function unwrapLongitude(lng: number, reference: number): number {
  return lng + 360 * Math.round((reference - lng) / 360);
}

function placeMarker(
  anchorX: number,
  anchorY: number,
  placed: RegionalReportMapMarker[],
  width: number,
  height: number,
): { x: number; y: number } {
  const fits = (x: number, y: number) =>
    x >= MARKER_EDGE && x <= width - MARKER_EDGE &&
    y >= MARKER_EDGE && y <= height - MARKER_EDGE &&
    placed.every((marker) => Math.hypot(marker.x - x, marker.y - y) >= REGIONAL_MARKER_SEPARATION - 0.01);

  if (fits(anchorX, anchorY)) return { x: anchorX, y: anchorY };
  // Moving the numbered badge does not move its geographic anchor. The
  // renderer connects every displaced badge back to the original coordinate.
  const angles = [-45, -135, 45, 135, 0, 180, -90, 90, -22.5, -157.5, 22.5, 157.5, -67.5, -112.5, 67.5, 112.5];
  for (let ring = 1; ring <= 8; ring++) {
    for (const angle of angles) {
      const rad = angle * Math.PI / 180;
      const x = anchorX + Math.cos(rad) * REGIONAL_MARKER_SEPARATION * ring;
      const y = anchorY + Math.sin(rad) * REGIONAL_MARKER_SEPARATION * ring;
      if (fits(x, y)) return { x, y };
    }
  }
  throw new Error("The regional map has too many overlapping locations to display clearly.");
}

/**
 * One Web Mercator layout for screen and PDF. Map tiles, exact anchors,
 * displaced badges and numbering all share the same projection.
 *
 * Canonical points are never changed, sorted, merged or truncated here.
 */
export function buildRegionalReportMap(
  points: readonly RegionalMapPoint[],
  topic: string | undefined,
  width = 680,
  height = 560,
): RegionalReportMapLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240) {
    throw new Error("The regional map requires a readable viewport.");
  }
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new Error(`The saved map location for ${point.label || point.title} has invalid coordinates.`);
    }
  }

  const apac = topic === "apac_weekly";
  const reference = apac ? 120 : 45;
  let west = apac ? 58 : 25;
  let east = apac ? 186 : 65;
  let south = apac ? -49 : 10;
  let north = apac ? 55 : 42;
  const located = points.map((point) => ({
    point,
    lng: unwrapLongitude(point.lng, reference),
  }));
  // Keep regional context, while retaining Pacific/dateline and edge locations
  // instead of clipping a valid saved development out of the map.
  for (const { point, lng } of located) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const minX = (west + 180) / 360;
  const maxX = (east + 180) / 360;
  const minY = mercatorY(north);
  const maxY = mercatorY(south);
  const padding = 46;
  const worldSize = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxY - minY),
  );
  // Sample the next more detailed tile level so this regional view retains
  // country labels rather than only the continent names of coarse zoom tiles.
  const zoom = Math.max(1, Math.min(8, Math.ceil(Math.log2(worldSize / 256))));
  const tileCount = 2 ** zoom;
  const tileSize = worldSize / tileCount;
  const left = ((minX + maxX) / 2) * worldSize - width / 2;
  const top = ((minY + maxY) / 2) * worldSize - height / 2;
  const tiles: RegionalReportMapTile[] = [];
  for (let y = Math.floor(top / tileSize); y <= Math.floor((top + height) / tileSize); y++) {
    if (y < 0 || y >= tileCount) continue;
    for (let x = Math.floor(left / tileSize); x <= Math.floor((left + width) / tileSize); x++) {
      tiles.push({
        key: `${zoom}:${x}:${y}`,
        z: zoom,
        x: ((x % tileCount) + tileCount) % tileCount,
        y,
        left: x * tileSize - left,
        top: y * tileSize - top,
        size: tileSize,
      });
    }
  }
  const markers: RegionalReportMapMarker[] = [];
  located.forEach(({ point, lng }, index) => {
    const anchorX = ((lng + 180) / 360) * worldSize - left;
    const anchorY = mercatorY(point.lat) * worldSize - top;
    const { x, y } = placeMarker(anchorX, anchorY, markers, width, height);
    markers.push({
      number: index + 1,
      point,
      x,
      y,
      anchorX,
      anchorY,
      displaced: Math.hypot(x - anchorX, y - anchorY) > 1,
    });
  });

  const centreY = (minY + maxY) / 2;
  const centreLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * centreY)));
  const kmPerPixel = 40_075.0167 * Math.cos(centreLat) / worldSize;
  const targetKm = kmPerPixel * 115;
  const magnitude = 10 ** Math.floor(Math.log10(targetKm));
  const scaleKm = (targetKm / magnitude >= 5 ? 5 : targetKm / magnitude >= 2 ? 2 : 1) * magnitude;
  return {
    width,
    height,
    zoom,
    tiles,
    markers,
    scaleBar: {
      width: scaleKm / kmPerPixel,
      label: `${scaleKm.toLocaleString("en-US", { maximumFractionDigits: 0 })} km`,
    },
    regionLabel: apac ? "Asia–Pacific" : "Middle East",
  };
}