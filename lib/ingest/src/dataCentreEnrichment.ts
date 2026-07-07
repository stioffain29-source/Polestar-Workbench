// Provider-AGNOSTIC data-centre enrichment engine.
//
// The registry (`data_centre_facilities`) is filled by two INSERT-only
// importers (OpenStreetMap, PeeringDB). Neither free source publishes a
// facility's operational STATUS, TYPE or CAPACITY, so those columns read "not
// reported". This engine ENRICHES existing rows with exactly those fields from
// a THIRD-PARTY provider export — WITHOUT hard-coding any single provider.
//
// DESIGN (see .agents/memory / project brief):
//   * Provider-agnostic: a provider is a `ProviderProfile` config (column map +
//     status/type value maps). A new provider = a new profile object; the
//     engine never changes. First concrete adapter = a generic FILE (CSV/JSON)
//     loader, mirroring the OFFLINE TAPA precedent — a sample export can be
//     evaluated with NO API key.
//   * STRICT no-fabrication: a field is written ONLY when the source EXPLICITLY
//     states a value that maps into the fixed vocabulary (status/type) or parses
//     as a bare number (capacity). Operator names are NEVER used to infer type.
//     Unmappable / prose values are counted and left "not reported".
//   * ENRICH-ONLY v1: only EXISTING registry rows are updated. Records that
//     match no row are reported (never inserted — that would duplicate the OSM /
//     PeeringDB importers).
//   * Per-field provenance: every written field stamps `enrichment_sources`
//     (which provider, which reference, which value). That stamp is also the
//     idempotency marker — a value already imported once is never re-imposed,
//     so re-runs are no-ops and a later analyst override is respected.
//   * Dry-run first: the summary carries a per-field COVERAGE report and a
//     per-record DIFF list so the desk sees exactly what WOULD change before any
//     `--commit`.

import { eq, inArray } from "drizzle-orm";
import {
  db,
  dataCentreFacilitiesTable,
  type DataCentreStatus,
  type DataCentreType,
  type DataCentreFacility,
  type EnrichmentSources,
  type EnrichmentFieldSource,
  type EnrichmentLocks,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Provider profile
// ---------------------------------------------------------------------------

/**
 * The 12 normalised fields a provider export can carry, mapped to the source's
 * own column / JSON-key names. Only `name` is required; anything absent from a
 * given provider is simply left unmapped (and reads 0% coverage).
 */
export interface ProviderColumnMap {
  name: string;
  operator?: string;
  country?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  status?: string;
  facilityType?: string;
  capacityMw?: string;
  itLoadMw?: string;
  sourceRef?: string;
  asOf?: string;
}

export interface ProviderProfile {
  /** Display name, e.g. "Baxtel". Never a secret. */
  name: string;
  /** Export format of the sample file. */
  format: "csv" | "json";
  /** Source column / JSON-key names for each normalised field. */
  columnMap: ProviderColumnMap;
  /**
   * EXACT-match (lowercased, trimmed) source-status string -> our vocabulary.
   * Any status the map does not cover is counted "unmappable" and NOT written.
   */
  statusValueMap: Record<string, DataCentreStatus>;
  /** Same, for facility type. */
  typeValueMap: Record<string, DataCentreType>;
  /** Unit of the capacity/IT-load columns. Defaults to MW. */
  powerUnit?: "MW" | "kW";
}

// ---------------------------------------------------------------------------
// Normalised record
// ---------------------------------------------------------------------------

/** One provider row parsed + mapped into our normalised shape. */
export interface EnrichmentRecord {
  name: string;
  operator: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Mapped into the vocabulary, or null when absent/unmappable. */
  status: DataCentreStatus | null;
  /** The verbatim source status string, if the row carried one (for coverage). */
  rawStatus: string | null;
  facilityType: DataCentreType | null;
  rawFacilityType: string | null;
  capacityMw: number | null;
  itLoadMw: number | null;
  sourceRef: string | null;
  asOf: string | null;
}

/** The four columns this engine is allowed to WRITE. */
export const ENRICHABLE_FIELDS = [
  "status",
  "facilityType",
  "capacityMw",
  "itLoadMw",
] as const;
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/** All 12 normalised fields, in report order — used by the coverage table. */
export const COVERAGE_FIELDS = [
  "name",
  "operator",
  "country",
  "city",
  "latitude",
  "longitude",
  "status",
  "facilityType",
  "capacityMw",
  "itLoadMw",
  "sourceRef",
  "asOf",
] as const;
export type CoverageField = (typeof COVERAGE_FIELDS)[number];

// ---------------------------------------------------------------------------
// CSV / JSON parsing (pure, dependency-free)
// ---------------------------------------------------------------------------

/** Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, CRLF, commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Trailing field / row (file may not end in a newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normHeader(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Turn parsed rows / JSON objects into header-keyed plain records. */
function toRawRecords(
  content: string,
  format: "csv" | "json",
): Record<string, string>[] {
  if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
        ? ((parsed as { data: unknown[] }).data)
        : [];
    const out: Record<string, string>[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const rec: Record<string, string> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        rec[normHeader(k)] =
          v == null ? "" : typeof v === "string" ? v : String(v);
      }
      out.push(rec);
    }
    return out;
  }

  const grid = parseCsv(content);
  if (grid.length < 2) return [];
  const headers = grid[0].map(normHeader);
  const out: Record<string, string>[] = [];
  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r];
    // Skip a fully blank line.
    if (cells.every((c) => c.trim() === "")) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = (cells[idx] ?? "").trim();
    });
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value coercion (no-fabrication)
// ---------------------------------------------------------------------------

