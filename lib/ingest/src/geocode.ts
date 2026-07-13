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
  Iran: [32.43, 53.69],
  Iraq: [33.22, 43.68],
  Yemen: [15.55, 48.52],
  Israel: [31.05, 34.85],
  Lebanon: [33.85, 35.86],
  Syria: [34.8, 39.0],
  Taiwan: [23.7, 120.96],
  Singapore: [1.35, 103.82],
  // Additional countries present in legacy / imported incident rows so they
  // also plot on the map rather than being dropped as ungeocodable.
  "South Africa": [-30.56, 22.94],
  "New Zealand": [-41.0, 174.0],
  Cambodia: [12.57, 104.99],
  Laos: [19.86, 102.5],
  Canada: [56.13, -106.35],
  "United States": [37.09, -95.71],
  // Out-of-region ("global market") centroids. The energy / fuel / fertiliser
  // monitors serve regionally-based clients who operate in GLOBAL markets, so
  // an out-of-region grid/refinery/fertiliser event is surfaced (shaded on the
  // world map + listed in the country tables) rather than dropped. Only REAL
  // countries with a matching world-choropleth polygon are added here — blocs
  // ("Europe", "Pacific") are deliberately omitted so the map and the country
  // tables never disagree.
  Spain: [40.46, -3.75],
  Portugal: [39.4, -8.22],
  Ukraine: [48.38, 31.17],
  Russia: [61.52, 105.32],
  Germany: [51.17, 10.45],
  Cuba: [21.52, -77.78],
  Nigeria: [9.08, 8.68],
  Niger: [17.61, 8.08],
  Kenya: [-0.02, 37.91],
  Ghana: [7.95, -1.02],
  Zimbabwe: [-19.02, 29.15],
  Zambia: [-13.13, 27.85],
  Mongolia: [46.86, 103.85],
  Turkey: [38.96, 35.24],
  "United Kingdom": [54.0, -2.5],
  Venezuela: [6.42, -66.59],
  France: [46.23, 2.21],
  Poland: [51.92, 19.13],
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
  // New Zealand
  auckland: { lat: -36.85, lng: 174.76 },
  wellington: { lat: -41.29, lng: 174.78 },
  christchurch: { lat: -43.53, lng: 172.64 },
  dunedin: { lat: -45.87, lng: 170.5 },
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
  // India conflict theatres (Kashmir / North-East / Naxal belt)
  srinagar: { lat: 34.08, lng: 74.8 },
  jammu: { lat: 32.73, lng: 74.87 },
  imphal: { lat: 24.82, lng: 93.94 },
  jagdalpur: { lat: 19.08, lng: 82.03, name: "Jagdalpur" },
  ranchi: { lat: 23.34, lng: 85.31 },
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
  sittwe: { lat: 20.15, lng: 92.9 },
  lashio: { lat: 22.93, lng: 97.75 },
  myitkyina: { lat: 25.38, lng: 97.4 },
  sagaing: { lat: 21.88, lng: 95.98 },
  loikaw: { lat: 19.67, lng: 97.21 },
  "hpa-an": { lat: 16.89, lng: 97.63, name: "Hpa-An" },
  // Nepal
  kathmandu: { lat: 27.72, lng: 85.32 },
  pokhara: { lat: 28.21, lng: 83.99 },
  // Pakistan
  karachi: { lat: 24.86, lng: 67.0 },
  lahore: { lat: 31.55, lng: 74.34 },
  islamabad: { lat: 33.69, lng: 73.06 },
  rawalpindi: { lat: 33.6, lng: 73.04 },
  peshawar: { lat: 34.02, lng: 71.58 },
  quetta: { lat: 30.18, lng: 66.98 },
  wana: { lat: 32.3, lng: 69.57, name: "Wana (Waziristan)" },
  "port qasim": { lat: 24.78, lng: 67.34, name: "Port Qasim" },
  // Philippines
  manila: { lat: 14.6, lng: 120.98 },
  cebu: { lat: 10.32, lng: 123.89 },
  davao: { lat: 7.19, lng: 125.46 },
  "quezon city": { lat: 14.68, lng: 121.04 },
  marawi: { lat: 8.0, lng: 124.3 },
  jolo: { lat: 6.05, lng: 121.0 },
  zamboanga: { lat: 6.91, lng: 122.08 },
  cotabato: { lat: 7.22, lng: 124.25 },
  "general santos": { lat: 6.11, lng: 125.17, name: "General Santos" },
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
  pattani: { lat: 6.87, lng: 101.25 },
  yala: { lat: 6.54, lng: 101.28 },
  narathiwat: { lat: 6.43, lng: 101.82 },
  // Vietnam
  hanoi: { lat: 21.03, lng: 105.85 },
  "ho chi minh": { lat: 10.82, lng: 106.63, name: "Ho Chi Minh City" },
  haiphong: { lat: 20.84, lng: 106.69 },
  "cai mep": { lat: 10.52, lng: 107.02, name: "Cai Mep" },
  // West Papua — mine-security + highland conflict districts FIRST so a
  // Freeport / Grasberg / Tembagapura story resolves to the mine area rather
  // than the provincial capital Jayapura (first in-range key wins).
  grasberg: { lat: -4.06, lng: 137.11, name: "Grasberg" },
  tembagapura: { lat: -4.05, lng: 137.11, name: "Tembagapura" },
  freeport: { lat: -4.55, lng: 136.89, name: "Freeport (Timika)" },
  "pt freeport": { lat: -4.55, lng: 136.89, name: "PT Freeport" },
  mimika: { lat: -4.55, lng: 136.89, name: "Mimika" },
  "kuala kencana": { lat: -4.43, lng: 136.88, name: "Kuala Kencana" },
  timika: { lat: -4.55, lng: 136.89 },
  "intan jaya": { lat: -3.73, lng: 137.03, name: "Intan Jaya" },
  sugapa: { lat: -3.73, lng: 137.03, name: "Sugapa" },
  "puncak jaya": { lat: -3.7, lng: 137.95, name: "Puncak Jaya" },
  ilaga: { lat: -3.98, lng: 137.55, name: "Ilaga" },
  nduga: { lat: -4.3, lng: 138.3, name: "Nduga" },
  kenyam: { lat: -4.27, lng: 138.3, name: "Kenyam" },
  paniai: { lat: -3.92, lng: 136.3, name: "Paniai" },
  enarotali: { lat: -3.92, lng: 136.36, name: "Enarotali" },
  yahukimo: { lat: -4.83, lng: 139.45, name: "Yahukimo" },
  dekai: { lat: -4.83, lng: 139.45, name: "Dekai" },
  oksibil: { lat: -4.9, lng: 140.62, name: "Oksibil" },
  beoga: { lat: -3.95, lng: 137.5, name: "Beoga" },
  jayapura: { lat: -2.53, lng: 140.72 },
  wamena: { lat: -4.1, lng: 138.95 },
  manokwari: { lat: -0.86, lng: 134.06 },
  sorong: { lat: -0.88, lng: 131.25 },
  merauke: { lat: -8.49, lng: 140.4 },
  nabire: { lat: -3.36, lng: 135.51 },
  biak: { lat: -1.18, lng: 136.08 },
  // Papua New Guinea
  "port moresby": { lat: -9.44, lng: 147.18 },
  lae: { lat: -6.73, lng: 146.99 },
  "mount hagen": { lat: -5.86, lng: 144.23 },
  madang: { lat: -5.22, lng: 145.79 },
  goroka: { lat: -6.08, lng: 145.39 },
  wewak: { lat: -3.58, lng: 143.66 },
  enga: { lat: -5.49, lng: 143.58, name: "Enga" },
  wabag: { lat: -5.49, lng: 143.71, name: "Wabag" },
  hela: { lat: -5.95, lng: 142.9, name: "Hela" },
  tari: { lat: -5.85, lng: 142.95, name: "Tari" },
  "southern highlands": { lat: -6.15, lng: 143.66, name: "Southern Highlands" },
  mendi: { lat: -6.15, lng: 143.66, name: "Mendi" },
  "western highlands": { lat: -5.86, lng: 144.23, name: "Western Highlands" },
  baisu: { lat: -5.83, lng: 144.28, name: "Baisu" },
  chimbu: { lat: -6.02, lng: 144.97, name: "Chimbu" },
  simbu: { lat: -6.02, lng: 144.97, name: "Simbu" },
  kundiawa: { lat: -6.02, lng: 144.97, name: "Kundiawa" },
  jiwaka: { lat: -5.8, lng: 144.62, name: "Jiwaka" },
  "east sepik": { lat: -3.58, lng: 143.66, name: "East Sepik" },
  angoram: { lat: -4.06, lng: 144.07, name: "Angoram" },
  "west sepik": { lat: -2.68, lng: 141.3, name: "West Sepik" },
  sandaun: { lat: -2.68, lng: 141.3, name: "Sandaun" },
  vanimo: { lat: -2.68, lng: 141.3, name: "Vanimo" },
  morobe: { lat: -6.73, lng: 146.99, name: "Morobe" },
  "national capital district": { lat: -9.44, lng: 147.18, name: "National Capital District" },
  ncd: { lat: -9.44, lng: 147.18, name: "National Capital District" },
  "west new britain": { lat: -5.55, lng: 150.14, name: "West New Britain" },
  kimbe: { lat: -5.55, lng: 150.14, name: "Kimbe" },
  "east new britain": { lat: -4.35, lng: 152.26, name: "East New Britain" },
  kokopo: { lat: -4.35, lng: 152.26, name: "Kokopo" },
  rabaul: { lat: -4.2, lng: 152.17, name: "Rabaul" },
  "new ireland": { lat: -2.57, lng: 150.8, name: "New Ireland" },
  kavieng: { lat: -2.57, lng: 150.8, name: "Kavieng" },
  "milne bay": { lat: -10.31, lng: 150.44, name: "Milne Bay" },
  alotau: { lat: -10.31, lng: 150.44, name: "Alotau" },
  kerema: { lat: -7.96, lng: 145.78, name: "Kerema" },
  daru: { lat: -9.08, lng: 143.21, name: "Daru" },
  popondetta: { lat: -8.77, lng: 148.24, name: "Popondetta" },
  kokoda: { lat: -8.88, lng: 147.74, name: "Kokoda" },
  buka: { lat: -5.42, lng: 154.67, name: "Buka" },
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
  // Levant / Gulf (local-language Cargo Watch feeds)
  beirut: { lat: 33.89, lng: 35.5 },
  damascus: { lat: 33.51, lng: 36.29 },
  aleppo: { lat: 36.2, lng: 37.16 },
  idlib: { lat: 35.93, lng: 36.63 },
  baghdad: { lat: 33.31, lng: 44.36 },
  basra: { lat: 30.51, lng: 47.78 },
  tehran: { lat: 35.69, lng: 51.39 },
  "tel aviv": { lat: 32.08, lng: 34.78, name: "Tel Aviv" },
  aden: { lat: 12.79, lng: 45.02 },
  sanaa: { lat: 15.37, lng: 44.19 },
  // Taiwan
  taipei: { lat: 25.03, lng: 121.57 },
  kaohsiung: { lat: 22.63, lng: 120.3 },
  // Thailand (local-language feed)
  "nakhon ratchasima": { lat: 14.97, lng: 102.1, name: "Nakhon Ratchasima" },
  korat: { lat: 14.97, lng: 102.1, name: "Korat" },
  // Indonesia (local-language feed)
  medan: { lat: 3.59, lng: 98.67 },
  makassar: { lat: -5.15, lng: 119.43 },
  semarang: { lat: -6.97, lng: 110.42 },
  palembang: { lat: -2.98, lng: 104.76 },
  tangerang: { lat: -6.18, lng: 106.63 },
  madiun: { lat: -7.63, lng: 111.52 },
  "soekarno-hatta": { lat: -6.13, lng: 106.66, name: "Soekarno-Hatta" },
  // Ukraine — Crimea (world-scope energy). Balaklava first so a Balaklava
  // thermal-power-plant strike resolves to the town, not the peninsula.
  balaklava: { lat: 44.5, lng: 33.6, name: "Balaklava" },
  sevastopol: { lat: 44.62, lng: 33.53, name: "Sevastopol" },
  simferopol: { lat: 44.95, lng: 34.1, name: "Simferopol" },
  kerch: { lat: 45.36, lng: 36.47, name: "Kerch" },
  crimea: { lat: 45.3, lng: 34.4, name: "Crimea" },
  // Turkey / United Kingdom / Venezuela (world-scope energy newsmakers).
  istanbul: { lat: 41.01, lng: 28.98, name: "Istanbul" },
  ankara: { lat: 39.93, lng: 32.86, name: "Ankara" },
  london: { lat: 51.51, lng: -0.13, name: "London" },
  scotland: { lat: 56.49, lng: -4.2, name: "Scotland" },
  caracas: { lat: 10.49, lng: -66.88, name: "Caracas" },
  // France / Poland (world-scope energy/fuel/fertiliser newsmakers).
  paris: { lat: 48.86, lng: 2.35, name: "Paris" },
  warsaw: { lat: 52.23, lng: 21.01, name: "Warsaw" },
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve coordinates for an incident from its canonical country and the
 * incident's free text (title + summary). Returns null when nothing in scope
 * matches, so the caller can log the miss instead of silently dropping it.
 */
