import { hasWord } from "./text";

// Lightweight, dependency-free geocoder for ingest.
//
// Incidents arrive with a canonical country name and free text (title +
// summary). There is no external geocoding API in the pipeline, so we resolve
// coordinates from a curated lookup table:
//   1. If a known city appears in the text, use that city's coordinates and
//      record the city name as the incident location (finer-grained marker).
//   2. Otherwise fall back to the country centroid.
//   3. If neither resolves, return null so the caller can log the miss.
//
// The country list mirrors the canonical names produced by the flashpoint and
// cargoWatch classifiers (including the Papua / PNG split). Keep this in sync
// with COUNTRY_ALIASES in flashpoint.ts and cargoWatch.ts when adding scope.

export type GeoResult = {
  latitude: number;
  longitude: number;
  /** City name when resolved at city granularity, else null. */
  location: string | null;
};

// Canonical country name -> approximate geographic centroid [lat, lng].
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  Australia: [-25.27, 133.78],
  Bangladesh: [23.68, 90.36],
  China: [35.86, 104.2],
  India: [22.59, 78.96],
  Indonesia: [-2.55, 118.01],
  Japan: [36.2, 138.25],
  Malaysia: [4.21, 101.98],
  Myanmar: [21.91, 95.96],
  Nepal: [28.39, 84.12],
  Pakistan: [30.38, 69.35],
  Philippines: [12.88, 121.77],
  "South Korea": [35.91, 127.77],
  "Sri Lanka": [7.87, 80.77],
  Thailand: [15.87, 100.99],
  Vietnam: [14.06, 108.28],
  "West Papua": [-2.5, 138.0],
  "Papua New Guinea": [-6.31, 143.96],
  // Cargo Watch (Middle East + APAC) scope.
  UAE: [23.42, 53.85],
  "United Arab Emirates": [23.42, 53.85],
  "Saudi Arabia": [23.89, 45.08],
  Qatar: [25.35, 51.18],
  Oman: [21.51, 55.92],
  Bahrain: [26.07, 50.56],
  Kuwait: [29.31, 47.48],
  Jordan: [30.59, 36.24],
  Singapore: [1.35, 103.82],
  // Additional countries present in legacy / imported incident rows so they
  // also plot on the map rather than being dropped as ungeocodable.
  "South Africa": [-30.56, 22.94],
  "New Zealand": [-41.0, 174.0],
  Cambodia: [12.57, 104.99],
  Laos: [19.86, 102.5],
  Canada: [56.13, -106.35],
  "United States": [37.09, -95.71],
};

