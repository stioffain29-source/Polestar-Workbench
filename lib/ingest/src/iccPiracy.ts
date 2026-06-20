import { createHash } from "node:crypto";
import {
  db,
  maritimeSecurityEventsTable,
  type InsertMaritimeSecurityEvent,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";

// ICC CCS / IMB Piracy Reporting Centre — maritime piracy & armed-robbery ingest.
//
// The ICC International Maritime Bureau (IMB) publishes the year's reported
// piracy and armed-robbery-at-sea events on its public live piracy map. The map
// is backed by a WordPress "WP Google Maps" plugin REST endpoint that returns
// every plotted marker as JSON — no API key, no login. We mirror the
// CURRENT-CALENDAR-YEAR markers into our OWN `maritime_security_events` table.
//
// CRITICAL PRODUCT RULE: these rows are NOT incidents. They live in their own
// table precisely so they can NEVER inflate any incident / crime / protest /
// conflict count. No incident-counting surface reads this table. Maritime
// security enriches the Shipping Watch assessment; it does not drive any count.
//
// Every byte of the upstream response is treated as UNTRUSTED input and each
// field is shape-validated before use. Like every ingest module, this NEVER
// closes the shared DB pool — only the CLI wrapper does.
//
// The IMB site sits behind Cloudflare and frequently 403s / blocks datacenter
// egress IPs (same class as the Liveuamap block). A blocked fetch is recorded as
// a non-alarming "pending" Source-Health state (awaiting production network
// validation), NOT a hard failure, until the feed returns data at least once.

const MARKERS_ENDPOINT = "https://icc-ccs.org/wp-json/wpgmza/v1/markers";
const SOURCE_PAGE = "https://icc-ccs.org/map/";

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 25000;
const BASE_BACKOFF_MS = 2500;

// A realistic desktop-browser User-Agent — the IMB site (Cloudflare) rejects
// library-default agents.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Constant adapter source key (part of the dedup key).
const SOURCE_NAME = "icc_imb";
// Source Health registration — its own topic so it never mingles with the
// news-scraped Shipping feeds or affects their counts.
const HEALTH_TOPIC = "maritime_security";
const HEALTH_SOURCE_NAME = "ICC CCS / IMB Piracy Reporting Centre";
const HEALTH_NOTES =
  "ICC International Maritime Bureau (IMB) Piracy Reporting Centre — current-year reported piracy & armed-robbery-at-sea events, mirrored as a STANDALONE maritime-security source (never as incidents). Public live piracy map; no key.";

// WP Google Maps category id → IMB classification. Stable on the source.
const CATEGORY_BY_ID: Record<string, string> = {
  "1": "Attempted Boarding",
  "2": "Boarded",
  "3": "Fired Upon",
  "4": "Hijacking",
  "5": "Suspicious Vessel",
};

// Severity precedence when a marker carries more than one category — the most
// serious wins the display classification.
const CATEGORY_PRECEDENCE = [
  "Hijacking",
  "Fired Upon",
  "Boarded",
  "Attempted Boarding",
  "Suspicious Vessel",
];

const UNKNOWN_TYPE = "Unknown Maritime Security Incident";

export type IccPiracySummary = {
  source: "icc_imb";
  mode: "commit" | "dry-run";
  /** Current calendar year the ingest is scoped to. */
  year: number;
  /** Markers returned by the upstream (raw). */
  markersFetched: number;
  /** Markers dropped during validation (malformed / unparseable). */
  rejected: number;
  /** Markers kept after the current-year filter. */
  currentYear: number;
  /** Validated current-year events already present (skipped). */
  duplicateInDb: number;
  /** Validated current-year events new to the table. */
  newToInsert: number;
  /** Rows actually written (commit mode). */
  inserted: number;
  /** Total icc_imb rows after the run. */
  totalAfter: number;
  /** Newest stored event date after the run (ISO), or null. */
  latestEventDate: string | null;
  /** Distinct countries represented in this run's kept events. */
  countriesCovered: string[];
  /** Breakdown of kept events by classification. */
  byType: Record<string, number>;
  /** False when every upstream fetch attempt failed. */
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

type NormalisedEvent = {
  eventKey: string;
  incidentNumber: string | null;
  incidentType: string;
  categoryRaw: string | null;
  title: string;
  narrative: string | null;
  rawSitrep: string | null;
  locationName: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  rawPositionText: string | null;
  coordinateQuality: string;
  incidentDate: Date | null;
  year: number | null;
  contentHash: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(asString(value));
  return Number.isFinite(n) ? n : null;
}

// --- IMB sitrep parsing ------------------------------------------------------

// Parse one "DD:MM.decimal[NS/EW]" IMB coordinate token to signed decimal deg.
function parsePosToken(token: string, axis: "lat" | "lon"): number | null {
  const m = token
    .trim()
    .match(/(\d{1,3})[:°\s]+(\d{1,2}(?:\.\d+)?)\s*([NSEW])/i);
  if (!m) return null;
  const deg = Number(m[1]);
  const min = Number(m[2]);
  const hemi = m[3]!.toUpperCase();
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  let dec = deg + min / 60;
  if (hemi === "S" || hemi === "W") dec = -dec;
  // Sanity-bound to the correct axis range.
  if (axis === "lat" && Math.abs(dec) > 90) return null;
  if (axis === "lon" && Math.abs(dec) > 180) return null;
  return dec;
}

// Parse the IMB raw position string "13:45.72N – 120:59.59E" into decimals.
function parseImbPosition(
  raw: string,
): { lat: number; lon: number } | null {
  // Split on the en-dash / hyphen separating the two coordinate halves.
  const parts = raw.split(/\s*[–—-]\s*/);
  if (parts.length < 2) return null;
  const lat = parsePosToken(parts[0]!, "lat");
  const lon = parsePosToken(parts[1]!, "lon");
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

function classifyFromNarrative(text: string): string {
  const t = text.toLowerCase();
  if (/\bhijack/.test(t)) return "Hijacking";
  if (/\bfired upon\b|\bopened fire\b|\bgunfire\b|\bshots? fired\b|\bfired at\b/.test(t))
    return "Fired Upon";
  if (
    /\b(robbers?|stole|theft|stolen|ship'?s? stores|engine spares|armed)\b/.test(t) &&
    /\bboard/.test(t)
  )
    return "Armed Robbery";
  if (/\bboarded\b/.test(t)) return "Boarded";
  if (/\battempt/.test(t)) return "Attempted Boarding";
  if (/\bsuspicious\b/.test(t)) return "Suspicious Vessel";
  return UNKNOWN_TYPE;
}

function classifyType(categories: string[], narrative: string): {
  type: string;
  raw: string | null;
} {
  const names = categories
    .map((c) => CATEGORY_BY_ID[c.trim()])
    .filter((n): n is string => !!n);
  if (names.length > 0) {
    for (const want of CATEGORY_PRECEDENCE) {
      if (names.includes(want)) return { type: want, raw: names.join(", ") };
    }
    return { type: names[0]!, raw: names.join(", ") };
  }
  return { type: classifyFromNarrative(narrative), raw: null };
}

// Pull the field values out of the custom_field_data blob. The WP Google Maps
// plugin serves it as an ARRAY of { id, name, value } objects (e.g.
// [{id:9,name:"Incident Number",value:"001-26"}, {id:66,name:"Sitrep:",value:"…"}]).
// Some installs instead key the object by field id with a plain string value, so
// handle both shapes. Returns the list of { name, value } pairs.
function customFieldPairs(
  customFieldData: unknown,
): { name: string; value: string }[] {
  if (!customFieldData) return [];
  const pairs: { name: string; value: string }[] = [];
  const pushEntry = (name: unknown, value: unknown) => {
    const v = asString(value).trim();
    if (v) pairs.push({ name: asString(name).trim(), value: v });
  };
  if (Array.isArray(customFieldData)) {
    for (const entry of customFieldData) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        pushEntry(e.name, e.value);
      } else {
        pushEntry("", entry);
      }
    }
  } else if (typeof customFieldData === "object") {
    for (const [k, v] of Object.entries(
      customFieldData as Record<string, unknown>,
    )) {
      if (v && typeof v === "object") {
        const e = v as Record<string, unknown>;
        pushEntry(e.name ?? k, e.value ?? v);
      } else {
        pushEntry(k, v);
      }
    }
  }
  return pairs;
}

// Pull the "Sitrep:" narrative out of the custom_field_data blob.
function extractSitrep(customFieldData: unknown): string | null {
  const pairs = customFieldPairs(customFieldData);
  if (pairs.length === 0) return null;
  // Prefer the field explicitly named "Sitrep".
  const named = pairs.find((p) => /sitrep/i.test(p.name));
  // Otherwise fall back to the longest descriptive value.
  let best: string | null = null;
  const candidates = named ? [named] : pairs;
  for (const p of candidates) {
    const cleaned = p.value.replace(/^sitrep\s*:?\s*/i, "").trim();
    if (!cleaned) continue;
    if (!best || cleaned.length > best.length) best = cleaned;
  }
  return best;
}

// Pull the "Incident Number" field (e.g. "001-26") from custom_field_data.
function extractIncidentNumber(customFieldData: unknown): string | null {
  const pairs = customFieldPairs(customFieldData);
  const named = pairs.find((p) => /incident\s*number/i.test(p.name));
  const v = named?.value.trim();
  return v || null;
}

// Parse the structured head of a sitrep:
//   "DD.MM.YYYY: HHMM UTC: Posn: <pos>, <location...>, <country>. <description>"
function parseSitrep(sitrep: string): {
  incidentDate: Date | null;
  rawPositionText: string | null;
  locationName: string | null;
  country: string | null;
  narrative: string | null;
} {
  let incidentDate: Date | null = null;
  const dateMatch = sitrep.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    const [, dd, mm, yyyy] = dateMatch;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    if (!Number.isNaN(d.getTime())) incidentDate = d;
  }

  let rawPositionText: string | null = null;
  let locationName: string | null = null;
  let country: string | null = null;
  let narrative: string | null = null;

  const posnIdx = sitrep.search(/Posn\s*:/i);
  if (posnIdx >= 0) {
    const afterPosn = sitrep.slice(posnIdx).replace(/^Posn\s*:\s*/i, "");
    // The location clause runs up to the first sentence break (". " — period
    // followed by whitespace). Decimal minutes like "45.72N" are period+digit,
    // so they never trigger the split.
    const breakMatch = afterPosn.match(/\.\s/);
    const head = breakMatch
      ? afterPosn.slice(0, breakMatch.index)
      : afterPosn;
    const rest = breakMatch
      ? afterPosn.slice((breakMatch.index ?? 0) + 1).trim()
      : "";
    const segments = head
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length > 0) rawPositionText = segments[0]!;
    if (segments.length >= 2) country = segments[segments.length - 1]!;
    if (segments.length >= 3)
      locationName = segments.slice(1, segments.length - 1).join(", ");
    else if (segments.length === 2) locationName = null;
    narrative = rest || null;
  } else {
    // No position clause — keep the whole sitrep (minus the date head) as the
    // narrative so nothing is lost.
    narrative = sitrep
      .replace(/^\s*\d{2}\.\d{2}\.\d{4}\s*:?\s*/, "")
      .replace(/^\s*\d{3,4}\s*(UTC|LT|hrs)?\s*:?\s*/i, "")
      .trim()
      || null;
  }

  // Defensive clamps on parsed free-text fields.
  if (country) {
    country = country.replace(/[.\s]+$/, "").slice(0, 120) || null;
  }
  if (locationName) locationName = locationName.slice(0, 200) || null;
  if (rawPositionText) rawPositionText = rawPositionText.slice(0, 120) || null;
  if (narrative) narrative = narrative.slice(0, 4000) || null;

  return { incidentDate, rawPositionText, locationName, country, narrative };
}

