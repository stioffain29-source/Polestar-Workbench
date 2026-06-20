import {
  db,
  maritimeMovementTable,
  maritimeVesselSightingTable,
  type InsertMaritimeMovement,
  type InsertMaritimeVesselSighting,
} from "@workspace/db";
import { and, desc, ilike, lte, gte, lt, eq, sql } from "drizzle-orm";
import {
  resolveVesselClasses,
  readVesselRegistryConfig,
  type VesselClass,
  type VesselLookup,
} from "./vesselRegistry";

// ===========================================================================
// Live vessel-MOVEMENT (AIS) context ingest.
//
// CRITICAL CONSTRAINT: movement is CONTEXT ONLY. This module writes ONLY to the
// isolated `maritime_movement` table. It NEVER touches the `incidents` table,
// never creates an incident, and can never inflate a confirmed-incident count.
// When unconfigured (no key) or switched off it no-ops cleanly and writes
// nothing — every downstream surface then degrades to "movement data
// unavailable".
//
// Provider: aisstream.io (a free AIS WebSocket stream). The provider is
// selected by AIS_PROVIDER (default "aisstream"); the credential is AIS_API_KEY
// and the kill-switch is AIS_ENABLED=false. The flow: open the WebSocket,
// subscribe to a bounding box per tracked chokepoint, sample live position +
// static reports for a short window, then aggregate UNIQUE vessels per theatre
// and write one snapshot row per theatre that had observed traffic.
//
// Honesty rules baked in:
//   * Only counts we can actually derive from AIS are filled. Total vessels and
//     AIS-visible count come from unique MMSIs seen; tankers come from the AIS
//     ship-type code. Bulk vs container vs LNG/LPG are NOT derivable from the
//     AIS type code, so they are filled ONLY when the optional external vessel
//     registry (lib/ingest/src/vesselRegistry.ts, keyed on IMO/MMSI) resolves a
//     definitive class; absent that registry, or for any vessel it cannot
//     resolve, they stay NULL ("not reported"), never a fabricated zero.
//     Inbound/outbound and anchored are likewise NULL when the short open-stream
//     sample cannot derive them.
//   * "AIS dark"/gap IS derived — but NOT from this single live sample (which
//     only shows vessels that ARE transmitting). It is STATEFUL: per-vessel
//     sightings are persisted across runs (maritime_vessel_sighting) so a
//     loitering vessel that later stops transmitting can be flagged. The count
//     is NULL when there was no prior baseline to measure (never fabricated).
//   * A theatre with neither live traffic NOR a measured dark signal gets NO row
//     (absence, not "0 traffic"); a dark-only theatre DOES get a row so an
//     all-gone-silent chokepoint is not swallowed by the absence rule.
//   * source_name contains "ais" so the AIS row on Source Health flips to live.
//
// Nothing here closes the shared DB pool — only the CLI wrapper does.
// ===========================================================================

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const SOURCE_NAME = "AIS (aisstream.io)";
const SOURCE_URL = "https://aisstream.io";

const DEFAULT_COLLECT_SECONDS = 60;
const MIN_COLLECT_SECONDS = 10;
const MAX_COLLECT_SECONDS = 180;

// A bounding box, [minLat, maxLat, minLon, maxLon]. Theatres are ordered
// SPECIFIC → BROAD: a vessel is assigned to the FIRST box that contains it, so
// a ship in the narrow Bab el-Mandeb strait is counted there, not swept up by
// the broad Red Sea box that overlaps it. The theatre names match
// BOARD_CHOKEPOINTS exactly so the workbench can map each snapshot to its card.
//
// `inboundBearing` is the compass course (0-360°) that represents the
// conventional "inbound" flow for the theatre — into the basin a transiting
// vessel is bound for (e.g. NW into the Persian Gulf at Hormuz). A vessel whose
// course-over-ground is within ±90° of this bearing is counted INBOUND, else
// OUTBOUND. A chokepoint is a through-route, so this is a directional-FLOW split
// (laden out / ballast in), not a port arrival/departure count; it is honest
// context, never an incident.
interface TheatreBox {
  theatre: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  inboundBearing: number;
}

export const AIS_THEATRES: TheatreBox[] = [
  { theatre: "Strait of Hormuz", minLat: 24.0, maxLat: 27.5, minLon: 54.0, maxLon: 58.5, inboundBearing: 315 },
  { theatre: "Bab el-Mandeb", minLat: 12.0, maxLat: 14.0, minLon: 42.5, maxLon: 44.5, inboundBearing: 0 },
  { theatre: "Gulf of Aden", minLat: 10.5, maxLat: 15.0, minLon: 44.5, maxLon: 51.5, inboundBearing: 270 },
  { theatre: "Singapore Strait", minLat: 1.0, maxLat: 1.5, minLon: 103.4, maxLon: 104.2, inboundBearing: 90 },
  { theatre: "Malacca Strait", minLat: 1.0, maxLat: 6.5, minLon: 98.0, maxLon: 103.4, inboundBearing: 135 },
  { theatre: "Red Sea", minLat: 14.0, maxLat: 28.0, minLon: 32.0, maxLon: 43.5, inboundBearing: 0 },
];

