// ===========================================================================
// Jakarta operational map — pure model + geocoder (no React, no Leaflet)
// ===========================================================================
//
// This module is the testable "source-to-map" layer for the Jakarta operational
// map. It answers three honest questions for every incident, with NO fabrication:
//
//   1. Where is it?  geocodeJakartaIncident() resolves a point ONLY from
//      explicit coordinates or a match against a fixed Jakarta gazetteer of named
//      districts, landmarks and roads. It never guesses a position. An incident
//      with no resolvable location returns null (it is carried in the "not
//      mapped" note, never dropped silently and never placed at a made-up point).
//
//   2. What is it?  categoriseJakartaMapIncident() maps the incident's hazard to
//      ONE of exactly five operational marker categories. An incident whose type
//      is not one of these returns null (again surfaced in the "not mapped" note,
//      never drawn as an unexplained neutral dot).
//
//   3. Which operating zone does it sit in?  the gazetteer entry (or the nearest
//      named zone for explicit coordinates) assigns a standing operating zone so
//      the right-hand panel can tie live reporting to concrete business guidance.
//
// The component (JakartaCorridorMap.tsx) consumes buildJakartaMapModel() and is
// left purely visual, so this honesty logic can be unit-tested in isolation.

import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import { hazardForIncident } from "@/lib/jakartaCorridors";

// ---------------------------------------------------------------------------
// Fit box
// ---------------------------------------------------------------------------
//
// Tighter than JAKARTA_VIEW_BBOX (which trailed off into half of West Java): it
// frames Jakarta proper plus the western airport approach and the immediate port
// strip, and trims the southern commuter sprawl and far-eastern Bekasi so the
// map reads as a city operating picture, not a regional overview.
export const JAKARTA_MAP_OPS_BBOX = {
  minLon: 106.62,
  minLat: -6.33,
  maxLon: 106.985,
  maxLat: -6.075,
};

// Wider acceptance box for EXPLICIT coordinates: a record that already carries
// real lat/lon may legitimately sit in the airport/commuter approaches just
// outside the city frame; anything beyond this is treated as out of theatre and
// not mapped.
export const JAKARTA_MAP_PLOT_BBOX = {
  minLon: 106.55,
  minLat: -6.42,
  maxLon: 107.02,
  maxLat: -6.05,
};

function inBbox(
  lat: number,
  lon: number,
  box: { minLon: number; minLat: number; maxLon: number; maxLat: number },
): boolean {
  return (
    lon >= box.minLon &&
    lon <= box.maxLon &&
    lat >= box.minLat &&
    lat <= box.maxLat
  );
}

// ---------------------------------------------------------------------------
// Marker categories — EXACTLY five, per the operational spec
// ---------------------------------------------------------------------------
export type JakartaMapCategory =
  | "protest-policing"
  | "flooding-weather"
  | "crime-safety"
  | "fire-emergency"
  | "port-logistics";

export type JakartaMarkerShape =
  | "circle"
  | "triangle"
  | "diamond"
  | "square"
  | "pentagon";

export interface JakartaMapCategoryMeta {
  id: JakartaMapCategory;
  label: string;
  /** Marker fill. None of these is a reserved severity hex (#A33232 / #1B6B7A). */
  color: string;
  shape: JakartaMarkerShape;
}

// Distinct, muted, print-safe palette — no neon, no gradients, and deliberately
// clear of the severity ramp so a marker colour is never read as a risk tier.
export const JAKARTA_MAP_CATEGORIES: JakartaMapCategoryMeta[] = [
  { id: "protest-policing", label: "Protest / policing", color: "#7C3AED", shape: "circle" },
  { id: "flooding-weather", label: "Flooding / weather", color: "#2563EB", shape: "triangle" },
  { id: "crime-safety", label: "Crime / public safety", color: "#9D174D", shape: "diamond" },
  { id: "fire-emergency", label: "Fire / emergency", color: "#C2410C", shape: "square" },
  { id: "port-logistics", label: "Port / logistics", color: "#475569", shape: "pentagon" },
];