function cleanStr(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function mapVocab<T extends string>(
  raw: string | null,
  valueMap: Record<string, T>,
): { value: T | null; unmappable: boolean } {
  if (raw == null) return { value: null, unmappable: false };
  const key = raw.toLowerCase().trim();
  // hasOwnProperty guard so a cell like "constructor" / "__proto__" can NEVER
  // resolve to an inherited prototype member and smuggle a non-vocabulary value
  // into the constrained column (no-fabrication is mechanical, not incidental).
  if (!Object.prototype.hasOwnProperty.call(valueMap, key)) {
    return { value: null, unmappable: true };
  }
  const hit = valueMap[key];
  if (hit) return { value: hit, unmappable: false };
  return { value: null, unmappable: true };
}

/**
 * STRICT power parse: accept only a bare number, optionally with a single
 * trailing MW/kW unit ("50", "50 MW", "50MW"). Reject prose ("up to 50MW",
 * "~50", "50-100"). kW is converted to MW. Zero / negative -> null.
 */
export function parsePowerMw(
  raw: string | null,
  defaultUnit: "MW" | "kW" = "MW",
): number | null {
  if (raw == null) return null;
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*(mw|kw)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || defaultUnit).toUpperCase();
  if (unit === "KW") n = n / 1000;
  return n > 0 ? n : null;
}

function parseCoord(raw: string | null, max: number): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null; // treat 0 as "not reported" for lat/long together
  return Math.abs(n) <= max ? n : null;
}

/** Map one raw provider record into the normalised shape via the profile. */
export function normaliseRecord(
  raw: Record<string, string>,
  profile: ProviderProfile,
): EnrichmentRecord | null {
  const get = (col: string | undefined): string | null =>
    col ? cleanStr(raw[normHeader(col)]) : null;

  const name = get(profile.columnMap.name);
  if (!name) return null; // a record with no name cannot be matched — skip.

  const rawStatus = get(profile.columnMap.status);
  const rawType = get(profile.columnMap.facilityType);
  const status = mapVocab(rawStatus, profile.statusValueMap).value;
  const facilityType = mapVocab(rawType, profile.typeValueMap).value;

  const lat = parseCoord(get(profile.columnMap.latitude), 90);
  const lng = parseCoord(get(profile.columnMap.longitude), 180);

  return {
    name,
    operator: get(profile.columnMap.operator),
    country: get(profile.columnMap.country),
    city: get(profile.columnMap.city),
    latitude: lat != null && lng != null ? lat : null,
    longitude: lat != null && lng != null ? lng : null,
    status,
    rawStatus,
    facilityType,
    rawFacilityType: rawType,
    capacityMw: parsePowerMw(get(profile.columnMap.capacityMw), profile.powerUnit),
    itLoadMw: parsePowerMw(get(profile.columnMap.itLoadMw), profile.powerUnit),
    sourceRef: get(profile.columnMap.sourceRef),
    asOf: get(profile.columnMap.asOf),
  };
}