// Speed-over-ground thresholds (knots). At/under ANCHOR a vessel reads as
// stationary (anchored/waiting); at/over MOVING it is genuinely transiting and
// its course can be trusted for a direction split. The gap between the two is a
// drifting/manoeuvring band that is counted as neither (no fabricated bin).
const ANCHOR_SOG_KNOTS = 0.5;
const MOVING_SOG_KNOTS = 1.0;

// AIS NavigationalStatus codes that mean the vessel is not transiting.
const NAV_AT_ANCHOR = 1;
const NAV_MOORED = 5;

// AIS-dark / transmission-gap detection thresholds.
//
// "Going dark" is inherently STATEFUL: a single live sample only shows vessels
// that ARE transmitting, so the only way to spot one that has STOPPED is to
// remember where vessels were last seen and notice they vanished. We persist
// per-vessel sightings (maritime_vessel_sighting) and, on each run, flag prior
// CANDIDATES that have since gone silent.
//
//   * LOOKBACK — a prior sighting older than this is too stale to reason about
//     (the vessel has long since legitimately moved on); it is pruned and never
//     counted.
//   * MIN_GAP — a prior sighting must be at least this old for its absence to be
//     meaningful. Without it, two runs minutes apart would flag a vessel that
//     simply has not re-transmitted yet.
//
// CANDIDATE = a vessel last seen LOITERING (anchored/moored or near-stationary)
// inside the theatre. A loitering vessel that stops transmitting is the genuine
// dark signal (e.g. an STS transfer or sanctioned tanker); a fast transiting
// vessel that leaves the bounding box is normal traffic, NOT dark, so it is
// deliberately excluded to avoid a fabricated count.
const DARK_LOOKBACK_HOURS = 24;
const DARK_MIN_GAP_MINUTES = 30;
// At/under this speed (knots) a vessel is loitering rather than transiting, so
// its disappearance is a meaningful dark signal rather than a normal departure.
const LOITER_SOG_KNOTS = 1.0;

/** AIS course-over-ground is reported 0-359.9°; 360 is the "not available" sentinel. */
function validCog(c: number | null): number | null {
  return c !== null && c >= 0 && c < 360 ? c : null;
}

/** AIS speed-over-ground is in knots; 102.3 is the "not available" sentinel. */
function validSog(s: number | null): number | null {
  return s !== null && s >= 0 && s < 102 ? s : null;
}

/**
 * Classify a moving vessel's course as inbound/outbound relative to a theatre's
 * reference bearing. Returns null when the vessel is anchored/waiting or has no
 * usable course+speed (so it is counted in neither direction).
 */
function classifyDirection(
  inboundBearing: number,
  cog: number | null,
  sog: number | null,
  navStatus: number | null,
): "inbound" | "outbound" | null {
  if (navStatus === NAV_AT_ANCHOR || navStatus === NAV_MOORED) return null;
  if (sog === null || sog < MOVING_SOG_KNOTS) return null;
  if (cog === null) return null;
  // Smallest absolute angular gap between the course and the inbound bearing.
  const diff = Math.abs(((cog - inboundBearing + 540) % 360) - 180);
  return diff <= 90 ? "inbound" : "outbound";
}

/** A vessel reads as anchored/waiting from an explicit nav status or ~zero speed. */
function isAnchored(sog: number | null, navStatus: number | null): boolean {
  if (navStatus === NAV_AT_ANCHOR || navStatus === NAV_MOORED) return true;
  return sog !== null && sog < ANCHOR_SOG_KNOTS;
}

/**
 * A vessel reads as LOITERING (a dark-detection candidate) when it is anchored/
 * moored or moving at/under the loiter speed. Such a vessel is not transiting
 * out of the box, so if it later stops transmitting that is a genuine gap — not
 * a normal departure. Requires a known speed or an explicit anchored status, so
 * a vessel with no movement data is NOT treated as a candidate (it would be a
 * fabricated signal).
 */
export function isLoitering(sog: number | null, navStatus: number | null): boolean {
  if (navStatus === NAV_AT_ANCHOR || navStatus === NAV_MOORED) return true;
  return sog !== null && sog <= LOITER_SOG_KNOTS;
}

/**
 * True when a prior sighting falls inside the dark-detection band relative to
 * `now`: recent enough to still matter (≥ now − LOOKBACK) AND old enough that an
 * absence is meaningful (< now − MIN_GAP). A sighting outside this band is
 * either too stale to reason about (legitimately moved on) or too fresh (may
 * simply not have re-transmitted yet), so it is NOT a dark candidate. The SQL
 * pre-filter in `runMaritimeMovementIngest` mirrors this same band using the
 * same constants; this is the authoritative, unit-tested gate.
 */