function contentHashOf(parts: Array<string | null | undefined>): string {
  return createHash("sha1")
    .update(parts.map((p) => (p ?? "").trim().toLowerCase()).join("|"))
    .digest("hex");
}

/** Coerce one upstream marker into our trusted shape; null drops the row. */
function normaliseMarker(raw: unknown, currentYear: number): NormalisedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  // Incident number lives in the title (e.g. "001-26"); fall back to the
  // "Incident Number" custom field when the title is blank.
  const titleRaw = asString(m.title).trim();
  const incidentNumber =
    titleRaw || extractIncidentNumber(m.custom_field_data) || null;

  // Categories may arrive as an array, a comma-joined string, or nested ids.
  const categories: string[] = [];
  const catSrc = m.categories;
  if (Array.isArray(catSrc)) {
    for (const c of catSrc) categories.push(asString(c).trim());
  } else if (typeof catSrc === "string") {
    for (const c of catSrc.split(",")) categories.push(c.trim());
  }

  const sitrep = extractSitrep(m.custom_field_data);
  const parsed = sitrep
    ? parseSitrep(sitrep)
    : {
        incidentDate: null,
        rawPositionText: null,
        locationName: null,
        country: null,
        narrative: null,
      };

  // Year resolution: prefer the parsed sitrep date, fall back to the "-YY"
  // suffix of the incident number ("001-26" → 2026).
  let year: number | null = parsed.incidentDate
    ? parsed.incidentDate.getUTCFullYear()
    : null;
  if (year == null && incidentNumber) {
    const ym = incidentNumber.match(/-(\d{2})$/);
    if (ym) year = 2000 + Number(ym[1]);
  }
  // Current-year-only: drop anything we can date to a different year. Markers we
  // cannot date at all are dropped (no historical backfill, no guessing).
  if (year == null || year !== currentYear) return null;

  const { type, raw: categoryRaw } = classifyType(
    categories,
    parsed.narrative ?? sitrep ?? "",
  );

  // Coordinates: prefer the marker's own decimal lat/lng, else parse the IMB
  // position string. (0,0) is treated as missing (the plugin's null island).
  let latitude = finiteOrNull(m.lat);
  let longitude = finiteOrNull(m.lng);
  let coordinateQuality = "missing";
  if (
    latitude != null &&
    longitude != null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  ) {
    coordinateQuality = "exact_reported";
  } else {
    latitude = null;
    longitude = null;
    if (parsed.rawPositionText) {
      const pos = parseImbPosition(parsed.rawPositionText);
      if (pos) {
        latitude = pos.lat;
        longitude = pos.lon;
        coordinateQuality = "exact_reported";
      }
    }
  }

  const contentHash = contentHashOf([
    incidentNumber,
    parsed.incidentDate ? parsed.incidentDate.toISOString().slice(0, 10) : "",
    parsed.country,
    parsed.locationName,
    (parsed.narrative ?? sitrep ?? "").slice(0, 200),
  ]);

  const eventKey = incidentNumber ? incidentNumber : `hash:${contentHash}`;
  const title = incidentNumber || `${type} — ${parsed.country ?? "Unknown waters"}`;

  return {
    eventKey,
    incidentNumber,
    incidentType: type,
    categoryRaw,
    title: title.slice(0, 200),
    narrative: parsed.narrative,
    rawSitrep: sitrep ? sitrep.slice(0, 6000) : null,
    locationName: parsed.locationName,
    country: parsed.country,
    latitude,
    longitude,
    rawPositionText: parsed.rawPositionText,
    coordinateQuality,
    incidentDate: parsed.incidentDate,
    year,
    contentHash,
  };
}

