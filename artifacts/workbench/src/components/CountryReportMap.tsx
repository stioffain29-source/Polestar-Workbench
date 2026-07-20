import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import { stripWireCruft } from "@/lib/incidentTitle";
import {
  impactForIncident,
  impactLevelForSet,
  businessRelevance,
  worstSeverityKey,
  IMPACT_COLOR,
  IMPACT_ORDER,
  IMPACT_RANK,
  OPERATIONAL_MAP_HEADING,
  OPERATIONAL_MAP_SUBTITLE,
  OPERATIONAL_MAP_READ,
  type ImpactLevel,
} from "@/lib/operationalPinchPoints";

const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};

// Severity ordering used to pick the colour for a marker that represents several
// incidents sharing one coordinate — the HIGHEST severity present wins, so an
// Extreme record is never hidden under a lower-severity dot.
const SEV_RANK: Record<string, number> = {
  extreme: 5,
  high: 4,
  moderate: 3,
  low: 2,
  insignificant: 1,
};

const POLAR = "#e2e2e2";
const DUSK = "#363636";
const NAVY = "#0B0B3D";
const ELECTRIC = "#4655FF";

export interface CountryReportMapProps {
  incidents: CountryFastFactsIncident[];
  /** Optional DOM id used by html2canvas during PDF export. */
  domId?: string;
  /** Report country name — used to centre the map when nothing is plottable. */
  countryName?: string;
}

// Default map view per report country. When the active window holds no records
// with coordinates, the map centres on the report's own country instead of a
// generic world view. Centroids mirror COUNTRY_CENTROIDS in the ingest geocoder.
const COUNTRY_VIEW: Record<string, { center: L.LatLngTuple; zoom: number }> = {
  "papua new guinea": { center: [-6.31, 143.96], zoom: 5 },
  png: { center: [-6.31, 143.96], zoom: 5 },
  papua: { center: [-4.0, 138.0], zoom: 5 },
  "west papua": { center: [-2.5, 138.0], zoom: 5 },
  indonesia: { center: [-2.5, 118.0], zoom: 4 },
  thailand: { center: [13.2, 101.0], zoom: 5 },
  philippines: { center: [12.5, 122.0], zoom: 5 },
};

function resolveCountryView(name?: string): { center: L.LatLngTuple; zoom: number } | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_VIEW[key] ?? null;
}

// Translucent fill from a solid posture hex, so the on-map markers read as light
// coloured bubbles (owner preference) rather than heavy solid discs, while the
// solid hue is kept for the crisp ring and numeral.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Area-risk ("numbered callout") zones.
//
// The GLOBAL REPORT CONTENT AND MAP STANDARD requires country reports to show
// RISK AREAS rather than raw database points: country incidents geocode to a
// small fixed set of province / regency centroids (and ~40% carry no location
// text at all, landing on a generic country centroid), so plotting them as
// exact dots is misleading. Instead, for a configured country we aggregate the
// window into a handful of named risk zones, drop ONE numbered, severity-
// coloured marker on each ACTIVE zone, and list "n. Zone — Severity"
// in the legend. Empty zones are omitted entirely (no "not reported" filler);
// records that match no zone are counted in an explicit note, never invented
// onto the map. Countries with no zone config fall back to the per-coordinate
// dot map below.
// ---------------------------------------------------------------------------
interface RiskZoneDef {
  name: string;
  // Standing risk characterisation of the area — what it is known for. Shown as
  // a muted note in the area-risk legend. Optional: only the Papua zones carry
  // one; other countries' zones read from data alone. This describes the zone's
  // established profile, not this reporting period's incidents, so it adds
  // analyst context without fabricating anything about the current window.
  description?: string;
  // Where the numbered marker is dropped.
  center: L.LatLngTuple;
  // Lower-cased place keywords (regencies, towns, provinces) that place an
  // incident in this zone when found in its location text or headline.
  places: string[];
  // Exact geocoder centroid "lat,lng" strings that belong to this zone, used as
  // a fallback when the location text is empty.
  coords?: string[];
  // When true, this zone is ALWAYS shown on the map (even with zero records this
  // period) as a fixed-numbered, neutral-grey marker with no severity label.
  // Used by the Jakarta callout map so its six business areas always appear in a
  // stable 1–6 order; other theatres leave it unset and keep the active-only
  // (count>0) behaviour, so their maps are unchanged.
  alwaysShow?: boolean;
}