export function isWithinDarkWindow(lastSeenAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - lastSeenAt.getTime();
  return (
    ageMs >= DARK_MIN_GAP_MINUTES * 60_000 &&
    ageMs <= DARK_LOOKBACK_HOURS * 3_600_000
  );
}

/** A prior-window vessel sighting considered for dark/gap detection. */
export interface PriorVesselSighting {
  mmsi: number;
  theatre: string;
  /** When the vessel was last observed transmitting inside the theatre. */
  lastSeenAt: Date;
  lastSog: number | null;
  lastNavStatus: number | null;
}

/**
 * Pure AIS-dark/gap computation. Given the vessel sightings from a prior window
 * (already filtered to the [lookback, min-gap] band by the caller) and the set
 * of MMSIs heard in the CURRENT live sample, return a per-theatre dark count.
 *
 * Honesty rules:
 *   * Only LOITERING vessels (anchored/moored or SOG ≤ threshold) are eligible —
 *     a vessel that was simply transiting and has moved on is not "dark".
 *   * A vessel is dark when it was a loitering candidate but is ABSENT from the
 *     current sample (stopped transmitting).
 *   * A theatre with NO candidates yields NULL ("not measurable"), never a
 *     fabricated 0; a theatre with candidates none of which went dark yields a
 *     genuine 0. The zero-current-vessels case (every candidate absent) yields
 *     the full candidate count.
 */
export function computeDarkByTheatre(
  priorRows: PriorVesselSighting[],
  currentMmsis: Set<number>,
  theatres: readonly string[] = AIS_THEATRES.map((t) => t.theatre),
  now: Date = new Date(),
): Map<string, number | null> {
  const candidates = new Map<string, number>();
  const dark = new Map<string, number>();
  for (const r of priorRows) {
    // Authoritative lookback/min-gap window gate (the SQL pre-filter mirrors it).
    if (!isWithinDarkWindow(r.lastSeenAt, now)) continue;
    if (!isLoitering(r.lastSog, r.lastNavStatus)) continue;
    candidates.set(r.theatre, (candidates.get(r.theatre) ?? 0) + 1);
    if (!currentMmsis.has(r.mmsi)) {
      dark.set(r.theatre, (dark.get(r.theatre) ?? 0) + 1);
    }
  }
  const out = new Map<string, number | null>();
  for (const t of theatres) {
    const c = candidates.get(t) ?? 0;
    out.set(t, c > 0 ? dark.get(t) ?? 0 : null);
  }
  return out;
}

export type MaritimeMovementSummary = {
  provider: string;
  mode: "commit" | "dry-run";
  /** A credential is present (the provider COULD run). */
  configured: boolean;
  /** Not switched off via AIS_ENABLED=false. */
  enabled: boolean;
  /** A real collection actually ran (vs a clean no-op). */
  ran: boolean;
  reason:
    | "ok"
    | "disabled"
    | "not_configured"
    | "unsupported_provider"
    | "fetch_failed";
  collectSeconds: number;
  messagesReceived: number;
  vesselsSeen: number;
  theatresWritten: number;
  rowsInserted: number;
  perTheatre: Array<{
    theatre: string;
    totalVessels: number;
    tankers: number;
    inbound: number | null;
    outbound: number | null;
    anchored: number | null;
    bulk: number | null;
    container: number | null;
    lngLpg: number | null;
    aisDarkOrGap: number | null;
    change: string | null;
  }>;
  /** External vessel-registry precision layer (bulk/container/LNG-LPG split). */
  registry: {
    configured: boolean;
    enabled: boolean;
    lookups: number;
    resolved: number;
  };
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

function isFalsey(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

function emptySummary(
  mode: "commit" | "dry-run",
  provider: string,
  configured: boolean,
  enabled: boolean,
  reason: MaritimeMovementSummary["reason"],
  collectSeconds: number,
  logLine: string,
): MaritimeMovementSummary {
  return {
    provider,
    mode,
    configured,
    enabled,
    ran: false,
    reason,
    collectSeconds,
    messagesReceived: 0,
    vesselsSeen: 0,
    theatresWritten: 0,
    rowsInserted: 0,
    perTheatre: [],
    registry: { configured, enabled, lookups: 0, resolved: 0 },
    fetchOk: false,
    errors: [],
    logLines: [logLine],
  };
}

function assignTheatre(lat: number, lon: number): string | null {
  for (const t of AIS_THEATRES) {
    if (lat >= t.minLat && lat <= t.maxLat && lon >= t.minLon && lon <= t.maxLon) {
      return t.theatre;
    }
  }
  return null;
}

// AIS ship-type codes: 80-89 = tanker. (70-79 = cargo, but AIS cannot split
// bulk vs container vs LNG from the type code alone, so those stay NULL.)
function isTankerType(type: number | null): boolean {
  return type !== null && type >= 80 && type <= 89;
}

// Trade-class vessels worth a registry lookup: 70-79 = cargo (bulk/container
// live here), 80-89 = tanker (gas carriers live here). Other classes
// (passenger, fishing, tug, etc.) carry no bulk/container/LNG split, so we do
// not spend a lookup on them.
function isCargoOrTanker(type: number | null): boolean {
  return type !== null && type >= 70 && type <= 89;
}

// Minimal structural type for the Node global WebSocket so this compiles without
// the DOM lib (the ingest package targets node types only). Node 22+ ships a
// stable global WebSocket, which the runtime provides.
interface WsLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}
type WsCtor = new (url: string) => WsLike;

async function messageToText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (
    data &&
    typeof (data as { text?: unknown }).text === "function"
  ) {
    try {
      return await (data as { text: () => Promise<string> }).text();
    } catch {
      return null;
    }
  }
  return null;
}

