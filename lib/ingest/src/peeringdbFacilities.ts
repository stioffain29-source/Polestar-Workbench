import {
  db,
  dataCentreFacilitiesTable,
  type InsertDataCentreFacility,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { OSM_DC_COUNTRIES } from "./osmDataCentres";

// PeeringDB → Data Centre facility REGISTRY importer.
//
// Populates the analyst-maintained `data_centre_facilities` table from the
// public PeeringDB facility API (https://www.peeringdb.com/api/fac — free,
// egress-only, no key required for read). It mirrors the OpenStreetMap importer
// (osmDataCentres.ts) exactly: descriptive-UA fetch with retries/backoff, every
// byte of the response treated as UNTRUSTED input, a dry-run/commit switch, and
// it NEVER closes the shared DB pool (only the CLI wrapper does).
//
// STRICT no-fabrication rules (owner-mandated):
//   - Only import a facility that has BOTH a real `name` AND mapped
//     coordinates. Nameless / coordless records are SKIPPED, never back-filled
//     with an operator string or a guessed point.
//   - operator (from `org_name`) / city / region (from `state`) / notes come
//     ONLY from the explicit PeeringDB fields; absent fields stay null and read
//     "not reported". capacity/dates stay null.
//   - status / planning-risk / facility-type are NEVER inferred. PeeringDB's
//     `status` field is a record-moderation flag ("ok"), NOT a lifecycle state,
//     so it is deliberately DISCARDED: status and planningRisk are stamped the
//     constrained-vocabulary sentinel "Unknown" (which reads "not reported"),
//     exactly as the OSM importer does.
//   - The canonical PeeringDB facility URL is stored on `sourceUrl` for
//     provenance (PeeringDB data is CC-BY — the stored URL satisfies
//     attribution) AND doubles as the idempotency marker (see below).
//
// CRITICAL ISOLATION: this writes ONLY `data_centre_facilities`. A registry
// facility is NEVER an incident — this importer must never touch the `incidents`
// table, never set `linkedIncidentId`, and must NOT be confused with
// `runDataCentresIngest` (topicConfigs), which is a completely separate pass
// that writes NEWS INCIDENTS under topic=data_centres. DO NOT wire this importer
// into the api-server ingest scheduler: it is a supervised, owner-run CLI
// (dry-run → review → commit, country by country) like import-osm-data-centres.
//
// IDEMPOTENCY: dedupe is by the canonical `sourceUrl`
// (https://www.peeringdb.com/fac/<id>) — INSERT-only, never update or delete.
// Re-runs skip refs already present, so they insert 0 new rows. As with OSM, if
// an analyst edits the sourceUrl the next run re-inserts, and if an analyst
// deletes an imported row a re-run resurrects it (INSERT-only, no tombstone) —
// both acceptable because every commit is preceded by an owner-reviewed dry-run.

const PEERINGDB_API_BASE =
  process.env.PEERINGDB_API_BASE?.trim() || "https://www.peeringdb.com/api";

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 30000;
const BASE_BACKOFF_MS = 3000;
// PeeringDB throttles anonymous reads; pace the requests politely.
const SLEEP_BETWEEN_COUNTRIES_MS = 2000;
const SLEEP_BETWEEN_PAGES_MS = 1000;
// PeeringDB caps a page at 250 records; paginate with `skip` past that.
const PAGE_SIZE = 250;
// Defensive stop: 20 pages = 5000 facilities/country, far beyond any real count.
const MAX_PAGES_PER_COUNTRY = 20;
// Clamp untrusted free-text pulled into `notes`.
const NOTES_MAX = 500;
// Two same-named facilities closer than this are flagged as a possible
// duplicate for the owner to eyeball (NOT auto-merged).
const PROXIMITY_WARN_METRES = 250;

// A descriptive User-Agent identifying the client (NOT a spoofed browser), as
// PeeringDB fair-use asks. The read API is public; no key is sent.
const PEERINGDB_UA =
  "PolestarWorkbench/1.0 (geopolitical-risk data-centre registry importer)";

const CREATED_BY = "PeeringDB import";
const STATUS_NOT_REPORTED = "Unknown";
const RISK_NOT_REPORTED = "Unknown";

// Registry scope — SHARED with the OSM importer so both sources cover the same
// 13 territories the desk tracks. `country` is the workbench canonical name
// (matches topicConfigs.ts canonicals); `iso` is the ISO 3166-1 alpha-2 that
// PeeringDB both stores in each record and filters on (`?country__in=`).
export const PEERINGDB_DC_COUNTRIES: ReadonlyArray<{
  country: string;
  iso: string;
}> = OSM_DC_COUNTRIES;

export type PeeringDbNormalisedFacility = {
  peeringDbId: number;
  name: string;
  operator: string | null;
  country: string;
  region: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  notes: string | null;
  sourceUrl: string;
};

export type PeeringDbNormaliseResult =
  | { ok: true; facility: PeeringDbNormalisedFacility }
  | {
      ok: false;
      reason: "no-name" | "no-coords" | "country-mismatch" | "invalid";
    };

export type PeeringDbCountryResult = {
  country: string;
  iso: string;
  fetchOk: boolean;
  pagesFetched: number;
  recordsFetched: number;
  skippedNoName: number;
  skippedNoCoords: number;
  skippedCountryMismatch: number;
  skippedInvalid: number;
  candidates: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  proximityWarnings: string[];
  error: string | null;
  /** New-to-insert facilities, for the dry-run preview table. */
  preview: PeeringDbNormalisedFacility[];
};

export type PeeringDbImportSummary = {
  mode: "commit" | "dry-run";
  countries: PeeringDbCountryResult[];
  totalCandidates: number;
  totalNew: number;
  totalInserted: number;
  logLines: string[];
};

export type PeeringDbImportOptions = {
  commit?: boolean;
  /** ISO codes or canonical names to scope to; default = all of PEERINGDB_DC_COUNTRIES. */
  countries?: string[];
  /** Optional cap on candidates per country (testing / sampling). */
  perCountryLimit?: number;
  /**
   * Test seam: bypass the network by returning parsed PeeringDB JSON for a
   * given country ISO + skip offset. Production leaves this undefined and the
   * real PeeringDB fetch is used.
   */
  fetchPage?: (iso: string, skip: number) => Promise<unknown>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function trimOrNull(value: unknown, max = 200): string | null {
  const s = asString(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function finiteOrNull(value: unknown): number | null {
  // null / undefined / "" must NOT coerce to 0 (Number("") === 0), or an absent
  // lat/lon would look like a real (0,0) point.
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Canonical PeeringDB facility URL — provenance AND idempotency marker. */
export function peeringDbFacUrl(id: number): string {
  return `https://www.peeringdb.com/fac/${id}`;
}

/** Build the PeeringDB facility API URL for one country ISO + page offset. */
export function buildPeeringDbFacUrl(iso: string, skip: number): string {
  const safeIso = iso.replace(/[^A-Za-z]/g, "").toUpperCase();
  const safeSkip = Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0;
  return `${PEERINGDB_API_BASE}/fac?country__in=${safeIso}&limit=${PAGE_SIZE}&skip=${safeSkip}`;
}

/**
 * Coerce one PeeringDB facility record into our trusted facility shape. Returns
 * a discriminated result so the caller can count WHY a record was skipped.
 *
 * No-fabrication gates:
 *   - `name` must be present (else "no-name" — org_name is NEVER promoted into
 *     the name column);
 *   - the record's `country` ISO must match the requested country (else
 *     "country-mismatch" — defensive, the API filter should already guarantee it);
 *   - coordinates must be present and in-range (else "no-coords").
 */
export function normalisePeeringDbFac(
  raw: unknown,
  country: string,
  iso: string,
): PeeringDbNormaliseResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid" };
  const rec = raw as Record<string, unknown>;

  const id = finiteOrNull(rec.id);
  if (id == null || !Number.isInteger(id)) {
    return { ok: false, reason: "invalid" };
  }

  // Name — strict: no org_name fallback (that would assert a name the source
  // does not report as the facility name).
  const name = trimOrNull(rec.name);
  if (!name) return { ok: false, reason: "no-name" };

  // Country must be the one we asked for. PeeringDB stores ISO 3166-1 alpha-2.
  const recIso = asString(rec.country).trim().toUpperCase();
  if (recIso !== iso.toUpperCase()) {
    return { ok: false, reason: "country-mismatch" };
  }

  const lat = finiteOrNull(rec.latitude);
  const lon = finiteOrNull(rec.longitude);
  if (
    lat == null ||
    lon == null ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return { ok: false, reason: "no-coords" };
  }

  // Everything below is optional context taken ONLY from explicit fields; absent
  // fields stay null and read "not reported".
  const operator = trimOrNull(rec.org_name);
  const region = trimOrNull(rec.state);
  const city = trimOrNull(rec.city);
  const notes = trimOrNull(rec.notes, NOTES_MAX);

  return {
    ok: true,
    facility: {
      peeringDbId: id,
      name,
      operator,
      country,
      region,
      city,
      latitude: lat,
      longitude: lon,
      notes,
      sourceUrl: peeringDbFacUrl(id),
    },
  };
}

function haversineMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Flag same-named facilities mapped close together — a likely duplicate listing.
 * We do NOT auto-merge (that could silently drop a genuine second facility); the
 * owner decides from the dry-run.
 */
export function findPeeringDbProximityWarnings(
  facilities: PeeringDbNormalisedFacility[],
): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < facilities.length; i++) {
    for (let j = i + 1; j < facilities.length; j++) {
      const a = facilities[i]!;
      const b = facilities[j]!;
      if (a.name.toLowerCase() !== b.name.toLowerCase()) continue;
      const metres = haversineMetres(a, b);
      if (metres <= PROXIMITY_WARN_METRES) {
        warnings.push(
          `possible duplicate listing of "${a.name}" — fac/${a.peeringDbId} & fac/${b.peeringDbId} (${Math.round(metres)} m apart); both will be imported unless you remove one`,
        );
      }
    }
  }
  return warnings;
}

/** Dedupe a batch by canonical sourceUrl (first occurrence wins). */
export function dedupePeeringDbBySourceUrl(
  facilities: PeeringDbNormalisedFacility[],
): PeeringDbNormalisedFacility[] {
  const seen = new Set<string>();
  const out: PeeringDbNormalisedFacility[] = [];
  for (const f of facilities) {
    if (seen.has(f.sourceUrl)) continue;
    seen.add(f.sourceUrl);
    out.push(f);
  }
  return out;
}

async function fetchPeeringDbPageLive(
  iso: string,
  skip: number,
): Promise<unknown> {
  const url = buildPeeringDbFacUrl(iso, skip);
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": PEERINGDB_UA,
            Accept: "application/json",
          },
          signal: ctrl.signal,
        });
      } catch (err) {
        throw {
          transient: true,
          message: ctrl.signal.aborted
            ? `timed out after ${FETCH_TIMEOUT_MS}ms`
            : err instanceof Error
              ? err.message
              : String(err),
        };
      }
      if (!res.ok) {
        // 429 (rate limited) and 5xx are the standard PeeringDB pushbacks.
        const transient = res.status === 429 || res.status >= 500;
        throw { transient, message: `status ${res.status}` };
      }
      return (await res.json()) as unknown;
    } catch (err) {
      lastErr = err;
      const transient = !!(
        err &&
        typeof err === "object" &&
        (err as { transient?: boolean }).transient
      );
      if (transient && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 800);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const msg =
    lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String((lastErr as { message: unknown }).message)
      : String(lastErr);
  throw new Error(msg);
}

