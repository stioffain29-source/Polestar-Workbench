// Jakarta corridor & access model for the country report's map graphic.
//
// The Jakarta report is about OPERATING EXPOSURE — movement, access and business
// disruption across the capital — not single incident points. So instead of the
// numbered severity dots used elsewhere, Jakarta gets a clean corridor & access
// schematic answering one practical question: where could movement, access or
// business activity be disrupted this week?
//
// This module is PURE (TYPE-only incident import, no runtime/DOM dependency) so
// it is directly unit-testable. It defines the six functional areas, the
// keyword rules that attribute live Jakarta incidents to them (mirroring the
// existing zoneIndexForIncident approach, including the airport-corridor
// pre-pass), and a status builder that marks each area ELEVATED this week (it
// carried live reporting) or STANDING/MONITORED (no reporting this period — a
// standing exposure profile, never fabricated activity).

import type { CountryFastFactsIncident } from "./countryFastFacts";

// The monochrome icon glyph drawn for each area's dominant exposure type. No
// emojis, no colour in the glyph itself — the glyph is monochrome and the
// this-week status is conveyed separately.
export type JakartaExposureIcon =
  | "crowd" // protest
  | "flood" // rain / flooding
  | "road" // cross-city movement
  | "plane" // airport transfer
  | "port" // logistics / port
  | "building"; // commercial / offices

export interface JakartaCorridorArea {
  /** Stable id (used as React key and in tests). */
  id: string;
  /** Display name shown on the schematic and in the exposure table. */
  name: string;
  /** Short marker label (kept tight so the schematic does not crowd). */
  shortName: string;
  /** Dominant exposure type — the standing "Main exposure" descriptor. */
  exposure: string;
  /** Monochrome icon matching the exposure type. */
  icon: JakartaExposureIcon;
  /** Standing operational-relevance descriptor (why it matters for business). */
  relevance: string;
  /** Practical standing action for the area. */
  action: string;
  /** Rough geographic position on the schematic, as a percentage of the box. */
  pos: { x: number; y: number };
  /** Lower-cased keywords that attribute an incident to this area. */
  keywords: string[];
  /** When true this area's keywords are checked FIRST (airport pre-pass), so an
   *  airport-specific token wins over a generic district token. */
  airportPrePass?: boolean;
}

// The six Jakarta corridor / access areas, in fixed display order (1–6). Each
// carries a STANDING exposure profile (what the area is known for) — these
// descriptors are not this-period claims, so they are safe to state regardless
// of the live window. The live window only flips an area between ELEVATED and
// STANDING; it never invents an exposure.
export const JAKARTA_CORRIDOR_AREAS: JakartaCorridorArea[] = [
  {
    id: "central-government",
    name: "Central Jakarta government district",
    shortName: "Central Govt District",
    exposure: "Protest and policing disruption",
    icon: "crowd",
    relevance:
      "Demonstrations and police lines around government buildings and main thoroughfares can close roads and slow access at short notice.",
    action:
      "Check protest activity before travelling into the government district; keep alternative routes ready.",
    pos: { x: 48, y: 45 },
    keywords: [
      "central jakarta", "jakarta pusat", "menteng", "tanah abang", "gambir",
      "monas", "monumen nasional", "medan merdeka", "istana", "presidential palace",
      "parliament", "dpr", "mpr", "senen", "kemayoran", "sawah besar",
      "cempaka putih", "johar baru", "government district",
    ],
  },
  {
    id: "commercial-hotels",
    name: "Main commercial & hotel areas",
    shortName: "Commercial & Hotels",
    exposure: "Office, client-meeting and visitor exposure",
    icon: "building",
    relevance:
      "Concentrates offices, hotels and client sites; incidents here bear directly on staff, meetings and visitor movement.",
    action:
      "Maintain caution around after-hours movement near offices, hotels and exposed public areas; confirm venues before meetings.",
    pos: { x: 51, y: 63 },
    keywords: [
      "south jakarta", "jakarta selatan", "scbd", "sudirman", "kuningan",
      "thamrin", "senayan", "setiabudi", "kebayoran", "mega kuningan",
      "senopati", "kemang", "tebet", "mampang", "pancoran", "cilandak",
      "business district", "central business district", "office tower",
      "shopping mall", "hotel",
    ],
  },
  {
    id: "airport-corridor",
    name: "Soekarno-Hatta airport corridor",
    shortName: "Airport Corridor",
    exposure: "Airport-transfer disruption",
    icon: "plane",
    relevance:
      "Transfers between the city and Soekarno-Hatta run through congested, flood-sensitive toll routes; disruption lengthens airport runs.",
    action:
      "Allow additional buffer on airport transfers; confirm the toll-route status before departure.",
    pos: { x: 13, y: 39 },
    airportPrePass: true,
    keywords: [
      "soekarno-hatta", "soekarno hatta", "soetta", "cgk", "bandara soekarno",
      "cengkareng", "airport corridor", "airport",
    ],
  },
  {
    id: "north-port",
    name: "North Jakarta & port area",
    shortName: "North & Port",
    exposure: "Logistics, flooding and access disruption",
    icon: "port",
    relevance:
      "Port, warehousing and low-lying access roads here drive logistics timings and are exposed to tidal and rain flooding.",
    action:
      "Confirm port-area access and flood status before logistics movements; build slack into delivery windows.",
    pos: { x: 64, y: 16 },
    keywords: [
      "north jakarta", "jakarta utara", "tanjung priok", "priok",
      "kelapa gading", "penjaringan", "koja", "cilincing", "pademangan",
      "ancol", "sunter", "port", "harbour", "harbor", "container terminal",
      "dock", "warehouse",
    ],
  },
  {
    id: "commuter-belt",
    name: "Greater Jakarta commuter belt",
    shortName: "Commuter Belt",
    exposure: "Rain, flooding and congestion exposure",
    icon: "flood",
    relevance:
      "Heavy rain and flooding across Jabodetabek lengthen commuting and site access for staff living outside the centre.",
    action:
      "Check flood-affected routes before staff travel on heavy-rain days; allow extra commuting time.",
    pos: { x: 30, y: 85 },
    keywords: [
      "greater jakarta", "jabodetabek", "bekasi", "depok", "tangerang",
      "bogor", "south tangerang", "tangsel", "cikarang", "serpong", "bsd",
      "flood", "flooding", "banjir", "heavy rain", "inundation",
    ],
  },
  {
    id: "cross-city-routes",
    name: "Main cross-city movement routes",
    shortName: "Cross-City Routes",
    exposure: "Meeting, site-visit and staff-movement delays",
    icon: "road",
    relevance:
      "Congestion on the main toll roads and arterials is a daily planning constraint on meetings, deliveries and transfers.",
    action:
      "Build time buffers into cross-city movement; brief drivers on the day's congestion and closure points.",
    pos: { x: 80, y: 60 },
    keywords: [
      "toll", "tol road", "jagorawi", "jorr", "inner ring", "outer ring",
      "highway", "motorway", "traffic", "macet", "congestion", "gridlock",
      "transjakarta", "busway", "mrt", "lrt", "krl", "commuter line",
      "cross-city", "arterial",
    ],
  },
];

