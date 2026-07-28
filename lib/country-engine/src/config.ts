// Per-country engine configuration (owner brief §1) — DATA ONLY, never logic.
//
// acceptedTokens / gazetteer are ported (compactly) from the existing datasets:
//   - artifacts/workbench/src/lib/countryMatch.ts (accepted country tokens)
//   - lib/ingest/src/*Extract.ts (PROVINCE_BY_CITY gazetteers)
//   - artifacts/workbench/src/lib/pngReportDataset.ts (province buckets)
//
// Pure — no runtime dependencies.

import type { CountryEngineConfig, IssueCategory, LocationPrecision, SourceReliability } from "./types";

type GazEntry = { province: string; lat?: number; lng?: number; precision: LocationPrecision };

const CITY: LocationPrecision = "Town or city";

// Common approved-source reliability seeds (§28). Merged into every config.
const COMMON_SOURCES: Record<string, SourceReliability> = {
  reuters: "High",
  "associated press": "High",
  "ap news": "High",
  afp: "High",
  bbc: "High",
  abc: "High",
  "al jazeera": "High",
  blogspot: "Low",
  wordpress: "Low",
};

function gaz(entries: Record<string, [string, number?, number?]>): Record<string, GazEntry> {
  const out: Record<string, GazEntry> = {};
  for (const [city, [province, lat, lng]] of Object.entries(entries)) {
    out[city] = { province, lat, lng, precision: CITY };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Papua New Guinea
// ---------------------------------------------------------------------------
const PNG_CONFIG: CountryEngineConfig = {
  slug: "papua-new-guinea",
  countryName: "Papua New Guinea",
  acceptedTokens: ["papua new guinea", "png"],
  gazetteer: gaz({
    "port moresby": ["National Capital District", -9.44, 147.18],
    lae: ["Morobe", -6.73, 146.99],
    "mount hagen": ["Western Highlands", -5.86, 144.23],
    "mt hagen": ["Western Highlands", -5.86, 144.23],
    madang: ["Madang", -5.22, 145.79],
    goroka: ["Eastern Highlands", -6.08, 145.39],
    wewak: ["East Sepik", -3.55, 143.63],
    wabag: ["Enga", -5.49, 143.72],
    tari: ["Hela", -5.85, 142.95],
    mendi: ["Southern Highlands", -6.15, 143.66],
    kokopo: ["East New Britain", -4.35, 152.26],
    kimbe: ["West New Britain", -5.55, 150.14],
    buka: ["Bougainville", -5.42, 154.67],
    arawa: ["Bougainville", -6.22, 155.57],
    vanimo: ["West Sepik", -2.68, 141.3],
    kundiawa: ["Chimbu", -6.02, 144.97],
    alotau: ["Milne Bay", -10.31, 150.45],
    popondetta: ["Oro", -8.77, 148.24],
    kavieng: ["New Ireland", -2.57, 150.8],
    lorengau: ["Manus", -2.02, 147.27],
    enga: ["Enga", -5.3, 143.5],
    bougainville: ["Bougainville", -6.3, 155.2],
  }),
  mapBounds: [-11.7, 140.8, -0.8, 156.5],
  sourceReliability: {
    ...COMMON_SOURCES,
    "post-courier": "Medium",
    "post courier": "Medium",
    "the national": "Medium",
    rnz: "Medium",
    "radio new zealand": "Medium",
  },
  localTerms: {
    raskol: "Violent crime",
    "tribal fight": "Communal or tribal violence",
    "tribal clash": "Communal or tribal violence",
    "sorcery accusation": "Communal or tribal violence",
  },
};

// ---------------------------------------------------------------------------
// Papua (Indonesian West Papua)
// ---------------------------------------------------------------------------
const PAPUA_CONFIG: CountryEngineConfig = {
  slug: "papua",
  countryName: "Papua",
  acceptedTokens: [
    "papua", "west papua", "papua barat", "highland papua", "papua pegunungan",
    "central papua", "papua tengah", "south papua", "papua selatan",
    "southwest papua", "papua barat daya",
  ],
  gazetteer: gaz({
    jayapura: ["Papua", -2.53, 140.72],
    sentani: ["Papua", -2.57, 140.52],
    biak: ["Papua", -1.19, 136.09],
    wamena: ["Papua Pegunungan", -4.1, 138.95],
    nduga: ["Papua Pegunungan", -4.2, 138.5],
    yahukimo: ["Papua Pegunungan", -4.5, 139.4],
    dekai: ["Papua Pegunungan", -4.85, 139.5],
    nabire: ["Papua Tengah", -3.36, 135.5],
    timika: ["Papua Tengah", -4.55, 136.89],
    "intan jaya": ["Papua Tengah", -3.6, 136.6],
    sugapa: ["Papua Tengah", -3.73, 137.03],
    ilaga: ["Papua Tengah", -3.98, 137.55],
    "puncak jaya": ["Papua Tengah", -3.9, 137.5],
    paniai: ["Papua Tengah", -3.9, 136.3],
    merauke: ["Papua Selatan", -8.49, 140.4],
    manokwari: ["Papua Barat", -0.86, 134.06],
    sorong: ["Papua Barat Daya", -0.88, 131.25],
    fakfak: ["Papua Barat", -2.92, 132.3],
  }),
  mapBounds: [-9.5, 130.0, 1.5, 141.5],
  sourceReliability: {
    ...COMMON_SOURCES,
    antara: "Medium",
    "jubi": "Medium",
    rnz: "Medium",
    "benar news": "High",
    "jakarta post": "Medium",
  },
  localTerms: {
    opm: "Insurgency",
    tpnpb: "Insurgency",
    "armed criminal group": "Insurgency",
    kkb: "Insurgency",
  },
};

// ---------------------------------------------------------------------------
// Indonesia (national)
// ---------------------------------------------------------------------------
const INDONESIA_CONFIG: CountryEngineConfig = {
  slug: "indonesia",
  countryName: "Indonesia",
  acceptedTokens: ["indonesia"],
  gazetteer: gaz({
    jakarta: ["DKI Jakarta", -6.2, 106.82],
    surabaya: ["East Java", -7.26, 112.75],
    bandung: ["West Java", -6.91, 107.61],
    medan: ["North Sumatra", 3.6, 98.67],
    semarang: ["Central Java", -6.97, 110.42],
    makassar: ["South Sulawesi", -5.15, 119.43],
    palembang: ["South Sumatra", -2.99, 104.76],
    denpasar: ["Bali", -8.65, 115.22],
    bali: ["Bali", -8.4, 115.19],
    yogyakarta: ["Yogyakarta", -7.8, 110.36],
    "banda aceh": ["Aceh", 5.55, 95.32],
    aceh: ["Aceh", 4.7, 96.75],
    padang: ["West Sumatra", -0.95, 100.35],
    pekanbaru: ["Riau", 0.51, 101.45],
    balikpapan: ["East Kalimantan", -1.24, 116.85],
    manado: ["North Sulawesi", 1.47, 124.84],
    ambon: ["Maluku", -3.65, 128.19],
    lombok: ["West Nusa Tenggara", -8.65, 116.32],
    mataram: ["West Nusa Tenggara", -8.58, 116.11],
    batam: ["Riau Islands", 1.08, 104.03],
  }),
  mapBounds: [-11, 94, 6, 141.5],
  sourceReliability: {
    ...COMMON_SOURCES,
    antara: "Medium",
    "jakarta post": "Medium",
    kompas: "Medium",
    tempo: "Medium",
    detik: "Medium",
    "cnn indonesia": "Medium",
    "cnbc indonesia": "Medium",
  },
  localTerms: {
    ormas: "Civil unrest",
    "demo buruh": "Strike or labour action",
  },
};

// ---------------------------------------------------------------------------
// Jakarta (city-scoped)
// ---------------------------------------------------------------------------
const JAKARTA_CONFIG: CountryEngineConfig = {
  slug: "jakarta",
  countryName: "Indonesia",
  acceptedTokens: ["indonesia", "jakarta", "dki jakarta"],
  gazetteer: gaz({
    jakarta: ["DKI Jakarta", -6.2, 106.82],
    "central jakarta": ["DKI Jakarta", -6.18, 106.83],
    "north jakarta": ["DKI Jakarta", -6.12, 106.88],
    "south jakarta": ["DKI Jakarta", -6.27, 106.81],
    "east jakarta": ["DKI Jakarta", -6.22, 106.9],
    "west jakarta": ["DKI Jakarta", -6.17, 106.76],
    "tanah abang": ["DKI Jakarta", -6.19, 106.81],
    monas: ["DKI Jakarta", -6.18, 106.83],
    thamrin: ["DKI Jakarta", -6.19, 106.82],
    sudirman: ["DKI Jakarta", -6.21, 106.82],
    menteng: ["DKI Jakarta", -6.2, 106.83],
    "tanjung priok": ["DKI Jakarta", -6.11, 106.88],
    "kelapa gading": ["DKI Jakarta", -6.16, 106.91],
  }),
  mapBounds: [-6.4, 106.6, -5.9, 107.1],
  cityScope: true,
  sourceReliability: {
    ...COMMON_SOURCES,
    antara: "Medium",
    "jakarta post": "Medium",
    kompas: "Medium",
    tempo: "Medium",
    detik: "Medium",
  },
};

// ---------------------------------------------------------------------------
// Philippines
// ---------------------------------------------------------------------------
const PHILIPPINES_CONFIG: CountryEngineConfig = {
  slug: "philippines",
  countryName: "Philippines",
  acceptedTokens: ["philippines", "the philippines"],
  gazetteer: gaz({
    manila: ["Metro Manila", 14.6, 120.98],
    "quezon city": ["Metro Manila", 14.68, 121.04],
    makati: ["Metro Manila", 14.55, 121.02],
    "metro manila": ["Metro Manila", 14.6, 121.0],
    cebu: ["Central Visayas", 10.32, 123.9],
    davao: ["Davao Region", 7.19, 125.46],
    zamboanga: ["Zamboanga Peninsula", 6.92, 122.08],
    "cagayan de oro": ["Northern Mindanao", 8.48, 124.65],
    "general santos": ["Soccsksargen", 6.11, 125.17],
    cotabato: ["Bangsamoro", 7.22, 124.25],
    marawi: ["Bangsamoro", 8.0, 124.29],
    jolo: ["Bangsamoro", 6.05, 121.0],
    iloilo: ["Western Visayas", 10.72, 122.56],
    bacolod: ["Western Visayas", 10.68, 122.95],
    baguio: ["Cordillera", 16.41, 120.6],
    tacloban: ["Eastern Visayas", 11.24, 125.0],
  }),
  mapBounds: [4.5, 116, 21.5, 127],
  sourceReliability: {
    ...COMMON_SOURCES,
    inquirer: "Medium",
    rappler: "Medium",
    philstar: "Medium",
    "gma news": "Medium",
    "abs-cbn": "Medium",
    "manila bulletin": "Medium",
  },
  localTerms: {
    npa: "Insurgency",
    "new people's army": "Insurgency",
    "abu sayyaf": "Terrorism",
  },
};

// ---------------------------------------------------------------------------
// Thailand
// ---------------------------------------------------------------------------
const THAILAND_CONFIG: CountryEngineConfig = {
  slug: "thailand",
  countryName: "Thailand",
  acceptedTokens: ["thailand"],
  gazetteer: gaz({
    bangkok: ["Bangkok", 13.75, 100.5],
    nonthaburi: ["Nonthaburi", 13.86, 100.51],
    "chiang mai": ["Chiang Mai", 18.79, 98.98],
    "chiang rai": ["Chiang Rai", 19.91, 99.84],
    phuket: ["Phuket", 7.88, 98.39],
    pattaya: ["Chonburi", 12.93, 100.88],
    chonburi: ["Chonburi", 13.36, 100.98],
    "hat yai": ["Songkhla", 7.01, 100.47],
    songkhla: ["Songkhla", 7.2, 100.6],
    pattani: ["Pattani", 6.87, 101.25],
    yala: ["Yala", 6.54, 101.28],
    narathiwat: ["Narathiwat", 6.43, 101.82],
    "nakhon ratchasima": ["Nakhon Ratchasima", 14.97, 102.1],
    "udon thani": ["Udon Thani", 17.41, 102.79],
    "khon kaen": ["Khon Kaen", 16.44, 102.83],
    ayutthaya: ["Phra Nakhon Si Ayutthaya", 14.35, 100.57],
  }),
  mapBounds: [5.5, 97.3, 20.5, 105.7],
  sourceReliability: {
    ...COMMON_SOURCES,
    "bangkok post": "Medium",
    "nation thailand": "Medium",
    khaosod: "Medium",
    "thai pbs": "Medium",
  },
  localTerms: {
    "deep south": "Insurgency",
    brn: "Insurgency",
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// Bump when engine rules change in a way that must re-process persisted
// country_engine_events (new gate/exclusion rules, classification changes,
// dedupe changes). The api-server boot reprocess keys its migration marker on
// this version, so a bump re-runs the engine for every registered slug on the
// next boot in EVERY environment — gate changes always propagate to the
// persisted review queues instead of waiting for an analyst-triggered re-run.
// v2: legal_process + preparedness_or_awareness gate rules (retire ~1.9k held
// rows for Indonesia alone).
export const COUNTRY_ENGINE_RULE_VERSION = "v2";

export const COUNTRY_ENGINE_CONFIGS: Record<string, CountryEngineConfig> = {
  "papua-new-guinea": PNG_CONFIG,
  papua: PAPUA_CONFIG,
  indonesia: INDONESIA_CONFIG,
  jakarta: JAKARTA_CONFIG,
  philippines: PHILIPPINES_CONFIG,
  thailand: THAILAND_CONFIG,
};

// Build a generic config for any country not in the registry. Uses the country
// name as its single accepted token, an empty gazetteer, and the common source
// seeds. mapBounds is null (caller derives bounds from event locations).
export function buildGenericCountryConfig(name: string): CountryEngineConfig {
  const clean = (name ?? "").trim();
  const slug = clean.toLowerCase().replace(/\s+/g, "-");
  return {
    slug,
    countryName: clean || "Unknown",
    acceptedTokens: clean ? [clean.toLowerCase()] : [],
    gazetteer: {},
    mapBounds: null,
    sourceReliability: { ...COMMON_SOURCES },
  };
}

// Resolve a config by slug, or build a generic config for any other name.
export function getCountryEngineConfig(slug: string): CountryEngineConfig {
  const key = (slug ?? "").trim().toLowerCase();
  return COUNTRY_ENGINE_CONFIGS[key] ?? buildGenericCountryConfig(slug);
}
