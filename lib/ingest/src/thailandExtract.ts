// Thailand (national) structured extraction for the Thailand country brief.
//
// Mirror of indonesiaExtract.ts / westPapuaExtract.ts for the Thailand national
// theatre. The category rulebook + business-impact lines + the occurred-vs-
// reported date parser are the SHARED theatre-agnostic core; only the city /
// district / province -> province gazetteer below is Thailand-specific.
//
// The report dataset groups these provinces into six regional location buckets;
// see THAILAND_REPORT_CONFIG in pngReportDataset.ts. Province display strings
// MUST match the bucket.provinces lists in THAILAND_REPORT_CONFIG.

import {
  compileGazetteer,
  deriveProvince,
  deriveLocality,
  extractStructuredItem,
  deriveIncidentDate,
  type IncidentCategory,
  type StructuredExtraction,
} from "./structuredExtract";

// City / district / province -> Thai province (English romanisation). The
// compiled gazetteer scans longest-key-first so a multi-word locality wins over
// a bare token. Ultra-short ambiguous English homographs (e.g. bare "nan") are
// deliberately omitted so ordinary prose never mis-resolves a province.
export const THAILAND_PROVINCE_BY_CITY: Record<string, string> = {
  // Bangkok Metropolitan Region
  bangkok: "Bangkok",
  "krung thep": "Bangkok",
  "bangkok metropolitan": "Bangkok",
  nonthaburi: "Nonthaburi",
  "pathum thani": "Pathum Thani",
  "samut prakan": "Samut Prakan",
  "nakhon pathom": "Nakhon Pathom",
  "samut sakhon": "Samut Sakhon",
  // Central Thailand
  ayutthaya: "Phra Nakhon Si Ayutthaya",
  "phra nakhon si ayutthaya": "Phra Nakhon Si Ayutthaya",
  "ang thong": "Ang Thong",
  lopburi: "Lopburi",
  "lop buri": "Lopburi",
  "sing buri": "Sing Buri",
  "chai nat": "Chai Nat",
  saraburi: "Saraburi",
  "nakhon nayok": "Nakhon Nayok",
  "suphan buri": "Suphan Buri",
  suphanburi: "Suphan Buri",
  "samut songkhram": "Samut Songkhram",
  kanchanaburi: "Kanchanaburi",
  ratchaburi: "Ratchaburi",
  phetchaburi: "Phetchaburi",
  "hua hin": "Prachuap Khiri Khan",
  "prachuap khiri khan": "Prachuap Khiri Khan",
  // Northern Thailand
  "chiang mai": "Chiang Mai",
  "chiang rai": "Chiang Rai",
  lamphun: "Lamphun",
  lampang: "Lampang",
  uttaradit: "Uttaradit",
  phrae: "Phrae",
  phayao: "Phayao",
  "mae hong son": "Mae Hong Son",
  "mae sot": "Tak",
  tak: "Tak",
  sukhothai: "Sukhothai",
  phitsanulok: "Phitsanulok",
  phichit: "Phichit",
  "kamphaeng phet": "Kamphaeng Phet",
  phetchabun: "Phetchabun",
  "nakhon sawan": "Nakhon Sawan",
  "uthai thani": "Uthai Thani",
  // Northeastern Thailand (Isan)
  "nakhon ratchasima": "Nakhon Ratchasima",
  korat: "Nakhon Ratchasima",
  buriram: "Buriram",
  surin: "Surin",
  sisaket: "Sisaket",
  "si sa ket": "Sisaket",
  "ubon ratchathani": "Ubon Ratchathani",
  ubon: "Ubon Ratchathani",
  yasothon: "Yasothon",
  chaiyaphum: "Chaiyaphum",
  "amnat charoen": "Amnat Charoen",
  "nong bua lamphu": "Nong Bua Lamphu",
  "khon kaen": "Khon Kaen",
  "udon thani": "Udon Thani",
  udon: "Udon Thani",
  loei: "Loei",
  "nong khai": "Nong Khai",
  "maha sarakham": "Maha Sarakham",
  "roi et": "Roi Et",
  kalasin: "Kalasin",
  "sakon nakhon": "Sakon Nakhon",
  "nakhon phanom": "Nakhon Phanom",
  mukdahan: "Mukdahan",
  "bueng kan": "Bueng Kan",
  // Eastern Thailand
  chonburi: "Chonburi",
  "chon buri": "Chonburi",
  pattaya: "Chonburi",
  "laem chabang": "Chonburi",
  "si racha": "Chonburi",
  sriracha: "Chonburi",
  rayong: "Rayong",
  "map ta phut": "Rayong",
  chanthaburi: "Chanthaburi",
  trat: "Trat",
  chachoengsao: "Chachoengsao",
  prachinburi: "Prachinburi",
  "sa kaeo": "Sa Kaeo",
  aranyaprathet: "Sa Kaeo",
  // Southern Thailand
  "nakhon si thammarat": "Nakhon Si Thammarat",
  krabi: "Krabi",
  "phang nga": "Phang Nga",
  phuket: "Phuket",
  "surat thani": "Surat Thani",
  "koh samui": "Surat Thani",
  "ko samui": "Surat Thani",
  ranong: "Ranong",
  chumphon: "Chumphon",
  songkhla: "Songkhla",
  "hat yai": "Songkhla",
  satun: "Satun",
  trang: "Trang",
  phatthalung: "Phatthalung",
  pattani: "Pattani",
  yala: "Yala",
  betong: "Yala",
  narathiwat: "Narathiwat",
  "sungai kolok": "Narathiwat",
  "su-ngai kolok": "Narathiwat",
};

const THAILAND_GAZETTEER = compileGazetteer(THAILAND_PROVINCE_BY_CITY);

export type ThailandCategory = IncidentCategory;
export type ThailandExtraction = StructuredExtraction;

/**
 * Resolve the matched Thai locality (city / district) as a display string, or
 * null when nothing matches.
 */
export function deriveThailandLocality(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveLocality(location, text, THAILAND_GAZETTEER);
}

/**
 * Resolve the Thai province from an explicit location string (if known) or by
 * scanning the incident text for a known locality. Returns null when nothing
 * matches, so the report falls back to the national bucket.
 */
export function deriveThailandProvince(
  location: string | null | undefined,
  text: string,
): string | null {
  return deriveProvince(location, text, THAILAND_GAZETTEER);
}

/**
 * Derive the Thailand per-item structured attributes from the incident text.
 * Province is resolved from the location/text; category + business impact come
 * from the shared category rulebook.
 */
export function extractThailandItem(
  title: string,
  summary: string,
  location: string | null | undefined,
): ThailandExtraction {
  return extractStructuredItem(title, summary, location, THAILAND_GAZETTEER);
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Delegates to the shared parser.
 */
export function deriveThailandIncidentDate(text: string, pubDate: Date): Date | null {
  return deriveIncidentDate(text, pubDate);
}
