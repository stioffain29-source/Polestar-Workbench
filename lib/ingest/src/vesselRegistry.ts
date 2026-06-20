// ===========================================================================
// External vessel-registry lookup (precise ship class by IMO/MMSI).
//
// WHY: AIS broadcasts only a coarse ship-and-cargo TYPE code. Codes 70-79 are
// an undifferentiated "cargo" class (bulk and container ships are
// indistinguishable from the code alone) and gas carriers have no dedicated
// code, so bulk vs container vs LNG/LPG cannot be split from AIS alone. An
// external registry keyed on the vessel's IMO (or MMSI) DOES carry the precise
// commercial class, which lets us honestly fill the bulk/container/LNG-LPG
// breakdowns for each chokepoint.
//
// HONESTY: this is an ADDITIVE precision layer over the AIS movement sample.
//   * It NEVER touches the incidents table and can never inflate an incident
//     count — it only enriches the isolated maritime_movement snapshot.
//   * Counts are only filled from a DEFINITIVE registry match. A vessel the
//     registry cannot resolve is left UNCLASSIFIED (never guessed), and a
//     theatre with zero successful lookups keeps bulk/container/LNG NULL ("not
//     reported"), never a fabricated zero.
//
// CONFIG (all env-gated; degrades cleanly to "not configured" → counts NULL):
//   VESSEL_REGISTRY_API_KEY    required to enable (unset → no lookups)
//   VESSEL_REGISTRY_ENABLED    set "false" to switch off even when keyed
//   VESSEL_REGISTRY_PROVIDER   default "datalastic" (the only one implemented)
//   VESSEL_REGISTRY_API_BASE   optional endpoint override
//   VESSEL_REGISTRY_MAX_LOOKUPS per-run lookup cap (default 150, clamp 1-1000)
//
// Default provider is datalastic.com, whose vessel endpoint returns a precise
// `type` / `type_specific` (e.g. "Bulk Carrier", "Container Ship", "LNG
// Tanker") keyed on imo or mmsi.
// ===========================================================================

const DEFAULT_PROVIDER = "datalastic";
const DEFAULT_BASE = "https://api.datalastic.com/api/v0";
const DEFAULT_MAX_LOOKUPS = 150;
const MIN_MAX_LOOKUPS = 1;
const MAX_MAX_LOOKUPS = 1000;
const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 5;

// A realistic browser UA; some registry endpoints throttle library defaults.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The commercial classes we can fill from a registry match. */
export type VesselClass = "bulk" | "container" | "lng-lpg" | "other";

export interface VesselLookup {
  /** IMO number (preferred key) when AIS static data reported it. */
  imo: number | null;
  /** MMSI is always present (the unique AIS vessel id). */
  mmsi: number;
}

export interface VesselRegistryConfig {
  configured: boolean;
  enabled: boolean;
  provider: string;
  base: string;
  apiKey: string;
  maxLookups: number;
}

export interface VesselRegistryResult {
  /** mmsi → resolved commercial class. ABSENT key means the lookup did not
   *  succeed (so the caller must NOT count it as anything). */
  classByMmsi: Map<number, VesselClass>;
  configured: boolean;
  enabled: boolean;
  /** Lookups actually attempted. */
  lookups: number;
  /** Lookups that returned a usable vessel record. */
  resolved: number;
  errors: string[];
}

function isFalsey(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

export function readVesselRegistryConfig(): VesselRegistryConfig {
  const apiKey = process.env.VESSEL_REGISTRY_API_KEY?.trim() ?? "";
  const provider = (
    process.env.VESSEL_REGISTRY_PROVIDER?.trim() || DEFAULT_PROVIDER
  ).toLowerCase();
  const base = process.env.VESSEL_REGISTRY_API_BASE?.trim() || DEFAULT_BASE;
  const rawMax = Number(process.env.VESSEL_REGISTRY_MAX_LOOKUPS);
  const maxLookups = Math.min(
    MAX_MAX_LOOKUPS,
    Math.max(
      MIN_MAX_LOOKUPS,
      Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : DEFAULT_MAX_LOOKUPS,
    ),
  );
  return {
    configured: apiKey.length > 0,
    enabled: !isFalsey(process.env.VESSEL_REGISTRY_ENABLED),
    provider,
    base: base.replace(/\/+$/, ""),
    apiKey,
    maxLookups,
  };
}

/** True when a registry credential is present (the lookup COULD run). */
export function isVesselRegistryConfigured(): boolean {
  return (process.env.VESSEL_REGISTRY_API_KEY?.trim().length ?? 0) > 0;
}

/**
 * Map a free-text vessel-type string from the registry to one of our tracked
 * commercial classes. Returns "other" for a resolved-but-untracked class (e.g.
 * a tanker or general cargo with no sub-class) and null only for an empty
 * input. The order matters: LNG/LPG is checked first because a gas carrier can
 * also read as a "tanker", and "container" before "bulk" so a phrasing that
 * mentions both maps to the more specific term.
 */
export function classifyVesselClass(raw: string | null | undefined): VesselClass | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/\b(lng|lpg)\b/.test(s) || s.includes("liquefied gas") || s.includes("gas carrier")) {
    return "lng-lpg";
  }
  if (s.includes("container")) return "container";
  if (s.includes("bulk")) return "bulk";
  return "other";
}

