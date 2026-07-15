// Philippines (national) structured extraction for the Philippines country brief.
//
// Mirror of indonesiaExtract.ts / westPapuaExtract.ts for the Philippines
// national theatre. The category rulebook + business-impact lines + the
// occurred-vs-reported date parser are the SHARED theatre-agnostic core; only
// the city / province -> administrative-region gazetteer below is
// Philippines-specific.
//
// The Philippines is mapped to its 17 ADMINISTRATIVE REGIONS rather than its 82
// provinces: many key incident sites (Manila, Cebu, Davao, Cagayan de Oro,
// Zamboanga, General Santos) are independent, highly-urbanised cities that are
// administratively NOT part of any province, so the region is the unambiguous
// no-fabrication unit. The report dataset groups these regions into four
// island-group buckets; see PHILIPPINES_REPORT_CONFIG in pngReportDataset.ts.
// The "province" field on StructuredTheatreConfig therefore carries a REGION
// display string, and those strings MUST match the bucket.provinces lists.

import {
  compileGazetteer,
  deriveProvince,
  deriveLocality,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

// City / province -> Philippine administrative region. The compiled gazetteer
// scans longest-key-first so a multi-word locality wins over a bare token.
export const PHILIPPINES_REGION_BY_CITY: Record<string, string> = {
  // Metro Manila (National Capital Region)
  manila: "Metro Manila",
  "metro manila": "Metro Manila",
  "national capital region": "Metro Manila",
  "quezon city": "Metro Manila",
  makati: "Metro Manila",
  pasig: "Metro Manila",
  taguig: "Metro Manila",
  caloocan: "Metro Manila",
  pasay: "Metro Manila",
  mandaluyong: "Metro Manila",
  paranaque: "Metro Manila",
  "parañaque": "Metro Manila",
  marikina: "Metro Manila",
  muntinlupa: "Metro Manila",
  "las pinas": "Metro Manila",
  "las piñas": "Metro Manila",
  valenzuela: "Metro Manila",
  malabon: "Metro Manila",
  navotas: "Metro Manila",
  "san juan city": "Metro Manila",
  pateros: "Metro Manila",
  // Cordillera Administrative Region
  baguio: "Cordillera Administrative Region",
  "la trinidad": "Cordillera Administrative Region",
  benguet: "Cordillera Administrative Region",
  sagada: "Cordillera Administrative Region",
  tabuk: "Cordillera Administrative Region",
  ifugao: "Cordillera Administrative Region",
  kalinga: "Cordillera Administrative Region",
  apayao: "Cordillera Administrative Region",
  abra: "Cordillera Administrative Region",
  // Ilocos Region
  vigan: "Ilocos Region",
  "ilocos sur": "Ilocos Region",
  laoag: "Ilocos Region",
  "ilocos norte": "Ilocos Region",
  dagupan: "Ilocos Region",
  lingayen: "Ilocos Region",
  pangasinan: "Ilocos Region",
  "la union": "Ilocos Region",
  "san fernando la union": "Ilocos Region",
  // Cagayan Valley
  tuguegarao: "Cagayan Valley",
  cagayan: "Cagayan Valley",
  cauayan: "Cagayan Valley",
  ilagan: "Cagayan Valley",
  isabela: "Cagayan Valley",
  aparri: "Cagayan Valley",
  "nueva vizcaya": "Cagayan Valley",
  quirino: "Cagayan Valley",
  batanes: "Cagayan Valley",
  // Central Luzon
  angeles: "Central Luzon",
  "clark freeport": "Central Luzon",
  "san fernando pampanga": "Central Luzon",
  pampanga: "Central Luzon",
  malolos: "Central Luzon",
  bulacan: "Central Luzon",
  cabanatuan: "Central Luzon",
  "nueva ecija": "Central Luzon",
  tarlac: "Central Luzon",
  olongapo: "Central Luzon",
  subic: "Central Luzon",
  zambales: "Central Luzon",
  balanga: "Central Luzon",
  bataan: "Central Luzon",
  aurora: "Central Luzon",
  // Calabarzon
  calamba: "Calabarzon",
  "santa rosa laguna": "Calabarzon",
  laguna: "Calabarzon",
  batangas: "Calabarzon",
  lipa: "Calabarzon",
  lucena: "Calabarzon",
  antipolo: "Calabarzon",
  rizal: "Calabarzon",
  "dasmarinas": "Calabarzon",
  "dasmariñas": "Calabarzon",
  bacoor: "Calabarzon",
  imus: "Calabarzon",
  cavite: "Calabarzon",
  quezon: "Calabarzon",
  // Mimaropa
  "puerto princesa": "Mimaropa",
  palawan: "Mimaropa",
  calapan: "Mimaropa",
  "oriental mindoro": "Mimaropa",
  "occidental mindoro": "Mimaropa",
  marinduque: "Mimaropa",
  romblon: "Mimaropa",
  // Bicol Region
  naga: "Bicol Region",
  "camarines sur": "Bicol Region",
  legazpi: "Bicol Region",
  legaspi: "Bicol Region",
  albay: "Bicol Region",
  sorsogon: "Bicol Region",
  daet: "Bicol Region",
  "camarines norte": "Bicol Region",
  iriga: "Bicol Region",
  masbate: "Bicol Region",
  catanduanes: "Bicol Region",
  // Western Visayas
  iloilo: "Western Visayas",
  bacolod: "Western Visayas",
  "negros occidental": "Western Visayas",
  roxas: "Western Visayas",
  capiz: "Western Visayas",
  kalibo: "Western Visayas",
  aklan: "Western Visayas",
  boracay: "Western Visayas",
  antique: "Western Visayas",
  guimaras: "Western Visayas",
  // Central Visayas
  cebu: "Central Visayas",
  mandaue: "Central Visayas",
  "lapu-lapu": "Central Visayas",
  dumaguete: "Central Visayas",
  "negros oriental": "Central Visayas",
  tagbilaran: "Central Visayas",
  bohol: "Central Visayas",
  siquijor: "Central Visayas",
  // Eastern Visayas
  tacloban: "Eastern Visayas",
  leyte: "Eastern Visayas",
  ormoc: "Eastern Visayas",
  catbalogan: "Eastern Visayas",
  samar: "Eastern Visayas",
  borongan: "Eastern Visayas",
  "eastern samar": "Eastern Visayas",
  calbayog: "Eastern Visayas",
  maasin: "Eastern Visayas",
  "southern leyte": "Eastern Visayas",
  biliran: "Eastern Visayas",
  // Zamboanga Peninsula
  zamboanga: "Zamboanga Peninsula",
  dipolog: "Zamboanga Peninsula",
  dapitan: "Zamboanga Peninsula",
  pagadian: "Zamboanga Peninsula",
  "zamboanga del sur": "Zamboanga Peninsula",
  "zamboanga del norte": "Zamboanga Peninsula",
  "zamboanga sibugay": "Zamboanga Peninsula",
  // Northern Mindanao
  "cagayan de oro": "Northern Mindanao",
  iligan: "Northern Mindanao",
  valencia: "Northern Mindanao",
  malaybalay: "Northern Mindanao",
  bukidnon: "Northern Mindanao",
  ozamiz: "Northern Mindanao",
  "misamis oriental": "Northern Mindanao",
  "misamis occidental": "Northern Mindanao",
  gingoog: "Northern Mindanao",
  camiguin: "Northern Mindanao",
  // Davao Region
  davao: "Davao Region",
  tagum: "Davao Region",
  digos: "Davao Region",
  panabo: "Davao Region",
  mati: "Davao Region",
  "davao del sur": "Davao Region",
  "davao del norte": "Davao Region",
  "davao oriental": "Davao Region",
  "davao occidental": "Davao Region",
  "davao de oro": "Davao Region",
  // Soccsksargen
  "general santos": "Soccsksargen",
  gensan: "Soccsksargen",
  koronadal: "Soccsksargen",
  kidapawan: "Soccsksargen",
  tacurong: "Soccsksargen",
  "south cotabato": "Soccsksargen",
  "north cotabato": "Soccsksargen",
  "sultan kudarat": "Soccsksargen",
  sarangani: "Soccsksargen",
  // Caraga
  butuan: "Caraga",
  surigao: "Caraga",
  bislig: "Caraga",
  bayugan: "Caraga",
  tandag: "Caraga",
  "agusan del norte": "Caraga",
  "agusan del sur": "Caraga",
  "surigao del norte": "Caraga",
  "surigao del sur": "Caraga",
  // Bangsamoro (BARMM)
  marawi: "Bangsamoro",
  "lanao del sur": "Bangsamoro",
  cotabato: "Bangsamoro",
  "cotabato city": "Bangsamoro",
  maguindanao: "Bangsamoro",
  jolo: "Bangsamoro",
  sulu: "Bangsamoro",
  basilan: "Bangsamoro",
  lamitan: "Bangsamoro",
  "tawi-tawi": "Bangsamoro",
  bongao: "Bangsamoro",
  parang: "Bangsamoro",
};

const PHILIPPINES_GAZETTEER = compileGazetteer(PHILIPPINES_REGION_BY_CITY);

export type PhilippinesCategory = IncidentCategory;
export type PhilippinesExtraction = StructuredExtraction;

/**
 * Resolve the matched Philippine locality (city / province) as a display
 * string, or null when nothing matches.
 */
export function derivePhilippinesLocality(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveLocality(location, text, PHILIPPINES_GAZETTEER);
}

/**
 * Resolve the Philippine administrative region from an explicit location string
 * (if known) or by scanning the incident text for a known locality. Returns
 * null when nothing matches, so the report falls back to the national bucket.
 */
export function derivePhilippinesProvince(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveProvince(location, text, PHILIPPINES_GAZETTEER);
}

/**
 * Derive the Philippines per-item structured attributes from the incident text.
 * Region is resolved from the location/text; category + business impact come
 * from the shared category rulebook.
 */
export function extractPhilippinesItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): PhilippinesExtraction {
  return extractStructuredItem(title, summary, location, PHILIPPINES_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Delegates to the shared parser.
 */
export function derivePhilippinesIncidentDate(
  text: string,
  pubDate: Date,
): Date | null {
  return deriveIncidentDate(text, pubDate);
}