function extractData(json: unknown): unknown[] {
  if (
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown[] }).data)
  ) {
    return (json as { data: unknown[] }).data;
  }
  return [];
}

function resolveCountries(
  filter?: string[],
): { country: string; iso: string }[] {
  if (!filter || filter.length === 0) return [...PEERINGDB_DC_COUNTRIES];
  const wanted = new Set(
    filter.map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
  return PEERINGDB_DC_COUNTRIES.filter(
    (c) => wanted.has(c.iso.toLowerCase()) || wanted.has(c.country.toLowerCase()),
  );
}

/**
 * Run the PeeringDB → Data Centre facility registry import. For each scoped
 * country it pages the PeeringDB facility API, normalises + de-duplicates the
 * records, skips any already stored (by sourceUrl), and — in commit mode —
 * inserts the new ones into `data_centre_facilities`. Never throws (per-country
 * failures are captured in the summary) and NEVER closes the shared DB pool.
 */
export async function runPeeringDbFacilityRegistryImport(
  opts: PeeringDbImportOptions = {},
): Promise<PeeringDbImportSummary> {
  const commit = opts.commit ?? false;
  const targets = resolveCountries(opts.countries);
  const fetchImpl =
    opts.fetchPage ?? ((iso: string, skip: number) => fetchPeeringDbPageLive(iso, skip));
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(
    `PeeringDB data-centre registry import — mode=${commit ? "COMMIT" : "DRY-RUN"}, countries=${targets.map((t) => t.iso).join(",") || "(none)"}`,
  );

  const results: PeeringDbCountryResult[] = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const { country, iso } = targets[idx]!;
    const result: PeeringDbCountryResult = {
      country,
      iso,
      fetchOk: true,
      pagesFetched: 0,
      recordsFetched: 0,
      skippedNoName: 0,
      skippedNoCoords: 0,
      skippedCountryMismatch: 0,
      skippedInvalid: 0,
      candidates: 0,
      duplicateInDb: 0,
      newToInsert: 0,
      inserted: 0,
      proximityWarnings: [],
      error: null,
      preview: [],
    };

    try {
      const records: unknown[] = [];
      for (let page = 0; page < MAX_PAGES_PER_COUNTRY; page++) {
        const skip = page * PAGE_SIZE;
        const json = await fetchImpl(iso, skip);
        const pageRecords = extractData(json);
        result.pagesFetched++;
        records.push(...pageRecords);
        // A short page is the last page.
        if (pageRecords.length < PAGE_SIZE) break;
        if (page < MAX_PAGES_PER_COUNTRY - 1) await sleep(SLEEP_BETWEEN_PAGES_MS);
      }
      result.recordsFetched = records.length;

      const normalised: PeeringDbNormalisedFacility[] = [];
      for (const rec of records) {
        const r = normalisePeeringDbFac(rec, country, iso);
        if (r.ok) {
          normalised.push(r.facility);
        } else if (r.reason === "no-name") {
          result.skippedNoName++;
        } else if (r.reason === "no-coords") {
          result.skippedNoCoords++;
        } else if (r.reason === "country-mismatch") {
          result.skippedCountryMismatch++;
        } else {
          result.skippedInvalid++;
        }
      }

      let unique = dedupePeeringDbBySourceUrl(normalised);
      if (opts.perCountryLimit != null && opts.perCountryLimit >= 0) {
        unique = unique.slice(0, opts.perCountryLimit);
      }
      result.candidates = unique.length;
      result.proximityWarnings = findPeeringDbProximityWarnings(unique);

      // Dedupe against the DB by sourceUrl (idempotency marker).
      let toInsert = unique;
      if (unique.length > 0) {
        const urls = unique.map((u) => u.sourceUrl);
        const existing = await db
          .select({ sourceUrl: dataCentreFacilitiesTable.sourceUrl })
          .from(dataCentreFacilitiesTable)
          .where(inArray(dataCentreFacilitiesTable.sourceUrl, urls));
        const have = new Set(
          existing.map((e) => e.sourceUrl).filter((u): u is string => !!u),
        );
        toInsert = unique.filter((u) => !have.has(u.sourceUrl));
      }
      result.duplicateInDb = unique.length - toInsert.length;
      result.newToInsert = toInsert.length;
      result.preview = toInsert;

      if (commit && toInsert.length > 0) {
        const values: InsertDataCentreFacility[] = toInsert.map((f) => ({
          name: f.name,
          operator: f.operator ?? undefined,
          country: f.country,
          region: f.region ?? undefined,
          city: f.city ?? undefined,
          latitude: f.latitude,
          longitude: f.longitude,
          status: STATUS_NOT_REPORTED,
          planningRisk: RISK_NOT_REPORTED,
          notes: f.notes ?? undefined,
          sourceUrl: f.sourceUrl,
          createdBy: CREATED_BY,
        }));
        // Chunk to keep insert statements bounded.
        const CHUNK = 200;
        for (let i = 0; i < values.length; i += CHUNK) {
          const slice = values.slice(i, i + CHUNK);
          const inserted = await db
            .insert(dataCentreFacilitiesTable)
            .values(slice)
            .returning({ id: dataCentreFacilitiesTable.id });
          result.inserted += inserted.length;
        }
      }

      log(
        `  ${iso} ${country}: fetched ${result.recordsFetched} over ${result.pagesFetched} page(s), ` +
          `kept ${result.candidates} (skipped ${result.skippedNoName} unnamed / ${result.skippedNoCoords} no-coords / ${result.skippedCountryMismatch} country-mismatch / ${result.skippedInvalid} invalid), ` +
          `${result.duplicateInDb} already stored, ${result.newToInsert} new` +
          (commit ? `, inserted ${result.inserted}` : ""),
      );
      for (const w of result.proximityWarnings) log(`    WARN ${iso}: ${w}`);
    } catch (err) {
      result.fetchOk = false;
      result.error = err instanceof Error ? err.message : String(err);
      log(`  ${iso} ${country}: FETCH ERROR: ${result.error}`);
    }

    results.push(result);

    // Fair-use pause between country queries (skip after the last).
    if (idx < targets.length - 1) await sleep(SLEEP_BETWEEN_COUNTRIES_MS);
  }

  const summary: PeeringDbImportSummary = {
    mode: commit ? "commit" : "dry-run",
    countries: results,
    totalCandidates: results.reduce((a, r) => a + r.candidates, 0),
    totalNew: results.reduce((a, r) => a + r.newToInsert, 0),
    totalInserted: results.reduce((a, r) => a + r.inserted, 0),
    logLines,
  };
  log(
    `TOTAL: ${summary.totalCandidates} facilities, ${summary.totalNew} new` +
      (commit
        ? `, ${summary.totalInserted} inserted`
        : " (dry-run — nothing written)"),
  );
  return summary;
}
