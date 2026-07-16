// ===========================================================================
// Jakarta operating-posture map — pure model (no React, no Leaflet)
// ===========================================================================
//
// The live Jakarta city report "Operational Map" (§13) model. It reuses the
// honest, no-fabrication exposure model (buildJakartaCorridorStatuses) and the
// honest geocoder (buildJakartaMapModel), and frames the picture as SEVEN
// numbered operating zones (fixed order 1–7), FOUR route corridors, a
// right-hand "Movement posture this period" panel and a shaded-zone map.
// Rendered by JakartaCorridorMap (screen + in-app PDF) and, as a headless
// posture table, by renderStructuredBrief in exportCountryReportPdf.
//
// Nothing here changes relevance rules, ingestion, or any other report code.

import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import {
  buildJakartaCorridorStatuses,
  type JakartaCorridorStatus,
  type JakartaExposureLevel,
} from "@/lib/jakartaCorridors";
import {
  buildJakartaMapModel,
  categoriseJakartaMapIncident,
  geocodeJakartaIncident,
  type JakartaMapCategory,
  type JakartaMapModel,
} from "@/lib/jakartaMapModel";

// ---------------------------------------------------------------------------
// Exposure palette + labels (trial-local; safe, non-reserved hexes). Mirrors
// the live map's tints but with the EXACT rating vocabulary the task requires
// ("Not assessed", not "Not Assessed").
// ---------------------------------------------------------------------------
export const POSTURE_EXPOSURE_FILL: Record<JakartaExposureLevel, string> = {
  high: "#D98A8A",
  elevated: "#E4B073",
  monitored: "#E8CE7A",
  low: "#B9CE96",
  "not-assessed": "#D0D3D8",
};
export const POSTURE_EXPOSURE_ACCENT: Record<JakartaExposureLevel, string> = {
  high: "#8F2F2F",
  elevated: "#A85B1B",
  monitored: "#7E6A1E",
  low: "#4F6E32",
  "not-assessed": "#7C828B",
};
export const POSTURE_EXPOSURE_LABEL: Record<JakartaExposureLevel, string> = {
  high: "High",
  elevated: "Elevated",
  monitored: "Monitored",
  low: "Low",
  "not-assessed": "Not assessed",
};
// Legend order (five ratings, worst first).
export const POSTURE_EXPOSURE_ORDER: JakartaExposureLevel[] = [
  "high",
  "elevated",
  "monitored",
  "low",
  "not-assessed",
];

// ---------------------------------------------------------------------------
// Seven numbered operating zones, in the FIXED task order (1–7). Each carries a
// rectangular outline (drawn shaded on the trial map) around its real centre,
// its live-exposure corridor tie (corridorAreaId → buildJakartaCorridorStatuses)
// and zone-specific reason/action text (standing + elevated variants) so the
// panel never repeats generic wording across zones.
// ---------------------------------------------------------------------------
export type JakartaPostureIcon = "monument" | "anchor" | "plane";
export type JakartaPostureLabelSide = "top" | "bottom" | "left" | "right";

export interface JakartaPostureZoneDef {
  number: number;
  id: string;
  /** Panel + map name. */
  name: string;
  /** Drives the live exposure rating via buildJakartaCorridorStatuses. */
  corridorAreaId: string;
  /** Zone centre [lat, lon] — label + pin anchor. */
  center: [number, number];
  /** Rectangular outline ring [lat, lon] — source geometry for the soft blob. */
  polygon: [number, number][];
  /** Optional on-map glyph near the pin (govt monument / port anchor / plane). */
  icon?: JakartaPostureIcon;
  /** Preferred side to place the pin's name + rating chip (auto-clamped). */
  labelSide: JakartaPostureLabelSide;
  /** Zone-specific reason shown when NO live reporting elevates the zone. */
  standingReason: string;
  /** Zone-specific movement action for the standing (quiet) case. */
  standingAction: string;
  /** Zone-specific reason shown when live reporting elevated the zone. */
  elevatedReason: string;
  /** Zone-specific movement action for the elevated case. */
  elevatedAction: string;
}

// Build a rectangular ring around a centre point. Ring order is
// NW, NE, SE, SW so ring[0] projects to the top-left corner on screen.
function rect(
  lat: number,
  lon: number,
  hLat: number,
  hLon: number,
): [number, number][] {
  return [
    [lat + hLat, lon - hLon],
    [lat + hLat, lon + hLon],
    [lat - hLat, lon + hLon],
    [lat - hLat, lon - hLon],
  ];
}

