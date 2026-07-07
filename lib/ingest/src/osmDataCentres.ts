import {
  db,
  dataCentreFacilitiesTable,
  type InsertDataCentreFacility,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// OpenStreetMap → Data Centre facility REGISTRY importer.
//
// Populates the analyst-maintained `data_centre_facilities` table from public
// OpenStreetMap data (Overpass API — free, no key, egress-only). It mirrors the
// standalone-source pattern of the ICC-piracy module: browser-UA fetch with
// retries/backoff, every byte of the response treated as UNTRUSTED input, a
// dry-run/commit switch, and it NEVER closes the shared DB pool (only the CLI
// wrapper does).
//
// STRICT no-fabrication rules (owner-mandated):
//   - Only import a facility that has BOTH a real name tag (name:en || name) AND
//     mapped coordinates. Unnamed / coordless elements are SKIPPED, never
//     back-filled with an operator string or a guessed point.
//   - operator / capacity / status / planning-risk are NEVER guessed. status and
//     planningRisk are stamped the constrained-vocabulary sentinel "Unknown"
//     (which reads "not reported" on the surfaces); capacity/dates stay null.
//   - The canonical OSM element URL is stored on `sourceUrl` for provenance
//     (OSM is ODbL — the stored URL satisfies attribution) AND doubles as the
//     idempotency marker (see below).
//
// CRITICAL ISOLATION: this writes ONLY `data_centre_facilities`. A registry
// facility is NEVER an incident — this importer must never touch the `incidents`
// table, never set `linkedIncidentId`, and must NOT be confused with
// `runDataCentresIngest` (topicConfigs), which is a completely separate pass
// that writes NEWS INCIDENTS under topic=data_centres. DO NOT wire this importer
// into the api-server ingest scheduler: it is a supervised, owner-run CLI
// (dry-run → review → commit, country by country) like import-tapa-explorer.
//
// IDEMPOTENCY: dedupe is by the canonical `sourceUrl`
// (https://www.openstreetmap.org/<type>/<id>) — INSERT-only, never update or
// delete. Re-runs skip refs already present, so they insert 0 new rows. Two
// documented consequences of the marker being sourceUrl (both acceptable because
// every commit is preceded by an owner-reviewed dry-run):
//   - if an analyst EDITS sourceUrl on an imported row, the next run re-inserts
//     that facility (the marker no longer matches);
//   - if an analyst DELETES an imported row, a re-run resurrects it (INSERT-only,
//     no tombstone).

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_API_BASE?.trim() ||
  "https://overpass-api.de/api/interpreter";

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 120000;
const BASE_BACKOFF_MS = 3000;
// overpass-api.de fair-use: pause between per-country queries so a full Asia run
// does not hammer a shared free endpoint.
const SLEEP_BETWEEN_COUNTRIES_MS = 6000;
// Server-side query budget (seconds). India is the heaviest area.
const OVERPASS_QUERY_TIMEOUT_S = 120;
// Clamp untrusted free-text pulled into `notes`.
const NOTES_MAX = 500;
// Two same-named facilities closer than this are flagged as a possible
// node/way double-map for the owner to eyeball (NOT auto-merged).
const PROXIMITY_WARN_METRES = 250;

// Overpass fair-use etiquette asks for a DESCRIPTIVE User-Agent identifying the
// client (NOT a spoofed browser). overpass-api.de's WAF actively 406s both a
// browser-looking UA and a missing UA, so a descriptive UA is REQUIRED, not just
// polite. Likewise the request must not pin `Accept: application/json` (that
// combination is also 406'd) — a permissive `*/*` is accepted.
const OVERPASS_UA =
  "PolestarWorkbench/1.0 (geopolitical-risk data-centre registry importer)";

const CREATED_BY = "OpenStreetMap import";
const STATUS_NOT_REPORTED = "Unknown";
const RISK_NOT_REPORTED = "Unknown";

// Asian scope, in the owner's stated import order. `country` is the workbench
// canonical name (matches topicConfigs.ts canonicals); `iso` is the ISO 3166-1
// alpha-2 used in the Overpass area filter. Do NOT pin admin_level in the area
// filter — ISO3166-1 alone is unique for every entry here (incl. HK at
// admin_level 3 and TW at admin_level 2).
export const OSM_DC_COUNTRIES: ReadonlyArray<{ country: string; iso: string }> =
  [
    { country: "Singapore", iso: "SG" },
    { country: "Malaysia", iso: "MY" },
    { country: "Indonesia", iso: "ID" },
    { country: "Thailand", iso: "TH" },
    { country: "Philippines", iso: "PH" },
    { country: "Vietnam", iso: "VN" },
    { country: "Hong Kong", iso: "HK" },
    { country: "Taiwan", iso: "TW" },
    { country: "Japan", iso: "JP" },
    { country: "South Korea", iso: "KR" },
    { country: "India", iso: "IN" },
    { country: "Australia", iso: "AU" },
    { country: "New Zealand", iso: "NZ" },
  ];

export type NormalisedFacility = {
  osmType: string;
  osmId: number;
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

export type NormaliseResult =
  | { ok: true; facility: NormalisedFacility }
  | { ok: false; reason: "no-name" | "no-coords" | "invalid" };

export type OsmCountryResult = {
  country: string;
  iso: string;
  fetchOk: boolean;
  elementsFetched: number;
  skippedNoName: number;
  skippedNoCoords: number;
  skippedInvalid: number;
  candidates: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  proximityWarnings: string[];
  error: string | null;
  /** New-to-insert facilities, for the dry-run preview table. */
  preview: NormalisedFacility[];
};

export type OsmImportSummary = {
  mode: "commit" | "dry-run";
  countries: OsmCountryResult[];
  totalCandidates: number;
  totalNew: number;
  totalInserted: number;
  logLines: string[];
};

export type OsmImportOptions = {
  commit?: boolean;
  /** ISO codes or canonical names to scope to; default = all of OSM_DC_COUNTRIES. */
  countries?: string[];
  /** Optional cap on candidates per country (testing / sampling). */
  perCountryLimit?: number;
  /**
   * Test seam: bypass the network by returning parsed Overpass JSON for a query.
   * Production leaves this undefined and the real Overpass fetch is used.
   */
  fetchOverpass?: (query: string, iso: string) => Promise<unknown>;
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

/** Canonical OpenStreetMap element URL — provenance AND idempotency marker. */
export function osmElementUrl(type: string, id: number): string {
  return `https://www.openstreetmap.org/${type}/${id}`;
}

/**
 * Build the Overpass QL query for one country's data centres. Unions the
 * approved `telecom=data_center` tag with the two occasionally-seen variants
 * (`man_made` / `building`) so real mapped facilities are not missed, scoped to
 * the country's ISO3166-1 area. `out center` yields tags plus a single point
 * (the geometry centre for ways/relations, the node itself for nodes).
 */
export function buildOverpassQuery(iso: string): string {
  const safeIso = iso.replace(/[^A-Za-z-]/g, "").toUpperCase();
  return [
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];`,
    `area["ISO3166-1"="${safeIso}"]->.a;`,
    `(`,
    `  nwr["telecom"="data_center"](area.a);`,
    `  nwr["man_made"="data_center"](area.a);`,
    `  nwr["building"="data_center"](area.a);`,
    `);`,
    `out center;`,
  ].join("\n");
}

/**
 * Coerce one Overpass element into our trusted facility shape. Returns a
 * discriminated result so the caller can count WHY an element was skipped.
 *
 * No-fabrication gates:
 *   - name must be an explicit name:en || name tag (else "no-name" skip — we do
 *     NOT promote operator/brand into the name column);
 *   - coordinates must be present and in-range (else "no-coords" skip).
 */
export function normaliseOsmElement(
  raw: unknown,
  country: string,
): NormaliseResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid" };
  const el = raw as Record<string, unknown>;

  const type = asString(el.type).trim().toLowerCase();
  const id = finiteOrNull(el.id);
  if (!type || id == null || !Number.isInteger(id)) {
    return { ok: false, reason: "invalid" };
  }

  const tags =
    el.tags && typeof el.tags === "object"
      ? (el.tags as Record<string, unknown>)
      : {};

  // Name — strict: explicit English name, else the local name tag. No operator
  // fallback (that would assert a name the source does not report).
  const name = trimOrNull(tags["name:en"]) ?? trimOrNull(tags["name"]);
  if (!name) return { ok: false, reason: "no-name" };

  // Coordinates — nodes carry lat/lon directly; ways/relations expose a
  // `center` from `out center`. (0,0) is the plugin null-island → treated as
  // missing.
  let lat = finiteOrNull(el.lat);
  let lon = finiteOrNull(el.lon);
  if (lat == null || lon == null) {
    const center =
      el.center && typeof el.center === "object"
        ? (el.center as Record<string, unknown>)
        : null;
    if (center) {
      lat = finiteOrNull(center.lat);
      lon = finiteOrNull(center.lon);
    }
  }
  if (
    lat == null ||
    lon == null ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return { ok: false, reason: "no-coords" };
  }

  // Everything below is optional context taken ONLY from explicit tags; absent
  // tags stay null and read "not reported".
  const operator = trimOrNull(tags["operator"]);
  const region = trimOrNull(tags["addr:state"]) ?? trimOrNull(tags["addr:province"]);
  const city = trimOrNull(tags["addr:city"]) ?? trimOrNull(tags["addr:town"]);
  const notes = trimOrNull(tags["description"], NOTES_MAX);

  return {
    ok: true,
    facility: {
      osmType: type,
      osmId: id,
      name,
      operator,
      country,
      region,
      city,
      latitude: lat,
      longitude: lon,
      notes,
      sourceUrl: osmElementUrl(type, id),
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
 * Flag same-named facilities mapped close together — a likely node/way
 * double-map. We do NOT auto-merge (that could silently drop a genuine second
 * facility); the owner decides from the dry-run.
 */
export function findProximityWarnings(
  facilities: NormalisedFacility[],
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
          `possible duplicate map of "${a.name}" — ${a.osmType}/${a.osmId} & ${b.osmType}/${b.osmId} (${Math.round(metres)} m apart); both will be imported unless you remove one in OSM`,
        );
      }
    }
  }
  return warnings;
}

/** Dedupe a batch by canonical sourceUrl (first occurrence wins). */
export function dedupeBySourceUrl(
  facilities: NormalisedFacility[],
): NormalisedFacility[] {
  const seen = new Set<string>();
  const out: NormalisedFacility[] = [];
  for (const f of facilities) {
    if (seen.has(f.sourceUrl)) continue;
    seen.add(f.sourceUrl);
    out.push(f);
  }
  return out;
}

async function fetchOverpassLive(query: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: {
            "User-Agent": OVERPASS_UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "*/*",
          },
          body: "data=" + encodeURIComponent(query),
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
        // 429 (rate limited) and 504 (gateway/timeout) are the standard Overpass
        // fair-use pushbacks; retry those and 5xx.
        const transient =
          res.status === 429 || res.status === 504 || res.status >= 500;
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

function extractElements(json: unknown): unknown[] {
  if (json && typeof json === "object" && Array.isArray((json as { elements?: unknown[] }).elements)) {
    return (json as { elements: unknown[] }).elements;
  }
  return [];
}

function resolveCountries(filter?: string[]): { country: string; iso: string }[] {
  if (!filter || filter.length === 0) return [...OSM_DC_COUNTRIES];
  const wanted = new Set(filter.map((f) => f.trim().toLowerCase()).filter(Boolean));
  return OSM_DC_COUNTRIES.filter(
    (c) => wanted.has(c.iso.toLowerCase()) || wanted.has(c.country.toLowerCase()),
  );
}

/**
 * Run the OpenStreetMap → Data Centre facility registry import. For each scoped
 * country it queries Overpass, normalises + de-duplicates the mapped
 * data-centre elements, skips any already stored (by sourceUrl), and — in
 * commit mode — inserts the new ones into `data_centre_facilities`. Never
 * throws (per-country failures are captured in the summary) and NEVER closes the
 * shared DB pool.
 */
export async function runOsmFacilityRegistryImport(
  opts: OsmImportOptions = {},
): Promise<OsmImportSummary> {
  const commit = opts.commit ?? false;
  const targets = resolveCountries(opts.countries);
  const fetchImpl = opts.fetchOverpass ?? ((q: string) => fetchOverpassLive(q));
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(
    `OSM data-centre registry import — mode=${commit ? "COMMIT" : "DRY-RUN"}, countries=${targets.map((t) => t.iso).join(",") || "(none)"}`,
  );

  const results: OsmCountryResult[] = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const { country, iso } = targets[idx]!;
    const result: OsmCountryResult = {
      country,
      iso,
      fetchOk: true,
      elementsFetched: 0,
      skippedNoName: 0,
      skippedNoCoords: 0,
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
      const query = buildOverpassQuery(iso);
      const json = await fetchImpl(query, iso);
      const elements = extractElements(json);
      result.elementsFetched = elements.length;

      const normalised: NormalisedFacility[] = [];
      for (const el of elements) {
        const r = normaliseOsmElement(el, country);
        if (r.ok) {
          normalised.push(r.facility);
        } else if (r.reason === "no-name") {
          result.skippedNoName++;
        } else if (r.reason === "no-coords") {
          result.skippedNoCoords++;
        } else {
          result.skippedInvalid++;
        }
      }

      let unique = dedupeBySourceUrl(normalised);
      if (opts.perCountryLimit != null && opts.perCountryLimit >= 0) {
        unique = unique.slice(0, opts.perCountryLimit);
      }
      result.candidates = unique.length;
      result.proximityWarnings = findProximityWarnings(unique);

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
        `  ${iso} ${country}: fetched ${result.elementsFetched}, ` +
          `kept ${result.candidates} (skipped ${result.skippedNoName} unnamed / ${result.skippedNoCoords} no-coords / ${result.skippedInvalid} invalid), ` +
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

  const summary: OsmImportSummary = {
    mode: commit ? "commit" : "dry-run",
    countries: results,
    totalCandidates: results.reduce((a, r) => a + r.candidates, 0),
    totalNew: results.reduce((a, r) => a + r.newToInsert, 0),
    totalInserted: results.reduce((a, r) => a + r.inserted, 0),
    logLines,
  };
  log(
    `TOTAL: ${summary.totalCandidates} mapped facilities, ${summary.totalNew} new` +
      (commit ? `, ${summary.totalInserted} inserted` : " (dry-run — nothing written)"),
  );
  return summary;
}
