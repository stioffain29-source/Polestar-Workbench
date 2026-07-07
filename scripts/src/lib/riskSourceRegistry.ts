/**
 * Swappable OFFLINE source registry for the data-centre country-risk framework.
 *
 * Each entry maps one public, offline index dataset to the risk dimension(s) it
 * seeds, plus the band map that turns its native scale into a Polestar tier. A
 * new source is added HERE (one entry) — the generic CLI `import-risk-seed.ts`
 * needs no change. There is deliberately NO per-source sign-off: an analyst
 * reviews each seeded value in the editor (it lands `provisional`) and the
 * source is cited in `source` / `seededFrom` / `sourceDate`.
 *
 * STRICT no-fabrication:
 *  - band maps are documented + versioned; an out-of-range value THROWS;
 *  - a country missing from a dataset is left "not reported" (never guessed);
 *  - qualitative sources (data localisation) are NOTE-ONLY — they seed a
 *    rationale/source note but assert NO numeric rating.
 *
 * Band-map thresholds are pinned by `__tests__/scripts/riskSeedBandMaps.test.ts`.
 */
import type {
  DataCentreRiskConfidence,
  DataCentreRiskDimensionKey,
  DataCentreRiskRating,
} from "@workspace/db/schema";

import {
  ratingFromBands,
  parseIndexCsv,
  parseNotesCsv,
  type ParsedIndex,
  type ParsedNotes,
  type RiskBand,
} from "./riskSeed.js";
import {
  cpiScoreToRating,
  parseCpiCsv,
  CPI_BAND_MAP_VERSION,
} from "./cpiSeed.js";

export const RISK_SEED_BAND_MAP_VERSION = 1;

type BaseEntry = {
  id: string;
  name: string;
  dimensions: readonly DataCentreRiskDimensionKey[];
  seededFromPrefix: string;
  confidence: DataCentreRiskConfidence;
  bandMapVersion: number;
  scaleNote: string;
  sourceLabel: (year: number) => string;
  seededFromLabel: (year: number) => string;
};

export type RatingSourceEntry = BaseEntry & {
  kind: "rating";
  valueToRating: (value: number) => DataCentreRiskRating;
  parse: (text: string) => ParsedIndex;
  rationale: (value: number, year: number) => string;
};

export type NoteSourceEntry = BaseEntry & {
  kind: "note";
  parseNotes: (text: string) => ParsedNotes;
  rationale: (note: string, year: number) => string;
};

export type RiskSourceEntry = RatingSourceEntry | NoteSourceEntry;

// ── Band tables (sorted DESCENDING by atLeast; final atLeast === scale min) ──

// Percentile / index where a HIGHER value = BETTER = LOWER risk (inverted).
const INVERTED_100: readonly RiskBand[] = [
  { atLeast: 80, rating: "Insignificant" },
  { atLeast: 60, rating: "Low" },
  { atLeast: 40, rating: "Moderate" },
  { atLeast: 20, rating: "High" },
  { atLeast: 0, rating: "Extreme" },
];

// ND-GAIN 0–100 where a HIGHER value = more climate-ready = LOWER risk.
const NDGAIN_100: readonly RiskBand[] = [
  { atLeast: 60, rating: "Insignificant" },
  { atLeast: 50, rating: "Low" },
  { atLeast: 40, rating: "Moderate" },
  { atLeast: 30, rating: "High" },
  { atLeast: 0, rating: "Extreme" },
];

// WRI Aqueduct baseline water-stress score 0–5 where HIGHER = MORE stress.
const AQUEDUCT_5: readonly RiskBand[] = [
  { atLeast: 4, rating: "Extreme" },
  { atLeast: 3, rating: "High" },
  { atLeast: 2, rating: "Moderate" },
  { atLeast: 1, rating: "Low" },
  { atLeast: 0, rating: "Insignificant" },
];

// INFORM index 0–10 where HIGHER = WORSE (INFORM's own class boundaries).
const INFORM_10: readonly RiskBand[] = [
  { atLeast: 6.5, rating: "Extreme" },
  { atLeast: 5, rating: "High" },
  { atLeast: 3.5, rating: "Moderate" },
  { atLeast: 2, rating: "Low" },
  { atLeast: 0, rating: "Insignificant" },
];

// % of firms reporting the problem 0–100 where HIGHER = WORSE (direct).
const PERCENT_DIRECT_100: readonly RiskBand[] = [
  { atLeast: 80, rating: "Extreme" },
  { atLeast: 60, rating: "High" },
  { atLeast: 40, rating: "Moderate" },
  { atLeast: 20, rating: "Low" },
  { atLeast: 0, rating: "Insignificant" },
];