export const JAKARTA_MAP_CATEGORY_META: Record<
  JakartaMapCategory,
  JakartaMapCategoryMeta
> = Object.fromEntries(
  JAKARTA_MAP_CATEGORIES.map((c) => [c.id, c]),
) as Record<JakartaMapCategory, JakartaMapCategoryMeta>;

// Map the honest hazard classification onto the five operational categories.
// "policing" folds into protest/policing; "traffic" folds into the
// port/logistics / movement-disruption category (the spec's fifth lane).
// Anything that resolves to no hazard returns null and is NOT plotted.
export function categoriseJakartaMapIncident(
  i: CountryFastFactsIncident,
): JakartaMapCategory | null {
  const hz = hazardForIncident(i);
  switch (hz) {
    case "protest":
    case "policing":
      return "protest-policing";
    case "flooding":
      return "flooding-weather";
    case "crime":
      return "crime-safety";
    case "fire":
      return "fire-emergency";
    case "traffic":
      return "port-logistics";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Operating zones — named LABEL points (not shaded blobs)
// ---------------------------------------------------------------------------
//
// Each zone is a real, named Jakarta operating area with concrete business
// meaning. The map draws a small labelled point per zone; the right-hand panel
// lists them with live status. `corridorAreaId` ties a zone to the existing
// corridor-status model (JAKARTA_CORRIDOR_AREAS) so the live exposure badge is
// derived from the same honest window, never invented here.
export interface JakartaOperatingZone {
  id: string;
  /** Tight label drawn on the map. */
  label: string;
  /** Fuller name shown in the right-hand panel. */
  panelTitle: string;
  /** Operational meaning + standing action (count-free, named). */
  meaning: string;
  /** Drives the live exposure badge via buildJakartaCorridorStatuses. */
  corridorAreaId: string;
  lat: number;
  lon: number;
  /** Preferred side for the map label so points do not collide. */
  labelSide?: "top" | "bottom" | "left" | "right";
}

export const JAKARTA_OPERATING_ZONES: JakartaOperatingZone[] = [
  {
    id: "govt",
    label: "Govt district",
    panelTitle: "Central Jakarta government district",
    meaning:
      "Government district protest exposure. Confirm activity around Monas, Istana Merdeka and DPR/MPR before non-essential movement.",
    corridorAreaId: "central-government",
    lat: -6.1754,
    lon: 106.8272,
    labelSide: "top",
  },
  {
    id: "sudirman-thamrin",
    label: "Sudirman · Thamrin",
    panelTitle: "Sudirman / Thamrin business corridor",
    meaning:
      "Business and hotel corridor. Confirm Sudirman and Thamrin route status before client meetings.",
    corridorAreaId: "commercial-hotels",
    lat: -6.2045,
    lon: 106.8215,
    labelSide: "right",
  },
  {
    id: "scbd-senayan",
    label: "SCBD · Senayan",
    panelTitle: "SCBD / Senayan",
    meaning:
      "Office, hotel and venue cluster. Confirm SCBD and Senayan approaches before meetings and events.",
    corridorAreaId: "commercial-hotels",
    lat: -6.2255,
    lon: 106.8055,
    labelSide: "left",
  },
  {
    id: "kuningan",
    label: "Kuningan",
    panelTitle: "Kuningan / Gatot Subroto",
    meaning:
      "Embassy and office corridor. Confirm Gatot Subroto and Rasuna Said status before travel.",
    corridorAreaId: "commercial-hotels",
    lat: -6.2285,
    lon: 106.829,
    labelSide: "right",
  },
  {
    id: "priok",
    label: "Tanjung Priok",
    panelTitle: "Tanjung Priok port",
    meaning:
      "Port access and container movement exposure. Confirm terminal and gate status before dispatch.",
    corridorAreaId: "north-port",
    lat: -6.105,
    lon: 106.881,
    labelSide: "top",
  },
  {
    id: "north-access",
    label: "North Jakarta",
    panelTitle: "North Jakarta access roads",
    meaning:
      "Low-lying port access roads. Check Cilincing and Koja approaches for flooding before movement.",
    corridorAreaId: "north-port",
    lat: -6.13,
    lon: 106.91,
    labelSide: "right",
  },
  {
    id: "airport",
    label: "Airport corridor",
    panelTitle: "Soekarno-Hatta airport corridor",
    meaning:
      "City–airport transfer route. Confirm the airport toll road and Tangerang approach before departure.",
    corridorAreaId: "airport-corridor",
    lat: -6.1256,
    lon: 106.6559,
    labelSide: "bottom",
  },
];

const ZONE_BY_ID: Record<string, JakartaOperatingZone> = Object.fromEntries(
  JAKARTA_OPERATING_ZONES.map((z) => [z.id, z]),
);

// ---------------------------------------------------------------------------
// Movement corridors drawn as route lines (airport / port / business)
// ---------------------------------------------------------------------------
export interface JakartaMapCorridor {
  id: string;
  label: string;
  /** Ordered [lat, lon] waypoints. */
  path: [number, number][];
  /** Path index used to anchor the label (defaults to the middle). */
  labelAt?: number;
}

export const JAKARTA_MAP_CORRIDORS: JakartaMapCorridor[] = [
  {
    id: "airport",
    label: "Airport corridor",
    path: [
      [-6.1256, 106.6559],
      [-6.14, 106.705],
      [-6.158, 106.76],
      [-6.174, 106.81],
    ],
    labelAt: 2,
  },
  {
    id: "port",
    label: "Port corridor",
    path: [
      [-6.105, 106.881],
      [-6.132, 106.862],
      [-6.158, 106.842],
      [-6.176, 106.826],
    ],
    labelAt: 1,
  },
  {
    id: "business",
    label: "Business corridor",
    path: [
      [-6.1935, 106.823],
      [-6.209, 106.8215],
      [-6.2255, 106.8075],
      [-6.2285, 106.829],
    ],
    labelAt: 1,
  },
];

// ---------------------------------------------------------------------------
// Gazetteer — fixed named Jakarta places → coordinates + operating zone
// ---------------------------------------------------------------------------
//
// Specific districts, landmarks and roads only. Entries are matched on a word
// boundary against the incident's location text and (masthead-stripped)
// headline. Because the incident set is already Jakarta-scoped, these proper
// place names are safe to match in a headline; broad regency names
// (Tangerang/Bekasi/Depok) are deliberately EXCLUDED — they are too coarse to
// pin a point honestly, so such records fall to the "not mapped" note.
export interface JakartaGazetteerEntry {
  /** Lower-case match tokens (most specific first). */
  names: string[];
  lat: number;
  lon: number;
  zoneId: string;
  /**
   * Location precision of the match, feeding the evidence-provenance ledger:
   *  - "high"   = a specific road, landmark, terminal, venue or palace — a point
   *               that honestly pins to metres / hundreds of metres.
   *  - "medium" = a named district / sub-district (kelurahan / kecamatan) — a
   *               real area, but the marker sits at its centroid.
   * BOTH precisions plot a marker (so the map is unchanged); the distinction
   * only sets the ledger's Location-confidence column (HIGH vs MEDIUM). Coarse
   * city-level mentions (Jakarta / Greater Jakarta / a commuter regency) never
   * reach the gazetteer and resolve to LOW — narrative-only, never a marker.
   */
  precision: "high" | "medium";
}

export const JAKARTA_GAZETTEER: JakartaGazetteerEntry[] = [
  // Government / central core
  { names: ["monumen nasional", "monas", "medan merdeka"], lat: -6.1754, lon: 106.8272, zoneId: "govt", precision: "high" },
  { names: ["istana merdeka", "istana negara", "presidential palace", "istana"], lat: -6.1702, lon: 106.8243, zoneId: "govt", precision: "high" },
  { names: ["gambir"], lat: -6.1766, lon: 106.8307, zoneId: "govt", precision: "medium" },
  { names: ["dpr/mpr", "dpr", "mpr", "parliament"], lat: -6.21, lon: 106.8, zoneId: "govt", precision: "high" },
  { names: ["menteng"], lat: -6.196, lon: 106.833, zoneId: "govt", precision: "medium" },
  { names: ["tanah abang"], lat: -6.186, lon: 106.812, zoneId: "govt", precision: "medium" },
  { names: ["sawah besar"], lat: -6.158, lon: 106.832, zoneId: "govt", precision: "medium" },
  { names: ["senen"], lat: -6.176, lon: 106.843, zoneId: "govt", precision: "medium" },
  { names: ["kemayoran"], lat: -6.161, lon: 106.85, zoneId: "govt", precision: "medium" },
  // Business / commercial / hotel
  { names: ["bundaran hi", "bundaran hotel indonesia"], lat: -6.1935, lon: 106.823, zoneId: "sudirman-thamrin", precision: "high" },
  { names: ["thamrin"], lat: -6.194, lon: 106.823, zoneId: "sudirman-thamrin", precision: "high" },
  { names: ["sudirman"], lat: -6.209, lon: 106.8215, zoneId: "sudirman-thamrin", precision: "high" },
  { names: ["scbd", "sudirman central business district"], lat: -6.2255, lon: 106.8075, zoneId: "scbd-senayan", precision: "high" },
  { names: ["gelora bung karno", "senayan", "gbk"], lat: -6.2185, lon: 106.802, zoneId: "scbd-senayan", precision: "high" },
  { names: ["kebayoran"], lat: -6.244, lon: 106.798, zoneId: "scbd-senayan", precision: "medium" },
  { names: ["mega kuningan", "kuningan"], lat: -6.2285, lon: 106.829, zoneId: "kuningan", precision: "medium" },
  { names: ["gatot subroto"], lat: -6.235, lon: 106.817, zoneId: "kuningan", precision: "high" },
  { names: ["rasuna said", "setiabudi"], lat: -6.223, lon: 106.833, zoneId: "kuningan", precision: "medium" },
  { names: ["senopati", "kemang"], lat: -6.262, lon: 106.814, zoneId: "scbd-senayan", precision: "medium" },
  { names: ["tebet"], lat: -6.236, lon: 106.857, zoneId: "kuningan", precision: "medium" },
  // North / port
  { names: ["tanjung priok", "priok"], lat: -6.105, lon: 106.881, zoneId: "priok", precision: "high" },
  { names: ["cilincing"], lat: -6.113, lon: 106.93, zoneId: "north-access", precision: "medium" },
  { names: ["koja"], lat: -6.11, lon: 106.9, zoneId: "north-access", precision: "medium" },
  { names: ["kelapa gading"], lat: -6.158, lon: 106.908, zoneId: "north-access", precision: "medium" },
  { names: ["penjaringan"], lat: -6.128, lon: 106.79, zoneId: "north-access", precision: "medium" },
  { names: ["pademangan"], lat: -6.133, lon: 106.835, zoneId: "north-access", precision: "medium" },
  { names: ["ancol"], lat: -6.124, lon: 106.84, zoneId: "north-access", precision: "high" },
  { names: ["sunter"], lat: -6.145, lon: 106.87, zoneId: "north-access", precision: "medium" },
  // Airport
  { names: ["soekarno-hatta", "soekarno hatta", "soetta", "cengkareng", "bandara soekarno"], lat: -6.1256, lon: 106.6559, zoneId: "airport", precision: "high" },
  { names: ["halim perdanakusuma", "halim"], lat: -6.2666, lon: 106.891, zoneId: "airport", precision: "high" },
];

// Coarse, greater-Jakarta-level location tokens. A record whose ONLY location
// signal is one of these cannot be pinned to a plottable point: it resolves to
// LOW confidence — a genuine Jakarta claim carried in the narrative and the
// evidence ledger, but never drawn as a map marker. Bare "jakarta" also covers
// the five administrative cities (Central / North / South / East / West Jakarta),
// which are far too broad to mark honestly.
export const JAKARTA_CITY_LEVEL_TOKENS: string[] = [
  "jabodetabek",
  "greater jakarta",
  "dki jakarta",
  "jakarta raya",
  "jakarta",
  "tangerang",
  "south tangerang",
  "tangsel",
  "bekasi",
  "depok",
  "bogor",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Light masthead strip: drop a trailing " - Source" / " | Source" tail so a
// publisher name never supplies a false gazetteer match (mirrors the corridor
// attribution helper).
function stripMasthead(title: string): string {
  return title.replace(/\s*[-|–—]\s*[^-|–—]{2,40}$/u, "").trim();
}

function tokenInText(token: string, hay: string): boolean {
  return new RegExp(`(^|[^a-z])${escapeRegExp(token)}([^a-z]|$)`, "i").test(hay);
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------
export type JakartaGeocodeConfidence = "explicit" | "named";

// Evidence-ledger location-precision tier. Orthogonal to JakartaGeocodeConfidence
// (which records the SOURCE of the match): here HIGH = explicit coordinates or a
// high-precision gazetteer landmark, MEDIUM = a named district centroid, LOW = a
// coarse city-level mention or no location signal (never plotted).
export type JakartaLocationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface JakartaLocationResolution {
  locationConfidence: JakartaLocationConfidence;
  /**
   * True only for HIGH / MEDIUM — a plottable point is available. LOW is
   * narrative-only and never carries a point (so it never becomes a marker).
   */
  hasPoint: boolean;
  lat?: number;
  lon?: number;
  zoneId?: string | null;
  matchedName?: string;
  source: "explicit" | "named" | "city-level" | "none";
}

export interface JakartaGeocode {
  lat: number;
  lon: number;
  confidence: JakartaGeocodeConfidence;
  /**
   * Location-precision tier for the evidence ledger. Only HIGH / MEDIUM ever
   * reach a JakartaGeocode (LOW is not plottable, so geocode returns null).
   */
  locationConfidence: Exclude<JakartaLocationConfidence, "LOW">;
  /** Operating zone the point was assigned to (or null). */
  zoneId: string | null;
  /** The gazetteer name that matched (for "named" confidence). */
  matchedName?: string;
}

// Single location-resolution authority for the Jakarta report: explicit
// coordinates (HIGH) → named gazetteer match (HIGH landmark / MEDIUM district,
// location text preferred then headline) → coarse city-level mention (LOW,
// unplottable) → no signal at all (LOW). Pure and deterministic; both the map
// and the evidence ledger read it so a marker and its ledger row can never
// disagree about where — or how precisely — an incident sits.
export function resolveJakartaIncidentLocation(
  i: CountryFastFactsIncident,
): JakartaLocationResolution {
  // 1) Explicit coordinates within the plot box → HIGH precision.
  const lat = i.latitude;
  const lon = i.longitude;
  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    inBbox(lat, lon, JAKARTA_MAP_PLOT_BBOX)
  ) {
    return {
      locationConfidence: "HIGH",
      hasPoint: true,
      lat,
      lon,
      zoneId: nearestZoneId(lat, lon),
      source: "explicit",
    };
  }

  // 2) Named gazetteer match — location text preferred, then headline. The
  //    matched entry's precision sets HIGH (landmark) vs MEDIUM (district).
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();

  for (const hay of [loc, title]) {
    if (!hay) continue;
    for (const entry of JAKARTA_GAZETTEER) {
      for (const name of entry.names) {
        if (tokenInText(name, hay)) {
          return {
            locationConfidence: entry.precision === "high" ? "HIGH" : "MEDIUM",
            hasPoint: true,
            lat: entry.lat,
            lon: entry.lon,
            zoneId: entry.zoneId,
            matchedName: name,
            source: "named",
          };
        }
      }
    }
  }

  // 3) Coarse city-level mention (Jakarta / Greater Jakarta / a commuter
  //    regency) → LOW. A genuine Jakarta claim, but not pinnable to a point, so
  //    it is narrative-only and never plotted.
  const cityHay = `${loc} ${title}`;
  for (const token of JAKARTA_CITY_LEVEL_TOKENS) {
    if (tokenInText(token, cityHay)) {
      return { locationConfidence: "LOW", hasPoint: false, zoneId: null, source: "city-level" };
    }
  }

  // 4) No location signal at all. The window is Jakarta-scoped, so the record is
  //    still a Jakarta claim, carried at LOW confidence (narrative-only).
  return { locationConfidence: "LOW", hasPoint: false, zoneId: null, source: "none" };
}

// Nearest operating zone within ~3.5 km (used for explicit coordinates that
// carry no gazetteer name). Returns null when nothing is close enough.
function nearestZoneId(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const z of JAKARTA_OPERATING_ZONES) {
    const dLat = lat - z.lat;
    const dLon = lon - z.lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = z.id;
    }
  }
  // ~0.032 deg ≈ 3.5 km; squared.
  return best !== null && bestD <= 0.032 * 0.032 ? best : null;
}

// Resolve an incident to a map point WITHOUT fabrication: explicit coordinates
// first (when they fall inside the plot box), then a named gazetteer match over
// the location text (preferred) and finally the headline. Returns null when no
// honest position is available.
export function geocodeJakartaIncident(
  i: CountryFastFactsIncident,
): JakartaGeocode | null {
  // 1) Explicit coordinates, if present and within the plot box.
  const lat = i.latitude;
  const lon = i.longitude;
  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    inBbox(lat, lon, JAKARTA_MAP_PLOT_BBOX)
  ) {
    return {
      lat,
      lon,
      confidence: "explicit",
      locationConfidence: "HIGH",
      zoneId: nearestZoneId(lat, lon),
    };
  }

  // 2) Named gazetteer match — location text preferred, then headline.
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();

  for (const hay of [loc, title]) {
    if (!hay) continue;
    for (const entry of JAKARTA_GAZETTEER) {
      for (const name of entry.names) {
        if (tokenInText(name, hay)) {
          return {
            lat: entry.lat,
            lon: entry.lon,
            confidence: "named",
            locationConfidence: entry.precision === "high" ? "HIGH" : "MEDIUM",
            zoneId: entry.zoneId,
            matchedName: name,
          };
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Assembled map model
// ---------------------------------------------------------------------------
export interface JakartaMapPoint {
  id: string;
  lat: number;
  lon: number;
  category: JakartaMapCategory;
  confidence: JakartaGeocodeConfidence;
  zoneId: string | null;
  severity: string;
}

export interface JakartaMapModel {
  points: JakartaMapPoint[];
  notMapped: {
    /** Resolvable to no honest location. */
    insufficientLocation: number;
    /** Located, but the incident type is not one of the five legend lanes. */
    typeNotMapped: number;
    /** insufficientLocation + typeNotMapped. */
    total: number;
  };
}

// Build the full set of plottable points plus the honest "not mapped" tallies.
// An incident is plotted ONLY when it has both a resolved position AND a
// recognised operational category; otherwise it is counted (never dropped) in
// the not-mapped note so the map's coverage is transparent.
export function buildJakartaMapModel(
  incidents: CountryFastFactsIncident[],
): JakartaMapModel {
  const points: JakartaMapPoint[] = [];
  let insufficientLocation = 0;
  let typeNotMapped = 0;

  for (let idx = 0; idx < incidents.length; idx++) {
    const i = incidents[idx];
    const geo = geocodeJakartaIncident(i);
    if (!geo) {
      insufficientLocation += 1;
      continue;
    }
    const category = categoriseJakartaMapIncident(i);
    if (!category) {
      typeNotMapped += 1;
      continue;
    }
    // Stable string id so collision offsets stay deterministic across renders.
    const id = i.id != null ? String(i.id) : `idx-${idx}`;
    points.push({
      id,
      lat: geo.lat,
      lon: geo.lon,
      category,
      confidence: geo.confidence,
      zoneId: geo.zoneId,
      severity: (i.severity ?? "").toLowerCase(),
    });
  }

  // Stable order (by id) so collision offsets are deterministic across renders.
  points.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    points,
    notMapped: {
      insufficientLocation,
      typeNotMapped,
      total: insufficientLocation + typeNotMapped,
    },
  };
}

export function operatingZoneById(id: string | null): JakartaOperatingZone | null {
  if (!id) return null;
  return ZONE_BY_ID[id] ?? null;
}
