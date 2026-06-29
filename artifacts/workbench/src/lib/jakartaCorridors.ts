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

// Operating-exposure scale for the Jakarta exposure map. This is the user's
// explicit scale for THIS graphic — it is an OPERATING-EXPOSURE axis (how badly
// movement / access / business could be disrupted), distinct from the report's
// incident-severity vocabulary {Insignificant, Low, Moderate, High, Extreme}.
// "not-assessed" is reserved for surrounding context geography that we do not
// profile as a business-exposure area (the regencies and the airport landmass).
export type JakartaExposureLevel =
  | "high"
  | "elevated"
  | "monitored"
  | "low"
  | "not-assessed";

export const JAKARTA_EXPOSURE_RANK: Record<JakartaExposureLevel, number> = {
  high: 4,
  elevated: 3,
  monitored: 2,
  low: 1,
  "not-assessed": 0,
};

// Live incident severity → operating-exposure mapping. A live record only ever
// RAISES an area's standing baseline; it never invents an exposure where the
// standing profile is lower than nothing.
const SEVERITY_TO_EXPOSURE: Record<string, JakartaExposureLevel> = {
  extreme: "high",
  high: "high",
  moderate: "elevated",
  low: "monitored",
  insignificant: "low",
};

export function severityToExposure(sevKey: string): JakartaExposureLevel | null {
  return SEVERITY_TO_EXPOSURE[(sevKey || "").toLowerCase()] ?? null;
}

export function maxExposure(
  a: JakartaExposureLevel,
  b: JakartaExposureLevel,
): JakartaExposureLevel {
  return JAKARTA_EXPOSURE_RANK[a] >= JAKARTA_EXPOSURE_RANK[b] ? a : b;
}

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
  /** Standing operating-exposure level for the area (its inherent profile,
   *  safe to state regardless of the live window). Live reporting can only
   *  RAISE the displayed level above this baseline, never invent below it. */
  baselineExposure: JakartaExposureLevel;
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
      "Protests near government buildings can close central roads at short notice.",
    action: "Check protest activity before travelling in; hold alternative routes.",
    baselineExposure: "elevated",
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
      "Dense offices and hotels mean incidents here hit staff and meetings directly.",
    action: "Confirm venues; stay alert around after-hours movement.",
    baselineExposure: "monitored",
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
      "City\u2013airport transfers run on congested, flood-prone toll routes.",
    action: "Allow extra buffer; confirm toll-route status before departure.",
    baselineExposure: "monitored",
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
      "Port and low-lying access roads drive logistics timings and flood easily.",
    action: "Confirm port access and flood status; build in delivery slack.",
    baselineExposure: "elevated",
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
      "Rain and flooding across Jabodetabek lengthen staff commutes and site access.",
    action: "Check flood-hit routes on heavy-rain days; allow extra time.",
    baselineExposure: "monitored",
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
      "Congestion on the main toll roads and arterials constrains daily movement.",
    action: "Build time buffers; brief drivers on closures.",
    baselineExposure: "monitored",
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

// ===========================================================================
// Live hazard classification — what was ACTUALLY reported this period
// ===========================================================================
//
// The area descriptions are NOT standing templates. A hazard (flooding,
// protest, crime…) is named ONLY when a live incident of that kind was
// attributed to the area this period. An area with no live reporting shows a
// neutral standing line that names NO active hazard; an area whose live records
// match no recognised hazard shows a generic "security-relevant activity"
// line. This keeps the map honest — it never asserts flooding when Jakarta is
// not flooding, protests when none were reported, and so on for every category.

export type JakartaHazard =
  | "protest"
  | "flooding"
  | "crime"
  | "fire"
  | "traffic"
  | "policing";

// Fixed priority for ordering/labelling when several hazards co-occur.
const HAZARD_PRIORITY: JakartaHazard[] = [
  "protest",
  "flooding",
  "crime",
  "fire",
  "traffic",
  "policing",
];