async function fetchMarkers(): Promise<{ markers: unknown[]; raw: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(MARKERS_ENDPOINT, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: ctrl.signal,
          redirect: "follow",
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
        const transient = res.status === 429 || res.status >= 500;
        let detail: string;
        if (res.status === 403 || res.status === 406) {
          detail = `status ${res.status} — blocked by ICC/Cloudflare bot protection (datacenter egress IP); expected from this network, retries on the next cycle`;
        } else {
          detail = `status ${res.status}`;
        }
        throw { transient, message: detail };
      }
      const json: unknown = await res.json();
      // The plugin returns either a bare array or an object with a markers array.
      let arr: unknown[] = [];
      if (Array.isArray(json)) {
        arr = json;
      } else if (json && typeof json === "object") {
        const o = json as Record<string, unknown>;
        if (Array.isArray(o.markers)) arr = o.markers;
        else if (Array.isArray(o.data)) arr = o.data;
      }
      return { markers: arr, raw: arr.length };
    } catch (err) {
      lastErr = err;
      const transient = !!(
        err &&
        typeof err === "object" &&
        (err as { transient?: boolean }).transient
      );
      if (transient && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
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

async function tableStats(): Promise<{
  total: number;
  latest: string | Date | null;
}> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      latest: sql<
        string | Date | null
      >`max(${maritimeSecurityEventsTable.incidentDate})`,
    })
    .from(maritimeSecurityEventsTable)
    .where(eq(maritimeSecurityEventsTable.sourceName, SOURCE_NAME));
  return { total: row?.n ?? 0, latest: row?.latest ?? null };
}