/**
 * Pull the most specific type string from a datalastic-shaped vessel record.
 * Tolerant of partial shapes: prefers `type_specific`, falls back to `type`.
 *
 * Datalastic's single-vessel endpoint (`/vessel?imo=…`|`&mmsi=…`) wraps the
 * record in a `data` OBJECT (verified against docs.datalastic.com):
 *   { "data": { "type": "Cargo", "type_specific": "Bulk Carrier", … },
 *     "meta": { "success": true } }
 * Its multi-vessel / bulk endpoints instead return `data` as an ARRAY, so we
 * also accept a single-element array defensively (we always look up one hull).
 */
function extractTypeText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  let rec: Record<string, unknown>;
  if (Array.isArray(data)) {
    const first = data[0];
    if (!first || typeof first !== "object") return null;
    rec = first as Record<string, unknown>;
  } else if (data && typeof data === "object") {
    rec = data as Record<string, unknown>;
  } else {
    rec = json as Record<string, unknown>;
  }
  const specific = rec.type_specific;
  if (typeof specific === "string" && specific.trim()) return specific;
  const type = rec.type;
  if (typeof type === "string" && type.trim()) return type;
  return null;
}

function buildLookupUrl(cfg: VesselRegistryConfig, v: VesselLookup): string {
  const params = new URLSearchParams({ "api-key": cfg.apiKey });
  // IMO is the stable hull identifier; prefer it. MMSI can be reassigned, but
  // it is the only key for vessels that did not broadcast static data.
  if (v.imo && v.imo > 0) params.set("imo", String(v.imo));
  else params.set("mmsi", String(v.mmsi));
  return `${cfg.base}/vessel?${params.toString()}`;
}

async function lookupOne(
  cfg: VesselRegistryConfig,
  v: VesselLookup,
): Promise<{ klass: VesselClass | null; error: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(buildLookupUrl(cfg, v), {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 404 = vessel simply not in the registry; that is "no match", not an
      // error worth surfacing repeatedly.
      if (res.status === 404) return { klass: null, error: null };
      return { klass: null, error: `status ${res.status}` };
    }
    const json = (await res.json()) as unknown;
    const text = extractTypeText(json);
    if (!text) return { klass: null, error: null };
    return { klass: classifyVesselClass(text), error: null };
  } catch (err) {
    const msg = ctrl.signal.aborted
      ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return { klass: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the precise commercial class for each candidate vessel via the
 * external registry. No-ops cleanly (empty map, configured:false) when the
 * registry is unconfigured or switched off — the caller then leaves the
 * bulk/container/LNG-LPG columns NULL. Bounded by `maxLookups` per run.
 */
export async function resolveVesselClasses(
  vessels: VesselLookup[],
  opts: { config?: VesselRegistryConfig } = {},
): Promise<VesselRegistryResult> {
  const cfg = opts.config ?? readVesselRegistryConfig();
  const classByMmsi = new Map<number, VesselClass>();
  const errors: string[] = [];

  if (!cfg.enabled || !cfg.configured) {
    return {
      classByMmsi,
      configured: cfg.configured,
      enabled: cfg.enabled,
      lookups: 0,
      resolved: 0,
      errors,
    };
  }
  if (cfg.provider !== DEFAULT_PROVIDER) {
    return {
      classByMmsi,
      configured: cfg.configured,
      enabled: cfg.enabled,
      lookups: 0,
      resolved: 0,
      errors: [`unsupported vessel registry provider "${cfg.provider}"`],
    };
  }

  // Dedupe by MMSI and cap to the per-run budget.
  const seen = new Set<number>();
  const queue: VesselLookup[] = [];
  for (const v of vessels) {
    if (seen.has(v.mmsi)) continue;
    seen.add(v.mmsi);
    queue.push(v);
    if (queue.length >= cfg.maxLookups) break;
  }

  let lookups = 0;
  let resolved = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const v = queue[cursor++];
      lookups += 1;
      const { klass, error } = await lookupOne(cfg, v);
      if (klass !== null) {
        resolved += 1;
        classByMmsi.set(v.mmsi, klass);
      }
      if (error && errors.length < 5) errors.push(error);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  return {
    classByMmsi,
    configured: cfg.configured,
    enabled: cfg.enabled,
    lookups,
    resolved,
    errors,
  };
}