function provRationale(
  sourceName: string,
  unit: string,
  value: number,
  year: number,
  version: number,
): string {
  return `Provisional — seeded from ${sourceName} ${year} ${unit} ${value} via band mapping v${version}; pending analyst review`;
}

const REGISTRY: readonly RiskSourceEntry[] = [
  {
    kind: "rating",
    id: "cpi",
    name: "Transparency International CPI",
    dimensions: ["corruption", "transparency"],
    seededFromPrefix: "TI CPI",
    confidence: "High",
    bandMapVersion: CPI_BAND_MAP_VERSION,
    scaleNote: "0–100, higher = cleaner (inverted)",
    valueToRating: cpiScoreToRating,
    parse: (text) => {
      const p = parseCpiCsv(text);
      return {
        year: p.year,
        rows: p.rows.map((r) => ({ country: r.country, value: r.score })),
      };
    },
    sourceLabel: (y) =>
      `Transparency International Corruption Perceptions Index ${y}`,
    seededFromLabel: (y) => `TI CPI ${y}`,
    rationale: (v, y) =>
      provRationale("TI CPI", "score", v, y, CPI_BAND_MAP_VERSION),
  },
  {
    kind: "rating",
    id: "wgi-regquality",
    name: "WGI Regulatory Quality (percentile)",
    dimensions: ["regulatoryEnvironment"],
    seededFromPrefix: "WGI RegQuality",
    confidence: "High",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "percentile 0–100, higher = better (inverted)",
    valueToRating: (v) =>
      ratingFromBands(v, INVERTED_100, {
        min: 0,
        max: 100,
        label: "WGI percentile",
      }),
    // Match the PERCENTILE column only. WGI exports also carry an "Estimate"
    // column (−2.5..+2.5, HIGHER = better) whose values are in-range for a
    // 0–100 band table but carry the OPPOSITE meaning — matching it would
    // silently mis-band (e.g. +2.1 excellent → "Extreme"). Percentile-only.
    parse: (text) =>
      parseIndexCsv(text, {
        valueHeader: /percentile/i,
        yearFromValueHeader: true,
      }),
    sourceLabel: (y) =>
      `World Bank Worldwide Governance Indicators — Regulatory Quality ${y}`,
    seededFromLabel: (y) => `WGI RegQuality ${y}`,
    rationale: (v, y) =>
      provRationale(
        "WGI Regulatory Quality",
        "percentile",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "rating",
    id: "wgi-polstab",
    name: "WGI Political Stability (percentile)",
    dimensions: ["politicalStability"],
    seededFromPrefix: "WGI PolStab",
    confidence: "High",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "percentile 0–100, higher = better (inverted)",
    valueToRating: (v) =>
      ratingFromBands(v, INVERTED_100, {
        min: 0,
        max: 100,
        label: "WGI percentile",
      }),
    // Percentile-only (see WGI Regulatory Quality above re: the Estimate trap).
    parse: (text) =>
      parseIndexCsv(text, {
        valueHeader: /percentile/i,
        yearFromValueHeader: true,
      }),
    sourceLabel: (y) =>
      `World Bank Worldwide Governance Indicators — Political Stability ${y}`,
    seededFromLabel: (y) => `WGI PolStab ${y}`,
    rationale: (v, y) =>
      provRationale(
        "WGI Political Stability",
        "percentile",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "rating",
    id: "aqueduct",
    name: "WRI Aqueduct baseline water stress",
    dimensions: ["waterStress"],
    seededFromPrefix: "WRI Aqueduct",
    confidence: "Medium",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "score 0–5, higher = more stress (direct)",
    valueToRating: (v) =>
      ratingFromBands(v, AQUEDUCT_5, {
        min: 0,
        max: 5,
        label: "Aqueduct score",
      }),
    parse: (text) =>
      parseIndexCsv(text, { valueHeader: /water[\s_-]*stress|bws/i }),
    sourceLabel: (y) => `WRI Aqueduct baseline water stress ${y}`,
    seededFromLabel: (y) => `WRI Aqueduct ${y}`,
    rationale: (v, y) =>
      provRationale(
        "WRI Aqueduct baseline water stress",
        "score",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "rating",
    id: "nd-gain",
    name: "ND-GAIN Country Index",
    dimensions: ["environmentalClimate"],
    seededFromPrefix: "ND-GAIN",
    confidence: "Medium",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "index 0–100, higher = more climate-ready (inverted)",
    valueToRating: (v) =>
      ratingFromBands(v, NDGAIN_100, {
        min: 0,
        max: 100,
        label: "ND-GAIN index",
      }),
    // /gain/ only — a raw ND-GAIN "readiness" sub-component is a 0..1 scale that
    // is in-range for this 0–100 band table but bands wrong (same class as the
    // WGI Estimate trap above); match the composite index column only.
    parse: (text) => parseIndexCsv(text, { valueHeader: /gain/i }),
    sourceLabel: (y) => `Notre Dame Global Adaptation Initiative (ND-GAIN) ${y}`,
    seededFromLabel: (y) => `ND-GAIN ${y}`,
    rationale: (v, y) =>
      provRationale("ND-GAIN", "index", v, y, RISK_SEED_BAND_MAP_VERSION),
  },
  {
    kind: "rating",
    id: "inform-hazard",
    name: "INFORM Risk — Hazard & Exposure",
    dimensions: ["naturalHazard"],
    seededFromPrefix: "INFORM Hazard",
    confidence: "Medium",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "index 0–10, higher = worse (direct)",
    valueToRating: (v) =>
      ratingFromBands(v, INFORM_10, {
        min: 0,
        max: 10,
        label: "INFORM index",
      }),
    parse: (text) =>
      parseIndexCsv(text, { valueHeader: /hazard|exposure/i }),
    sourceLabel: (y) => `INFORM Risk Index — Hazard & Exposure ${y}`,
    seededFromLabel: (y) => `INFORM Hazard ${y}`,
    rationale: (v, y) =>
      provRationale(
        "INFORM Hazard & Exposure",
        "index",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "rating",
    id: "inform-conflict",
    name: "INFORM Risk — Conflict",
    dimensions: ["securityCivilUnrest"],
    seededFromPrefix: "INFORM Conflict",
    confidence: "Medium",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "index 0–10, higher = worse (direct)",
    valueToRating: (v) =>
      ratingFromBands(v, INFORM_10, {
        min: 0,
        max: 10,
        label: "INFORM index",
      }),
    parse: (text) =>
      parseIndexCsv(text, { valueHeader: /conflict/i }),
    sourceLabel: (y) => `INFORM Risk Index — Conflict ${y}`,
    seededFromLabel: (y) => `INFORM Conflict ${y}`,
    rationale: (v, y) =>
      provRationale(
        "INFORM Conflict",
        "index",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "rating",
    id: "wb-enterprise-power",
    name: "World Bank Enterprise Surveys — power outages",
    dimensions: ["gridPowerStability"],
    seededFromPrefix: "WB Enterprise Surveys",
    // Caveated: Enterprise Survey vintages are uneven per country, so this seed
    // lands at LOW confidence for the analyst to weigh.
    confidence: "Low",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "% of firms citing electricity as a constraint, higher = worse",
    valueToRating: (v) =>
      ratingFromBands(v, PERCENT_DIRECT_100, {
        min: 0,
        max: 100,
        label: "Enterprise Survey %",
      }),
    parse: (text) =>
      parseIndexCsv(text, { valueHeader: /electric|outage|power|firms/i }),
    sourceLabel: (y) => `World Bank Enterprise Surveys ${y}`,
    seededFromLabel: (y) => `WB Enterprise Surveys ${y}`,
    rationale: (v, y) =>
      provRationale(
        "WB Enterprise Surveys",
        "%",
        v,
        y,
        RISK_SEED_BAND_MAP_VERSION,
      ),
  },
  {
    kind: "note",
    id: "dla-piper-localisation",
    name: "DLA Piper Data Protection Laws of the World",
    dimensions: ["dataLocalisation"],
    seededFromPrefix: "DLA Piper",
    confidence: "Medium",
    bandMapVersion: RISK_SEED_BAND_MAP_VERSION,
    scaleNote: "qualitative regime (note-only, no rating)",
    parseNotes: (text) =>
      parseNotesCsv(text, {
        noteHeader: /regime|localisation|localization|category|requirement|note|status|summary/i,
      }),
    sourceLabel: (y) => `DLA Piper Data Protection Laws of the World ${y}`,
    seededFromLabel: (y) => `DLA Piper ${y}`,
    rationale: (note, y) =>
      `Provisional — data-localisation regime per DLA Piper ${y}: ${note}; pending analyst review`,
  },
];

export const RISK_SOURCE_IDS: readonly string[] = REGISTRY.map((s) => s.id);

export function getRiskSource(id: string): RiskSourceEntry | undefined {
  return REGISTRY.find((s) => s.id === id);
}

export function listRiskSources(): readonly RiskSourceEntry[] {
  return REGISTRY;
}
