// Indonesia (national) structured extraction for the Indonesia country brief.
//
// Mirror of westPapuaExtract.ts for the Indonesia national theatre. The category
// rulebook + business-impact lines + the occurred-vs-reported date parser are
// the SHARED theatre-agnostic core; only the city / regency / province ->
// province gazetteer below is Indonesia-specific.
//
// The report dataset groups these provinces into six regional location buckets;
// see INDONESIA_REPORT_CONFIG in pngReportDataset.ts. Papua-region provinces are
// DELIBERATELY omitted here — Indonesian Papua is served by its own West Papua
// brief, and a Papua-tagged record never carries country "Indonesia".

import {
  compileGazetteer,
  deriveProvince,
  deriveLocality,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

// City / regency / province -> Indonesian province (post-2022 names, excluding
// the six Papua provinces). Province display strings MUST match the
// bucket.provinces lists in INDONESIA_REPORT_CONFIG. Key landmarks that belong
// to a different province than a bare city token (e.g. "Medan Merdeka" square in
// Jakarta vs the city of Medan) are listed explicitly; the compiled gazetteer
// scans longest-key-first so the multi-word landmark wins.
export const INDONESIA_PROVINCE_BY_CITY: Record<string, string> = {
  // DKI Jakarta (capital region)
  "dki jakarta": "DKI Jakarta",
  jakarta: "DKI Jakarta",
  "jakarta pusat": "DKI Jakarta",
  "jakarta utara": "DKI Jakarta",
  "jakarta selatan": "DKI Jakarta",
  "jakarta timur": "DKI Jakarta",
  "jakarta barat": "DKI Jakarta",
  "central jakarta": "DKI Jakarta",
  "north jakarta": "DKI Jakarta",
  "south jakarta": "DKI Jakarta",
  "east jakarta": "DKI Jakarta",
  "west jakarta": "DKI Jakarta",
  "medan merdeka": "DKI Jakarta",
  monas: "DKI Jakarta",
  "patung kuda": "DKI Jakarta",
  "tanah abang": "DKI Jakarta",
  thamrin: "DKI Jakarta",
  sudirman: "DKI Jakarta",
  menteng: "DKI Jakarta",
  "tanjung priok": "DKI Jakarta",
  "kelapa gading": "DKI Jakarta",
  // West Java
  "west java": "West Java",
  "jawa barat": "West Java",
  bandung: "West Java",
  bekasi: "West Java",
  depok: "West Java",
  bogor: "West Java",
  cimahi: "West Java",
  cirebon: "West Java",
  sukabumi: "West Java",
  tasikmalaya: "West Java",
  garut: "West Java",
  karawang: "West Java",
  cikarang: "West Java",
  // Banten
  banten: "Banten",
  serang: "Banten",
  cilegon: "Banten",
  tangerang: "Banten",
  "tangerang selatan": "Banten",
  "south tangerang": "Banten",
  // Central Java
  "central java": "Central Java",
  "jawa tengah": "Central Java",
  semarang: "Central Java",
  surakarta: "Central Java",
  solo: "Central Java",
  magelang: "Central Java",
  tegal: "Central Java",
  pekalongan: "Central Java",
  kudus: "Central Java",
  purwokerto: "Central Java",
  salatiga: "Central Java",
  // Yogyakarta
  yogyakarta: "Yogyakarta",
  jogja: "Yogyakarta",
  jogjakarta: "Yogyakarta",
  sleman: "Yogyakarta",
  bantul: "Yogyakarta",
  // East Java
  "east java": "East Java",
  "jawa timur": "East Java",
  surabaya: "East Java",
  malang: "East Java",
  sidoarjo: "East Java",
  gresik: "East Java",
  kediri: "East Java",
  madiun: "East Java",
  jember: "East Java",
  banyuwangi: "East Java",
  probolinggo: "East Java",
  mojokerto: "East Java",
  madura: "East Java",
  "tanjung perak": "East Java",
  // Aceh
  aceh: "Aceh",
  "banda aceh": "Aceh",
  lhokseumawe: "Aceh",
  sabang: "Aceh",
  // North Sumatra
  "north sumatra": "North Sumatra",
  "sumatera utara": "North Sumatra",
  medan: "North Sumatra",
  belawan: "North Sumatra",
  binjai: "North Sumatra",
  "pematang siantar": "North Sumatra",
  "deli serdang": "North Sumatra",
  // West Sumatra
  "west sumatra": "West Sumatra",
  "sumatera barat": "West Sumatra",
  padang: "West Sumatra",
  bukittinggi: "West Sumatra",
  payakumbuh: "West Sumatra",
  // Riau
  riau: "Riau",
  pekanbaru: "Riau",
  dumai: "Riau",
  // Riau Islands
  "riau islands": "Riau Islands",
  "kepulauan riau": "Riau Islands",
  batam: "Riau Islands",
  "tanjung pinang": "Riau Islands",
  bintan: "Riau Islands",
  // Jambi
  jambi: "Jambi",
  // South Sumatra
  "south sumatra": "South Sumatra",
  "sumatera selatan": "South Sumatra",
  palembang: "South Sumatra",
  lubuklinggau: "South Sumatra",
  prabumulih: "South Sumatra",
  // Bengkulu
  bengkulu: "Bengkulu",
  // Lampung
  lampung: "Lampung",
  "bandar lampung": "Lampung",
  // Bangka Belitung
  "bangka belitung": "Bangka Belitung",
  pangkalpinang: "Bangka Belitung",
  belitung: "Bangka Belitung",
  // West Kalimantan
  "west kalimantan": "West Kalimantan",
  "kalimantan barat": "West Kalimantan",
  pontianak: "West Kalimantan",
  singkawang: "West Kalimantan",
  // Central Kalimantan
  "central kalimantan": "Central Kalimantan",
  "kalimantan tengah": "Central Kalimantan",
  palangkaraya: "Central Kalimantan",
  "palangka raya": "Central Kalimantan",
  sampit: "Central Kalimantan",
  // South Kalimantan
  "south kalimantan": "South Kalimantan",
  "kalimantan selatan": "South Kalimantan",
  banjarmasin: "South Kalimantan",
  banjarbaru: "South Kalimantan",
  // East Kalimantan
  "east kalimantan": "East Kalimantan",
  "kalimantan timur": "East Kalimantan",
  balikpapan: "East Kalimantan",
  samarinda: "East Kalimantan",
  bontang: "East Kalimantan",
  penajam: "East Kalimantan",
  ikn: "East Kalimantan",
  // North Kalimantan
  "north kalimantan": "North Kalimantan",
  "kalimantan utara": "North Kalimantan",
  tarakan: "North Kalimantan",
  nunukan: "North Kalimantan",
  // North Sulawesi
  "north sulawesi": "North Sulawesi",
  "sulawesi utara": "North Sulawesi",
  manado: "North Sulawesi",
  bitung: "North Sulawesi",
  // Central Sulawesi
  "central sulawesi": "Central Sulawesi",
  "sulawesi tengah": "Central Sulawesi",
  palu: "Central Sulawesi",
  poso: "Central Sulawesi",
  morowali: "Central Sulawesi",
  // South Sulawesi
  "south sulawesi": "South Sulawesi",
  "sulawesi selatan": "South Sulawesi",
  makassar: "South Sulawesi",
  parepare: "South Sulawesi",
  palopo: "South Sulawesi",
  // Southeast Sulawesi
  "southeast sulawesi": "Southeast Sulawesi",
  "sulawesi tenggara": "Southeast Sulawesi",
  kendari: "Southeast Sulawesi",
  baubau: "Southeast Sulawesi",
  // West Sulawesi
  "west sulawesi": "West Sulawesi",
  "sulawesi barat": "West Sulawesi",
  mamuju: "West Sulawesi",
  // Gorontalo
  gorontalo: "Gorontalo",
  // Bali
  bali: "Bali",
  denpasar: "Bali",
  kuta: "Bali",
  ubud: "Bali",
  badung: "Bali",
  gianyar: "Bali",
  // West Nusa Tenggara
  "west nusa tenggara": "West Nusa Tenggara",
  "nusa tenggara barat": "West Nusa Tenggara",
  mataram: "West Nusa Tenggara",
  lombok: "West Nusa Tenggara",
  sumbawa: "West Nusa Tenggara",
  bima: "West Nusa Tenggara",
  // East Nusa Tenggara
  "east nusa tenggara": "East Nusa Tenggara",
  "nusa tenggara timur": "East Nusa Tenggara",
  kupang: "East Nusa Tenggara",
  ende: "East Nusa Tenggara",
  maumere: "East Nusa Tenggara",
  "labuan bajo": "East Nusa Tenggara",
  flores: "East Nusa Tenggara",
  sumba: "East Nusa Tenggara",
  // Maluku
  maluku: "Maluku",
  ambon: "Maluku",
  tual: "Maluku",
  seram: "Maluku",
  // North Maluku
  "north maluku": "North Maluku",
  "maluku utara": "North Maluku",
  ternate: "North Maluku",
  tidore: "North Maluku",
  sofifi: "North Maluku",
  halmahera: "North Maluku",
};

const INDONESIA_GAZETTEER = compileGazetteer(INDONESIA_PROVINCE_BY_CITY);

export type IndonesiaCategory = IncidentCategory;
export type IndonesiaExtraction = StructuredExtraction;

/**
 * Resolve the matched Indonesian locality (city / regency) as a display string,
 * or null when nothing matches.
 */
export function deriveIndonesiaLocality(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveLocality(location, text, INDONESIA_GAZETTEER);
}

/**
 * Resolve the Indonesian province from an explicit location string (if known)
 * or by scanning the incident text for a known locality. Returns null when
 * nothing matches, so the report falls back to the national bucket.
 */
export function deriveIndonesiaProvince(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveProvince(location, text, INDONESIA_GAZETTEER);
}

/**
 * Derive the Indonesia per-item structured attributes from the incident text.
 * Province is resolved from the location/text; category + business impact come
 * from the shared category rulebook.
 */
export function extractIndonesiaItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): IndonesiaExtraction {
  return extractStructuredItem(title, summary, location, INDONESIA_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Delegates to the shared parser.
 */
export function deriveIndonesiaIncidentDate(text: string, pubDate: Date): Date | null {
  return deriveIncidentDate(text, pubDate);
}