// What we accumulate per unique vessel (MMSI). `type` comes from ShipStaticData;
// `cog`/`sog`/`navStatus` come from PositionReport. All start null and are only
// overwritten with VALID values, so a missing field stays "not reported".
interface VesselObs {
  theatre: string | null;
  type: number | null;
  /** IMO hull number from ShipStaticData; key for the external registry lookup. */
  imo: number | null;
  cog: number | null;
  sog: number | null;
  navStatus: number | null;
}

interface CollectResult {
  messages: number;
  byMmsi: Map<number, VesselObs>;
  error: string | null;
}

/**
 * Open the aisstream.io WebSocket, subscribe to every tracked chokepoint
 * bounding box, and collect unique vessels (by MMSI) for `collectMs`. Resolves
 * with whatever was gathered when the window elapses or the socket closes; it
 * never rejects — a connection failure resolves with an `error` string so the
 * caller writes nothing and reports a clean failure.
 */
function collectAisStream(apiKey: string, collectMs: number): Promise<CollectResult> {
  return new Promise<CollectResult>((resolve) => {
    const WS = (globalThis as { WebSocket?: WsCtor }).WebSocket;
    const byMmsi = new Map<number, VesselObs>();
    let messages = 0;
    let settled = false;
    let ws: WsLike | null = null;

    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve({ messages, byMmsi, error });
    };

    const timer = setTimeout(() => finish(null), collectMs);
    (timer as { unref?: () => void }).unref?.();

    if (!WS) {
      finish("global WebSocket is unavailable in this runtime");
      return;
    }

    const subscription = {
      APIKey: apiKey,
      BoundingBoxes: AIS_THEATRES.map((t) => [
        [t.minLat, t.minLon],
        [t.maxLat, t.maxLon],
      ]),
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };

    try {
      ws = new WS(AISSTREAM_URL);
    } catch (err) {
      finish(err instanceof Error ? err.message : String(err));
      return;
    }

    ws.addEventListener("open", () => {
      try {
        ws?.send(JSON.stringify(subscription));
      } catch (err) {
        finish(err instanceof Error ? err.message : String(err));
      }
    });
    ws.addEventListener("error", () => finish("WebSocket connection error"));
    ws.addEventListener("close", () => finish(null));
    ws.addEventListener("message", (ev: unknown) => {
      void (async () => {
        const text = await messageToText((ev as { data?: unknown })?.data);
        if (!text) return;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return;
        }
        // aisstream sends an error frame as { error: "..." } — surface it.
        if (typeof obj.error === "string") {
          finish(obj.error);
          return;
        }
        const meta = obj.MetaData as
          | { MMSI?: number; latitude?: number; longitude?: number }
          | undefined;
        const mmsi = typeof meta?.MMSI === "number" ? meta.MMSI : null;
        if (mmsi === null) return;
        messages += 1;

        const lat = typeof meta?.latitude === "number" ? meta.latitude : null;
        const lon = typeof meta?.longitude === "number" ? meta.longitude : null;
        const theatre = lat !== null && lon !== null ? assignTheatre(lat, lon) : null;

        let type: number | null = null;
        let imo: number | null = null;
        let cog: number | null = null;
        let sog: number | null = null;
        let navStatus: number | null = null;
        if (obj.MessageType === "ShipStaticData") {
          const msg = obj.Message as
            | { ShipStaticData?: { Type?: number; ImoNumber?: number } }
            | undefined;
          const t = msg?.ShipStaticData?.Type;
          if (typeof t === "number") type = t;
          const imoNum = msg?.ShipStaticData?.ImoNumber;
          if (typeof imoNum === "number" && imoNum > 0) imo = imoNum;
        } else if (obj.MessageType === "PositionReport") {
          const msg = obj.Message as
            | {
                PositionReport?: {
                  Cog?: number;
                  Sog?: number;
                  NavigationalStatus?: number;
                };
              }
            | undefined;
          const pr = msg?.PositionReport;
          if (typeof pr?.Cog === "number") cog = validCog(pr.Cog);
          if (typeof pr?.Sog === "number") sog = validSog(pr.Sog);
          if (typeof pr?.NavigationalStatus === "number")
            navStatus = pr.NavigationalStatus;
        }

        const existing = byMmsi.get(mmsi);
        if (existing) {
          if (theatre) existing.theatre = theatre;
          if (type !== null) existing.type = type;
          if (imo !== null) existing.imo = imo;
          // Keep the latest VALID movement fields seen for this vessel.
          if (cog !== null) existing.cog = cog;
          if (sog !== null) existing.sog = sog;
          if (navStatus !== null) existing.navStatus = navStatus;
        } else {
          byMmsi.set(mmsi, { theatre, type, imo, cog, sog, navStatus });
        }
      })();
    });
  });
}