// Text patterns, tested in priority order (first match wins) over the
// masthead-stripped headline + location, so e.g. "police fire teargas at
// protest" reads as protest, not fire, and "gunmen open fire" reads as crime.
const HAZARD_PATTERNS: { hazard: JakartaHazard; re: RegExp }[] = [
  {
    hazard: "protest",
    re: /(protest|demonstrat|unrest|rally|riot|blockad|\bstrike|walkout|sit-in|\bdemo\b|labour action)/i,
  },
  {
    hazard: "flooding",
    re: /(flood|banjir|inundat|deluge|waterlogg|heavy rain)/i,
  },
  {
    hazard: "crime",
    re: /(robber|theft|burglar|break-in|carjack|assault|murder|homicid|stabb|shoot|gunm|gunfire|open fire|kidnap|extort|looting|\bcrime\b)/i,
  },
  {
    hazard: "fire",
    re: /(\bfire\b|blaze|wildfire|explos|conflagration)/i,
  },
  {
    hazard: "traffic",
    re: /(traffic|congestion|macet|gridlock|\btoll\b|highway|motorway|road closure|derail|\btrain\b|\bkrl\b|\bmrt\b|\blrt\b|busway|transjakarta|collision|pile-up)/i,
  },
  {
    hazard: "policing",
    re: /(police|raid|\barrest|crackdown|security operation|patrol|detain|manhunt)/i,
  },
];

// Classify a single incident's hazard from its text, or null when it matches no
// recognised hazard. Mirrors the corridor attribution's masthead strip.
export function hazardForIncident(
  i: CountryFastFactsIncident,
): JakartaHazard | null {
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();
  const hay = `${loc} ${title}`;
  for (const { hazard, re } of HAZARD_PATTERNS) {
    if (re.test(hay)) return hazard;
  }
  return null;
}

// Short factual noun phrase per hazard (lower-case, for the "… was reported"
// lead). "fire incidents" is the only plural.
const HAZARD_LEAD: Record<JakartaHazard, string> = {
  protest: "protest activity",
  flooding: "flooding or heavy rain",
  crime: "crime",
  fire: "fire incidents",
  traffic: "traffic or transport disruption",
  policing: "policing activity",
};

// Practical action per hazard (used when that hazard led the area this period).
const HAZARD_ACTION: Record<JakartaHazard, string> = {
  protest:
    "Check protest activity and hold alternative routes before travelling in.",
  flooding:
    "Check affected routes on heavy-rain days and allow extra time.",
  crime:
    "Maintain caution around after-hours movement and exposed public areas.",
  fire: "Confirm the status of affected areas before movement.",
  traffic: "Build in time buffers and brief drivers on possible closures.",
  policing:
    "Verify local conditions before travel; security activity can briefly restrict access.",
};

// Short Title-Case label per hazard, for the headless PDF "main exposure"
// column. Built ONLY from hazards actually reported this period.
const HAZARD_LABEL: Record<JakartaHazard, string> = {
  protest: "Protest",
  flooding: "Flooding / heavy rain",
  crime: "Crime",
  fire: "Fire",
  traffic: "Traffic",
  policing: "Policing",
};

// Short locative used in the factual lead, per area id.
const AREA_LOCATIVE: Record<string, string> = {
  "central-government": "around the central government district",
  "commercial-hotels": "across the main commercial and hotel areas",
  "airport-corridor": "on the Soekarno-Hatta airport corridor",
  "north-port": "around North Jakarta and the port area",
  "commuter-belt": "across the Greater Jakarta commuter belt",
  "cross-city-routes": "on the main cross-city movement routes",
};

