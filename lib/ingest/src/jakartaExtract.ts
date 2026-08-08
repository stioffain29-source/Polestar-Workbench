// Jakarta (city) structured extraction for the Jakarta country brief.
//
// Mirror of westPapuaExtract.ts for the Greater Jakarta theatre. The category
// rulebook + business-impact lines + the occurred-vs-reported date parser are
// the SHARED theatre-agnostic core; only the district / locality gazetteer below
// is Jakarta-specific.
//
// The Jakarta brief is a CITY view of records the country resolver attributes to
// Indonesia. `isJakartaScoped` is the gate that selects those records (see
// CountryReport.tsx); the gazetteer then buckets each into one of the five DKI
// administrative cities or Greater Jakarta (Jabodetabek). A bare "Jakarta"
// mention with no district resolves to no bucket (falls to "Other"), which is
// honest — a citywide item is not pinned to a district.

import { hasWord } from "./text";
import { INDONESIA_PROVINCE_BY_CITY } from "./indonesiaExtract";
import {
  compileGazetteer,
  deriveProvince,
  deriveLocality,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

// District / locality -> DKI administrative city (or Greater Jakarta for the
// Jabodetabek commuter ring). Area display strings MUST match the
// bucket.provinces lists in JAKARTA_REPORT_CONFIG. Bare "jakarta" is
// deliberately absent (cannot resolve a district); isJakartaScoped handles the
// citywide gate.
export const JAKARTA_AREA_BY_LOCALITY: Record<string, string> = {
  // Central Jakarta
  "central jakarta": "Central Jakarta",
  "jakarta pusat": "Central Jakarta",
  monas: "Central Jakarta",
  "medan merdeka": "Central Jakarta",
  "merdeka square": "Central Jakarta",
  gambir: "Central Jakarta",
  "tanah abang": "Central Jakarta",
  thamrin: "Central Jakarta",
  sudirman: "Central Jakarta",
  menteng: "Central Jakarta",
  cikini: "Central Jakarta",
  "patung kuda": "Central Jakarta",
  istana: "Central Jakarta",
  "merdeka palace": "Central Jakarta",
  senen: "Central Jakarta",
  kemayoran: "Central Jakarta",
  "lapangan banteng": "Central Jakarta",
  // North Jakarta
  "north jakarta": "North Jakarta",
  "jakarta utara": "North Jakarta",
  "tanjung priok": "North Jakarta",
  ancol: "North Jakarta",
  "kelapa gading": "North Jakarta",
  penjaringan: "North Jakarta",
  koja: "North Jakarta",
  cilincing: "North Jakarta",
  pluit: "North Jakarta",
  sunter: "North Jakarta",
  // South Jakarta
  "south jakarta": "South Jakarta",
  "jakarta selatan": "South Jakarta",
  kebayoran: "South Jakarta",
  "blok m": "South Jakarta",
  senayan: "South Jakarta",
  kuningan: "South Jakarta",
  pancoran: "South Jakarta",
  tebet: "South Jakarta",
  cilandak: "South Jakarta",
  "pondok indah": "South Jakarta",
  kemang: "South Jakarta",
  setiabudi: "South Jakarta",
  mampang: "South Jakarta",
  "gelora bung karno": "South Jakarta",
  gbk: "South Jakarta",
  // East Jakarta
  "east jakarta": "East Jakarta",
  "jakarta timur": "East Jakarta",
  cakung: "East Jakarta",
  jatinegara: "East Jakarta",
  cawang: "East Jakarta",
  rawamangun: "East Jakarta",
  pulogadung: "East Jakarta",
  "pulo gadung": "East Jakarta",
  matraman: "East Jakarta",
  "kramat jati": "East Jakarta",
  "duren sawit": "East Jakarta",
  // West Jakarta
  "west jakarta": "West Jakarta",
  "jakarta barat": "West Jakarta",
  grogol: "West Jakarta",
  "kebon jeruk": "West Jakarta",
  cengkareng: "West Jakarta",
  tambora: "West Jakarta",
  palmerah: "West Jakarta",
  "tanjung duren": "West Jakarta",
  kalideres: "West Jakarta",
  "taman sari": "West Jakarta",
  // Greater Jakarta (Jabodetabek commuter ring)
  jabodetabek: "Greater Jakarta (Jabodetabek)",
  "greater jakarta": "Greater Jakarta (Jabodetabek)",
  bekasi: "Greater Jakarta (Jabodetabek)",
  depok: "Greater Jakarta (Jabodetabek)",
  tangerang: "Greater Jakarta (Jabodetabek)",
  "tangerang selatan": "Greater Jakarta (Jabodetabek)",
  "south tangerang": "Greater Jakarta (Jabodetabek)",
  bsd: "Greater Jakarta (Jabodetabek)",
  serpong: "Greater Jakarta (Jabodetabek)",
  bogor: "Greater Jakarta (Jabodetabek)",
  cibinong: "Greater Jakarta (Jabodetabek)",
  cikarang: "Greater Jakarta (Jabodetabek)",
  cibubur: "Greater Jakarta (Jabodetabek)",
  bintaro: "Greater Jakarta (Jabodetabek)",
};

const JAKARTA_GAZETTEER = compileGazetteer(JAKARTA_AREA_BY_LOCALITY);

export type JakartaCategory = IncidentCategory;
export type JakartaExtraction = StructuredExtraction;

// Strip a trailing Jakarta-masthead suffix (e.g. " - The Jakarta Post") so a
// source name does not falsely scope an out-of-town story to Jakarta.
const JAKARTA_MASTHEAD_RE =
  /\s[-–—|]\s*(the\s+)?jakarta\s+(post|globe|daily|herald)\b.*$/i;

// Strong, non-metonymic administrative tokens for the capital region. Unlike a
// bare "jakarta" (which Indonesian reporting routinely uses to mean the central
// government), these refer unambiguously to the place.
const JAKARTA_STRONG_TOKENS = ["jabodetabek", "dki jakarta", "dki", "greater jakarta"];

// Indonesian localities OUTSIDE the capital region (every gazetteer key that does
// not resolve to DKI Jakarta). A bare "jakarta" mention is treated as the city
// only when none of these competing localities also appears, so a story centred
// elsewhere that merely references "Jakarta" (the government) is not pulled in.
// Greater-Jakarta ring towns (Bekasi, Depok, Tangerang, Bogor, …) are scoped IN
// by the district gazetteer in step 1 BEFORE this list is ever consulted.
//
// Indonesian Papua is DELIBERATELY excluded from INDONESIA_PROVINCE_BY_CITY
// (see indonesiaExtract.ts) because it has its own West Papua brief and never
// carries country "Indonesia". That means a Papua story is invisible to this
// list even though it is definitely not Jakarta — e.g. "Indonesian Forces Hunt
// Papua Separatists After Four Road Workers Killed" routinely also mentions
// "Jakarta" (the national government/military response), which used to let it
// pass the bare-"jakarta" fallback below and get mis-filed as a Jakarta-city
// "insurgency" development. Add the bare region token explicitly so any Papua
// mention blocks the fallback the same way a named ID city does. A single
// "papua" word-boundary match also covers every province variant ("Papua
// Barat", "Papua Tengah", "West Papua", ...) since hasWord is a substring match.
const NON_JAKARTA_ID_LOCALITIES = [
  ...Object.entries(INDONESIA_PROVINCE_BY_CITY)
    .filter(([, province]) => province !== "DKI Jakarta")
    .map(([locality]) => locality),
  "papua",
];

/**
 * Decide whether a record belongs to the Jakarta city brief. Precision-first,
 * because the brief is country-scoped to Indonesia and "Jakarta" is frequently
 * metonymic for the national government or a meeting / source / context mention.
 *
 * 1. A resolvable district / Greater-Jakarta locality (in the geocoded location
 *    or the masthead-stripped text) is an unambiguous in-scope signal.
 * 2. The specific administrative tokens (jabodetabek / DKI) are also unambiguous.
 * 3. A bare "jakarta" mention scopes IN only when no competing non-Jakarta
 *    Indonesian locality also appears — otherwise the event is centred elsewhere
 *    and the Jakarta reference is contextual, so it is left to the national brief.
 */
export function isJakartaScoped(
  title: string | null | undefined,
  summary: string | null | undefined,
  location: string | null | undefined,
): boolean {
  const cleanedTitle = (title ?? "").replace(JAKARTA_MASTHEAD_RE, "");
  const text = `${cleanedTitle} ${summary ?? ""}`;
  const hay = `${location ?? ""} ${text}`;

  // 1) Unambiguous district / Greater-Jakarta locality.
  if (deriveProvince(location, text, JAKARTA_GAZETTEER) !== null) return true;

  // 2) Specific, non-metonymic administrative tokens.
  for (const t of JAKARTA_STRONG_TOKENS) if (hasWord(hay, t)) return true;

  // 3) Bare "jakarta": accept only when nothing else dominates the story.
  if (hasWord(hay, "jakarta")) {
    for (const locality of NON_JAKARTA_ID_LOCALITIES) {
      if (hasWord(hay, locality)) return false;
    }
    return true;
  }
  return false;
}

/**
 * Resolve the matched Jakarta district / locality as a display string, or null
 * when nothing matches.
 */
export function deriveJakartaLocality(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveLocality(location, text, JAKARTA_GAZETTEER);
}

/**
 * Resolve the Jakarta administrative area (district city or Greater Jakarta)
 * from an explicit location string (if known) or by scanning the incident text.
 * Returns null when nothing matches, so a citywide item falls to "Other".
 */
export function deriveJakartaArea(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveProvince(location, text, JAKARTA_GAZETTEER);
}

/**
 * Derive the Jakarta per-item structured attributes from the incident text.
 * Area is resolved from the location/text; category + business impact come from
 * the shared category rulebook.
 */
export function extractJakartaItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): JakartaExtraction {
  return extractStructuredItem(title, summary, location, JAKARTA_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Delegates to the shared parser.
 */
export function deriveJakartaIncidentDate(text: string, pubDate: Date): Date | null {
  return deriveIncidentDate(text, pubDate);
}
