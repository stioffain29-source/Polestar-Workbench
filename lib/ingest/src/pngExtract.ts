// PNG-only structured extraction for the Papua New Guinea country brief.
//
// Additive and PNG-scoped: every helper here runs ONLY for records the
// flashpoint country resolver attributes to Papua New Guinea, so the broadened
// PNG scope and its derived attributes never leak into other countries. The
// columns these populate (province / category / business_impact / incident_date)
// are nullable; every consumer falls back to location / topic / occurredAt when
// they are absent, so non-PNG rows are unaffected.

import { hasWord } from "./text";

// City / suburb / locality -> PNG province. Keys are matched on word boundaries
// (longest first) against the incident text so a suburb (West Taraka) resolves
// the right province (Morobe) even when the headline omits the province name.
export const PNG_PROVINCE_BY_CITY: Record<string, string> = {
  // National Capital District (Port Moresby + suburbs/landmarks)
  "port moresby": "National Capital District",
  "nine mile": "National Capital District",
  bomana: "National Capital District",
  gerehu: "National Capital District",
  boroko: "National Capital District",
  waigani: "National Capital District",
  gordons: "National Capital District",
  gordon: "National Capital District",
  "six mile": "National Capital District",
  hohola: "National Capital District",
  badili: "National Capital District",
  koki: "National Capital District",
  hanuabada: "National Capital District",
  ncd: "National Capital District",
  // Morobe (Lae + suburbs)
  "west taraka": "Morobe",
  taraka: "Morobe",
  lae: "Morobe",
  nadzab: "Morobe",
  bumbu: "Morobe",
  eriku: "Morobe",
  bulolo: "Morobe",
  wau: "Morobe",
  morobe: "Morobe",
  // Western Highlands (Mt Hagen + Kagamuga airport)
  kagamuga: "Western Highlands",
  "mount hagen": "Western Highlands",
  "mt hagen": "Western Highlands",
  // Other PNG provinces
  banz: "Jiwaka",
  minj: "Jiwaka",
  madang: "Madang",
  goroka: "Eastern Highlands",
  kainantu: "Eastern Highlands",
  wewak: "East Sepik",
  maprik: "East Sepik",
  enga: "Enga",
  wabag: "Enga",
  porgera: "Enga",
  wapenamanda: "Enga",
  tari: "Hela",
  hela: "Hela",
  komo: "Hela",
  mendi: "Southern Highlands",
  ialibu: "Southern Highlands",
  kokopo: "East New Britain",
  rabaul: "East New Britain",
  kimbe: "West New Britain",
  bougainville: "Bougainville",
  buka: "Bougainville",
  arawa: "Bougainville",
  panguna: "Bougainville",
  vanimo: "West Sepik",
  kerema: "Gulf",
  popondetta: "Oro",
  alotau: "Milne Bay",
  daru: "Western",
  kavieng: "New Ireland",
  lorengau: "Manus",
};

// Longest keys first so "west taraka" wins over "taraka", "mount hagen" over a
// bare "hagen", etc.
const PROVINCE_KEYS = Object.keys(PNG_PROVINCE_BY_CITY).sort((a, b) => b.length - a.length);

/**
 * Resolve the PNG province from an explicit location string (if known) or by
 * scanning the incident text for a known locality. Returns null when nothing
 * matches, so the report falls back to the location/country label.
 */
export function derivePngProvince(location: string | null | undefined, text: string): string | null {
  const loc = (location ?? "").trim().toLowerCase();
  if (loc && PNG_PROVINCE_BY_CITY[loc]) return PNG_PROVINCE_BY_CITY[loc];
  const hay = `${location ?? ""} ${text}`;
  for (const key of PROVINCE_KEYS) {
    if (hasWord(hay, key)) return PNG_PROVINCE_BY_CITY[key];
  }
  return null;
}

export type PngCategory =
  | "Armed robbery / hold-up"
  | "Tribal / communal violence"
  | "Homicide / violent crime"
  | "Theft / break-in"
  | "Civil unrest / protest"
  | "Policing operation"
  | "Community policing"
  | "Intelligence / training"
  | "Corrections / detention"
  | "Aviation / airport"
  | "Maritime / port"
  | "Road / highway"
  | "Power / utilities"
  | "Telecoms / connectivity"
  | "Government stability"
  | "Other security";