async function baselineTotal(theatre: string, cutoff: Date): Promise<number | null> {
  try {
    const [row] = await db
      .select({ total: maritimeMovementTable.totalVessels })
      .from(maritimeMovementTable)
      .where(
        and(
          eq(maritimeMovementTable.theatre, theatre),
          ilike(maritimeMovementTable.sourceName, "%ais%"),
          lte(maritimeMovementTable.dataAsOf, cutoff),
        ),
      )
      .orderBy(desc(maritimeMovementTable.dataAsOf))
      .limit(1);
    return row?.total ?? null;
  } catch {
    return null;
  }
}

/** Terse "vs 7-day baseline" delta, e.g. "+12%". Null when no baseline exists. */
function formatChange(current: number, baseline: number | null): string | null {
  if (baseline === null || baseline <= 0) return null;
  const pct = Math.round(((current - baseline) / baseline) * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${pct}%`;
  return "0%";
}

function confidenceFor(vessels: number): "low" | "medium" | "high" {
  if (vessels >= 20) return "high";
  if (vessels >= 5) return "medium";
  return "low";
}

export type MaritimeMovementOptions = {
  commit?: boolean;
  /** Override the live-sample window (seconds); defaults to AIS_COLLECT_SECONDS. */
  collectSeconds?: number;
};

/**
 * Run the live AIS movement-context ingest once. No-ops cleanly (writes
 * nothing, never throws for an expected condition) when the provider is
 * unconfigured, switched off, or unsupported. CONTEXT ONLY — never writes the
 * incidents table.
 */
export async function runMaritimeMovementIngest(
  opts: MaritimeMovementOptions = {},
): Promise<MaritimeMovementSummary> {
  const mode: "commit" | "dry-run" = opts.commit ? "commit" : "dry-run";
  const provider = (process.env.AIS_PROVIDER?.trim() || "aisstream").toLowerCase();
  const apiKey = process.env.AIS_API_KEY?.trim() ?? "";
  const configured = apiKey.length > 0;
  const enabled = !isFalsey(process.env.AIS_ENABLED);

  const envSeconds = Number(process.env.AIS_COLLECT_SECONDS);
  const collectSeconds = Math.min(
    MAX_COLLECT_SECONDS,
    Math.max(
      MIN_COLLECT_SECONDS,
      opts.collectSeconds ??
        (Number.isFinite(envSeconds) && envSeconds > 0
          ? envSeconds
          : DEFAULT_COLLECT_SECONDS),
    ),
  );

  if (!enabled) {
    return emptySummary(
      mode,
      provider,
      configured,
      false,
      "disabled",
      collectSeconds,
      "AIS movement ingest disabled (AIS_ENABLED=false); skipping.",
    );
  }
  if (!configured) {
    return emptySummary(
      mode,
      provider,
      false,
      true,
      "not_configured",
      collectSeconds,
      "AIS movement ingest not configured (AIS_API_KEY unset); skipping cleanly.",
    );
  }
  if (provider !== "aisstream") {
    return emptySummary(
      mode,
      provider,
      true,
      true,
      "unsupported_provider",
      collectSeconds,
      `AIS provider "${provider}" is not supported (only "aisstream"); skipping.`,
    );
  }

  const { messages, byMmsi, error } = await collectAisStream(
    apiKey,
    collectSeconds * 1000,
  );

  // Per-theatre reference bearing for the inbound/outbound flow split.
  const bearingByTheatre = new Map<string, number>(
    AIS_THEATRES.map((t) => [t.theatre, t.inboundBearing]),
  );

  // OPTIONAL precision layer: resolve the precise commercial class (bulk /
  // container / LNG-LPG) for each cargo/tanker vessel via the external vessel
  // registry, keyed on its IMO (preferred) or MMSI. No-ops cleanly when the
  // registry is unconfigured — the breakdown columns then stay NULL. Only
  // trade-class vessels (AIS type 70-89) are looked up; that is where the
  // bulk/container/gas split lives, and it bounds the lookup budget to the
  // vessels that matter.
  const registryConfig = readVesselRegistryConfig();
  const registryCandidates: VesselLookup[] = [];
  for (const [mmsi, v] of byMmsi.entries()) {
    if (v.theatre && isCargoOrTanker(v.type)) {
      registryCandidates.push({ mmsi, imo: v.imo });
    }
  }
  const registry = await resolveVesselClasses(registryCandidates, {
    config: registryConfig,
  });
  const classByMmsi = registry.classByMmsi;

  // Aggregate UNIQUE vessels per theatre.
  //   inbound/outbound — direction split from course-over-ground (moving only)
  //   anchored         — at-anchor / moored / ~zero speed
  //   bulk/container/lngLpg — from the external registry (registry-resolved only)
  //   directionObserved/motionObserved/registryResolved — how many vessels we
  //     could classify, so a 0 only ever reads as a real measurement (not "no
  //     data" — that stays NULL)
  interface TheatreAgg {
    total: number;
    tankers: number;
    inbound: number;
    outbound: number;
    anchored: number;
    bulk: number;
    container: number;
    lngLpg: number;
    directionObserved: number;
    motionObserved: number;
    registryResolved: number;
  }
  const agg = new Map<string, TheatreAgg>();
  for (const [mmsi, v] of byMmsi.entries()) {
    const { theatre, type, cog, sog, navStatus } = v;
    if (!theatre) continue;
    const a =
      agg.get(theatre) ??
      ({
        total: 0,
        tankers: 0,
        inbound: 0,
        outbound: 0,
        anchored: 0,
        bulk: 0,
        container: 0,
        lngLpg: 0,
        directionObserved: 0,
        motionObserved: 0,
        registryResolved: 0,
      } satisfies TheatreAgg);
    a.total += 1;
    if (isTankerType(type)) a.tankers += 1;
    const klass = classByMmsi.get(mmsi);
    if (klass !== undefined) {
      a.registryResolved += 1;
      if (klass === "bulk") a.bulk += 1;
      else if (klass === "container") a.container += 1;
      else if (klass === "lng-lpg") a.lngLpg += 1;
    }
    if (sog !== null || navStatus !== null) a.motionObserved += 1;
    if (isAnchored(sog, navStatus)) {
      a.anchored += 1;
    } else {
      const dir = classifyDirection(
        bearingByTheatre.get(theatre) ?? 0,
        cog,
        sog,
        navStatus,
      );
      if (dir === "inbound") {
        a.inbound += 1;
        a.directionObserved += 1;
      } else if (dir === "outbound") {
        a.outbound += 1;
        a.directionObserved += 1;
      }
    }
    agg.set(theatre, a);
  }

  const vesselsSeen = [...agg.values()].reduce((s, a) => s + a.total, 0);
  const errors = error ? [error] : [];
  const logLines: string[] = [];
  const perTheatre: MaritimeMovementSummary["perTheatre"] = [];

  // A hard failure with no data → write nothing, report cleanly.
  if (error && vesselsSeen === 0) {
    logLines.push(`AIS movement ingest: collection failed — ${error}.`);
    return {
      provider,
      mode,
      configured: true,
      enabled: true,
      ran: false,
      reason: "fetch_failed",
      collectSeconds,
      messagesReceived: messages,
      vesselsSeen: 0,
      theatresWritten: 0,
      rowsInserted: 0,
      perTheatre: [],
      registry: {
        configured: registry.configured,
        enabled: registry.enabled,
        lookups: registry.lookups,
        resolved: registry.resolved,
      },
      fetchOk: false,
      errors,
      logLines,
    };
  }

  const observedAt = new Date();
  const cutoff = new Date(observedAt.getTime() - 7 * 86_400_000);
  const rows: InsertMaritimeMovement[] = [];

  // -------------------------------------------------------------------------
  // AIS-dark / transmission-gap detection (STATEFUL — reads persisted
  // sightings). The live sample only shows vessels that ARE transmitting, so a
  // dark vessel is found by comparing the set seen NOW against vessels that were
  // recently LOITERING in a theatre and have since gone silent.
  //
  //   darkByTheatre = number of prior loitering candidates now absent, OR null
  //   when there were no candidates to measure (so a 0 is only ever a genuine
  //   "had loitering vessels, none went dark", never a fabricated zero).
  // -------------------------------------------------------------------------
  const currentMmsis = new Set<number>(byMmsi.keys());
  const lookbackCutoff = new Date(
    observedAt.getTime() - DARK_LOOKBACK_HOURS * 3_600_000,
  );
  const minGapCutoff = new Date(
    observedAt.getTime() - DARK_MIN_GAP_MINUTES * 60_000,
  );
  const darkByTheatre = new Map<string, number | null>();
  try {
    // Prior sightings that are recent enough to still matter (≥ lookback) AND
    // old enough that absence is meaningful (< min-gap).
    const priorRows = await db
      .select({
        mmsi: maritimeVesselSightingTable.mmsi,
        theatre: maritimeVesselSightingTable.theatre,
        lastSeenAt: maritimeVesselSightingTable.lastSeenAt,
        lastSog: maritimeVesselSightingTable.lastSog,
        lastNavStatus: maritimeVesselSightingTable.lastNavStatus,
      })
      .from(maritimeVesselSightingTable)
      .where(
        and(
          gte(maritimeVesselSightingTable.lastSeenAt, lookbackCutoff),
          lt(maritimeVesselSightingTable.lastSeenAt, minGapCutoff),
        ),
      );
    const computed = computeDarkByTheatre(
      priorRows.map((r) => ({
        mmsi: r.mmsi,
        theatre: r.theatre,
        lastSeenAt: r.lastSeenAt,
        lastSog: r.lastSog ?? null,
        lastNavStatus: r.lastNavStatus ?? null,
      })),
      currentMmsis,
      AIS_THEATRES.map((t) => t.theatre),
      observedAt,
    );
    for (const [theatre, count] of computed) darkByTheatre.set(theatre, count);
  } catch (err) {
    // Detection is best-effort: a query failure leaves every count NULL ("not
    // measurable"), never a fabricated zero, and never fails the ingest.
    const m = err instanceof Error ? err.message : String(err);
    logLines.push(`AIS dark/gap detection skipped — ${m}.`);
  }

  // Iterate in board order for stable output.
  for (const t of AIS_THEATRES) {
    const a = agg.get(t.theatre);
    // Genuine gap detection (null when not measurable — never fabricated).
    const aisDarkOrGap = darkByTheatre.get(t.theatre) ?? null;
    const hasTraffic = !!a && a.total > 0;
    const hasDark = aisDarkOrGap != null && aisDarkOrGap > 0;
    // A snapshot is written when EITHER live traffic was observed OR a dark/gap
    // signal was measured for the theatre. The dark-only case matters: vessels
    // that were loitering here and have all since gone silent leave zero live
    // traffic, yet that is the STRONGEST dark signal — emitting the row keeps it
    // from being swallowed by the "absence" rule. A theatre with neither is true
    // absence and gets no row (never a fabricated zero).
    if (!hasTraffic && !hasDark) continue;

    const baseline = hasTraffic ? await baselineTotal(t.theatre, cutoff) : null;
    const change = hasTraffic ? formatChange(a!.total, baseline) : null;
    // A count is only written when we actually OBSERVED the signal it needs:
    //   direction needs ≥1 course-classifiable vessel; anchored needs ≥1 vessel
    //   reporting speed/nav-status. Otherwise the column stays NULL ("not
    //   reported"), never a fabricated zero. With no live traffic every live
    //   count stays NULL — only the (cross-window) dark/gap signal is reported.
    const inbound = hasTraffic && a!.directionObserved > 0 ? a!.inbound : null;
    const outbound = hasTraffic && a!.directionObserved > 0 ? a!.outbound : null;
    const anchored = hasTraffic && a!.motionObserved > 0 ? a!.anchored : null;
    const tankers = hasTraffic && a!.tankers > 0 ? a!.tankers : null;
    const total = hasTraffic ? a!.total : null;
    // The bulk/container/LNG-LPG split is filled ONLY when the external registry
    // resolved ≥1 vessel in this theatre. A theatre with zero successful
    // lookups (registry off, or no match) keeps all three NULL ("not
    // reported"); a 0 only appears when we DID resolve vessels and none were of
    // that class — a real measurement, never a fabricated zero.
    const registryResolved = hasTraffic && a!.registryResolved > 0;
    const bulk = registryResolved ? a!.bulk : null;
    const container = registryResolved ? a!.container : null;
    const lngLpg = registryResolved ? a!.lngLpg : null;
    perTheatre.push({
      theatre: t.theatre,
      totalVessels: total ?? 0,
      tankers: tankers ?? 0,
      inbound,
      outbound,
      anchored,
      bulk,
      container,
      lngLpg,
      aisDarkOrGap,
      change,
    });
    rows.push({
      theatre: t.theatre,
      dataAsOf: observedAt,
      // NULL (not 0) when no live traffic was observed — the dark signal does
      // not assert visible vessels.
      totalVessels: total,
      inboundCount: inbound,
      outboundCount: outbound,
      tankersCount: tankers,
      // Bulk vs container vs LNG/LPG cannot be separated from the AIS ship-type
      // code alone (70-79 is "cargo" with no sub-class; gas carriers are not a
      // distinct code) — that split needs the external vessel registry (keyed on
      // IMO/MMSI). When the registry is configured these are registry-resolved
      // counts; otherwise they stay NULL rather than a fabricated guess.
      bulkCarriersCount: bulk,
      containerCount: container,
      lngLpgCount: lngLpg,
      anchoredOrWaitingCount: anchored,
      aisVisibleCount: total,
      // AIS-dark/gap IS derived here — not from this single live sample (which
      // only shows vessels that ARE transmitting), but from cross-window state:
      // loitering vessels seen in a prior run that have since gone silent. NULL
      // when there was no prior baseline to measure against (never fabricated).
      aisDarkOrGapCount: aisDarkOrGap,
      changeVs7DayBaseline: change,
      confidence: hasTraffic ? confidenceFor(a!.total) : "low",
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      notes: hasTraffic
        ? "Live AIS sample of vessels currently transiting the theatre. Movement is context, never an incident."
        : "No live AIS traffic observed; prior loitering vessels have gone silent (AIS-dark/gap). Indicator only, never an incident.",
      rawPayload: {
        provider: "aisstream",
        collectSeconds,
        messagesReceived: messages,
        observedAt: observedAt.toISOString(),
        boundingBox: [t.minLat, t.maxLat, t.minLon, t.maxLon],
        inboundBearing: t.inboundBearing,
        directionObserved: a?.directionObserved ?? 0,
        motionObserved: a?.motionObserved ?? 0,
        registryResolved: a?.registryResolved ?? 0,
        registryProvider: registry.configured ? registryConfig.provider : null,
        aisDarkOrGap,
      },
    });
  }

  let inserted = 0;
  if (opts.commit && rows.length > 0) {
    try {
      const result = await db.insert(maritimeMovementTable).values(rows);
      inserted = result.rowCount ?? rows.length;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      errors.push(m);
      logLines.push(`AIS movement ingest: DB insert failed — ${m}.`);
      return {
        provider,
        mode,
        configured: true,
        enabled: true,
        ran: false,
        reason: "fetch_failed",
        collectSeconds,
        messagesReceived: messages,
        vesselsSeen,
        theatresWritten: 0,
        rowsInserted: 0,
        perTheatre,
        registry: {
          configured: registry.configured,
          enabled: registry.enabled,
          lookups: registry.lookups,
          resolved: registry.resolved,
        },
        fetchOk: true,
        errors,
        logLines,
      };
    }
  }

  // Persist this run's sightings so a FUTURE run can measure a vessel's gap.
  // One row per MMSI, reflecting the LAST theatre seen — so a vessel that
  // legitimately moves to another theatre updates in place and can never be
  // mis-flagged as "dark" in the old one. Only on commit (dry-run keeps no
  // history); non-fatal so a sighting write never fails the movement ingest.
  if (opts.commit) {
    const sightingRows: InsertMaritimeVesselSighting[] = [];
    for (const [mmsi, obs] of byMmsi) {
      if (!obs.theatre) continue; // only persist vessels inside a tracked theatre
      sightingRows.push({
        mmsi,
        theatre: obs.theatre,
        lastSeenAt: observedAt,
        lastSog: obs.sog,
        lastNavStatus: obs.navStatus,
        updatedAt: observedAt,
      });
    }
    if (sightingRows.length > 0) {
      try {
        await db
          .insert(maritimeVesselSightingTable)
          .values(sightingRows)
          .onConflictDoUpdate({
            target: maritimeVesselSightingTable.mmsi,
            set: {
              theatre: sql`excluded.theatre`,
              lastSeenAt: sql`excluded.last_seen_at`,
              // Preserve the last KNOWN movement when this sample lacked it (a
              // static-only report has no speed/nav-status), so loiter state is
              // not erased to NULL.
              lastSog: sql`COALESCE(excluded.last_sog, ${maritimeVesselSightingTable.lastSog})`,
              lastNavStatus: sql`COALESCE(excluded.last_nav_status, ${maritimeVesselSightingTable.lastNavStatus})`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        logLines.push(`AIS sighting persistence skipped — ${m}.`);
      }
    }
    // Prune sightings older than the lookback window — they are too stale to
    // reason about and keep the table bounded.
    try {
      await db
        .delete(maritimeVesselSightingTable)
        .where(lt(maritimeVesselSightingTable.lastSeenAt, lookbackCutoff));
    } catch {
      /* non-fatal housekeeping */
    }
  }

  logLines.push(
    `AIS movement ingest (${mode}): ${messages} messages, ${vesselsSeen} unique vessels across ${rows.length} theatre(s); ${opts.commit ? `${inserted} row(s) written` : "dry-run, nothing written"}.`,
  );
  if (registry.configured && registry.enabled) {
    logLines.push(
      `Vessel registry (${registryConfig.provider}): ${registry.lookups} lookup(s), ${registry.resolved} resolved to a commercial class.`,
    );
  } else if (registryCandidates.length > 0) {
    logLines.push(
      "Vessel registry not configured — bulk/container/LNG-LPG breakdown left unreported (NULL).",
    );
  }
  if (registry.errors.length > 0) {
    errors.push(...registry.errors.map((e) => `vessel registry: ${e}`));
  }

  return {
    provider,
    mode,
    configured: true,
    enabled: true,
    ran: true,
    reason: "ok",
    collectSeconds,
    messagesReceived: messages,
    vesselsSeen,
    theatresWritten: rows.length,
    rowsInserted: inserted,
    perTheatre,
    registry: {
      configured: registry.configured,
      enabled: registry.enabled,
      lookups: registry.lookups,
      resolved: registry.resolved,
    },
    fetchOk: true,
    errors,
    logLines,
  };
}

/** True when an AIS credential is present (the provider could run). */
export function isAisConfigured(): boolean {
  return (process.env.AIS_API_KEY?.trim().length ?? 0) > 0;
}