// Indonesian Papua (West Papua) risk zones, in display order. Shared by the
// "papua" and "west papua" reports. PNG keeps the dot map until its own zones
// are configured.
const PAPUA_ZONES: RiskZoneDef[] = [
  {
    name: "Central Highlands",
    description: "Armed-group and security-force activity.",
    center: [-3.9, 138.6],
    places: [
      "central highlands",
      "highlands",
      "wamena",
      "jayawijaya",
      "nduga",
      "tolikara",
      "lanny jaya",
      "yahukimo",
      "pegunungan bintang",
      "yalimo",
      "mamberamo tengah",
      "puncak",
      "intan jaya",
      "sugapa",
      "agisiga",
      "ilaga",
      "kenyam",
      "oksibil",
    ],
    coords: ["-3.73,137.03"],
  },
  {
    name: "Jayapura & North Coast",
    description: "Urban and access-route monitoring.",
    center: [-2.2, 140.2],
    places: [
      "jayapura",
      "sentani",
      "keerom",
      "sarmi",
      "biak",
      "supiori",
      "waropen",
      "mamberamo raya",
    ],
    coords: ["-2.53,140.72", "-1.18,136.08"],
  },
  {
    name: "Bird's Head",
    description: "Infrastructure, fire and local disruption monitoring.",
    center: [-1.3, 133.6],
    places: [
      "bird's head",
      "birds head",
      "manokwari",
      "bintuni",
      "teluk bintuni",
      "wondama",
      "teluk wondama",
      "fakfak",
      "fak-fak",
      "kaimana",
    ],
    coords: ["-0.86,134.06"],
  },
  {
    name: "Papua Tengah",
    description: "Intan Jaya movement and security risk.",
    center: [-3.9, 136.1],
    places: [
      "papua tengah",
      "central papua",
      "nabire",
      "mimika",
      "timika",
      "paniai",
      "dogiyai",
      "deiyai",
      "puncak jaya",
    ],
    coords: ["-4.55,136.89"],
  },
  {
    name: "Papua Barat Daya",
    description: "Crime, fire and disruption monitoring.",
    center: [-1.1, 132.0],
    places: [
      "papua barat daya",
      "southwest papua",
      "sorong",
      "raja ampat",
      "tambrauw",
      "maybrat",
      "klademak",
      "klamono",
      "aimas",
    ],
    coords: ["-0.88,131.25"],
  },
];

// National Indonesia risk zones — the six macro-regions the Indonesia
// operating-risk brief groups incidents into (Papua is routed to the dedicated
// West Papua brief upstream, so it has no zone here). Province names and major
// city names are the place keywords; "java" alone is deliberately absent so West
// Java and Central/East Java never collide.
//
// These are REPORTING-DRIVEN, like every other country map: a macro-region is
// only plotted when the current window carries a reported event there, and its
// posture is derived from that reporting (frequency + business impact), never a
// standing assessment. No alwaysShow, no standing description, no fixed label —
// aggregateZones returns only the regions with records this period.
export const INDONESIA_ZONES: RiskZoneDef[] = [
  {
    name: "Greater Jakarta & West Java",
    center: [-6.5, 107.2],
    places: [
      "jakarta", "dki jakarta", "jabodetabek", "bekasi", "depok",
      "tangerang", "bogor", "banten", "serang", "cilegon",
      "west java", "jawa barat", "bandung", "sukabumi", "cirebon",
      "garut", "tasikmalaya", "karawang", "cianjur", "cimahi",
    ],
  },
  {
    name: "Central & East Java",
    center: [-7.5, 111.6],
    places: [
      "central java", "jawa tengah", "semarang", "solo", "surakarta",
      "yogyakarta", "jogja", "magelang", "tegal", "purwokerto", "pekalongan",
      "east java", "jawa timur", "surabaya", "malang", "sidoarjo",
      "gresik", "kediri", "madura", "banyuwangi", "jember", "mojokerto", "madiun",
    ],
  },
  {
    name: "Sumatra",
    center: [-0.5, 101.5],
    places: [
      "sumatra", "sumatera", "medan", "north sumatra", "west sumatra",
      "padang", "palembang", "south sumatra", "riau", "pekanbaru",
      "batam", "lampung", "bandar lampung", "aceh", "banda aceh",
      "jambi", "bengkulu", "bangka", "belitung", "pangkalpinang", "dumai", "binjai",
    ],
  },
  {
    name: "Kalimantan / Borneo",
    center: [0.0, 114.0],
    places: [
      "kalimantan", "borneo", "pontianak", "banjarmasin", "balikpapan",
      "samarinda", "palangkaraya", "palangka raya", "tarakan", "singkawang", "banjarbaru",
    ],
  },
  {
    name: "Sulawesi",
    center: [-2.0, 120.5],
    places: [
      "sulawesi", "makassar", "manado", "palu", "kendari", "gorontalo",
      "mamuju", "parepare", "bitung", "kotamobagu", "palopo",
    ],
  },
  {
    name: "Bali, Nusa Tenggara & Maluku",
    center: [-7.5, 119.5],
    places: [
      "bali", "denpasar", "nusa tenggara", "lombok", "mataram", "kupang",
      "flores", "sumbawa", "bima", "maluku", "ambon", "ternate", "tidore", "north maluku",
    ],
  },
];

