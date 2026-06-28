import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import { classifyLocationConfidence } from "@/lib/countryLocationConfidence";

const SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
};

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
};

function resolveCountryView(name?: string): { center: L.LatLngTuple; zoom: number } | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_VIEW[key] ?? null;
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
// coloured marker on each ACTIVE zone, and list "n. Zone — Severity (count)"
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

// National Indonesia risk zones, mirroring the six regional buckets the
// Indonesia operating-risk brief groups incidents into (Papua is routed to the
// dedicated West Papua brief upstream, so it has no zone here). Province names
// and major city names are the place keywords; "java" alone is deliberately
// absent so West Java and Central/East Java never collide.
const INDONESIA_ZONES: RiskZoneDef[] = [
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
    name: "Kalimantan (Borneo)",
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
    places: [
      "central jakarta", "jakarta pusat", "menteng", "tanah abang", "gambir",
      "senen", "cempaka putih", "kemayoran", "johar baru", "sawah besar",
    ],
  },
  {
    name: "South Jakarta",
    description: "Office, embassy and commercial-area exposure.",
    center: [-6.28, 106.81],
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
    places: [
      "west jakarta", "jakarta barat", "grogol", "kembangan", "palmerah",
      "taman sari", "tambora", "kebon jeruk", "kalideres",
    ],
  },
  {
    name: "North Jakarta",
    description: "Port, flooding and logistics exposure.",
    center: [-6.12, 106.87],
    places: [
      "north jakarta", "jakarta utara", "tanjung priok", "kelapa gading",
      "penjaringan", "koja", "cilincing", "pademangan", "ancol", "sunter",
    ],
  },
  {
    name: "East Jakarta",
    description: "Road movement and residential disruption.",
    center: [-6.23, 106.90],
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
}