function joinHazardLeads(xs: string[]): string {
  const a = xs.filter((s) => s.length > 0);
  if (a.length <= 1) return a[0] ?? "";
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

// Build the display-ready relevance + action for an area from what was ACTUALLY
// reported this period. No live reporting → neutral standing line (no hazard
// named). Live reporting but no recognised hazard → generic line. Otherwise the
// line names only the hazards that occurred, in priority order.
export function buildAreaProse(
  areaId: string,
  count: number,
  hazards: JakartaHazard[],
): { relevance: string; action: string } {
  const loc = AREA_LOCATIVE[areaId] ?? "here";
  if (count === 0) {
    return {
      relevance:
        "No specific incidents were reported here this period; the area's standing movement and access considerations continue to apply.",
      action: "Confirm local conditions before travel.",
    };
  }
  const ordered = HAZARD_PRIORITY.filter((h) => hazards.includes(h));
  if (ordered.length === 0) {
    return {
      relevance: `Security-relevant activity was reported ${loc} this period.`,
      action: "Confirm local conditions before travel.",
    };
  }
  const lead = joinHazardLeads(ordered.map((h) => HAZARD_LEAD[h]));
  const verb =
    ordered.length > 1 ? "were" : ordered[0] === "fire" ? "were" : "was";
  const relevance = `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${verb} reported ${loc} this period.`;
  return { relevance, action: HAZARD_ACTION[ordered[0]] };
}

// Short "main exposure" summary for the headless PDF table column, derived from
// what was ACTUALLY reported this period — never a standing hazard template, so
// the PDF never names a hazard the on-screen map does not.
export function hazardSummaryLabel(status: {
  count: number;
  hazards: JakartaHazard[];
}): string {
  if (status.count === 0) return "Standing profile";
  if (status.hazards.length === 0) return "Security-relevant activity";
  return status.hazards.map((h) => HAZARD_LABEL[h]).join(", ");
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
  /** Hazards actually reported in the area this period (priority order). */
  hazards: JakartaHazard[];
  /** Display-ready relevance line, derived from this period's reporting. */
  relevance: string;
  /** Display-ready action line, derived from this period's reporting. */
  action: string;
  /** The area's standing operating-exposure profile (window-independent). */
  baselineExposure: JakartaExposureLevel;
  /** Operating-exposure derived from this period's worst severity, or null
   *  when the area carried no live reporting. */
  liveExposure: JakartaExposureLevel | null;
  /** Displayed level = the higher of baseline and live. Live can only raise. */
  displayExposure: JakartaExposureLevel;
}

// Build the per-area this-week status from the live window plus the count of
// records that matched no area (carried in totals/tables, never plotted).
export function buildJakartaCorridorStatuses(
  incidents: CountryFastFactsIncident[],
  areas: JakartaCorridorArea[] = JAKARTA_CORRIDOR_AREAS,
): { statuses: JakartaCorridorStatus[]; unattributed: number } {
  const counts = areas.map(() => ({ count: 0, worstRank: 0, worstKey: "" }));
  const hazardSets: Set<JakartaHazard>[] = areas.map(() => new Set());
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
    const hz = hazardForIncident(i);
    if (hz) hazardSets[a].add(hz);
  }
  const statuses = areas.map((area, idx) => {
    const c = counts[idx];
    const baselineExposure = area.baselineExposure;
    const liveExposure =
      c.count > 0 ? severityToExposure(c.worstKey) : null;
    const displayExposure = liveExposure
      ? maxExposure(baselineExposure, liveExposure)
      : baselineExposure;
    const hazards = HAZARD_PRIORITY.filter((h) => hazardSets[idx].has(h));
    const prose = buildAreaProse(area.id, c.count, hazards);
    return {
      area,
      number: idx + 1,
      count: c.count,
      worstKey: c.count > 0 ? c.worstKey : "",
      elevated: c.count > 0,
      hazards,
      relevance: prose.relevance,
      action: prose.action,
      baselineExposure,
      liveExposure,
      displayExposure,
    };
  });
  return { statuses, unattributed };
}

// ===========================================================================
// Geographic 5-city exposure model (for the Leaflet exposure map overlay)
// ===========================================================================
//
// The corridor model above answers "which FUNCTION (movement / access /
// business activity) is exposed". The map instead shades the five real DKI
// Jakarta administrative cities by their operating exposure, so the choropleth
// drawn over the Leaflet basemap lines up with actual geography. The ids match
// the "city" feature ids in jakartaGeo.ts (north / west / central / east /
// south). Each city carries a STANDING baseline that live reporting can only
// RAISE, never invent — identical honesty rule to the corridor model.

export interface JakartaCity {
  /** Stable id — MUST match the geo "city" feature id in jakartaGeo.ts. */
  id: "north" | "west" | "central" | "east" | "south";
  /** Display name shown on the map label and legend. */
  name: string;
  /** Standing operating-exposure profile for the city (window-independent). */
  baselineExposure: JakartaExposureLevel;
  /** Lower-cased keywords that attribute an incident to this city. */
  keywords: string[];
}

