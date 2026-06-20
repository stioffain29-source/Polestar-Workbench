// West Papua (Indonesian Papua) structured extraction for the West Papua
// country brief.
//
// Mirror of pngExtract.ts for the Indonesian Papua theatre. Additive and
// theatre-scoped: every helper runs ONLY for records the flashpoint country
// resolver attributes to West Papua (and NOT cross-border Papua New Guinea —
// those keep their PNG enrichment, since one row carries a single
// province/category/business_impact/incident_date set). The category rulebook +
// date parser are the SHARED theatre-agnostic core; only the city -> province
// gazetteer below is West-Papua-specific.
//
// Provinces follow the post-2022 six-province split of Indonesian Papua:
//   Papua (Jayapura), Papua Pegunungan (Highland Papua, Wamena),
//   Papua Tengah (Central Papua, Nabire), Papua Selatan (South Papua, Merauke),
//   Papua Barat (West Papua, Manokwari), Papua Barat Daya (Southwest Papua,
//   Sorong).
// The report dataset groups these six provinces into four location buckets;
// see WEST_PAPUA_CONFIG in pngReportDataset.ts.

import {
  compileGazetteer,
  deriveProvince,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

// City / regency / locality -> Indonesian Papua province. Only distinctive
// proper-noun localities are listed; the ambiguous bare region terms
// ("west papua", "papua barat") are deliberately omitted so a generic
// region-only story falls through to the national bucket instead of being
// mis-filed under the Papua Barat province.
export const WEST_PAPUA_PROVINCE_BY_CITY: Record<string, string> = {
  // Papua (NE coast; capital Jayapura)
  jayapura: "Papua",
  sentani: "Papua",
  abepura: "Papua",
  waena: "Papua",
  keerom: "Papua",
  arso: "Papua",
  sarmi: "Papua",
  "biak numfor": "Papua",
  biak: "Papua",
  supiori: "Papua",
  waropen: "Papua",
  mamberamo: "Papua",
  genyem: "Papua",
  // Papua Pegunungan (Highland Papua; capital Wamena)
  wamena: "Papua Pegunungan",
  jayawijaya: "Papua Pegunungan",
  nduga: "Papua Pegunungan",
  kenyam: "Papua Pegunungan",
  yahukimo: "Papua Pegunungan",
  dekai: "Papua Pegunungan",
  "lanny jaya": "Papua Pegunungan",
  tiom: "Papua Pegunungan",
  tolikara: "Papua Pegunungan",
  karubaga: "Papua Pegunungan",
  yalimo: "Papua Pegunungan",
  elelim: "Papua Pegunungan",
  "pegunungan bintang": "Papua Pegunungan",
  oksibil: "Papua Pegunungan",
  kiwirok: "Papua Pegunungan",
  // Papua Tengah (Central Papua; capital Nabire)
  nabire: "Papua Tengah",
  mimika: "Papua Tengah",
  timika: "Papua Tengah",
  "intan jaya": "Papua Tengah",
  sugapa: "Papua Tengah",
  bilogai: "Papua Tengah",
  "puncak jaya": "Papua Tengah",
  mulia: "Papua Tengah",
  puncak: "Papua Tengah",
  ilaga: "Papua Tengah",
  beoga: "Papua Tengah",
  paniai: "Papua Tengah",
  enarotali: "Papua Tengah",
  dogiyai: "Papua Tengah",
  deiyai: "Papua Tengah",
  // Papua Selatan (South Papua; capital Merauke)
  merauke: "Papua Selatan",
  "boven digoel": "Papua Selatan",
  "tanah merah": "Papua Selatan",
  mappi: "Papua Selatan",
  kepi: "Papua Selatan",
  asmat: "Papua Selatan",
  agats: "Papua Selatan",
  // Papua Barat (West Papua; capital Manokwari)
  manokwari: "Papua Barat",
  "teluk bintuni": "Papua Barat",
  bintuni: "Papua Barat",
  "teluk wondama": "Papua Barat",
  wasior: "Papua Barat",
  fakfak: "Papua Barat",
  kaimana: "Papua Barat",
  "arfak": "Papua Barat",
  // Papua Barat Daya (Southwest Papua; capital Sorong)
  sorong: "Papua Barat Daya",
  aimas: "Papua Barat Daya",
  "raja ampat": "Papua Barat Daya",
  waisai: "Papua Barat Daya",
  tambrauw: "Papua Barat Daya",
  maybrat: "Papua Barat Daya",
  kumurkek: "Papua Barat Daya",
  teminabuan: "Papua Barat Daya",
};

const WEST_PAPUA_GAZETTEER = compileGazetteer(WEST_PAPUA_PROVINCE_BY_CITY);

export type WestPapuaCategory = IncidentCategory;
export type WestPapuaExtraction = StructuredExtraction;

/**
 * Resolve the Indonesian Papua province from an explicit location string (if
 * known) or by scanning the incident text for a known locality. Returns null
 * when nothing matches, so the report falls back to the location/country label.
 */
export function deriveWestPapuaProvince(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveProvince(location, text, WEST_PAPUA_GAZETTEER);
}

/**
 * Derive the West Papua per-item structured attributes from the incident text.
 * Province is resolved from the location/text; category + business impact come
 * from the shared category rulebook.
 */
export function extractWestPapuaItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): WestPapuaExtraction {
  return extractStructuredItem(title, summary, location, WEST_PAPUA_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Delegates to the shared parser.
 */
export function deriveWestPapuaIncidentDate(text: string, pubDate: Date): Date | null {
  return deriveIncidentDate(text, pubDate);
}
