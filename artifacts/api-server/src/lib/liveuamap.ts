import type { LiveuamapEvent, LiveuamapEventsResponse } from "@workspace/api-zod";
import { logger } from "./logger";

// Server-side proxy for the Liveuamap (liveuamap.com) live-event feed.
//
// Liveuamap's data API is PAID and metered, and the workbench is intentionally
// public, so the key must never reach the browser and a naive pass-through
// would let anonymous traffic burn the paid quota. This module keeps the key
// server-side and bounds upstream calls with a per-region TTL cache, in-flight
// coalescing, and a stale-on-error fallback. If LIVEUAMAP_API_KEY is unset the
// whole feature cleanly no-ops (configured: false, no markers) — mirroring the
// ReliefWeb pattern — so the map still works without the integration.

// Endpoint + auth confirmed from Liveuamap's official C# example
// (github.com/liveuamap/liveuamap.consolecsharp.api): the key is the `key`
// query param, regions are integer ids, time is unix seconds.
const API_BASE = "https://a.liveuamap.com/api";

// Only an allowlist of APAC / Middle East regions (the workbench operating
// area) is mapped to its Liveuamap numeric id. Anything else is rejected before
// a paid call is ever made.
const REGION_IDS: Record<string, number> = {
  asia: 6,
  "middle-east": 7,
  india: 26,
  pakistan: 69,
  china: 24,
  myanmar: 148,
  thailand: 151,
  vietnam: 150,
  bangladesh: 153,
  indonesia: 156,
  philippines: 72,
  taiwan: 142,
  "hong-kong": 12,
  japan: 149,
  koreas: 9,
  "central-asia": 57,
  "israel-palestine": 2,
  iran: 66,
  iraq: 65,
  syria: 3,
  yemen: 53,
  lebanon: 74,
  afghanistan: 56,
  kashmir: 55,
};

export const LIVEUAMAP_REGIONS = Object.keys(REGION_IDS);
export const DEFAULT_REGION = "asia";
export const DEFAULT_COUNT = 50;
export const MAX_COUNT = 100;

const FRESH_MS = 12 * 60 * 1000; // serve cached without refetch for 12 min
const STALE_MS = 60 * 60 * 1000; // serve last good data on error for up to 60 min
const FAIL_MS = 3 * 60 * 1000; // remember a hard failure briefly to avoid hammering
const TIMEOUT_MS = 9000;

type CacheEntry = {
  data: LiveuamapEventsResponse;
  storedAt: number;
  ok: boolean;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<LiveuamapEventsResponse>>();

function isConfigured(): boolean {
  return !!process.env.LIVEUAMAP_API_KEY?.trim();
}

function clampCount(count: number | undefined): number {
  if (!count || !Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.max(1, Math.min(MAX_COUNT, Math.trunc(count)));
}

function normalizeRegion(region: string | undefined): string {
  const r = (region ?? "").trim().toLowerCase();
  return r in REGION_IDS ? r : DEFAULT_REGION;
}

function toIso(ev: Record<string, unknown>): string {
  const ts = ev.timestamp;
  if (typeof ts === "number" && ts > 0) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const t = ev.time;
  if (typeof t === "string" && t.trim()) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

// Upstream `link` values are untrusted and get rendered into <a href>, so only
// allow well-formed http/https URLs through — anything else (javascript:, data:,
// relative junk) is dropped to null.
function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Liveuamap returns lat/lng as strings and a grab-bag of optional fields; treat
// every upstream value as untrusted and keep only well-formed, geolocated rows.
function normalizeEvents(raw: unknown): LiveuamapEvent[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: LiveuamapEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const ev = item as Record<string, unknown>;
    const lat = Number.parseFloat(String(ev.lat ?? ""));
    const lng = Number.parseFloat(String(ev.lng ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const name = str(ev.name);
    if (!name) continue;
    const id = ev.id != null ? String(ev.id) : `${lat},${lng},${String(ev.timestamp ?? "")}`;
    out.push({
      id,
      name,
      lat,
      lng,
      time: toIso(ev),
      link: safeUrl(ev.link),
      source: str(ev.source) ?? str(ev.viaSource),
      location: str(ev.location),
      category: str(ev.svimg),
    });
  }
  return out;
}

async function fetchUpstream(region: string): Promise<LiveuamapEventsResponse> {
  const key = process.env.LIVEUAMAP_API_KEY!.trim();
  const resid = REGION_IDS[region];
  const time = Math.floor(Date.now() / 1000);
  // Always fetch the max page per region; the cache is keyed by region alone and
  // each request slices to its own count. This stops the public `count` param
  // from multiplying the cache-key space (and thus the paid upstream calls).
  const url = `${API_BASE}?a=mpts&resid=${resid}&time=${time}&count=${MAX_COUNT}&key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`upstream status ${res.status}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const body =
      json && typeof json.mpts === "object" && json.mpts !== null
        ? (json.mpts as Record<string, unknown>)
        : json;
    const events = normalizeEvents(body.events);
    const freerequests =
      typeof body.freerequests === "number" ? body.freerequests : null;
    return {
      configured: true,
      cached: false,
      region,
      count: MAX_COUNT,
      fetchedAt: new Date().toISOString(),
      freerequests,
      events,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Shape a cached/per-region payload to a specific request: cap events to the
// requested count and report that count + cache status.
function withCount(
  data: LiveuamapEventsResponse,
  count: number,
  cached: boolean,
): LiveuamapEventsResponse {
  return { ...data, count, cached, events: data.events.slice(0, count) };
}

export async function getLiveuamapEvents(
  regionInput: string | undefined,
  countInput: number | undefined,
): Promise<LiveuamapEventsResponse> {
  const region = normalizeRegion(regionInput);
  const count = clampCount(countInput);

  if (!isConfigured()) {
    return {
      configured: false,
      cached: false,
      region,
      count,
      fetchedAt: null,
      freerequests: null,
      events: [],
    };
  }

  // Cache by region only — the public `count` never widens the key space, so
  // the number of paid upstream calls is bounded by the region allowlist.
  const cacheKey = region;
  const now = Date.now();
  const entry = cache.get(cacheKey);

  // Fresh cache hit, or a recent hard failure we don't want to retry yet.
  if (entry) {
    const age = now - entry.storedAt;
    if (entry.ok && age < FRESH_MS) return withCount(entry.data, count, true);
    if (!entry.ok && age < FAIL_MS) return withCount(entry.data, count, true);
  }

  // Coalesce concurrent requests for the same region into one upstream call.
  const existing = inflight.get(cacheKey);
  if (existing) {
    const data = await existing;
    return withCount(data, count, true);
  }

  const task = (async (): Promise<LiveuamapEventsResponse> => {
    try {
      const data = await fetchUpstream(region);
      cache.set(cacheKey, { data, storedAt: Date.now(), ok: true });
      return data;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), region },
        "Liveuamap fetch failed",
      );
      // Serve the last good payload if it is still within the stale window.
      if (entry?.ok && Date.now() - entry.storedAt < STALE_MS) {
        return entry.data;
      }
      const empty: LiveuamapEventsResponse = {
        configured: true,
        cached: false,
        region,
        count: MAX_COUNT,
        fetchedAt: null,
        freerequests: null,
        events: [],
      };
      cache.set(cacheKey, { data: empty, storedAt: Date.now(), ok: false });
      return empty;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, task);
  const data = await task;
  return withCount(data, count, false);
}
