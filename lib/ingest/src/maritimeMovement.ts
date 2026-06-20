import { db, maritimeMovementTable, type InsertMaritimeMovement } from "@workspace/db";
import { and, desc, ilike, lte, eq, sql } from "drizzle-orm";

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
//     ship-type code. Inbound/outbound, bulk vs container vs LNG, anchored and
//     "AIS dark" are NOT derivable from a short open-stream sample, so they stay
//     NULL ("not reported"), never a fabricated zero.
//   * A theatre that observed no vessels gets NO row (absence, not "0 traffic").
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
interface TheatreBox {
  theatre: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const AIS_THEATRES: TheatreBox[] = [
  { theatre: "Strait of Hormuz", minLat: 24.0, maxLat: 27.5, minLon: 54.0, maxLon: 58.5 },
  { theatre: "Bab el-Mandeb", minLat: 12.0, maxLat: 14.0, minLon: 42.5, maxLon: 44.5 },
  { theatre: "Gulf of Aden", minLat: 10.5, maxLat: 15.0, minLon: 44.5, maxLon: 51.5 },
  { theatre: "Singapore Strait", minLat: 1.0, maxLat: 1.5, minLon: 103.4, maxLon: 104.2 },
  { theatre: "Malacca Strait", minLat: 1.0, maxLat: 6.5, minLon: 98.0, maxLon: 103.4 },
  { theatre: "Red Sea", minLat: 14.0, maxLat: 28.0, minLon: 32.0, maxLon: 43.5 },
];

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
    change: string | null;
  }>;
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

interface CollectResult {
  messages: number;
  byMmsi: Map<number, { theatre: string | null; type: number | null }>;
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
    const byMmsi = new Map<number, { theatre: string | null; type: number | null }>();
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
        if (obj.MessageType === "ShipStaticData") {
          const msg = obj.Message as
            | { ShipStaticData?: { Type?: number } }
            | undefined;
          const t = msg?.ShipStaticData?.Type;
          if (typeof t === "number") type = t;
        }

        const existing = byMmsi.get(mmsi);
        if (existing) {
          if (theatre) existing.theatre = theatre;
          if (type !== null) existing.type = type;
        } else {
          byMmsi.set(mmsi, { theatre, type });
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

  // Aggregate UNIQUE vessels per theatre.
  const agg = new Map<string, { total: number; tankers: number }>();
  for (const { theatre, type } of byMmsi.values()) {
    if (!theatre) continue;
    const a = agg.get(theatre) ?? { total: 0, tankers: 0 };
    a.total += 1;
    if (isTankerType(type)) a.tankers += 1;
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
      fetchOk: false,
      errors,
      logLines,
    };
  }

  const observedAt = new Date();
  const cutoff = new Date(observedAt.getTime() - 7 * 86_400_000);
  const rows: InsertMaritimeMovement[] = [];

  // Iterate in board order for stable output.
  for (const t of AIS_THEATRES) {
    const a = agg.get(t.theatre);
    if (!a || a.total === 0) continue; // absence, never a fabricated zero
    const baseline = await baselineTotal(t.theatre, cutoff);
    const change = formatChange(a.total, baseline);
    perTheatre.push({
      theatre: t.theatre,
      totalVessels: a.total,
      tankers: a.tankers,
      change,
    });
    rows.push({
      theatre: t.theatre,
      dataAsOf: observedAt,
      totalVessels: a.total,
      tankersCount: a.tankers > 0 ? a.tankers : null,
      aisVisibleCount: a.total,
      changeVs7DayBaseline: change,
      confidence: confidenceFor(a.total),
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      notes:
        "Live AIS sample of vessels currently transiting the theatre. Movement is context, never an incident.",
      rawPayload: {
        provider: "aisstream",
        collectSeconds,
        messagesReceived: messages,
        observedAt: observedAt.toISOString(),
        boundingBox: [t.minLat, t.maxLat, t.minLon, t.maxLon],
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
        fetchOk: true,
        errors,
        logLines,
      };
    }
  }

  logLines.push(
    `AIS movement ingest (${mode}): ${messages} messages, ${vesselsSeen} unique vessels across ${rows.length} theatre(s); ${opts.commit ? `${inserted} row(s) written` : "dry-run, nothing written"}.`,
  );

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
    fetchOk: true,
    errors,
    logLines,
  };
}

/** True when an AIS credential is present (the provider could run). */
export function isAisConfigured(): boolean {
  return (process.env.AIS_API_KEY?.trim().length ?? 0) > 0;
}
