import type { FeatureCollection, Geometry } from "geojson";
import cargoScopeCountriesGeo from "../assets/cargoScopeCountries.geo.json" with { type: "json" };
import worldChoroplethExtrasGeo from "../assets/worldChoroplethExtras.geo.json" with { type: "json" };
import monitorChoroplethExtrasGeo from "../assets/monitorChoroplethExtras.geo.json" with { type: "json" };

// The countries that form the visible bounds of the Shipping Watch map.
// This trims out distant global countries so the projection zooms in on the
// Middle East / Indian Ocean choke points.
const REGION_COUNTRIES = new Set([
  "Saudi Arabia", "Yemen", "Oman", "Iran", "Egypt", "Sudan",
  "Somalia", "Djibouti", "Eritrea", "Israel", "Jordan",
  "UAE", "United Arab Emirates", "India", "Pakistan", "Malaysia",
  "Singapore", "Indonesia", "Sri Lanka", "Kenya", "Qatar", "Kuwait",
  "Iraq", "Bahrain", "Syria", "Lebanon", "Turkey", "Ethiopia",
  "Tanzania", "Mozambique", "Madagascar", "Bangladesh", "Myanmar", "Thailand", "Vietnam"
]);

const allFeatures = [
  ...(cargoScopeCountriesGeo as unknown as FeatureCollection<Geometry, { name?: string }>).features,
  ...(monitorChoroplethExtrasGeo as unknown as FeatureCollection<Geometry, { name?: string }>).features,
  ...(worldChoroplethExtrasGeo as unknown as FeatureCollection<Geometry, { name?: string }>).features,
];

export const SHIPPING_REGIONAL_GEO: FeatureCollection<Geometry, { name?: string }> = {
  type: "FeatureCollection",
  features: allFeatures.filter(f => f.properties?.name && REGION_COUNTRIES.has(f.properties.name)),
};

export interface ShippingRegionalMapPoint {
  key: string;
  label: string;
  longitude: number;
  latitude: number;
}

export const SHIPPING_REGIONAL_MAP_POINTS: ShippingRegionalMapPoint[] = [
  { key: "Strait of Hormuz", label: "Hormuz", longitude: 56.45, latitude: 26.56 },
  { key: "Bab el-Mandeb", label: "Bab el-Mandeb", longitude: 43.41, latitude: 12.65 },
  { key: "Red Sea", label: "Red Sea", longitude: 38.5, latitude: 21 },
  { key: "Suez Canal", label: "Suez", longitude: 32.34, latitude: 30.63 },
  { key: "Gulf of Aden", label: "Gulf of Aden", longitude: 47, latitude: 12 },
  { key: "Singapore Strait", label: "Singapore", longitude: 103.9, latitude: 1.2 },
  { key: "Malacca Strait", label: "Malacca", longitude: 99.5, latitude: 4 },
];

function extendBounds(
  coordinates: unknown,
  bounds: { minLongitude: number; maxLongitude: number; minLatitude: number; maxLatitude: number },
): void {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    bounds.minLongitude = Math.min(bounds.minLongitude, coordinates[0]);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, coordinates[0]);
    bounds.minLatitude = Math.min(bounds.minLatitude, coordinates[1]);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, coordinates[1]);
    return;
  }
  if (Array.isArray(coordinates)) {
    for (const child of coordinates) extendBounds(child, bounds);
  }
}

const mapBounds = {
  minLongitude: Number.POSITIVE_INFINITY,
  maxLongitude: Number.NEGATIVE_INFINITY,
  minLatitude: Number.POSITIVE_INFINITY,
  maxLatitude: Number.NEGATIVE_INFINITY,
};
for (const feature of SHIPPING_REGIONAL_GEO.features) {
  extendBounds((feature.geometry as { coordinates?: unknown } | null)?.coordinates, mapBounds);
}
for (const point of SHIPPING_REGIONAL_MAP_POINTS) {
  extendBounds([point.longitude, point.latitude], mapBounds);
}
export const SHIPPING_REGIONAL_MAP_BOUNDS = mapBounds;
export const SHIPPING_REGIONAL_MAP_LABEL_OFFSETS: Array<[number, number]> = [[32, -35], [-14, 56], [-20, -18], [10, -35], [85, 28], [0, 62], [-35, -40]];

export function projectShippingRegionalPoint(
  point: Pick<ShippingRegionalMapPoint, "longitude" | "latitude">,
  frame: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const { minLongitude, maxLongitude, minLatitude, maxLatitude } = SHIPPING_REGIONAL_MAP_BOUNDS;
  const midLatitude = (minLatitude + maxLatitude) / 2;
  const longitudeScale = Math.cos((midLatitude * Math.PI) / 180) || 1;
  const geoWidth = (maxLongitude - minLongitude) * longitudeScale || 1;
  const geoHeight = maxLatitude - minLatitude || 1;
  return {
    x: frame.x + (((point.longitude - minLongitude) * longitudeScale) / geoWidth) * frame.width,
    y: frame.y + ((maxLatitude - point.latitude) / geoHeight) * frame.height,
  };
}