// Jakarta risk zones, in the spec's numbered-callout order (Central, South,
// West, North, East, airport corridor) with a Greater-Jakarta fallback. Each
// carries a standing-profile description shown muted in the legend. The airport
// corridor is matched on airport-specific tokens ONLY (so a generic West-Jakarta
// item never grabs it); "cengkareng" lives here, not in West Jakarta, because in
// Jakarta reporting it overwhelmingly denotes the Soekarno-Hatta corridor. It
// sits before the Greater-Jakarta fallback so an airport item resolves to it.
export const JAKARTA_ZONES: RiskZoneDef[] = [
  {
    name: "Central Jakarta",
    description: "Protest and government-district disruption.",
    center: [-6.18, 106.83],
    alwaysShow: true,
    places: [
      "central jakarta", "jakarta pusat", "menteng", "tanah abang", "gambir",
      "senen", "cempaka putih", "kemayoran", "johar baru", "sawah besar",
    ],
  },
  {
    name: "South Jakarta",
    description: "Office, embassy and commercial-area exposure.",
    center: [-6.28, 106.81],
    alwaysShow: true,
    places: [
      "south jakarta", "jakarta selatan", "kebayoran", "tebet", "setiabudi",
      "mampang", "pancoran", "cilandak", "pasar minggu", "jagakarsa",
      "pesanggrahan", "sudirman", "kuningan", "scbd", "senayan",
    ],
  },
  {
    name: "West Jakarta",
    description: "Congestion, crime and access disruption.",
    center: [-6.16, 106.76],
    alwaysShow: true,
    places: [
      "west jakarta", "jakarta barat", "grogol", "kembangan", "palmerah",
      "taman sari", "tambora", "kebon jeruk", "kalideres",
    ],
  },
  {
    name: "North Jakarta",
    description: "Port, flooding and logistics exposure.",
    center: [-6.12, 106.87],
    alwaysShow: true,
    places: [
      "north jakarta", "jakarta utara", "tanjung priok", "kelapa gading",
      "penjaringan", "koja", "cilincing", "pademangan", "ancol", "sunter",
    ],
  },
  {
    name: "East Jakarta",
    description: "Road movement and residential disruption.",
    center: [-6.23, 106.90],
    alwaysShow: true,
    places: [
      "east jakarta", "jakarta timur", "cakung", "jatinegara", "duren sawit",
      "pulo gadung", "matraman", "kramat jati", "makasar", "ciracas",
      "cipayung", "pasar rebo", "rawamangun",
    ],
  },
  {
    name: "Soekarno-Hatta Airport Corridor",
    description: "Airport-transfer disruption.",
    center: [-6.1256, 106.6558],
    alwaysShow: true,
    places: [
      "soekarno-hatta", "soekarno hatta", "soetta", "cgk",
      "bandara soekarno", "cengkareng", "airport corridor",
    ],
  },
  {
    name: "Greater Jakarta (Jabodetabek)",
    description: "Wider Jabodetabek commuter belt.",
    center: [-6.4, 106.85],
    places: [
      "greater jakarta", "jabodetabek", "bekasi", "depok", "tangerang",
      "bogor", "south tangerang", "tangsel", "cikarang", "serpong", "bsd",
    ],
  },
];

const RISK_MAP_ZONES: Record<string, RiskZoneDef[]> = {
  papua: PAPUA_ZONES,
  "west papua": PAPUA_ZONES,
  indonesia: INDONESIA_ZONES,
  jakarta: JAKARTA_ZONES,
};

function resolveRiskZones(name?: string): RiskZoneDef[] | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return RISK_MAP_ZONES[key] ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Drop a trailing " - Source" / " | Source" masthead tail before keyword
// matching, so a publisher name never pulls an incident into the wrong zone.
function stripMasthead(title: string): string {
  const cut = title.replace(/\s*[-|]\s*[^-|]{2,40}$/i, "").trim();
  return cut.length >= 8 ? cut : title;
}