// Severity ordering — the HIGHEST severity present in an area drives its
// elevated-status colour, so an Extreme record is never hidden under a lower tier.
const SEV_RANK: Record<string, number> = {
  extreme: 5,
  high: 4,
  moderate: 3,
  low: 2,
  insignificant: 1,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Light masthead strip: drop a trailing " - Source" / " | Source" tail so a
// publisher name never supplies a false keyword match.
function stripMasthead(title: string): string {
  return title.replace(/\s*[-|–—]\s*[^-|–—]{2,40}$/u, "").trim();
}

// Which area an incident belongs to: keyword match over its location text and
// (masthead-stripped) headline. Mirrors zoneIndexForIncident — the airport
// pre-pass runs first so an airport-specific token beats a generic district
// token, then the areas are scanned in display order (first match wins).
// Returns null when the record matches no area.
export function corridorIndexForIncident(
  i: CountryFastFactsIncident,
  areas: JakartaCorridorArea[] = JAKARTA_CORRIDOR_AREAS,
): number | null {
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();
  const hay = `${loc} ${title}`;
  const matches = (p: string) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(p)}([^a-z]|$)`, "i").test(hay);

  const airportIdx = areas.findIndex((a) => a.airportPrePass);
  if (airportIdx >= 0 && areas[airportIdx].keywords.some(matches)) {
    return airportIdx;
  }
  for (let a = 0; a < areas.length; a++) {
    for (const p of areas[a].keywords) {
      if (matches(p)) return a;
    }
  }
  return null;
}

export interface JakartaCorridorStatus {
  area: JakartaCorridorArea;
  /** 1-based display number. */
  number: number;
  /** Live records attributed to the area in the active window. */
  count: number;
  /** Worst severity key present this period ("" when none). */
  worstKey: string;
  /** True when the area carried live reporting this period. */
  elevated: boolean;
}

// Build the per-area this-week status from the live window plus the count of
// records that matched no area (carried in totals/tables, never plotted).
export function buildJakartaCorridorStatuses(
  incidents: CountryFastFactsIncident[],
  areas: JakartaCorridorArea[] = JAKARTA_CORRIDOR_AREAS,
): { statuses: JakartaCorridorStatus[]; unattributed: number } {
  const counts = areas.map(() => ({ count: 0, worstRank: 0, worstKey: "" }));
  let unattributed = 0;
  for (const i of incidents) {
    const a = corridorIndexForIncident(i, areas);
    if (a === null) {
      unattributed += 1;
      continue;
    }
    const c = counts[a];
    c.count += 1;
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > c.worstRank) {
      c.worstRank = r;
      c.worstKey = k;
    }
  }
  const statuses = areas.map((area, idx) => {
    const c = counts[idx];
    return {
      area,
      number: idx + 1,
      count: c.count,
      worstKey: c.count > 0 ? c.worstKey : "",
      elevated: c.count > 0,
    };
  });
  return { statuses, unattributed };
}