export const JAKARTA_POSTURE_ZONES: JakartaPostureZoneDef[] = [
  {
    number: 1,
    id: "govt",
    name: "Central Jakarta government district",
    corridorAreaId: "central-government",
    center: [-6.168, 106.828],
    polygon: rect(-6.168, 106.828, 0.022, 0.02),
    icon: "monument",
    labelSide: "left",
    standingReason: "Protest and government area exposure.",
    standingAction: "Check demonstration activity before movement.",
    elevatedReason:
      "Reporting this period points to protest or security activity in the central government district.",
    elevatedAction:
      "Avoid the palace and parliament frontage on demonstration days and hold a fallback route.",
  },
  {
    number: 2,
    id: "priok",
    name: "Tanjung Priok / port access",
    corridorAreaId: "north-port",
    center: [-6.101, 106.884],
    polygon: rect(-6.101, 106.884, 0.013, 0.026),
    icon: "anchor",
    labelSide: "top",
    standingReason: "Port access and weather delay exposure.",
    standingAction: "Confirm terminal, gate and road status before dispatch.",
    elevatedReason:
      "Reporting this period indicates disruption around Tanjung Priok port operations or access.",
    elevatedAction:
      "Verify berth and gate availability and build in delay before committing loads.",
  },
  {
    number: 3,
    id: "north-access",
    name: "North Jakarta access roads",
    corridorAreaId: "north-port",
    center: [-6.14, 106.902],
    polygon: rect(-6.14, 106.902, 0.024, 0.019),
    labelSide: "right",
    standingReason: "Flooding and congestion exposure.",
    standingAction: "Check low lying approaches before movement.",
    elevatedReason:
      "Reporting this period flags flooding or congestion on the northern port-access roads.",
    elevatedAction:
      "Use inland alternates and delay low-clearance vehicles until water recedes.",
  },
  {
    number: 4,
    id: "sudirman-thamrin",
    name: "Sudirman / Thamrin",
    corridorAreaId: "commercial-hotels",
    center: [-6.202, 106.823],
    polygon: rect(-6.202, 106.823, 0.021, 0.009),
    labelSide: "left",
    standingReason: "Business corridor with disruption exposure.",
    standingAction: "Confirm road status before meetings.",
    elevatedReason:
      "Reporting this period raises protest or disruption risk along the Sudirman–Thamrin axis.",
    elevatedAction:
      "Time meetings around any march and keep a parallel Rasuna Said or toll alternate ready.",
  },
  {
    number: 5,
    id: "scbd-senayan",
    name: "SCBD / Senayan",
    corridorAreaId: "commercial-hotels",
    center: [-6.227, 106.8],
    polygon: rect(-6.227, 106.8, 0.015, 0.013),
    labelSide: "left",
    standingReason: "Office, hotel and venue movement exposure.",
    standingAction: "Allow extra transfer time.",
    elevatedReason:
      "Reporting this period points to congestion or an incident around SCBD / Senayan.",
    elevatedAction:
      "Allow extra transfer time and confirm venue access on event days.",
  },
  {
    number: 6,
    id: "kuningan",
    name: "Kuningan / Gatot Subroto",
    corridorAreaId: "commercial-hotels",
    center: [-6.236, 106.843],
    polygon: rect(-6.236, 106.843, 0.015, 0.013),
    labelSide: "right",
    standingReason: "Office and embassy corridor exposure.",
    standingAction: "Confirm route before executive movement.",
    elevatedReason:
      "Reporting this period flags disruption on the Kuningan / Gatot Subroto corridor.",
    elevatedAction:
      "Expect embassy-area controls and route via Mampang or the toll where possible.",
  },
  {
    number: 7,
    id: "airport",
    name: "Airport corridor",
    corridorAreaId: "airport-corridor",
    center: [-6.125, 106.657],
    polygon: rect(-6.125, 106.657, 0.016, 0.026),
    icon: "plane",
    labelSide: "right",
    standingReason: "Airport transfer route exposure.",
    standingAction: "Confirm toll road status before departure.",
    elevatedReason:
      "Reporting this period indicates congestion or disruption on the airport corridor.",
    elevatedAction:
      "Bring departures forward and keep the outer-ring alternate in reserve.",
  },
];

// ---------------------------------------------------------------------------
// Four route corridors (task order): Airport, Port, CBD business, North Jakarta
// access. Ordered [lat, lon] waypoints drawn as movement lines.
// ---------------------------------------------------------------------------
export interface JakartaPostureCorridor {
  id: string;
  label: string;
  path: [number, number][];
  labelAt?: number;
}

export const JAKARTA_POSTURE_CORRIDORS: JakartaPostureCorridor[] = [
  {
    id: "airport",
    label: "Airport corridor",
    // Realistic Sedyatmo toll route: east from Soekarno-Hatta, a northward
    // kink toward the Pluit/Kapuk junction, then the inner-ring toll curving
    // south into the Semanggi / government approach (not a straight line).
    path: [
      [-6.1256, 106.6559],
      [-6.114, 106.7],
      [-6.1075, 106.742],
      [-6.114, 106.775],
      [-6.14, 106.798],
      [-6.163, 106.808],
      [-6.174, 106.81],
    ],
    labelAt: 3,
  },
  {
    id: "port",
    label: "Port corridor",
    // Realistic port-access route: south-west out of Tanjung Priok along the
    // harbour toll, a gentle westward bow past Ancol / Kemayoran, then south
    // into the government district (not a straight diagonal).
    path: [
      [-6.104, 106.882],
      [-6.111, 106.871],
      [-6.121, 106.859],
      [-6.137, 106.851],
      [-6.156, 106.84],
      [-6.171, 106.83],
      [-6.176, 106.826],
    ],
    labelAt: 2,
  },
  {
    id: "cbd-business",
    label: "CBD business corridor",
    path: [
      [-6.1935, 106.823],
      [-6.209, 106.8215],
      [-6.2255, 106.8075],
      [-6.2285, 106.829],
    ],
    labelAt: 1,
  },
  {
    id: "north-access",
    label: "North Jakarta access",
    path: [
      [-6.105, 106.881],
      [-6.11, 106.9],
      [-6.113, 106.93],
    ],
    labelAt: 1,
  },
];