// Which zone (by index) an incident belongs to: place-keyword match over its
// location text and headline first, then an exact geocoder-centroid match.
// Returns null when the record matches no configured zone.
export function zoneIndexForIncident(i: CountryFastFactsIncident, zones: RiskZoneDef[]): number | null {
  const loc = (i.location ?? "").toLowerCase();
  const title = stripMasthead(
    ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim(),
  ).toLowerCase();
  const hay = `${loc} ${title}`;
  const matches = (p: string) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(p)}([^a-z]|$)`, "i").test(hay);
  // Airport-corridor pre-pass: airport-specific tokens must win over a generic
  // district token. "Cengkareng, West Jakarta" denotes the Soekarno-Hatta
  // corridor, but West Jakarta sits earlier in display order and would grab it
  // first. Checking the airport zone's tokens before the in-order scan keeps the
  // spec's numbered-callout order intact without mis-bucketing. No-op for
  // theatres with no airport zone (findIndex → -1), so other maps are unchanged.
  const airportIdx = zones.findIndex(
    (z) => z.name === "Soekarno-Hatta Airport Corridor",
  );
  if (airportIdx >= 0 && zones[airportIdx].places.some(matches)) {
    return airportIdx;
  }
  for (let z = 0; z < zones.length; z++) {
    for (const p of zones[z].places) {
      if (matches(p)) return z;
    }
  }
  if (
    typeof i.latitude === "number" &&
    typeof i.longitude === "number" &&
    !Number.isNaN(i.latitude) &&
    !Number.isNaN(i.longitude)
  ) {
    const key = `${i.latitude},${i.longitude}`;
    for (let z = 0; z < zones.length; z++) {
      if (zones[z].coords?.includes(key)) return z;
    }
  }
  return null;
}

interface ActiveZone {
  def: RiskZoneDef;
  number: number;
  count: number;
  worstKey: string;
  // The incidents that matched this zone this period — used to derive the
  // reporting-driven "reported issue" headline, business relevance and posture.
  incidents: CountryFastFactsIncident[];
}

// Aggregate the window into active zones (count + worst severity each, numbered
// in config order) plus the count of records that matched no zone. Exported for
// the Jakarta map-zone tests, which pin the alwaysShow fixed-numbering contract.
export function aggregateZones(
  incidents: CountryFastFactsIncident[],
  zones: RiskZoneDef[],
): { active: ActiveZone[]; unattributed: number } {
  const counts = zones.map(() => ({ count: 0, worstRank: 0, worstKey: "" }));
  const members: CountryFastFactsIncident[][] = zones.map(() => []);
  let unattributed = 0;
  for (const i of incidents) {
    const z = zoneIndexForIncident(i, zones);
    if (z === null) {
      unattributed += 1;
      continue;
    }
    const c = counts[z];
    c.count += 1;
    members[z].push(i);
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > c.worstRank) {
      c.worstRank = r;
      c.worstKey = k;
    }
  }
  // Build the numbered active list. alwaysShow zones (the Jakarta callout areas)
  // appear in fixed config order even at zero count — rendered as neutral-grey
  // markers with no severity — so the six business areas keep a stable 1–6
  // numbering. Other zones (and theatres with no alwaysShow flag at all) are
  // included only when they carry records, appended after any fixed zones, so
  // their maps are unchanged. Numbering follows inclusion order: fixed zones own
  // 1..k and a populated fallback (e.g. Greater Jakarta) takes the next number.
  const active: ActiveZone[] = [];
  zones.forEach((def, idx) => {
    const c = counts[idx];
    if (!def.alwaysShow && c.count === 0) return;
    active.push({
      def,
      number: active.length + 1,
      count: c.count,
      worstKey: c.count > 0 ? c.worstKey : "",
      incidents: members[idx],
    });
  });
  return { active, unattributed };
}

// ---------------------------------------------------------------------------
// Shared Operational-Map render helpers + derivation (used by BOTH the zone and
// dot render paths so screen == in-app PDF and the two modes never diverge).
// These reader-facing pieces MUST live in the render body — renderToStaticMarkup
// (the owner-gated test substitute for a screenshot) runs the body, not effects.
// ---------------------------------------------------------------------------

// The single reporting-driven marker/card unit for both modes.
interface ImpactPoint {
  key: string;
  // Numbered cross-reference to the on-map marker (zone mode); null in dot mode,
  // where markers are located by name rather than numbered.
  marker: string | null;
  location: string;
  issue: string;
  relevance: string;
  impact: ImpactLevel;
}

// A per-coordinate dot group in the non-zone ("all other countries") mode.
interface DotGroup {
  lat: number;
  lng: number;
  members: CountryFastFactsIncident[];
  count: number;
  worstKey: string;
  impact: ImpactLevel;
  location: string;
  lead: CountryFastFactsIncident;
}

// Clean a headline for the "reported issue" line: drop the masthead tail and any
// wire/video cruft. Display-only, no fabrication.
function cleanIssue(i: CountryFastFactsIncident): string {
  const raw = ((i.displayTitle && i.displayTitle.trim()) || i.title || "").trim();
  const cleaned = stripWireCruft(stripMasthead(raw)).trim();
  return cleaned || "Reported incident";
}

// Re-case a free-text location for the card without inventing precision — only
// the text the record already carries is capitalised.
function titleCaseLocation(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 2 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// The incident that leads (and drives the impact level of) a location's card:
// highest operational IMPACT first, then highest severity, then most recent. This
// keeps the card internally consistent — the headline shown is the very event
// that justifies the impact level and business-relevance line.
function leadIncident(list: CountryFastFactsIncident[]): CountryFastFactsIncident {
  let lead = list[0];
  let leadImp = IMPACT_RANK[impactForIncident(lead)] ?? 0;
  let leadRank = SEV_RANK[(lead?.severity ?? "").toLowerCase()] ?? 0;
  let leadTime = Date.parse(lead?.occurredAt ?? "") || 0;
  for (const i of list) {
    const imp = IMPACT_RANK[impactForIncident(i)] ?? 0;
    const r = SEV_RANK[(i.severity ?? "").toLowerCase()] ?? 0;
    const t = Date.parse(i.occurredAt ?? "") || 0;
    if (imp > leadImp || (imp === leadImp && (r > leadRank || (r === leadRank && t > leadTime)))) {
      lead = i;
      leadImp = imp;
      leadRank = r;
      leadTime = t;
    }
  }
  return lead;
}

function OperationalMapHeader() {
  return (
    <div style={{ fontFamily: "Roboto, sans-serif", marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>
        {OPERATIONAL_MAP_HEADING}
      </div>
      <div style={{ fontSize: 12, color: DUSK, marginTop: 2 }}>{OPERATIONAL_MAP_SUBTITLE}</div>
    </div>
  );
}

function ImpactChip({ impact }: { impact: ImpactLevel }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: IMPACT_COLOR[impact],
        color: "#fff",
        fontFamily: "Roboto, sans-serif",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: "3px 7px",
        borderRadius: 2,
        whiteSpace: "nowrap",
      }}
    >
      Impact level: {impact}
    </span>
  );
}

function ImpactLegend() {
  return (
    <div className="mt-3" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {IMPACT_ORDER.map((p) => (
        <div key={p} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: IMPACT_COLOR[p],
              border: `1px solid ${POLAR}`,
            }}
          />
          <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>{p}</span>
        </div>
      ))}
    </div>
  );
}

function MapReadNote() {
  return (
    <div
      className="mt-3"
      style={{
        background: "#ffffff",
        border: `1px solid ${POLAR}`,
        borderLeft: `3px solid ${ELECTRIC}`,
        borderRadius: 2,
        padding: "10px 12px",
      }}
    >
      <div
        style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 4 }}
      >
        Map Read
      </div>
      <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK, lineHeight: 1.5 }}>
        {OPERATIONAL_MAP_READ}
      </div>
    </div>
  );
}

function ImpactCard({ point }: { point: ImpactPoint }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        background: "#ffffff",
        border: `1px solid ${POLAR}`,
        borderLeft: `3px solid ${IMPACT_COLOR[point.impact]}`,
        borderRadius: 2,
        padding: "8px 10px",
      }}
    >
      {point.marker ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: IMPACT_COLOR[point.impact],
            color: "#fff",
            fontFamily: "Roboto, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            marginTop: 1,
          }}
        >
          {point.marker}
        </span>
      ) : (
        <span
          style={{
            display: "inline-block",
            flex: "0 0 auto",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: IMPACT_COLOR[point.impact],
            border: `1px solid ${POLAR}`,
            marginTop: 3,
          }}
        />
      )}
      <div style={{ fontFamily: "Roboto, sans-serif", minWidth: 0, flex: "1 1 auto" }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{point.location}</span>
          <ImpactChip impact={point.impact} />
        </div>
        <div style={{ fontSize: 11.5, color: DUSK, marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>What happened this period: </span>
          {point.issue}
        </div>
        <div style={{ fontSize: 11.5, color: DUSK, marginTop: 2 }}>
          <span style={{ fontWeight: 600 }}>Business relevance: </span>
          {point.relevance}
        </div>
      </div>
    </div>
  );
}

function ImpactCardGrid({ points }: { points: ImpactPoint[] }) {
  return (
    <div
      className="mt-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 8,
      }}
    >
      {points.map((p) => (
        <ImpactCard key={p.key} point={p} />
      ))}
    </div>
  );
}

/**
 * Incident map for the Country Report Builder.
 *
 * Uses CartoDB Positron tiles (clean, light, professional basemap, no API key
 * required).
 *
 * Two rendering modes:
 *  - AREA-RISK (numbered callout) for countries with a configured zone list
 *    (e.g. Papua / West Papua): one numbered, severity-coloured marker per
 *    ACTIVE risk zone, with a "n. Zone — Severity" legend. This is the
 *    standard-preferred country-report map — it shows risk AREAS rather than
 *    raw database points, which is honest about the province-centroid geocoding.
 *  - PER-COORDINATE DOTS for all other countries (unchanged): one dot per
 *    distinct coordinate, coloured by the highest severity present and badged
 *    with the incident count.
 *
 * In BOTH modes markers are plain absolutely-positioned HTML <div> elements in
 * an overlay layered over the Leaflet container (NOT Leaflet circleMarkers, and
 * NOT <canvas>). This is deliberate: the in-app "Download PDF" rasterises the
 * on-screen DOM with html2canvas, which does NOT reliably capture Leaflet's
 * canvas/SVG marker panes nor standalone <canvas> overlays — both show on screen
 * but vanish in the PDF. Plain HTML <div> markers rasterise faithfully, so the
 * screen and the PDF agree. Markers are re-projected on every map move/zoom.
 */
export default function CountryReportMap({ incidents, domId, countryName }: CountryReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const basemapStyleRef = useRef<"jakarta" | "standard" | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<
    Array<{
      el: HTMLElement;
      lat: number;
      lng: number;
      half: number;
    }>
  >([]);

  const zonesDef = resolveRiskZones(countryName);
  const zoneMode = zonesDef !== null;
  const isJakarta = (countryName ?? "").trim().toLowerCase() === "jakarta";

  // A record plots as a marker only when the geocoder resolved it to a real
  // sub-national place: it carries a coordinate AND a non-empty location. The
  // geocoder sets `location` to a town/province name on any sub-national fix and
  // leaves it null when it can only fall back to the bare country centroid, so a
  // present location is the robust "we know roughly where it happened" signal.
  // Centroid-only records (no place named) stay unplotted — counted in totals,
  // tables and the note instead of stacking on one central dot that never moves.
  // A marker is therefore a town/province-level fix, not an exact point.
  // Memoised so the legend, the marker effect and the note read one consistent set.
  const plottable = useMemo(
    () =>
      incidents.filter(
        (i) =>
          typeof i.latitude === "number" &&
          typeof i.longitude === "number" &&
          !Number.isNaN(i.latitude) &&
          !Number.isNaN(i.longitude) &&
          typeof i.location === "string" &&
          i.location.trim().length > 0,
      ),
    [incidents],
  );

  // Zone aggregation (area-risk mode only). Memoised so the legend and the
  // marker effect see one consistent result.
  const zoneAgg = useMemo(
    () => (zonesDef ? aggregateZones(incidents, zonesDef) : { active: [], unattributed: 0 }),
    [incidents, zonesDef],
  );

  // Per-coordinate dot groups (non-zone "all other countries" mode). One group
  // per distinct lat/lng, carrying its incidents, worst severity, derived
  // posture and a display location. Memoised so the marker effect and the card
  // grid render from one consistent, reporting-driven result.
  const dotGroups = useMemo<DotGroup[]>(() => {
    if (zoneMode) return [];
    const groups = new Map<string, CountryFastFactsIncident[]>();
    for (const i of plottable) {
      const key = `${i.latitude},${i.longitude}`;
      const arr = groups.get(key);
      if (arr) arr.push(i);
      else groups.set(key, [i]);
    }
    const out: DotGroup[] = [];
    for (const gm of groups.values()) {
      const worstKey = worstSeverityKey(gm);
      const rawLoc = (gm.find((m) => (m.location ?? "").trim())?.location ?? "").trim();
      out.push({
        lat: gm[0].latitude as number,
        lng: gm[0].longitude as number,
        members: gm,
        count: gm.length,
        worstKey,
        impact: impactLevelForSet(gm),
        location: rawLoc ? titleCaseLocation(rawLoc) : "Reported location",
        lead: leadIncident(gm),
      });
    }
    return out;
  }, [plottable, zoneMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Jakarta reads as a numbered callout schematic, not a street map: use the
    // label-free CARTO basemap and a faded opacity so the coloured markers
    // dominate and it does not look like a web-map screenshot (spec §6). Other
    // theatres keep the standard labelled basemap at full opacity.
    const basemapUrl = isJakarta
      ? "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    const basemapOpacity = isJakarta ? 0.85 : 1;
    const desiredStyle: "jakarta" | "standard" = isJakarta ? "jakarta" : "standard";

    if (!mapRef.current) {
      // No zoom buttons or attribution overlay: the country-report map is a
      // clean report graphic, captured into the PDF via html2canvas. Leaflet
      // controls render as floating widgets that look like UI clutter in an
      // exported document, so both controls are disabled at construction. With
      // attributionControl off the tile layer's attribution string below is
      // never drawn, so no control container is created at all.
      mapRef.current = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
      });
      tileLayerRef.current = L.tileLayer(basemapUrl, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
        crossOrigin: true,
        opacity: basemapOpacity,
      }).addTo(mapRef.current);
      basemapStyleRef.current = desiredStyle;
    } else if (tileLayerRef.current && basemapStyleRef.current !== desiredStyle) {
      // The component instance is reused for a different theatre (countryName
      // changed without a remount): resync the basemap so Jakarta always gets
      // the faded label-free schematic and every other theatre keeps the
      // standard labelled basemap at full opacity — neither inherits the other.
      tileLayerRef.current.setUrl(basemapUrl);
      tileLayerRef.current.setOpacity(basemapOpacity);
      basemapStyleRef.current = desiredStyle;
    }

    const map = mapRef.current;

    // Overlay layer that holds the HTML markers. Created once, on top of the
    // tiles; pointer-events:none so it never blocks panning/zooming.
    if (!overlayRef.current) {
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "500";
      containerRef.current.appendChild(overlay);
      overlayRef.current = overlay;
    }
    const overlay = overlayRef.current;

    const positionDots = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = `${p.x - d.half}px`;
        d.el.style.top = `${p.y - d.half}px`;
      }
    };

    // Rebuild markers for the current set.
    overlay.replaceChildren();
    dotsRef.current = [];

    // ---- AREA-RISK (numbered callout) mode ------------------------------
    if (zoneMode) {
      const active = zoneAgg.active;
      if (active.length === 0) {
        const view = resolveCountryView(countryName);
        map.setView(view ? view.center : [-3.5, 138.0], view ? view.zoom : 5);
        map.off("move zoom resize viewreset zoomanim", positionDots);
        return;
      }

      const latLngs: L.LatLngExpression[] = [];
      for (const z of active) {
        // Reporting-driven: an area is only plotted when the window carries a
        // reported event there; empty areas are never drawn.
        if (z.count === 0) continue;
        const [lat, lng] = z.def.center;
        const impact = impactLevelForSet(z.incidents);
        const color = IMPACT_COLOR[impact];
        const size = 28;
        const half = size / 2;

        // Plain absolutely-positioned numbered <div> marker (html2canvas-safe),
        // coloured by operational IMPACT LEVEL (frequency + business impact),
        // never raw severity or a standing assessment.
        const marker = document.createElement("div");
        marker.style.position = "absolute";
        marker.style.width = `${size}px`;
        marker.style.height = `${size}px`;
        marker.style.borderRadius = "50%";
        marker.style.background = withAlpha(color, 0.35);
        marker.style.border = `2px solid ${color}`;
        marker.style.boxSizing = "border-box";
        marker.style.display = "flex";
        marker.style.alignItems = "center";
        marker.style.justifyContent = "center";
        marker.style.color = color;
        marker.style.fontFamily = "Roboto, sans-serif";
        marker.style.fontWeight = "700";
        marker.style.fontSize = "13px";
        marker.style.lineHeight = "1";
        // Centred on screen via flex + line-height:1. html2canvas renders text a
        // touch low, so the export clone re-adds a small bottom pad on
        // [data-map-numeral]; on screen we keep it symmetric so the numeral sits
        // dead-centre.
        marker.dataset.mapNumeral = "true";
        marker.style.pointerEvents = "auto";
        marker.textContent = String(z.number);
        marker.title = `${z.number}. ${z.def.name} — ${impact}`;

        overlay.appendChild(marker);
        dotsRef.current.push({ el: marker, lat, lng, half });
        latLngs.push([lat, lng]);
      }

      if (latLngs.length === 0) {
        const view = resolveCountryView(countryName);
        map.setView(view ? view.center : [-3.5, 138.0], view ? view.zoom : 5);
        map.off("move zoom resize viewreset zoomanim", positionDots);
        return;
      }
      if (latLngs.length === 1) {
        map.setView(latLngs[0] as L.LatLngTuple, 6);
      } else {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [48, 52], maxZoom: 7 });
      }
      positionDots();
      map.off("move zoom resize viewreset zoomanim", positionDots);
      map.on("move zoom resize viewreset zoomanim", positionDots);
      return () => {
        map.off("move zoom resize viewreset zoomanim", positionDots);
      };
    }

    // ---- PER-COORDINATE DOT mode (all other countries) ------------------
    if (dotGroups.length === 0) {
      const view = resolveCountryView(countryName);
      if (view) {
        map.setView(view.center, view.zoom);
      } else {
        map.setView([0, 120], 2);
      }
      map.off("move zoom resize viewreset zoomanim", positionDots);
      return;
    }

    const latLngs: L.LatLngExpression[] = [];

    // One dot per distinct coordinate (many records share a city/country
    // centroid). The dot is coloured by operational IMPACT LEVEL (frequency +
    // worst business impact at that point) and badged with the incident COUNT; a
    // plain <div> so html2canvas rasterises it into the PDF unchanged. Each dot
    // stays exactly on land and no reported incident is obscured.
    for (const g of dotGroups) {
      const color = IMPACT_COLOR[g.impact];
      const size = g.count > 1 ? 22 : 14;
      const half = size / 2;

      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = withAlpha(color, 0.35);
      dot.style.border = `2px solid ${color}`;
      dot.style.boxSizing = "border-box";
      // The overlay is pointer-events:none; re-enable on the dot so the native
      // hover tooltip (dot.title) listing the incidents at this point fires.
      dot.style.pointerEvents = "auto";
      if (g.count > 1) {
        dot.style.display = "flex";
        dot.style.alignItems = "center";
        dot.style.justifyContent = "center";
        dot.style.color = color;
        dot.style.fontFamily = "Roboto, sans-serif";
        dot.style.fontWeight = "700";
        dot.style.fontSize = "11px";
        dot.style.lineHeight = "1";
        // Centred on screen (flex + line-height:1); the export clone re-adds a
        // small bottom pad on [data-map-numeral] to counter html2canvas.
        dot.dataset.mapNumeral = "true";
        dot.textContent = String(g.count);
      }

      const lines = g.members.map((m) => {
        const t = cleanIssue(m);
        const sd = SEV_LABEL[(m.severity ?? "").toLowerCase()] ?? m.severity ?? "";
        return sd ? `${t} (${sd})` : t;
      });
      dot.title = [
        `${g.location} — ${g.count} incident${g.count === 1 ? "" : "s"}`,
        ...lines,
      ].join("\n");

      overlay.appendChild(dot);
      dotsRef.current.push({ el: dot, lat: g.lat, lng: g.lng, half });
      latLngs.push([g.lat, g.lng]);
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0] as L.LatLngTuple, 8);
    } else {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 44], maxZoom: 9 });
    }

    positionDots();
    map.off("move zoom resize viewreset zoomanim", positionDots);
    map.on("move zoom resize viewreset zoomanim", positionDots);

    return () => {
      map.off("move zoom resize viewreset zoomanim", positionDots);
    };
  }, [countryName, zoneMode, zoneAgg, dotGroups]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      tileLayerRef.current = null;
      basemapStyleRef.current = null;
      overlayRef.current = null;
      dotsRef.current = [];
    };
  }, []);

  const unplotted = incidents.length - plottable.length;

  // ---- AREA-RISK legend ------------------------------------------------
  if (zoneMode) {
    const active = zoneAgg.active;
    const mapContainer = (
      <div
        id={domId}
        ref={containerRef}
        style={{
          height: 360,
          width: "100%",
          position: "relative",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />
    );

    // Reporting-driven impact points: only zones carrying a reported event this
    // period are plotted (built in the marker effect) and carded here. Cards are
    // rendered in the JSX body so screen == rasterised in-app PDF, and each card
    // mirrors its numbered on-map marker.
    const points: ImpactPoint[] = active
      .filter((z) => z.count > 0)
      .map((z) => {
        const lead = leadIncident(z.incidents);
        const impact = impactLevelForSet(z.incidents);
        return {
          key: z.def.name,
          marker: String(z.number),
          location: z.def.name,
          issue: cleanIssue(lead),
          relevance: businessRelevance(lead, impact),
          impact,
        };
      });

    return (
      <div>
        <OperationalMapHeader />
        {mapContainer}
        {points.length > 0 ? (
          <>
            <ImpactLegend />
            <ImpactCardGrid points={points} />
            {zoneAgg.unattributed > 0 ? (
              <div
                style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
              >
                Some records could not be tied to a specific area and are included in the totals and tables but not plotted.
              </div>
            ) : null}
          </>
        ) : (
          <div
            style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
          >
            No reported operational issue resolved to a mapped area this period.
          </div>
        )}
        <MapReadNote />
      </div>
    );
  }

  // ---- PER-COORDINATE OPERATIONAL MAP (all other countries) ------------
  // One card per plotted coordinate, mirroring the on-map dots. Reporting-driven:
  // a point exists only where the window carries a reported event.
  const dotPoints: ImpactPoint[] = dotGroups.map((g) => ({
    key: `${g.lat},${g.lng}`,
    marker: null,
    location: g.location,
    issue: cleanIssue(g.lead),
    relevance: businessRelevance(g.lead, g.impact),
    impact: g.impact,
  }));

  return (
    <div>
      <OperationalMapHeader />
      <div
        id={domId}
        ref={containerRef}
        style={{
          height: 360,
          width: "100%",
          position: "relative",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />
      {dotPoints.length > 0 ? (
        <>
          <ImpactLegend />
          <ImpactCardGrid points={dotPoints} />
          <div
            style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
          >
            Points show reported events at the town or province named in the reporting; where several share a location one marker carries the count. A marker is a town or province-level fix, not an exact point.
            {unplotted > 0
              ? ` ${unplotted} of ${incidents.length} record${incidents.length === 1 ? "" : "s"} name no specific place and are included in the totals and tables but not plotted.`
              : ""}
          </div>
        </>
      ) : (
        // No record in the window carries usable coordinates: do NOT present the
        // basemap as an incident map. Centred on the report country for context
        // only, with an explicit note so no marker plotting is implied.
        <div
          style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
        >
          No reported operational issue names a mappable place this period; the map reflects country operating context only.
        </div>
      )}
      <MapReadNote />
    </div>
  );
}