// Ordered most-specific-first. The first regex to match wins.
const CATEGORY_RULES: Array<{ re: RegExp; category: PngCategory; impact: string }> = [
  {
    re: /\b(armed robbery|hold[- ]?up|carjack(?:ing|ed)?|stick[- ]?up|heist)\b/i,
    category: "Armed robbery / hold-up",
    impact: "Direct threat to staff, cash-in-transit and premises in the affected area; review movement and security cover.",
  },
  {
    re: /\b(tribal (?:fight|clash|war|warfare|violence|conflict)|payback (?:killing|attack)|inter[- ]?clan|clan (?:fight|war|clash)|communal (?:violence|clash))\b/i,
    category: "Tribal / communal violence",
    impact: "Road closures, supply-chain disruption and personnel-movement risk across the affected district.",
  },
  {
    re: /\b(murder(?:ed|s)?|homicide|manslaughter|massacre|shot dead|stabb(?:ed|ing)|gunned down|beaten to death|found dead|fatalit(?:y|ies)|killed)\b/i,
    category: "Homicide / violent crime",
    impact: "Heightened personal-security risk locally; review after-hours exposure and movement protocols.",
  },
  {
    re: /\b(community polic\w*|neighbou?rhood watch|police (?:partnership|community)|safe (?:city|community)|crime[- ]?prevention (?:launch|program|programme|initiative))\b/i,
    category: "Community policing",
    impact: "Net positive for the local security posture; limited direct operational impact.",
  },
  {
    re: /\b(intelligence (?:training|unit|sharing|gathering|course|workshop|capabilit\w*)|police training|capacity[- ]?building|train(?:ing|ed) (?:of |for )?(?:officers|police|recruits|personnel))\b/i,
    category: "Intelligence / training",
    impact: "Security capacity-building; no direct operational disruption expected.",
  },
  {
    re: /\b(correctional (?:service|institution|facility|officers?)|warders?|prison (?:break|escape|riot|unrest|officers?|inmates?)|jail ?break|inmates? escape|cell block)\b/i,
    category: "Corrections / detention",
    impact: "Localised security-force activity; limited direct commercial impact unless escapees are at large.",
  },
  {
    re: /\b(airport|airstrip|airfield|runway|aviation|air ?services|flights?|aircraft)\b/i,
    category: "Aviation / airport",
    impact: "Possible flight-schedule and airport-access disruption affecting travel and air freight.",
  },
  {
    re: /\b(wharf|jetty|port (?:closure|shut|disrupt\w*|congestion|operations?|security)|harbou?r|shipping|maritime|vessel|ferry)\b/i,
    category: "Maritime / port",
    impact: "Possible cargo-handling and port-access disruption affecting sea freight.",
  },
  {
    re: /\b(highway|road (?:closed|cut|block\w*|landslip|landslide|washed|sealed)|bridge (?:collapse|washed|down|out)|landslip|landslide blocks?)\b/i,
    category: "Road / highway",
    impact: "Overland freight and personnel-movement disruption on the affected corridor.",
  },
  {
    re: /\b(power (?:outage|blackout|cut|failure|shortage|rationing|crisis)|electricity (?:outage|blackout|cut|crisis)|grid (?:failure|down)|png power|fuel (?:shortage|crisis|outage|ran out|rationing|supply))\b/i,
    category: "Power / utilities",
    impact: "Operational disruption from power/fuel interruption; check site continuity and backup supply.",
  },
  {
    re: /\b(telecom\w*|telecommunication\w*|internet (?:outage|down|disrupt\w*|cut)|network (?:outage|down|disrupt\w*)|mobile (?:network|service) (?:down|outage|disrupt\w*)|digicel|connectivity)\b/i,
    category: "Telecoms / connectivity",
    impact: "Connectivity disruption; verify communications redundancy at affected sites.",
  },
  {
    re: /\b(vote of no confidence|government (?:shutdown|instability|stability|crisis|standoff)|political (?:crisis|instability|standoff)|public servants? strike|cabinet (?:reshuffle|crisis)|parliament\w* (?:standoff|deadlock|impasse))\b/i,
    category: "Government stability",
    impact: "Political-risk signal; monitor for downstream policy and security effects.",
  },
  {
    re: /\b(protest|demonstration|rally|march|riot|unrest|looting|roadblock|road block|strike|walkout|stoppage|picket|public disorder)\b/i,
    category: "Civil unrest / protest",
    impact: "Potential road blockages, business closures and movement restrictions in the affected area.",
  },
  {
    re: /\b(theft|stolen|burglary|break[- ]?in|looting|robbery|robbed)\b/i,
    category: "Theft / break-in",
    impact: "Property and asset-security risk; review premises security in the affected area.",
  },
  {
    re: /\b(police (?:operation|raid|swoop|patrol|deployment|crackdown)|joint (?:operation|patrol|task ?force)|raid(?:ed|s)?|swoop|manhunt|arrest(?:ed|s)?|detain(?:ed|ee|ees)?|apprehend\w*|wanted (?:man|men|criminal|suspect|fugitive))\b/i,
    category: "Policing operation",
    impact: "Localised disruption and checkpoints; short-term access constraints possible.",
  },
];

