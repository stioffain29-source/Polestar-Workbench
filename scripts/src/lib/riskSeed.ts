/**
 * Generic data-centre country-risk SEED helpers (pure, side-effect free).
 *
 * These generalise the CPI-specific helpers in `cpiSeed.ts` so ANY offline
 * index source (WGI, ND-GAIN, INFORM, WRI Aqueduct, World Bank Enterprise
 * Surveys, …) can seed the per-country risk framework through one shared,
 * swappable registry (`riskSourceRegistry.ts`) and one CLI
 * (`import-risk-seed.ts`).
 *
 * They hold NO database or filesystem access so they can be unit tested in
 * isolation (see `__tests__/scripts/riskSeedBandMaps.test.ts`). The CLI owns all
 * I/O.
 *
 * STRICT no-fabrication: a seeded dimension is always marked `provisional` and
 * carries its exact provenance in `source` / `seededFrom` / `sourceDate`; it is
 * never presented as a reviewed analyst assessment until the analyst saves it.
 * An unmatched country is left "not reported" — a value is never guessed.
 */
import type {
  DataCentreRiskConfidence,
  DataCentreRiskDimensionValue,
  DataCentreRiskRating,
} from "@workspace/db/schema";

/**
 * A single band: a value `>= atLeast` maps to `rating`. Bands must be supplied
 * sorted DESCENDING by `atLeast`, with the final band's `atLeast` equal to the
 * scale minimum so every in-range value resolves.
 */
export type RiskBand = { atLeast: number; rating: DataCentreRiskRating };

/**
 * Map a numeric value to a Polestar tier via an ordered band list. Throws on an
 * out-of-range / non-finite value rather than guessing a tier (no fabrication).
 */
export function ratingFromBands(
  value: number,
  bands: readonly RiskBand[],
  scale: { min: number; max: number; label: string },
): DataCentreRiskRating {
  if (!Number.isFinite(value) || value < scale.min || value > scale.max) {
    throw new RangeError(
      `${scale.label} out of range ${scale.min}–${scale.max}: ${String(value)}`,
    );
  }
  for (const b of bands) {
    if (value >= b.atLeast) return b.rating;
  }
  // Unreachable when the final band's atLeast === scale.min, but stay explicit.
  throw new RangeError(
    `${scale.label} ${String(value)} matched no band (check band table)`,
  );
}

/**
 * May this dimension be (re)seeded from a source with `seedPrefix`? NEVER
 * overwrite analyst work:
 *  - a LOCKED dimension is off-limits (analyst pinned it);
 *  - an OVERRIDDEN dimension is off-limits (analyst moved the seed);
 *  - a prior provisional seed from the SAME source prefix may be refreshed;
 *  - an untouched/empty dimension may be seeded;
 *  - any dimension carrying non-seed analyst content is left alone.
 */
export function isSeedable(
  existing: DataCentreRiskDimensionValue | undefined,
  seedPrefix: string,
): boolean {
  if (!existing) return true;
  if (existing.locked) return false;
  if (existing.overridden) return false;
  const isPriorSeed =
    Boolean(existing.provisional) &&
    (existing.seededFrom ?? "").startsWith(seedPrefix);
  if (isPriorSeed) return true;
  const hasContent =
    !!existing.rating ||
    existing.rationale.trim() !== "" ||
    existing.source.trim() !== "" ||
    existing.analystNote.trim() !== "";
  return !hasContent;
}

/** Build a provisional, rated seeded dimension carrying full provenance. */
export function buildSeededDimension(params: {
  rating: DataCentreRiskRating;
  rationale: string;
  source: string;
  seededFrom: string;
  sourceDate: string;
  confidence: DataCentreRiskConfidence;
}): DataCentreRiskDimensionValue {
  return {
    rating: params.rating,
    rationale: params.rationale,
    source: params.source,
    analystNote: "",
    provisional: true,
    overridden: false,
    seededFrom: params.seededFrom,
    sourceDate: params.sourceDate,
    confidence: params.confidence,
    lastReviewed: null,
    locked: false,
  };
}

/**
 * Build a provisional NOTE-ONLY seeded dimension (rating stays null). Used for
 * qualitative sources (e.g. data-localisation legal regimes) that inform an
 * analyst but must not assert a numeric tier.
 */
export function buildNoteDimension(params: {
  rationale: string;
  source: string;
  seededFrom: string;
  sourceDate: string;
  confidence: DataCentreRiskConfidence;
}): DataCentreRiskDimensionValue {
  return {
    rating: null,
    rationale: params.rationale,
    source: params.source,
    analystNote: "",
    provisional: true,
    overridden: false,
    seededFrom: params.seededFrom,
    sourceDate: params.sourceDate,
    confidence: params.confidence,
    lastReviewed: null,
    locked: false,
  };
}

// Split one CSV line honouring double-quoted fields (index country names such
// as "Korea, North" and "Congo, Dem. Rep." embed commas).
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export type IndexRow = { country: string; value: number };
export type ParsedIndex = { year: number | null; rows: IndexRow[] };

const DEFAULT_COUNTRY_HEADER = /country|jurisdiction|economy|territory|nation/i;

/**
 * Parse a local index CSV into `{country, value}` rows. Discovers a country
 * column (default `/country|jurisdiction|economy|territory|nation/i`) and a
 * value column matching `valueHeader`. When `yearFromValueHeader` is set, a
 * four-digit year is pulled out of the matched value header. Rows with an empty
 * country or a non-numeric value are skipped (no guessing).
 */
export function parseIndexCsv(
  text: string,
  cfg: {
    valueHeader: RegExp;
    countryHeader?: RegExp;
    yearFromValueHeader?: boolean;
  },
): ParsedIndex {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { year: null, rows: [] };

  const header = splitCsvLine(lines[0]);
  const countryIdx = header.findIndex((h) =>
    (cfg.countryHeader ?? DEFAULT_COUNTRY_HEADER).test(h),
  );
  const valueIdx = header.findIndex((h) => cfg.valueHeader.test(h));
  if (countryIdx === -1 || valueIdx === -1) return { year: null, rows: [] };

  let year: number | null = null;
  if (cfg.yearFromValueHeader) {
    const m = header[valueIdx].match(/((?:19|20)\d{2})/);
    if (m) year = Number(m[1]);
  }

  const rows: IndexRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const country = (cells[countryIdx] ?? "").trim();
    const raw = (cells[valueIdx] ?? "").trim();
    if (country === "" || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    rows.push({ country, value });
  }
  return { year, rows };
}

export type NoteRow = { country: string; note: string };
export type ParsedNotes = { rows: NoteRow[] };

/**
 * Parse a local two-column CSV into `{country, note}` rows for a NOTE-ONLY
 * source (country + qualitative category/description). Discovers a country
 * column and a note column matching `noteHeader`. Rows with an empty country or
 * an empty note are skipped (no guessing).
 */
export function parseNotesCsv(
  text: string,
  cfg: { noteHeader: RegExp; countryHeader?: RegExp },
): ParsedNotes {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [] };

  const header = splitCsvLine(lines[0]);
  const countryIdx = header.findIndex((h) =>
    (cfg.countryHeader ?? DEFAULT_COUNTRY_HEADER).test(h),
  );
  const noteIdx = header.findIndex((h) => cfg.noteHeader.test(h));
  if (countryIdx === -1 || noteIdx === -1) return { rows: [] };

  const rows: NoteRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const country = (cells[countryIdx] ?? "").trim();
    const note = (cells[noteIdx] ?? "").trim();
    if (country === "" || note === "") continue;
    rows.push({ country, note });
  }
  return { rows };
}