// ---------------------------------------------------------------------------
// Assembled trial model
// ---------------------------------------------------------------------------
export interface JakartaPostureZone extends JakartaPostureZoneDef {
  /** Live-derived operating exposure this period ("not-assessed" when quiet). */
  rating: JakartaExposureLevel;
  /** True when live reporting elevated the zone above its standing baseline. */
  elevated: boolean;
  /** Reason shown in the panel (zone-specific; elevated variant when raised). */
  reason: string;
  /** Movement action shown in the panel (zone-specific; elevated when raised). */
  action: string;
}

// A "major incident marker" for the map — plotted as a small dark diamond (no
// callout box, no icon). Built from the SAME honest geocoder + category
// classifier the live map uses, so a marker appears ONLY where a record carries
// a resolvable Jakarta location and a recognised operational type. It still
// carries a short category label + occurrence date on the model (kept for
// future use), but the map draws a single quiet point style.
export interface JakartaPostureMarker {
  id: string;
  lat: number;
  lon: number;
  /** Short category label, e.g. "Protest / rally" (model-only; not drawn). */
  label: string;
  /** Short occurrence date, e.g. "25 Jun" (empty when unknown). */
  dateLabel: string;
  severity: string;
}

export interface JakartaPostureModel {
  zones: JakartaPostureZone[];
  map: JakartaMapModel;
  markers: JakartaPostureMarker[];
}

// Short operational category label per map category (kept on the model only).
const POSTURE_MARKER_LABEL: Record<JakartaMapCategory, string> = {
  "protest-policing": "Protest / rally",
  "flooding-weather": "Flooding",
  "crime-safety": "Crime / safety",
  "fire-emergency": "Fire / emergency",
  "port-logistics": "Traffic disruption",
};

const POSTURE_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function postureShortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${POSTURE_MONTHS[d.getUTCMonth()]}`;
}

function buildPostureMarkers(
  incidents: CountryFastFactsIncident[],
): JakartaPostureMarker[] {
  const out: JakartaPostureMarker[] = [];
  for (let idx = 0; idx < incidents.length; idx++) {
    const i = incidents[idx];
    const geo = geocodeJakartaIncident(i);
    if (!geo) continue;
    const cat = categoriseJakartaMapIncident(i);
    if (!cat) continue;
    out.push({
      id: i.id != null ? String(i.id) : `idx-${idx}`,
      lat: geo.lat,
      lon: geo.lon,
      label: POSTURE_MARKER_LABEL[cat],
      dateLabel: postureShortDate(i.occurredAt),
      severity: (i.severity ?? "").toLowerCase(),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// Derive the seven-zone posture from live incidents WITHOUT fabrication: the
// rating comes straight from the shared corridor-status model, and the panel
// reason/action use the ZONE-SPECIFIC elevated text only when the zone was
// actually elevated by reporting; otherwise the zone-specific standing profile
// text is shown. No invented incidents — the text describes the zone's
// exposure character, gated on a real elevation flag.
// Pure zone derivation from already-computed corridor statuses. Shared by the
// on-screen model builder AND the headless PDF posture table so both surfaces
// render the identical seven-zone rating/reason/action set.
export function buildJakartaPostureZones(
  statuses: JakartaCorridorStatus[],
): JakartaPostureZone[] {
  const byArea = new Map<string, JakartaCorridorStatus>();
  for (const s of statuses) byArea.set(s.area.id, s);

  return JAKARTA_POSTURE_ZONES.map((z) => {
    const st = byArea.get(z.corridorAreaId) ?? null;
    const rating: JakartaExposureLevel = st ? st.displayExposure : "not-assessed";
    const elevated = st ? st.elevated : false;
    return {
      ...z,
      rating,
      elevated,
      reason: elevated ? z.elevatedReason : z.standingReason,
      action: elevated ? z.elevatedAction : z.standingAction,
    };
  });
}

export function buildJakartaPostureModel(
  incidents: CountryFastFactsIncident[],
): JakartaPostureModel {
  const corridor = buildJakartaCorridorStatuses(incidents);
  return {
    zones: buildJakartaPostureZones(corridor.statuses),
    map: buildJakartaMapModel(incidents),
    markers: buildPostureMarkers(incidents),
  };
}