const OTHER_SECURITY_IMPACT =
  "Security-relevant development; monitor for operational follow-on in the affected area.";

export interface PngExtraction {
  province: string | null;
  category: PngCategory;
  businessImpact: string;
}

/**
 * Derive the PNG per-item structured attributes from the incident text.
 * Province is resolved from the location/text; category + business impact come
 * from the category rulebook above.
 */
export function extractPngItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): PngExtraction {
  const text = `${title} ${summary}`;
  const province = derivePngProvince(location, text);
  let category: PngCategory = "Other security";
  let businessImpact = OTHER_SECURITY_IMPACT;
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) {
      category = rule.category;
      businessImpact = rule.impact;
      break;
    }
  }
  return { province, category, businessImpact };
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// "26 May", "26th of May 2025", "on 9 June"
const DMY_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_ALT})\b(?:[,\s]+(\d{4}))?`,
  "gi",
);
// "May 26", "June 9, 2025"
const MDY_RE = new RegExp(
  String.raw`\b(${MONTH_ALT})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:[,\s]+(\d{4}))?`,
  "gi",
);

function monthIndex(token: string): number | undefined {
  return MONTHS[token.toLowerCase()];
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Returns a Date only when the text names a date
 * that is clearly EARLIER than the publication date (more than two days before)
 * and within the previous ~200 days — the signal that an item "reported this
 * week occurred earlier" (e.g. the West Taraka raid reported 9 Jun for a 26 May
 * operation). Returns null when no such earlier date is stated, in which case
 * consumers treat occurredAt (the publication date) as the incident date.
 */
export function derivePngIncidentDate(text: string, pubDate: Date): Date | null {
  const pubMs = pubDate.getTime();
  const minMs = pubMs - 200 * 24 * 60 * 60 * 1000;
  const distinctMs = pubMs - 2 * 24 * 60 * 60 * 1000;
  const pubYear = pubDate.getUTCFullYear();
  const candidates: number[] = [];

  const collect = (day: number, month: number | undefined, yearStr: string | undefined) => {
    if (month === undefined || !day || day < 1 || day > 31) return;
    let year = yearStr ? Number(yearStr) : pubYear;
    let d = Date.UTC(year, month, day);
    // No explicit year and the date lands after publication -> it belongs to
    // the previous year (a December event reported in January).
    if (!yearStr && d > pubMs) d = Date.UTC(year - 1, month, day);
    if (d >= minMs && d <= distinctMs) candidates.push(d);
  };

  let m: RegExpExecArray | null;
  DMY_RE.lastIndex = 0;
  while ((m = DMY_RE.exec(text)) !== null) {
    collect(Number(m[1]), monthIndex(m[2]), m[3]);
  }
  MDY_RE.lastIndex = 0;
  while ((m = MDY_RE.exec(text)) !== null) {
    collect(Number(m[2]), monthIndex(m[1]), m[3]);
  }

  if (candidates.length === 0) return null;
  // Earliest distinct earlier date wins (the event, not a later follow-up ref).
  return new Date(Math.min(...candidates));
}