export function parseEnrichmentFile(
  content: string,
  profile: ProviderProfile,
): EnrichmentRecord[] {
  return toRawRecords(content, profile.format)
    .map((r) => normaliseRecord(r, profile))
    .filter((r): r is EnrichmentRecord => r != null);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Facility fields the matcher needs (subset of the full row — test seam). */
export interface MatchableFacility {
  id: number;
  name: string;
  country: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function normaliseFacilityName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Great-circle-ish metres between two points (equirectangular, fine <5km). */
export function haversineMetres(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = toRad(bLng - aLng) * Math.cos(toRad((aLat + bLat) / 2));
  const y = toRad(bLat - aLat);
  return Math.sqrt(x * x + y * y) * R;
}

export type MatchResult =
  | { kind: "matched"; facility: MatchableFacility }
  | { kind: "unmatched" }
  | { kind: "ambiguous"; candidates: MatchableFacility[] };

const PROXIMITY_METRES = 500;

/**
 * Match a record to at most one existing facility. Requires normalised-name +
 * country (case-insensitive) equality. Multiple candidates are broken by coord
 * proximity (<=500 m) then city equality; if still >1, returns "ambiguous" and
 * NOTHING is written.
 */
export function matchRecordToFacilities(
  record: EnrichmentRecord,
  facilities: MatchableFacility[],
): MatchResult {
  const recName = normaliseFacilityName(record.name);
  if (!recName) return { kind: "unmatched" };
  const recCountry = (record.country ?? "").toLowerCase().trim();

  let candidates = facilities.filter(
    (f) =>
      normaliseFacilityName(f.name) === recName &&
      f.country.toLowerCase().trim() === recCountry &&
      recCountry !== "",
  );
  if (candidates.length === 0) return { kind: "unmatched" };
  if (candidates.length === 1) return { kind: "matched", facility: candidates[0] };

  // Tie-break 1: coordinate proximity.
  if (record.latitude != null && record.longitude != null) {
    const near = candidates.filter(
      (f) =>
        f.latitude != null &&
        f.longitude != null &&
        haversineMetres(record.latitude!, record.longitude!, f.latitude, f.longitude) <=
          PROXIMITY_METRES,
    );
    if (near.length === 1) return { kind: "matched", facility: near[0] };
    if (near.length > 1) candidates = near;
  }

  // Tie-break 2: city equality.
  const recCity = (record.city ?? "").toLowerCase().trim();
  if (recCity) {
    const sameCity = candidates.filter(
      (f) => (f.city ?? "").toLowerCase().trim() === recCity,
    );
    if (sameCity.length === 1) return { kind: "matched", facility: sameCity[0] };
    if (sameCity.length > 0) candidates = sameCity;
  }

  return { kind: "ambiguous", candidates };
}

// ---------------------------------------------------------------------------
// Diff (no-fabrication + idempotency)
// ---------------------------------------------------------------------------

export interface FieldDiff {
  facilityId: number;
  facilityName: string;
  field: EnrichableField;
  current: string | number | null;
  proposed: string | number;
  sourceRef: string | null;
}

/** The subset of a facility row the differ reads. */
export interface DiffableFacility {
  id: number;
  name: string;
  status: string;
  facilityType: string;
  capacityMw: number | null;
  itLoadMw: number | null;
  enrichmentSources: EnrichmentSources | null;
  /** Per-field analyst lock. A locked field is never proposed for change. */
  enrichmentLocks: EnrichmentLocks | null;
}

function currentValue(
  facility: DiffableFacility,
  field: EnrichableField,
): string | number | null {
  switch (field) {
    case "status":
      return facility.status;
    case "facilityType":
      return facility.facilityType;
    case "capacityMw":
      return facility.capacityMw;
    case "itLoadMw":
      return facility.itLoadMw;
  }
}

function proposedValue(
  record: EnrichmentRecord,
  field: EnrichableField,
): string | number | null {
  switch (field) {
    case "status":
      return record.status;
    case "facilityType":
      return record.facilityType;
    case "capacityMw":
      return record.capacityMw;
    case "itLoadMw":
      return record.itLoadMw;
  }
}

/**
 * Per-field diff for a matched facility. A field is proposed ONLY when:
 *   (a) the record carries a usable (mapped/parsed) value,
 *   (b) it differs from the current column value,
 *   (c) `enrichment_sources` does NOT already record that EXACT value (so a
 *       value imported once is never re-imposed over a later analyst edit), AND
 *   (d) the field is NOT analyst-LOCKED (a manual correction the desk pinned so
 *       no import can overwrite it).
 */
export function computeFacilityDiff(
  record: EnrichmentRecord,
  facility: DiffableFacility,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of ENRICHABLE_FIELDS) {
    if (facility.enrichmentLocks?.[field]) continue; // (d) analyst-locked
    const proposed = proposedValue(record, field);
    if (proposed == null) continue; // (a) nothing usable from the source
    const current = currentValue(facility, field);
    if (current === proposed) continue; // (b) already equal
    const already = facility.enrichmentSources?.[field];
    if (already && already.value === proposed) continue; // (c) previously imported
    diffs.push({
      facilityId: facility.id,
      facilityName: facility.name,
      field,
      current,
      proposed,
      sourceRef: record.sourceRef,
    });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

export interface FieldCoverage {
  field: CoverageField;
  present: number;
  /** status / facilityType only: raw value present but unmappable to vocab. */
  unmappable: number;
  total: number;
  pct: number;
}

function hasUsableValue(record: EnrichmentRecord, field: CoverageField): boolean {
  switch (field) {
    case "name":
      return record.name.trim() !== "";
    case "operator":
      return record.operator != null;
    case "country":
      return record.country != null;
    case "city":
      return record.city != null;
    case "latitude":
      return record.latitude != null;
    case "longitude":
      return record.longitude != null;
    case "status":
      return record.status != null;
    case "facilityType":
      return record.facilityType != null;
    case "capacityMw":
      return record.capacityMw != null;
    case "itLoadMw":
      return record.itLoadMw != null;
    case "sourceRef":
      return record.sourceRef != null;
    case "asOf":
      return record.asOf != null;
  }
}

export function buildFieldCoverage(records: EnrichmentRecord[]): FieldCoverage[] {
  const total = records.length;
  return COVERAGE_FIELDS.map((field) => {
    let present = 0;
    let unmappable = 0;
    for (const r of records) {
      if (hasUsableValue(r, field)) present += 1;
      if (field === "status" && r.status == null && r.rawStatus != null) {
        unmappable += 1;
      }
      if (field === "facilityType" && r.facilityType == null && r.rawFacilityType != null) {
        unmappable += 1;
      }
    }
    return {
      field,
      present,
      unmappable,
      total,
      pct: total === 0 ? 0 : Math.round((present / total) * 1000) / 10,
    };
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface EnrichmentSummary {
  provider: string;
  commit: boolean;
  totalRecords: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  /** Records that matched a facility already claimed by an earlier record. */
  duplicateMatches: number;
  coverage: FieldCoverage[];
  diffs: FieldDiff[];
  unmatchedRecords: { name: string; country: string | null; city: string | null }[];
  ambiguousRecords: { name: string; country: string | null; candidateIds: number[] }[];
  updatedRows: number;
  fieldWrites: number;
  logLines: string[];
}

export interface EnrichmentOptions {
  profile: ProviderProfile;
  fileContent: string;
  commit?: boolean;
  /** Optional canonical-country scope (case-insensitive). */
  countries?: string[];
  /** Test seam: inject facilities instead of reading the DB. */
  facilities?: DataCentreFacility[];
}

function toMatchable(f: DataCentreFacility): MatchableFacility {
  return {
    id: f.id,
    name: f.name,
    country: f.country,
    city: f.city,
    latitude: f.latitude,
    longitude: f.longitude,
  };
}

function toDiffable(f: DataCentreFacility): DiffableFacility {
  return {
    id: f.id,
    name: f.name,
    status: f.status,
    facilityType: f.facilityType,
    capacityMw: f.capacityMw,
    itLoadMw: f.itLoadMw,
    enrichmentSources: f.enrichmentSources ?? null,
    enrichmentLocks: f.enrichmentLocks ?? null,
  };
}

/**
 * Run one enrichment pass. Pure planning (parse, match, diff, coverage) always
 * runs; DB WRITES happen only when `commit` is true. Idempotent: a second run
 * over the same file (with no analyst change between) proposes zero diffs.
 */
export async function runDataCentreEnrichment(
  opts: EnrichmentOptions,
): Promise<EnrichmentSummary> {
  const { profile, fileContent, commit = false, countries } = opts;
  const log: string[] = [];

  const records = parseEnrichmentFile(fileContent, profile);
  const coverage = buildFieldCoverage(records);

  // Load the registry (optionally scoped by country) unless injected.
  let facilities: DataCentreFacility[];
  if (opts.facilities) {
    facilities = opts.facilities;
  } else {
    const scope = (countries ?? []).map((c) => c.trim()).filter(Boolean);
    facilities = await db
      .select()
      .from(dataCentreFacilitiesTable)
      .where(
        scope.length
          ? inArray(dataCentreFacilitiesTable.country, scope)
          : undefined,
      );
  }
  const matchables = facilities.map(toMatchable);
  const diffableById = new Map(facilities.map((f) => [f.id, toDiffable(f)]));

  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let duplicateMatches = 0;
  const diffs: FieldDiff[] = [];
  const unmatchedRecords: EnrichmentSummary["unmatchedRecords"] = [];
  const ambiguousRecords: EnrichmentSummary["ambiguousRecords"] = [];
  // facilityId -> { diffs, record } collected for the (optional) commit pass.
  const perFacility = new Map<number, { record: EnrichmentRecord; diffs: FieldDiff[] }>();

  for (const record of records) {
    const m = matchRecordToFacilities(record, matchables);
    if (m.kind === "unmatched") {
      unmatched += 1;
      unmatchedRecords.push({
        name: record.name,
        country: record.country,
        city: record.city,
      });
      continue;
    }
    if (m.kind === "ambiguous") {
      ambiguous += 1;
      ambiguousRecords.push({
        name: record.name,
        country: record.country,
        candidateIds: m.candidates.map((c) => c.id),
      });
      continue;
    }
    matched += 1;
    const diffable = diffableById.get(m.facility.id)!;
    const facDiffs = computeFacilityDiff(record, diffable);
    if (facDiffs.length > 0) {
      // If two sample records match the SAME facility, the first with diffs wins
      // (the commit pass writes perFacility). Only the winner's diffs go into
      // `diffs` so the dry-run report matches exactly what --commit will write;
      // any later collision is counted + logged for the owner to reconcile.
      if (perFacility.has(m.facility.id)) {
        duplicateMatches += 1;
      } else {
        perFacility.set(m.facility.id, { record, diffs: facDiffs });
        diffs.push(...facDiffs);
      }
    }
  }

  let updatedRows = 0;
  let fieldWrites = 0;

  if (commit && perFacility.size > 0 && !opts.facilities) {
    const asOfStamp = new Date();
    for (const [facilityId, { record, diffs: facDiffs }] of perFacility) {
      const existing = diffableById.get(facilityId)!;
      const updateData: Record<string, unknown> = { updatedAt: asOfStamp };
      const newSources: EnrichmentSources = { ...(existing.enrichmentSources ?? {}) };
      for (const d of facDiffs) {
        updateData[d.field] = d.proposed;
        const src: EnrichmentFieldSource = {
          provider: profile.name,
          sourceRef: record.sourceRef,
          asOf: record.asOf,
          value: d.proposed,
        };
        newSources[d.field] = src;
        fieldWrites += 1;
      }
      updateData.enrichmentSources = newSources;
      // Replicate the PATCH route's status-transition stamping so the recent-
      // movers monitor stays correct when the engine changes status.
      const statusDiff = facDiffs.find((d) => d.field === "status");
      if (statusDiff && statusDiff.current !== statusDiff.proposed) {
        updateData.statusChanged = true;
        updateData.previousStatus = existing.status;
        updateData.statusChangedAt = asOfStamp;
      }
      await db
        .update(dataCentreFacilitiesTable)
        .set(updateData)
        .where(eq(dataCentreFacilitiesTable.id, facilityId));
      updatedRows += 1;
    }
  }

  log.push(
    `${profile.name}: ${records.length} record(s) parsed — ${matched} matched, ${unmatched} unmatched, ${ambiguous} ambiguous.`,
  );
  if (duplicateMatches > 0) {
    log.push(
      `NOTE: ${duplicateMatches} record(s) matched a facility another record already claimed — only the first is applied. Reconcile duplicates in the sample.`,
    );
  }
  log.push(
    commit
      ? `COMMIT: updated ${updatedRows} facility row(s), ${fieldWrites} field(s) written.`
      : `DRY-RUN: ${diffs.length} field change(s) proposed across ${perFacility.size} facility row(s). No writes.`,
  );

  return {
    provider: profile.name,
    commit,
    totalRecords: records.length,
    matched,
    unmatched,
    ambiguous,
    duplicateMatches,
    coverage,
    diffs,
    unmatchedRecords,
    ambiguousRecords,
    updatedRows,
    fieldWrites,
    logLines: log,
  };
}

// ---------------------------------------------------------------------------
// Provider profiles
// ---------------------------------------------------------------------------

// Common industry status vocabulary -> our fixed DATA_CENTRE_STATUSES. Kept
// CONSERVATIVE: only unambiguous synonyms. Anything not here is "unmappable"
// and never written. Extend as a real provider sample dictates.
const COMMON_STATUS_MAP: Record<string, DataCentreStatus> = {
  operational: "Operational",
  live: "Operational",
  "in service": "Operational",
  "in operation": "Operational",
  active: "Operational",
  "under construction": "Under construction",
  construction: "Under construction",
  building: "Under construction",
  approved: "Approved",
  permitted: "Approved",
  proposed: "Proposed",
  announced: "Proposed",
  planned: "Proposed",
  "planning submitted": "Planning submitted",
  "in planning": "Planning submitted",
  "application submitted": "Planning submitted",
  "planning refused": "Planning refused",
  refused: "Planning refused",
  delayed: "Delayed",
  "on hold": "Delayed",
  suspended: "Suspended",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  abandoned: "Cancelled",
};

const COMMON_TYPE_MAP: Record<string, DataCentreType> = {
  hyperscale: "Hyperscale",
  colocation: "Colocation",
  colo: "Colocation",
  "multi-tenant": "Colocation",
  "retail colocation": "Colocation",
  enterprise: "Enterprise",
  private: "Enterprise",
  edge: "Edge",
  "cloud region": "Cloud region",
  "availability zone": "Cloud region",
  "carrier hotel": "Carrier hotel",
  "carrier-neutral": "Carrier hotel",
  interconnection: "Carrier hotel",
};

/**
 * GENERIC profile — expects canonical column names. Use this to evaluate ANY
 * provider sample by renaming its columns to these headers, OR clone it into a
 * provider-specific profile once the real column names are known from a sample.
 * Canonical CSV/JSON columns:
 *   name, operator, country, city, latitude, longitude, status,
 *   facility_type, capacity_mw, it_load_mw, source_ref, as_of
 */
export const GENERIC_PROFILE: ProviderProfile = {
  name: "Generic",
  format: "csv",
  columnMap: {
    name: "name",
    operator: "operator",
    country: "country",
    city: "city",
    latitude: "latitude",
    longitude: "longitude",
    status: "status",
    facilityType: "facility_type",
    capacityMw: "capacity_mw",
    itLoadMw: "it_load_mw",
    sourceRef: "source_ref",
    asOf: "as_of",
  },
  statusValueMap: COMMON_STATUS_MAP,
  typeValueMap: COMMON_TYPE_MAP,
  powerUnit: "MW",
};

/** Registry of known provider profiles, keyed by lowercased provider token. */
export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  generic: GENERIC_PROFILE,
};

export function getProviderProfile(token: string): ProviderProfile | undefined {
  return PROVIDER_PROFILES[token.toLowerCase().trim()];
}