// The five DKI cities in a fixed scan order (first match wins). Keywords are
// district-specific so cross-city leakage stays low; the central and southern
// business cores carry the higher standing baselines.
export const JAKARTA_CITIES: JakartaCity[] = [
  {
    id: "central",
    name: "Central Jakarta",
    baselineExposure: "elevated",
    keywords: [
      "central jakarta", "jakarta pusat", "menteng", "tanah abang", "gambir",
      "monas", "monumen nasional", "medan merdeka", "istana",
      "presidential palace", "parliament", "dpr", "mpr", "senen", "kemayoran",
      "sawah besar", "cempaka putih", "johar baru", "thamrin",
      "government district",
    ],
  },
  {
    id: "north",
    name: "North Jakarta",
    baselineExposure: "elevated",
    keywords: [
      "north jakarta", "jakarta utara", "tanjung priok", "priok",
      "kelapa gading", "penjaringan", "koja", "cilincing", "pademangan",
      "ancol", "sunter",
    ],
  },
  {
    id: "west",
    name: "West Jakarta",
    baselineExposure: "monitored",
    keywords: [
      "west jakarta", "jakarta barat", "grogol", "palmerah", "taman sari",
      "tambora", "kebon jeruk", "kembangan", "cengkareng", "kalideres",
      "slipi", "petamburan",
    ],
  },
  {
    id: "south",
    name: "South Jakarta",
    baselineExposure: "monitored",
    keywords: [
      "south jakarta", "jakarta selatan", "scbd", "sudirman", "kuningan",
      "setiabudi", "kebayoran", "mega kuningan", "senopati", "kemang", "tebet",
      "mampang", "pancoran", "cilandak", "senayan", "pasar minggu", "jagakarsa",
      "pesanggrahan",
    ],
  },
  {
    id: "east",
    name: "East Jakarta",
    baselineExposure: "low",
    keywords: [
      "east jakarta", "jakarta timur", "cakung", "jatinegara", "matraman",
      "pulo gadung", "pulogadung", "kramat jati", "duren sawit", "cipayung",
      "makasar", "ciracas", "pasar rebo", "rawamangun", "cawang", "halim",
    ],
  },
];

// Which city an incident belongs to: keyword match over its location text and
// (masthead-stripped) headline, scanned in display order (first match wins).
// Returns null when the record matches no city.
export function cityIndexForIncident(
  i: CountryFastFactsIncident,
  cities: JakartaCity[] = JAKARTA_CITIES,
): number | null {
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();
  const hay = `${loc} ${title}`;
  const matches = (p: string) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(p)}([^a-z]|$)`, "i").test(hay);

  for (let c = 0; c < cities.length; c++) {
    for (const p of cities[c].keywords) {
      if (matches(p)) return c;
    }
  }
  return null;
}

export interface JakartaCityStatus {
  city: JakartaCity;
  /** Live records attributed to the city in the active window. */
  count: number;
  /** Worst severity key present this period ("" when none). */
  worstKey: string;
  /** True when the city carried live reporting this period. */
  elevated: boolean;
  /** The city's standing operating-exposure profile (window-independent). */
  baselineExposure: JakartaExposureLevel;
  /** Operating-exposure derived from this period's worst severity, or null. */
  liveExposure: JakartaExposureLevel | null;
  /** Displayed level = the higher of baseline and live. Live can only raise. */
  displayExposure: JakartaExposureLevel;
}

// Build the per-city this-week status from the live window plus the count of
// records that matched no city (carried in totals/tables, never shaded).
export function buildJakartaCityStatuses(
  incidents: CountryFastFactsIncident[],
  cities: JakartaCity[] = JAKARTA_CITIES,
): { statuses: JakartaCityStatus[]; unattributed: number } {
  const counts = cities.map(() => ({ count: 0, worstRank: 0, worstKey: "" }));
  let unattributed = 0;
  for (const i of incidents) {
    const c = cityIndexForIncident(i, cities);
    if (c === null) {
      unattributed += 1;
      continue;
    }
    const cell = counts[c];
    cell.count += 1;
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > cell.worstRank) {
      cell.worstRank = r;
      cell.worstKey = k;
    }
  }
  const statuses = cities.map((city, idx) => {
    const cell = counts[idx];
    const baselineExposure = city.baselineExposure;
    const liveExposure = cell.count > 0 ? severityToExposure(cell.worstKey) : null;
    const displayExposure = liveExposure
      ? maxExposure(baselineExposure, liveExposure)
      : baselineExposure;
    return {
      city,
      count: cell.count,
      worstKey: cell.count > 0 ? cell.worstKey : "",
      elevated: cell.count > 0,
      baselineExposure,
      liveExposure,
      displayExposure,
    };
  });
  return { statuses, unattributed };
}