// City name -> [lat, lng]. Keys are lowercase; matched word-bounded in text.
// Display name is derived by title-casing the key unless overridden.
const CITY_COORDS: Record<string, { lat: number; lng: number; name?: string }> = {
  // Australia
  sydney: { lat: -33.87, lng: 151.21 },
  melbourne: { lat: -37.81, lng: 144.96 },
  brisbane: { lat: -27.47, lng: 153.03 },
  canberra: { lat: -35.28, lng: 149.13 },
  perth: { lat: -31.95, lng: 115.86 },
  adelaide: { lat: -34.93, lng: 138.6 },
  // Bangladesh
  dhaka: { lat: 23.81, lng: 90.41 },
  chittagong: { lat: 22.36, lng: 91.78 },
  // China
  beijing: { lat: 39.9, lng: 116.41 },
  shanghai: { lat: 31.23, lng: 121.47 },
  guangzhou: { lat: 23.13, lng: 113.26 },
  shenzhen: { lat: 22.54, lng: 114.06 },
  "hong kong": { lat: 22.32, lng: 114.17 },
  // India
  delhi: { lat: 28.61, lng: 77.21 },
  mumbai: { lat: 19.08, lng: 72.88 },
  chennai: { lat: 13.08, lng: 80.27 },
  bengaluru: { lat: 12.97, lng: 77.59 },
  kolkata: { lat: 22.57, lng: 88.36 },
  hyderabad: { lat: 17.39, lng: 78.49 },
  "nhava sheva": { lat: 18.95, lng: 72.95 },
  // Indonesia
  jakarta: { lat: -6.21, lng: 106.85 },
  surabaya: { lat: -7.26, lng: 112.75 },
  bandung: { lat: -6.92, lng: 107.61 },
  bali: { lat: -8.41, lng: 115.19 },
  "tanjung priok": { lat: -6.1, lng: 106.88, name: "Tanjung Priok" },
  // Japan
  tokyo: { lat: 35.68, lng: 139.69 },
  osaka: { lat: 34.69, lng: 135.5 },
  kyoto: { lat: 35.01, lng: 135.77 },
  yokohama: { lat: 35.44, lng: 139.64 },
  nagoya: { lat: 35.18, lng: 136.91 },
  fukuoka: { lat: 33.59, lng: 130.4 },
  // Malaysia
  "kuala lumpur": { lat: 3.14, lng: 101.69 },
  penang: { lat: 5.41, lng: 100.33 },
  johor: { lat: 1.49, lng: 103.74 },
  "port klang": { lat: 3.0, lng: 101.39, name: "Port Klang" },
  // Myanmar
  yangon: { lat: 16.84, lng: 96.17 },
  mandalay: { lat: 21.98, lng: 96.08 },
  naypyidaw: { lat: 19.76, lng: 96.08 },
  // Nepal
  kathmandu: { lat: 27.72, lng: 85.32 },
  pokhara: { lat: 28.21, lng: 83.99 },
  // Pakistan
  karachi: { lat: 24.86, lng: 67.0 },
  lahore: { lat: 31.55, lng: 74.34 },
  islamabad: { lat: 33.69, lng: 73.06 },
  rawalpindi: { lat: 33.6, lng: 73.04 },
  peshawar: { lat: 34.02, lng: 71.58 },
  "port qasim": { lat: 24.78, lng: 67.34, name: "Port Qasim" },
  // Philippines
  manila: { lat: 14.6, lng: 120.98 },
  cebu: { lat: 10.32, lng: 123.89 },
  davao: { lat: 7.19, lng: 125.46 },
  "quezon city": { lat: 14.68, lng: 121.04 },
  // South Korea
  seoul: { lat: 37.57, lng: 126.98 },
  busan: { lat: 35.18, lng: 129.08 },
  incheon: { lat: 37.46, lng: 126.71 },
  daegu: { lat: 35.87, lng: 128.6 },
  // Sri Lanka
  colombo: { lat: 6.93, lng: 79.85 },
  kandy: { lat: 7.29, lng: 80.64 },
  jaffna: { lat: 9.66, lng: 80.02 },
  // Thailand
  bangkok: { lat: 13.76, lng: 100.5 },
  "chiang mai": { lat: 18.79, lng: 98.99 },
  phuket: { lat: 7.88, lng: 98.39 },
  "laem chabang": { lat: 13.08, lng: 100.88, name: "Laem Chabang" },
  // Vietnam
  hanoi: { lat: 21.03, lng: 105.85 },
  "ho chi minh": { lat: 10.82, lng: 106.63, name: "Ho Chi Minh City" },
  haiphong: { lat: 20.84, lng: 106.69 },
  "cai mep": { lat: 10.52, lng: 107.02, name: "Cai Mep" },
  // West Papua
  jayapura: { lat: -2.53, lng: 140.72 },
  wamena: { lat: -4.1, lng: 138.95 },
  manokwari: { lat: -0.86, lng: 134.06 },
  sorong: { lat: -0.88, lng: 131.25 },
  merauke: { lat: -8.49, lng: 140.4 },
  nabire: { lat: -3.36, lng: 135.51 },
  timika: { lat: -4.55, lng: 136.89 },
  biak: { lat: -1.18, lng: 136.08 },
  // Papua New Guinea
  "port moresby": { lat: -9.44, lng: 147.18 },
  lae: { lat: -6.73, lng: 146.99 },
  "mount hagen": { lat: -5.86, lng: 144.23 },
  madang: { lat: -5.22, lng: 145.79 },
  goroka: { lat: -6.08, lng: 145.39 },
  wewak: { lat: -3.58, lng: 143.66 },
  // Middle East (Cargo Watch)
  dubai: { lat: 25.2, lng: 55.27 },
  "abu dhabi": { lat: 24.45, lng: 54.38 },
  sharjah: { lat: 25.35, lng: 55.39 },
  ajman: { lat: 25.41, lng: 55.44 },
  riyadh: { lat: 24.71, lng: 46.68 },
  jeddah: { lat: 21.49, lng: 39.19 },
  dammam: { lat: 26.43, lng: 50.1 },
  doha: { lat: 25.29, lng: 51.53 },
  muscat: { lat: 23.59, lng: 58.41 },
  salalah: { lat: 17.02, lng: 54.09 },
  manama: { lat: 26.23, lng: 50.59 },
  amman: { lat: 31.95, lng: 35.93 },
  aqaba: { lat: 29.53, lng: 35.0 },
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve coordinates for an incident from its canonical country and the
 * incident's free text (title + summary). Returns null when nothing in scope
 * matches, so the caller can log the miss instead of silently dropping it.
 */
export function geocode(country: string, text = ""): GeoResult | null {
  // City match first (finer granularity). Scan the text for known cities.
  if (text) {
    for (const [key, c] of Object.entries(CITY_COORDS)) {
      if (hasWord(text, key)) {
        return { latitude: c.lat, longitude: c.lng, location: c.name ?? titleCase(key) };
      }
    }
  }

  // Country centroid fallback. Combined tags like "West Papua; Papua New
  // Guinea" resolve on their first component.
  const primary = country.split(";")[0]?.trim() ?? country.trim();
  const centroid = COUNTRY_CENTROIDS[primary] ?? COUNTRY_CENTROIDS[country.trim()];
  if (centroid) {
    return { latitude: centroid[0], longitude: centroid[1], location: null };
  }

  return null;
}
