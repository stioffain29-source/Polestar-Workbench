// Single source of truth for the "true" (scoped, noise-filtered) incident set
// of any topic. The dashboard cards, the generic Topic monitor page and the
// reports all run their counts through this so every surface tallies to the
// same figure — no more raw-count vs report-count divergence.
//
// Per-topic selection mirrors EXACTLY what each topic page treats as a real
// event, so the dashboard card and the page can never diverge:
//   shipping     → in-scope region → drop low-credibility noise → collapse
//                  syndication via dedupeShippingMonitorRows (the Shipping
//                  page's exact pipeline; this is a list-level transform, not
//                  a per-record predicate)
//   cargo_watch  → cargo scope classifier (APAC/ME cargo crime only)
//   flashpoint   → topic relevance gate, then collapse syndicated rewrites of
//                  the same event with the report builder's exact title+
//                  signature dedup, so the monitor and the dashboard card both
//                  count DISTINCT events, not the number of outlets that re-ran
//                  the same wire (the report's deeper window-bound kinetic/court
//                  dedup is separate and stays in the report builder)
//   everything   → topic relevance gate (fuel / energy / fertiliser)
import { parseISO } from "date-fns";
import { isTopicRelevant } from "./topicRelevance";
import { dedupeByTitle } from "./flashpointReportDataset";
import {
  classifyRegion as classifyShippingRegion,
  isLowCredibilityShippingRecord,
} from "./shippingAnalysis";
import { deriveIncidentCountry } from "./shippingCountry";
import { dedupeShippingMonitorRows } from "./shippingReportDataset";
import { isCargoInScope } from "./cargoAnalysis";

export interface TrueIncidentLike {
  topic: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  country?: string | null;
}

function relevanceInput(i: TrueIncidentLike) {
  return {
    topic: i.topic,
    title: i.title,
    summary: i.summary ?? null,
    source: i.source ?? null,
    sourceUrl: i.sourceUrl ?? null,
    location: i.location ?? i.country ?? null,
  };
}

/**
 * True when a single record is a real, in-scope event for the given topic.
 * NOTE: for shipping this is the per-record part of the pipeline only (region
 * scope + drop low-credibility noise). Syndication dedup is a list-level
 * transform and lives in `resolveTrueIncidents`, so always prefer that for
 * counts — `isTrueIncident("shipping", …)` will over-count syndicated wires.
 */
export function isTrueIncident(topic: string, i: TrueIncidentLike): boolean {
  switch (topic) {
    case "shipping": {
      const country = deriveIncidentCountry(i);
      if (classifyShippingRegion(country) === "Out of scope") return false;
      return !isLowCredibilityShippingRecord(i);
    }
    case "cargo_watch":
      return isCargoInScope(i);
    case "flashpoint":
    case "protests":
      return isTopicRelevant("flashpoint", relevanceInput(i));
    default:
      return isTopicRelevant(topic, relevanceInput(i));
  }
}

// Reproduces the Shipping monitor page's exact base-list pipeline
// (Shipping.tsx: scope to APAC + ME → drop isLowCredibilityShippingRecord →
// dedupeShippingMonitorRows) so the dashboard card and the page can never
// disagree. The original `occurredAt`/`severity` fields are preserved on the
// returned rows, so downstream windowing and severity counts still work.
function resolveShippingTrue<T extends TrueIncidentLike>(incidents: T[]): T[] {
  const enriched = incidents.map((i) => {
    const rec = i as TrueIncidentLike & {
      occurredAt?: string | null;
      severity?: string | null;
    };
    let occurredDate: Date;
    try {
      occurredDate = rec.occurredAt ? parseISO(rec.occurredAt) : new Date(NaN);
    } catch {
      occurredDate = new Date(NaN);
    }
    return { ...i, occurredDate, severity: rec.severity ?? "" };
  });
  const scoped = enriched.filter(
    (i) =>
      classifyShippingRegion(deriveIncidentCountry(i)) !== "Out of scope" &&
      !isLowCredibilityShippingRecord(i),
  );
  return dedupeShippingMonitorRows(scoped) as unknown as T[];
}

// Flashpoint/protests: relevance gate THEN collapse syndicated rewrites of the
// same event using the report builder's exact two-pass title+signature dedup,
// so the monitor and the dashboard card both count DISTINCT events, not the
// number of outlets that re-ran the same wire. The dedup keeps the best row
// (highest severity, then newest), mirroring the Shipping list-level transform.
function resolveFlashpointTrue<T extends TrueIncidentLike>(incidents: T[]): T[] {
  const relevant = incidents.filter((i) => isTrueIncident("flashpoint", i));
  const enriched = relevant.map((i) => {
    const rec = i as TrueIncidentLike & {
      occurredAt?: string | null;
      severity?: string | null;
    };
    let date: Date;
    try {
      date = rec.occurredAt ? parseISO(rec.occurredAt) : new Date(NaN);
    } catch {
      date = new Date(NaN);
    }
    return { ...i, date, severity: rec.severity ?? "" };
  });
  return dedupeByTitle(enriched) as unknown as T[];
}

/** Filter a list down to the topic's true, in-scope events. */
export function resolveTrueIncidents<T extends TrueIncidentLike>(
  topic: string,
  incidents: T[],
): T[] {
  if (topic === "shipping") return resolveShippingTrue(incidents);
  if (topic === "flashpoint" || topic === "protests") return resolveFlashpointTrue(incidents);
  return incidents.filter((i) => isTrueIncident(topic, i));
}
