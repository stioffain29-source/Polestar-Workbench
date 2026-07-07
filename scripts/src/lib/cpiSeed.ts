/**
 * CPI → data-centre country-risk SEED helpers (pure, side-effect free).
 *
 * Transparency International's Corruption Perceptions Index (CPI) scores a
 * country 0–100, where a HIGHER score means LESS perceived public-sector
 * corruption. Our Polestar risk scale runs the other way (Extreme = worst), so
 * the band map is INVERTED: a high CPI score maps to a LOW risk rating.
 *
 * These helpers hold NO database or filesystem access so they can be unit
 * tested in isolation (see `__tests__/scripts/cpiBandMap.test.ts`). The CLI
 * `scripts/src/import-cpi.ts` owns all I/O.
 *
 * STRICT no-fabrication: a seeded dimension is always marked `provisional` and
 * carries its exact CPI provenance in `source` / `seededFrom`; it is never
 * presented as a reviewed analyst assessment until the analyst saves it.
 */
import type {
  DataCentreRiskDimensionValue,
  DataCentreRiskRating,
} from "@workspace/db/schema";

import {
  buildSeededDimension as buildSeededDimensionGeneric,
  isSeedable,
  splitCsvLine,
} from "./riskSeed.js";

// Re-export so existing importers (and the pinned band-map test) keep resolving
// `splitCsvLine` from here; the single implementation now lives in riskSeed.
export { splitCsvLine };

// Bump this (and add a v2 band function) if the score→tier thresholds ever
// change, so an old provisional seed is distinguishable from a new one.
export const CPI_BAND_MAP_VERSION = 1;

/**
 * INVERTED CPI band map v1. Score is TI CPI (0–100, higher = cleaner).
 *   >= 80        → Insignificant
 *   60 – 79      → Low
 *   40 – 59      → Moderate
 *   20 – 39      → High
 *   < 20         → Extreme
 * Throws on an out-of-range score rather than guessing a tier.
 */
export function cpiScoreToRating(score: number): DataCentreRiskRating {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError(`CPI score out of range 0–100: ${String(score)}`);
  }
  if (score >= 80) return "Insignificant";
  if (score >= 60) return "Low";
  if (score >= 40) return "Moderate";
  if (score >= 20) return "High";
  return "Extreme";
}

/**
 * Build the provisional dimension value seeded from a CPI score for a year.
 * Both the `corruption` and `transparency` dimensions seed from the same CPI
 * score (CPI measures perceived public-sector corruption / transparency).
 */
export function buildSeededDimension(
  score: number,
  year: number,
): DataCentreRiskDimensionValue {
  return buildSeededDimensionGeneric({
    rating: cpiScoreToRating(score),
    rationale: `Provisional — seeded from TI CPI ${year} score ${score} via band mapping v${CPI_BAND_MAP_VERSION}; pending analyst review`,
    source: `Transparency International Corruption Perceptions Index ${year}`,
    seededFrom: `TI CPI ${year}`,
    sourceDate: String(year),
    confidence: "High",
  });
}

/**
 * May this dimension be (re)seeded from CPI? NEVER overwrite analyst work:
 *  - a locked or overridden dimension is off-limits;
 *  - a prior CPI provisional seed may be refreshed to a newer year;
 *  - an untouched/empty dimension may be seeded;
 *  - any dimension carrying non-seed analyst content is left alone.
 * Delegates to the shared `isSeedable`, keyed on the "TI CPI" seed prefix.
 */
export function isCpiSeedable(
  existing: DataCentreRiskDimensionValue | undefined,
): boolean {
  return isSeedable(existing, "TI CPI");
}

export type CpiRow = { country: string; score: number };
export type ParsedCpi = { year: number | null; rows: CpiRow[] };

/**
 * Parse a local CPI CSV into rows. The header must carry a country column
 * (matching /country|jurisdiction|economy|territory/i) and a score column. The
 * score column is discovered as, in order: a "CPI score YYYY" header (which
 * also yields the year), a "score" header, or a bare four-digit-year header.
 * Rows with an empty country or a non-numeric score are skipped (no guessing).
 */
export function parseCpiCsv(text: string): ParsedCpi {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { year: null, rows: [] };

  const header = splitCsvLine(lines[0]);
  const countryIdx = header.findIndex((h) =>
    /country|jurisdiction|economy|territory/i.test(h),
  );

  let scoreIdx = -1;
  let year: number | null = null;
  // Prefer a "CPI score YYYY" / "score YYYY" header — it pins the year too.
  header.forEach((h, i) => {
    if (scoreIdx !== -1) return;
    const m = h.match(/(?:cpi\s*)?score\D*((?:19|20)\d{2})/i);
    if (m) {
      scoreIdx = i;
      year = Number(m[1]);
    }
  });
  if (scoreIdx === -1) {
    scoreIdx = header.findIndex((h) => /score/i.test(h));
  }
  if (scoreIdx === -1) {
    // Last resort: a bare four-digit-year column header IS the score column.
    header.forEach((h, i) => {
      if (scoreIdx !== -1) return;
      const m = h.match(/^((?:19|20)\d{2})$/);
      if (m) {
        scoreIdx = i;
        year = Number(m[1]);
      }
    });
  }

  if (countryIdx === -1 || scoreIdx === -1) return { year, rows: [] };

  const rows: CpiRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const country = (cells[countryIdx] ?? "").trim();
    const score = Number((cells[scoreIdx] ?? "").trim());
    if (country === "" || !Number.isFinite(score)) continue;
    rows.push({ country, score });
  }
  return { year, rows };
}
