// Adapter bridging the workbench country-report dataset to the ONE shared
// engine (@workspace/country-engine). Owner brief §14–22, §23, §30, §33, §36.
//
// The workbench dataset builds PngReportItem rows from the live incident feed.
// This adapter projects those rows into the engine's EngineSourceInput shape and
// runs buildCanonicalEvents with the per-country config, so EVERY rendered
// section, map point, count and Top-3 is derived from the SAME canonical events
// the api-server owner routes expose. Excluded / held events never reach any
// rendered surface — callers read EngineResult.included only.
//
// Pure — no runtime dependencies beyond the engine and date-fns formatting.
import {
  buildCanonicalEvents,
  getCountryEngineConfig,
  type CanonicalEvent,
  type EngineResult,
  type EngineSourceInput,
  type LocationPrecision,
} from "@workspace/country-engine";
import type { MapPoint } from "@workspace/country-engine/gate";

// The minimal row shape the adapter needs. PngReportItem satisfies this (it
// carries id/title/summary/severity/dates/location) but the adapter also
// accepts the richer raw source incident so the engine's own attribution and
// dedup read the stored country tag where present.
export interface CanonicalAdapterItem {
  id: string | number;
  title: string;
  rawTitle?: string;
  displayTitle?: string | null;
  summary?: string | null;
  country?: string | null;
  province?: string | null;
  location?: string | null;
  category?: string | null;
  severity?: string | null;
  source?: string | null;
  url?: string | null;
  sourceUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // Dataset rows carry Date objects; raw incidents carry ISO strings.
  reportedDate?: Date | string | null;
  incidentDate?: Date | string | null;
  occurredAt?: string | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  const s = String(v).trim();
  return s || null;
}

/**
 * Project a workbench report/source item into the engine's EngineSourceInput.
 * The engine NEVER reads the incidents table directly — this is the sole
 * projection point.
 */
export function toEngineInput(
  item: CanonicalAdapterItem,
  slug: string,
): EngineSourceInput {
  const occurredAt =
    toIso(item.occurredAt) ?? toIso(item.reportedDate) ?? new Date(0).toISOString();
  return {
    id: String(item.id),
    topic: slug,
    title: item.rawTitle?.trim() || item.title,
    displayTitle: item.displayTitle ?? item.title ?? null,
    summary: item.summary ?? null,
    country: item.country ?? null,
    location: item.location ?? item.province ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    occurredAt,
    incidentDate: toIso(item.incidentDate),
    province: item.province ?? null,
    category: item.category ?? null,
    severity: (item.severity ?? "").toLowerCase() || null,
    source: item.source ?? null,
    sourceUrl: item.url ?? item.sourceUrl ?? null,
  };
}

/**
 * Run the shared engine over a set of workbench items for `slug` and return the
 * full EngineResult (ALL events plus the included / held / excluded splits).
 * Excluded and held events are carried for the admin review path but MUST NOT be
 * rendered, mapped, counted or promoted to Top-3 — callers read `.included`.
 */
export function runCountryEngine(
  items: CanonicalAdapterItem[],
  slug: string,
): EngineResult {
  const config = getCountryEngineConfig(slug);
  const inputs = items.map((i) => toEngineInput(i, slug));
  return buildCanonicalEvents(inputs, config);
}

/**
 * Convenience: the INCLUDED canonical events only. §36 fallback discipline —
 * excluded/held rows are dropped, not turned into filler.
 */
export function toCanonicalEvents(
  items: CanonicalAdapterItem[],
  slug: string,
): CanonicalEvent[] {
  return runCountryEngine(items, slug).included;
}

// §23 — location precisions that carry a credible, plottable point.
const PLOTTABLE_PRECISIONS: ReadonlySet<LocationPrecision> = new Set<LocationPrecision>([
  "Exact site",
  "Town or city",
  "District",
  "Province or state",
]);

/**
 * §23 / §33 MAP — the map points for a set of INCLUDED canonical events. Only
 * events with a credible precision (Exact site / Town or city / District /
 * Province or state) AND real coordinates are plotted; Unknown, Country-only,
 * foreign and excluded/held rows never produce a point.
 */
export function toMapPoints(included: CanonicalEvent[]): MapPoint[] {
  const points: MapPoint[] = [];
  for (const e of included) {
    if (!PLOTTABLE_PRECISIONS.has(e.locationPrecision)) continue;
    if (
      typeof e.latitude !== "number" ||
      typeof e.longitude !== "number" ||
      Number.isNaN(e.latitude) ||
      Number.isNaN(e.longitude)
    ) {
      continue;
    }
    points.push({
      eventId: e.eventId,
      lat: e.latitude,
      lng: e.longitude,
      precision: e.locationPrecision,
    });
  }
  return points;
}