// A city named in the text may only set the incident location if it actually
// sits near the record's attributed country. Without this, a passing mention
// of a foreign city (e.g. "Taipei" in a Gulf strike story) would hijack the
// location and place the marker thousands of km out of theatre.
const MAX_CITY_KM = 2500;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function geocode(country: string, text = ""): GeoResult | null {
  // Country centroid fallback. Combined tags like "West Papua; Papua New
  // Guinea" resolve on their first component.
  const primary = country.split(";")[0]?.trim() ?? country.trim();
  const centroid = COUNTRY_CENTROIDS[primary] ?? COUNTRY_CENTROIDS[country.trim()];

  // City match first (finer granularity). Scan the text for known cities, but
  // skip any city that lies far from the country centroid — a foreign-city
  // mention must never override the incident's real location. When no centroid
  // anchors the record, fall back to the legacy first-match behaviour.
  if (text) {
    for (const [key, c] of Object.entries(CITY_COORDS)) {
      if (!hasWord(text, key)) continue;
      if (centroid && haversineKm(c.lat, c.lng, centroid[0], centroid[1]) > MAX_CITY_KM) {
        continue;
      }
      return { latitude: c.lat, longitude: c.lng, location: c.name ?? titleCase(key) };
    }
  }

  if (centroid) {
    return { latitude: centroid[0], longitude: centroid[1], location: null };
  }

  return null;
}