// Aggregate the window into active zones (count + worst severity each, numbered
// in config order) plus the count of records that matched no zone.
function aggregateZones(
  incidents: CountryFastFactsIncident[],
  zones: RiskZoneDef[],
): { active: ActiveZone[]; unattributed: number } {
  const counts = zones.map(() => ({ count: 0, worstRank: 0, worstKey: "" }));
  let unattributed = 0;
  for (const i of incidents) {
    const z = zoneIndexForIncident(i, zones);
    if (z === null) {
      unattributed += 1;
      continue;
    }
    const c = counts[z];
    c.count += 1;
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > c.worstRank) {
      c.worstRank = r;
      c.worstKey = k;
    }
  }
  const active: ActiveZone[] = [];
  zones.forEach((def, idx) => {
    if (counts[idx].count > 0) {
      active.push({
        def,
        number: active.length + 1,
        count: counts[idx].count,
        worstKey: counts[idx].worstKey,
      });
    }
  });
  return { active, unattributed };
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
 *    ACTIVE risk zone, with a "n. Zone — Severity (count)" legend. This is the
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Array<{ el: HTMLElement; lat: number; lng: number; half: number }>>([]);

  const zonesDef = resolveRiskZones(countryName);
  const zoneMode = zonesDef !== null;

  // A record is plotted as a PRECISE marker only when it carries a coordinate
  // AND the title/location text shows we actually know where it happened below
  // city level (exact coords or a sub-city fix). City- / province-only records
  // geocode to a centroid, so plotting them as exact dots is false precision —
  // they are counted in totals, tables and the note instead. Memoised so the
  // legend, the marker effect and the note all read one consistent set.
  const plottable = useMemo(
    () =>
      incidents.filter(
        (i) =>
          typeof i.latitude === "number" &&
          typeof i.longitude === "number" &&
          !Number.isNaN(i.latitude) &&
          !Number.isNaN(i.longitude) &&
          classifyLocationConfidence({
            title: (i.displayTitle && i.displayTitle.trim()) || i.title,
            location: i.location,
          }).plottable,
      ),
    [incidents],
  );

  // Zone aggregation (area-risk mode only). Memoised so the legend and the
  // marker effect see one consistent result.
  const zoneAgg = useMemo(
    () => (zonesDef ? aggregateZones(incidents, zonesDef) : { active: [], unattributed: 0 }),
    [incidents, zonesDef],
  );

  useEffect(() => {
    if (!containerRef.current) return;

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
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
        },
      ).addTo(mapRef.current);
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
        const [lat, lng] = z.def.center;
        const color = SEV_COLOR[z.worstKey] ?? "#999999";
        const size = 28;
        const half = size / 2;

        // Plain absolutely-positioned numbered <div> marker (html2canvas-safe).
        const marker = document.createElement("div");
        marker.style.position = "absolute";
        marker.style.width = `${size}px`;
        marker.style.height = `${size}px`;
        marker.style.borderRadius = "50%";
        marker.style.background = color;
        marker.style.border = "2px solid #ffffff";
        marker.style.boxSizing = "border-box";
        marker.style.display = "flex";
        marker.style.alignItems = "center";
        marker.style.justifyContent = "center";
        marker.style.color = "#ffffff";
        marker.style.fontFamily = "Roboto, sans-serif";
        marker.style.fontWeight = "700";
        marker.style.fontSize = "13px";
        marker.style.lineHeight = "1";
        // html2canvas renders text slightly low; a small bottom pad re-centres
        // the numeral in the exported PDF without shifting it on screen much.
        marker.style.paddingBottom = "2px";
        marker.style.pointerEvents = "auto";
        marker.textContent = String(z.number);
        marker.title = `${z.number}. ${z.def.name} — ${SEV_LABEL[z.worstKey] ?? z.worstKey} (${z.count})`;

        overlay.appendChild(marker);
        dotsRef.current.push({ el: marker, lat, lng, half });
        latLngs.push([lat, lng]);
      }

      if (latLngs.length === 1) {
        map.setView(latLngs[0] as L.LatLngTuple, 6);
      } else {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [36, 36], maxZoom: 7 });
      }
      positionDots();
      map.off("move zoom resize viewreset zoomanim", positionDots);
      map.on("move zoom resize viewreset zoomanim", positionDots);
      return () => {
        map.off("move zoom resize viewreset zoomanim", positionDots);
      };
    }

    // ---- PER-COORDINATE DOT mode (all other countries) ------------------
    if (plottable.length === 0) {
      const view = resolveCountryView(countryName);
      if (view) {
        map.setView(view.center, view.zoom);
      } else {
        map.setView([0, 120], 2);
      }
      map.off("move zoom resize viewreset zoomanim", positionDots);
      return;
    }

    // Many country-report records geocode to the SAME city or country centroid,
    // so several incidents legitimately share one coordinate. We deliberately do
    // NOT stack them (which hides all but the top dot) and do NOT fan them out in
    // screen space (a fixed pixel ring pushes coastal-city markers off the
    // coastline into the sea, implying maritime incidents that never happened and
    // there is no reliable client-side way to know which direction is inland).
    // Instead we render ONE dot per distinct coordinate, coloured by the
    // HIGHEST severity present there and badged with the incident COUNT. Each
    // dot therefore stays exactly on land, every incident is accounted for, and
    // an Extreme record is never obscured by a lower-severity dot.
    const groups = new Map<string, number[]>();
    plottable.forEach((i, idx) => {
      const key = `${i.latitude},${i.longitude}`;
      const arr = groups.get(key);
      if (arr) arr.push(idx);
      else groups.set(key, [idx]);
    });

    const latLngs: L.LatLngExpression[] = [];

    for (const idxs of groups.values()) {
      const members = idxs.map((gi) => plottable[gi]);
      const lat = members[0].latitude as number;
      const lng = members[0].longitude as number;
      const count = members.length;

      // Highest severity present at this coordinate drives the marker colour.
      let worst = members[0];
      let worstRank = SEV_RANK[(worst.severity ?? "").toLowerCase()] ?? 0;
      for (const m of members) {
        const r = SEV_RANK[(m.severity ?? "").toLowerCase()] ?? 0;
        if (r > worstRank) {
          worst = m;
          worstRank = r;
        }
      }
      const color = SEV_COLOR[(worst.severity ?? "").toLowerCase()] ?? "#999999";

      const size = count > 1 ? 22 : 14;
      const half = size / 2;

      // Plain absolutely-positioned <div> dot — html2canvas rasterises these
      // faithfully (a standalone <canvas> marker is silently dropped from the
      // exported PDF, breaking screen==PDF parity). When several incidents share
      // the coordinate the dot carries the count as a centred white numeral.
      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = color;
      dot.style.border = "2px solid #ffffff";
      dot.style.boxSizing = "border-box";
      // The overlay is pointer-events:none; re-enable on the dot so the native
      // hover tooltip (dot.title) listing the incidents at this point fires.
      dot.style.pointerEvents = "auto";
      if (count > 1) {
        dot.style.display = "flex";
        dot.style.alignItems = "center";
        dot.style.justifyContent = "center";
        dot.style.color = "#ffffff";
        dot.style.fontFamily = "Roboto, sans-serif";
        dot.style.fontWeight = "700";
        dot.style.fontSize = "11px";
        dot.style.lineHeight = "1";
        // html2canvas renders text slightly low; a small bottom pad re-centres
        // the numeral in the exported PDF without shifting it on screen much.
        dot.style.paddingBottom = "2px";
        dot.textContent = String(count);
      }

      const loc = (members.find((m) => (m.location ?? "").trim())?.location ?? "").trim();
      const lines = members.map((m) => {
        const t = ((m.displayTitle && m.displayTitle.trim()) || m.title || "Incident").trim();
        const sd = SEV_LABEL[(m.severity ?? "").toLowerCase()] ?? m.severity ?? "";
        return sd ? `${t} (${sd})` : t;
      });
      dot.title = [
        loc ? `${loc} — ${count} incident${count === 1 ? "" : "s"}` : `${count} incident${count === 1 ? "" : "s"}`,
        ...lines,
      ].join("\n");

      overlay.appendChild(dot);
      dotsRef.current.push({ el: dot, lat, lng, half });
      latLngs.push([lat, lng]);
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0] as L.LatLngTuple, 8);
    } else {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24], maxZoom: 9 });
    }

    positionDots();
    map.off("move zoom resize viewreset zoomanim", positionDots);
    map.on("move zoom resize viewreset zoomanim", positionDots);

    return () => {
      map.off("move zoom resize viewreset zoomanim", positionDots);
    };
  }, [plottable, countryName, zoneMode, zoneAgg]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayRef.current = null;
      dotsRef.current = [];
    };
  }, []);

  const unplotted = incidents.length - plottable.length;
  const hasPlotted = plottable.length > 0;

  // ---- AREA-RISK legend ------------------------------------------------
  if (zoneMode) {
    const active = zoneAgg.active;
    return (
      <div>
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
        {active.length > 0 ? (
          <>
            {/* Numbered risk-zone legend: "n. Zone — Severity (count)". The
                numbered markers above are HTML <div> overlays, so they appear
                in BOTH the on-screen view and the rasterised PDF. */}
            <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {active.map((z) => (
                <div key={z.def.name} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 auto",
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: SEV_COLOR[z.worstKey] ?? "#999999",
                      color: "#fff",
                      fontFamily: "Roboto, sans-serif",
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1,
                      border: `1px solid ${POLAR}`,
                      marginTop: 1,
                    }}
                  >
                    {z.number}
                  </span>
                  <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK }}>
                    <span style={{ fontWeight: 700, color: "#0b0a3d" }}>{z.def.name}</span>{" "}
                    — {SEV_LABEL[z.worstKey] ?? z.worstKey} ({z.count})
                    {z.def.description ? (
                      <span style={{ color: DUSK, opacity: 0.75 }}> · {z.def.description}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
            >
              Each marker shows a risk area, numbered and coloured by the highest severity recorded there this period.
              {zoneAgg.unattributed > 0
                ? ` ${zoneAgg.unattributed} record${zoneAgg.unattributed === 1 ? "" : "s"} could not be tied to a specific area and ${zoneAgg.unattributed === 1 ? "is" : "are"} included in totals and tables but not plotted.`
                : ""}
            </div>
          </>
        ) : (
          // No record in the window resolves to a defined risk zone: present the
          // basemap as country context only, with an explicit note.
          <div
            style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
          >
            Map reflects country operating context only. No incident in this period resolves to a defined risk area.
          </div>
        )}
      </div>
    );
  }

  // ---- PER-COORDINATE DOT legend (all other countries) -----------------
  return (
    <div>
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
      {hasPlotted ? (
        <>
          {/* Severity legend is shown ONLY when markers are actually plotted, so
              the map never implies incident plotting on an empty/no-coordinate
              window. The HTML dot overlay above guarantees the plotted points
              are present in BOTH the on-screen view and the rasterised PDF, so
              the legend never accompanies a point-less map. */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: SEV_COLOR[k],
                    border: `1px solid ${POLAR}`,
                  }}
                />
                <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                  {SEV_LABEL[k]}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
          >
            Markers show only incidents with a confirmed local location. Where several share a location, one marker shows the incident count and is coloured by the highest severity recorded there.
            {" "}City- or province-level records, and records without coordinates, are included in totals and tables but not plotted as precise points.
            {unplotted > 0 ? ` ${unplotted} of ${incidents.length} record${incidents.length === 1 ? "" : "s"} not plotted.` : ""}
          </div>
        </>
      ) : (
        // No record in the window carries usable coordinates: do NOT present the
        // basemap as an incident map. Centred on the report country for context
        // only, with an explicit note so no marker plotting is implied.
        <div
          style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
        >
          Map reflects country operating context only. Incident records in this period do not contain sufficient coordinates for reliable plotting.
        </div>
      )}
    </div>
  );
}