/**
 * Run the ICC CCS / IMB maritime-security ingest. Pulls the public live-piracy
 * map markers, keeps only the current calendar year, parses each IMB sitrep,
 * classifies the event, de-duplicates, and stores the new ones in the isolated
 * maritime_security_events table. Never throws — all failures are captured in
 * the returned summary so an upstream outage cannot break the wider ingest
 * cycle. Does NOT close the shared DB pool.
 */
export async function runIccPiracyIngest(
  opts: { commit?: boolean } = {},
): Promise<IccPiracySummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  const currentYear = new Date().getUTCFullYear();

  log(`ICC CCS / IMB piracy — mode=${commit ? "COMMIT" : "DRY-RUN"}, year=${currentYear}`);

  const base: IccPiracySummary = {
    source: "icc_imb",
    mode: commit ? "commit" : "dry-run",
    year: currentYear,
    markersFetched: 0,
    rejected: 0,
    currentYear: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestEventDate: null,
    countriesCovered: [],
    byType: {},
    fetchOk: true,
    errors,
    logLines,
  };

  try {
    let markers: unknown[] = [];
    let rawCount = 0;
    let fetchOk = true;
    try {
      const fetched = await fetchMarkers();
      markers = fetched.markers;
      rawCount = fetched.raw;
      log(`  fetched ${rawCount} marker(s) from ICC live-piracy map`);
    } catch (err) {
      fetchOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      log(`  FETCH ERROR: ${msg}`);
    }
    base.fetchOk = fetchOk;
    base.markersFetched = rawCount;

    // Normalise + current-year filter.
    const kept: NormalisedEvent[] = [];
    let rejected = 0;
    for (const m of markers) {
      const norm = normaliseMarker(m, currentYear);
      if (norm) kept.push(norm);
      else rejected++;
    }
    base.rejected = rejected;
    base.currentYear = kept.length;

    // Dedup within the batch by eventKey (first wins).
    const byKey = new Map<string, NormalisedEvent>();
    for (const e of kept) if (!byKey.has(e.eventKey)) byKey.set(e.eventKey, e);
    const unique = Array.from(byKey.values());

    base.countriesCovered = Array.from(
      new Set(unique.map((e) => e.country).filter((c): c is string => !!c)),
    ).sort();
    base.byType = unique.reduce<Record<string, number>>((acc, e) => {
      acc[e.incidentType] = (acc[e.incidentType] ?? 0) + 1;
      return acc;
    }, {});

    // Dedup against the DB by eventKey.
    let toInsert: NormalisedEvent[] = unique;
    if (unique.length > 0) {
      const keys = unique.map((e) => e.eventKey);
      const existing = await db
        .select({ eventKey: maritimeSecurityEventsTable.eventKey })
        .from(maritimeSecurityEventsTable)
        .where(
          inArray(maritimeSecurityEventsTable.eventKey, keys),
        );
      const have = new Set(existing.map((e) => e.eventKey));
      toInsert = unique.filter((e) => !have.has(e.eventKey));
    }
    base.duplicateInDb = unique.length - toInsert.length;
    base.newToInsert = toInsert.length;
    log(
      `  ${unique.length} current-year event(s); ${base.duplicateInDb} already stored; ${toInsert.length} new`,
    );

    if (commit) {
      if (toInsert.length > 0) {
        const values: InsertMaritimeSecurityEvent[] = toInsert.map((e) => ({
          sourceName: SOURCE_NAME,
          eventKey: e.eventKey,
          incidentNumber: e.incidentNumber,
          incidentType: e.incidentType,
          categoryRaw: e.categoryRaw,
          title: e.title,
          narrative: e.narrative,
          rawSitrep: e.rawSitrep,
          locationName: e.locationName,
          country: e.country,
          latitude: e.latitude,
          longitude: e.longitude,
          rawPositionText: e.rawPositionText,
          coordinateQuality: e.coordinateQuality,
          incidentDate: e.incidentDate,
          year: e.year,
          sourceUrl: SOURCE_PAGE,
          classification: "maritime_security",
          contentHash: e.contentHash,
        }));
        const inserted = await db
          .insert(maritimeSecurityEventsTable)
          .values(values)
          .onConflictDoNothing({
            target: [
              maritimeSecurityEventsTable.sourceName,
              maritimeSecurityEventsTable.eventKey,
            ],
          })
          .returning({ id: maritimeSecurityEventsTable.id });
        base.inserted = inserted.length;
      }

      // Health: a blocked/failed fetch with no prior success is "pending"
      // (awaiting production network validation), NOT a hard failure — it stays
      // out of the red Action Required panel and the dashboard failing count.
      // The first successful fetch flips it to operational automatically.
      const feedOk = fetchOk;
      await recordSourceHealth(
        HEALTH_TOPIC,
        [
          {
            name: HEALTH_SOURCE_NAME,
            url: SOURCE_PAGE,
            ok: feedOk,
            error: feedOk
              ? null
              : `Awaiting production network validation — ${errors[0] ?? "ICC live-piracy map unreachable from this network"}`,
          },
        ],
        { sourceType: "api", reliability: 5, notes: HEALTH_NOTES, pending: true },
      );
      log(`  committed: ${base.inserted} new event(s) stored`);
    } else {
      log(`  DRY-RUN — no rows written.`);
    }

    const stats = await tableStats();
    base.totalAfter = stats.total;
    base.latestEventDate = stats.latest ? new Date(stats.latest).toISOString() : null;
    return base;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    log(`  UNEXPECTED ERROR: ${msg}`);
    base.fetchOk = false;
    try {
      const stats = await tableStats();
      base.totalAfter = stats.total;
      base.latestEventDate = stats.latest ? new Date(stats.latest).toISOString() : null;
    } catch {
      // best effort
    }
    return base;
  }
}

/** Empty summary used when the piracy pass is skipped (e.g. lock contention). */
export function emptyIccPiracySummary(): IccPiracySummary {
  return {
    source: "icc_imb",
    mode: "dry-run",
    year: new Date().getUTCFullYear(),
    markersFetched: 0,
    rejected: 0,
    currentYear: 0,
    duplicateInDb: 0,
    newToInsert: 0,
    inserted: 0,
    totalAfter: 0,
    latestEventDate: null,
    countriesCovered: [],
    byType: {},
    fetchOk: true,
    errors: [],
    logLines: [],
  };
}
