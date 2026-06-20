// PNG-only structured extraction for the Papua New Guinea country brief.
//
// Additive and PNG-scoped: every helper here runs ONLY for records the
// flashpoint country resolver attributes to Papua New Guinea, so the broadened
// PNG scope and its derived attributes never leak into other countries. The
// columns these populate (province / category / business_impact / incident_date)
// are nullable; every consumer falls back to location / topic / occurredAt when
// they are absent, so non-PNG rows are unaffected.
//
// The category rulebook + business-impact lines + the occurred-vs-reported date
// parser are theatre-AGNOSTIC and live in ./structuredExtract.ts so the PNG and
// West Papua briefs can never drift. Only the city -> province gazetteer below
// is PNG-specific; the functions here are thin wrappers that bind that
// gazetteer to the shared core. The public API (PngCategory, PngExtraction,
// derivePngProvince, extractPngItem, derivePngIncidentDate) is unchanged.

import {
  compileGazetteer,
  deriveProvince,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

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
  erima: "National Capital District",
  tokarara: "National Capital District",
  morata: "National Capital District",
  kaugere: "National Capital District",
  sabama: "National Capital District",
  korobosea: "National Capital District",
  "moresby south": "National Capital District",
  "moresby north-east": "National Capital District",
  "moresby northeast": "National Capital District",
  "moresby north-west": "National Capital District",
  "moresby northwest": "National Capital District",
  "national capital district": "National Capital District",
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

const PNG_GAZETTEER = compileGazetteer(PNG_PROVINCE_BY_CITY);

// The PNG brief's category type is the shared theatre-agnostic category set.
export type PngCategory = IncidentCategory;
export type PngExtraction = StructuredExtraction;

/**
 * Resolve the PNG province from an explicit location string (if known) or by
 * scanning the incident text for a known locality. Returns null when nothing
 * matches, so the report falls back to the location/country label.
 */
export function derivePngProvince(location: string | null | undefined, text: string): string | null {
  return deriveProvince(location, text, PNG_GAZETTEER);
}

/**
 * Derive the PNG per-item structured attributes from the incident text.
 * Province is resolved from the location/text; category + business impact come
 * from the shared category rulebook.
 */
export function extractPngItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): PngExtraction {
  return extractStructuredItem(title, summary, location, PNG_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date (e.g. the West Taraka raid reported 9 Jun for a
 * 26 May operation). Delegates to the shared parser.
 */
export function derivePngIncidentDate(text: string, pubDate: Date): Date | null {
  return deriveIncidentDate(text, pubDate);
}
