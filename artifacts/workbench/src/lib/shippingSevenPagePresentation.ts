/**
 * Renderer-neutral facts for the seven-page Shipping Watch product.
 *
 * The older publication tables intentionally avoid retelling an event that is
 * already shown on the Maritime Intelligence board.  That is useful for the
 * long-form editor, but it is the wrong projection for the compact seven-page
 * product: the timeline and closing register need the actual canonical rows.
 *
 * This module is therefore a deliberately small presentation boundary.  It
 * never admits, classifies, deduplicates or re-windows an incident.  It only
 * reads the final canonical set and the final board, and keeps both renderers
 * on the same set of source-backed facts.
 */

import {
  classifyPiracy,
  classifyVesselIncident,
  REGION_COLOR,
  semanticEventClass,
  type ChokepointKey,
  type Region,
} from "./shippingAnalysis";
import type {
  CanonicalIncident,
  ShippingReportDataset,
} from "./shippingReportDataset";
import {
  hasEvidenceBackedCommercialConsequence,
} from "./shippingReportDataset";
import type { ShippingCoverage } from "./shippingCoverage";
import {
  BOARD_CHOKEPOINTS,
  type LatestIncident,
  type MaritimeIntelligence,
  type MovementTheatre,
} from "./maritimeIntelligence";
import {
  formatMaritimeMovementSample,
  maritimeReportMovementTheatres,
} from "./maritimeReportView";

/**
 * The source fields consumed by this product. Keeping this structural rather
 * than importing ShippingPublicationBundle avoids a runtime cycle with the
 * publication finalizer.
 */
export interface ShippingSevenPagePublicationSource {
  dataset: Pick<ShippingReportDataset, "canonicalIncidents">;
  completeness: Pick<ShippingCoverage, "complete">;
  maritimeBoard: Pick<
    MaritimeIntelligence,
    | "windowStart"
    | "windowEnd"
    | "chokepointCards"
    | "movementSnapshot"
    | "confirmedIncidents"
  >;
  /** Cached summaries are optional; the register can still use source text. */
  incidentSummaries?: Record<string, string> | null;
}

export interface ShippingSevenPageRisk {
  /**
   * Null is intentional while the assessment is pending. Renderers must not
   * turn the internal neutral level 1 into a misleading "L1".
   */
  level: 1 | 2 | 3 | 4 | 5 | null;
  label: string;
  display: string;
  pending: boolean;
}

export interface ShippingSevenPageLatestIncident {
  id: number | string;
  title: string;
  date: Date;
  occurredAt: string;
  severity: string;
  type: string;
  physicalLocation: string | null;
  country: string | null;
  source: string | null;
  sourceUrl: string | null;
}

export interface ShippingSevenPageMatrixRow {
  key: ChokepointKey;
  incidents: number;
  risk: ShippingSevenPageRisk;
  movement: MovementTheatre | null;
  movementText: string;
  latestIncident: ShippingSevenPageLatestIncident | null;
  operationalRead: string;
}

export interface ShippingSevenPageTimelineItem {
  id: number | string;
  title: string;
  date: Date;
  occurredAt: string;
  physicalLocation: string | null;
  country: string | null;
  type: string;
  severity: string;
  severityLabel: string;
  source: string | null;
  sourceUrl: string | null;
  major: boolean;
}

export interface ShippingSevenPageCappedRows<T> {
  rows: T[];
  totalCount: number;
  shownCount: number;
  capped: boolean;
  /** Only populated when rows were capped. */
  countNote: string | null;
}

export interface ShippingSevenPageRegisterRow extends ShippingSevenPageTimelineItem {
  summary: string | null;
}

export interface ShippingSevenPageChartRow {
  label: string;
  value: number;
  color: string;
  /** True for a physical geography, false for the explicit residual row. */
  known: boolean;
}

export interface ShippingSevenPageGeographyChart {
  rows: ShippingSevenPageChartRow[];
  totalCount: number;
  knownCount: number;
  unknownCount: number;
}

export interface ShippingSevenPageCommercialEffect {
  id: number | string;
  title: string;
  status: "confirmed" | "assessed";
  /** Provider semantic kind, not a renderer-invented consequence category. */
  kind: string | null;
  claim: string | null;
  evidence: string | null;
  physicalLocation: string | null;
  source: string | null;
  sourceUrl: string | null;
}

export interface ShippingSevenPagePresentation {
  /** Exactly the seven board catalogue entries, including quiet routes. */
  matrix: ShippingSevenPageMatrixRow[];
  /** Main timeline: vessel events only. A piracy-only event is secondary. */
  timeline: ShippingSevenPageCappedRows<ShippingSevenPageTimelineItem>;
  /** Piracy rows which are not already represented in the main timeline. */
  piracySecondary: ShippingSevenPageCappedRows<ShippingSevenPageTimelineItem>;
  register: ShippingSevenPageCappedRows<ShippingSevenPageRegisterRow>;
  geography: {
    regions: ShippingSevenPageGeographyChart;
    countries: ShippingSevenPageGeographyChart;
  };
  commercialEffects: ShippingSevenPageCommercialEffect[];
  /** Canonical incident total used to audit all chart residuals. */
  canonicalIncidentCount: number;
}

/**
 * The page can fit twelve compact register rows without pushing the disclaimer
 * to an eighth page. This is a display cap only; canonicalIncidentCount and
 * the count note retain the full denominator. Current Shipping cycles commonly
 * contain eleven canonical incidents, so the full meaningful register remains
 * visible rather than being needlessly projected away.
 */
export const SHIPPING_SEVEN_PAGE_REGISTER_CAP = 12;
export const SHIPPING_SEVEN_PAGE_TIMELINE_CAP = 6;
export const SHIPPING_SEVEN_PAGE_PIRACY_CAP = 4;

const UNKNOWN_LABEL = "Unknown";
const UNKNOWN_COLOR = "#e2e2e2";
const COUNTRY_COLOR = "#465bff";

const SEVERITY_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

const SEVERITY_LABEL: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

const EVENT_CLASS_LABEL: Record<string, string> = {
  commercial_attack: "Commercial-vessel attack",
  commercial_seizure: "Commercial-vessel seizure",
  piracy_or_armed_robbery: "Piracy or armed robbery",
  collision_or_grounding: "Collision or grounding",
  port_disruption: "Port disruption",
  chokepoint_disruption: "Chokepoint disruption",
  route_disruption: "Route disruption",
  environmental_maritime_event: "Environmental maritime event",
  naval_activity: "Naval activity",
  military_naval_activity: "Military naval activity",
  drone_activity: "Drone activity",
  military_exercise: "Military exercise",
  geopolitical_maritime_development: "Geopolitical maritime development",
  protest_or_labour: "Maritime protest or labour disruption",
  other_maritime_event: "Maritime event",
  non_event: "Non-event",
};

type SemanticConsequence = {
  status?: string | null;
  kind?: string | null;
  claim?: string | null;
  description?: string | null;
  evidence?: string | null;
  evidenceQuote?: string | null;
};

type SevenPageSemantic = {
  eventClass?: string | null;
  routingConsequence?: SemanticConsequence | null;
  commercialConsequence?: SemanticConsequence | null;
};

function semantic(row: CanonicalIncident): SevenPageSemantic | null {
  const value = row.maritimeSemantic;
  return value && typeof value === "object" ? (value as SevenPageSemantic) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Movement providers do not always agree on whether "of"/"el" is included in
 * a theatre name ("Gulf Aden" vs "Gulf of Aden"). Removing connector words
 * makes the match resilient without introducing a second geography catalogue.
 */
function movementKey(value: unknown): string {
  return normalized(value)
    .split(" ")
    .filter((part) => part !== "of" && part !== "the" && part !== "el")
    .join("");
}

function withinWindow(
  theatre: MovementTheatre,
  start: Date,
  end: Date,
): boolean {
  const timestamp = Date.parse(theatre.dataAsOf);
  return Number.isFinite(timestamp) &&
    timestamp >= start.getTime() &&
    timestamp <= end.getTime();
}

function movementForKey(
  board: ShippingSevenPagePublicationSource["maritimeBoard"],
  key: ChokepointKey,
): MovementTheatre | null {
  const start = board.windowStart;
  const end = board.windowEnd;
  // This shared helper applies the report-end cutoff and latest-per-theatre
  // reduction. The lower bound is added here because a historical sample
  // before the report window is not "recent data" for this publication.
  const theatres = maritimeReportMovementTheatres(
    board as MaritimeIntelligence,
  ).filter((theatre) => withinWindow(theatre, start, end));
  const target = movementKey(key);
  return (
    theatres.find((theatre) =>
      [theatre.theatre, theatre.chokepoint].some((candidate) => {
        const value = movementKey(candidate);
        return Boolean(value && (value === target || value.includes(target) || target.includes(value)));
      }),
    ) ?? null
  );
}

function severityLabel(value: string): string {
  const key = text(value).toLowerCase();
  return SEVERITY_LABEL[key] ?? (text(value) || "Not assessed");
}

function eventType(row: CanonicalIncident, fallback?: string | null): string {
  const eventClass = text(semantic(row)?.eventClass);
  if (eventClass) {
    return EVENT_CLASS_LABEL[eventClass] ??
      eventClass.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  const vessel = classifyVesselIncident(row);
  if (vessel === "Seized") return "Commercial-vessel seizure";
  if (vessel === "Attack") return "Commercial-vessel attack";
  if (vessel) return `Commercial-vessel ${vessel.toLowerCase()}`;
  const piracy = classifyPiracy(row);
  if (piracy) return "Piracy or armed robbery";
  return text(fallback) || "Maritime event";
}

function latestFromRow(
  row: CanonicalIncident,
  fallback?: LatestIncident | null,
): ShippingSevenPageLatestIncident {
  const boardFallback = fallback?.id === row.id ? fallback : null;
  const occurredAt = text(row.occurredAt) || boardFallback?.occurredAt || row.date.toISOString();
  // Canonical projection is authoritative here. In particular, an explicit
  // null physicalLocation must remain unknown even if an older semantic blob
  // still contains a stale/default location string.
  const locationUnavailable =
    row.region === "Country not identified" &&
    !text(row.incidentCountry) &&
    !text(row.country);
  const physicalLocation = locationUnavailable
    ? null
    : text(row.physicalLocation) || text(row.location) || null;
  const country = text(row.incidentCountry) || text(row.country) || null;
  return {
    id: row.id,
    title: text(row.title) || boardFallback?.title || "Maritime incident",
    date: row.date,
    occurredAt,
    severity: text(row.severity) || boardFallback?.severity || "Not assessed",
    type: eventType(row, boardFallback?.category),
    physicalLocation,
    country,
    source: row.source ?? boardFallback?.source ?? null,
    sourceUrl: row.sourceUrl ?? boardFallback?.sourceUrl ?? null,
  };
}

function timelineItem(
  row: CanonicalIncident,
  fallback?: LatestIncident | null,
): ShippingSevenPageTimelineItem {
  const latest = latestFromRow(row, fallback);
  const key = latest.severity.toLowerCase();
  return {
    id: latest.id,
    title: latest.title,
    date: latest.date,
    occurredAt: latest.occurredAt,
    physicalLocation: latest.physicalLocation,
    country: latest.country,
    type: latest.type,
    severity: latest.severity,
    severityLabel: severityLabel(latest.severity),
    source: latest.source,
    sourceUrl: latest.sourceUrl,
    major: (SEVERITY_RANK[key] ?? 0) >= SEVERITY_RANK.high,
  };
}

function capRows<T>(rows: T[], cap: number): ShippingSevenPageCappedRows<T> {
  const shown = rows.slice(0, cap);
  const capped = rows.length > shown.length;
  return {
    rows: shown,
    totalCount: rows.length,
    shownCount: shown.length,
    capped,
    countNote: capped ? `Showing ${shown.length} of ${rows.length} incidents.` : null,
  };
}

function chart(
  rows: Array<{ label: string; value: number; color: string; known: boolean }>,
  totalCount: number,
): ShippingSevenPageGeographyChart {
  const unknownCount = rows.find((row) => !row.known)?.value ?? 0;
  const knownCount = rows
    .filter((row) => row.known)
    .reduce((sum, row) => sum + row.value, 0);
  return { rows, totalCount, knownCount, unknownCount };
}

function geographyCharts(
  canonical: CanonicalIncident[],
): ShippingSevenPagePresentation["geography"] {
  const regionCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  for (const row of canonical) {
    const region = text(row.region);
    const country = text(row.incidentCountry) || text(row.country) || null;
    if (region && region !== "Country not identified") {
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
    if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }
  const unknownRegion = canonical.length -
    [...regionCounts.values()].reduce((sum, count) => sum + count, 0);
  const unknownCountry = canonical.length -
    [...countryCounts.values()].reduce((sum, count) => sum + count, 0);

  const regions: ShippingSevenPageChartRow[] = [...regionCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({
      label,
      value,
      color: "#0b0a3d",
      known: true,
    }));
  regions.push({ label: UNKNOWN_LABEL, value: unknownRegion, color: UNKNOWN_COLOR, known: false });

  const countries: ShippingSevenPageChartRow[] = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value]) => ({
      label,
      value,
      color: COUNTRY_COLOR,
      known: true,
    }));
  countries.push({ label: UNKNOWN_LABEL, value: unknownCountry, color: UNKNOWN_COLOR, known: false });

  return {
    regions: chart(regions, canonical.length),
    countries: chart(countries, canonical.length),
  };
}

function commercialEffects(
  canonical: CanonicalIncident[],
): ShippingSevenPageCommercialEffect[] {
  const effects: ShippingSevenPageCommercialEffect[] = [];
  for (const row of canonical) {
    const evidence = semantic(row);
    if (!evidence) continue;
    const consequences = [
      evidence.routingConsequence,
      evidence.commercialConsequence,
    ];
    for (const consequence of consequences) {
      const selection = consequence === evidence.routingConsequence
        ? "routing"
        : "commercial";
      if (!hasEvidenceBackedCommercialConsequence(row, selection)) continue;
      const status = consequence?.status === "confirmed"
        ? "confirmed"
        : "assessed";
      effects.push({
        id: row.id,
        title: text(row.title) || "Maritime incident",
        status,
        kind: text(consequence?.kind) || null,
        claim: text(consequence?.claim) || null,
        evidence: text(consequence?.evidenceQuote) || null,
        physicalLocation: text(row.physicalLocation) || text(row.location) || null,
        source: row.source ?? null,
        sourceUrl: row.sourceUrl ?? null,
      });
    }
  }
  return effects;
}

function matrix(
  source: ShippingSevenPagePublicationSource,
  canonicalById: Map<string, CanonicalIncident>,
): ShippingSevenPageMatrixRow[] {
  const boardCards = new Map(
    source.maritimeBoard.chokepointCards.map((card) => [card.key, card]),
  );
  const pending =
    !source.completeness.complete;
  return BOARD_CHOKEPOINTS.map((key) => {
    const card = boardCards.get(key);
    const movement = movementForKey(source.maritimeBoard, key);
    const sourceRow = card?.lastConfirmed
      ? canonicalById.get(String(card.lastConfirmed.id))
      : null;
    const actualLatest = sourceRow
      ? latestFromRow(sourceRow, card?.lastConfirmed)
      : null;
    const cardRisk = card?.risk;
    const qualifiedPending = pending || !card || card.incidentCount === 0 && cardRisk?.label === "Not assessed";
    const risk: ShippingSevenPageRisk = qualifiedPending
      ? {
          level: null,
          label: pending ? "Assessment pending" : "Not assessed",
          display: pending ? "Assessment pending" : "Not assessed",
          pending: true,
        }
      : {
          level: cardRisk?.level ?? null,
          label: cardRisk?.label ?? "Not assessed",
          display: cardRisk?.level ? `L${cardRisk.level} · ${cardRisk.label}` : (cardRisk?.label ?? "Not assessed"),
          pending: false,
        };
    return {
      key,
      incidents: card?.incidentCount ?? 0,
      risk,
      movement,
      movementText: movement
        ? `${movement.dataAsOf} · ${formatMaritimeMovementSample(movement)}`
        : "No AIS sample in report window",
      latestIncident: actualLatest,
      operationalRead: card?.incidentCount
        ? (sourceRow && hasEvidenceBackedCommercialConsequence(sourceRow, "routing")
          ? semantic(sourceRow)?.routingConsequence?.claim || "No confirmed passage consequence established."
          : `${card.incidentCount} confirmed incident${card.incidentCount === 1 ? "" : "s"}; passage consequences are not established.`)
        : "No confirmed incident in the current window.",
    };
  });
}

/**
 * Build the shared facts consumed by the preview and PDF seven-page renderers.
 */
export function buildShippingSevenPagePresentation(
  source: ShippingSevenPagePublicationSource,
): ShippingSevenPagePresentation {
  const canonical = [...source.dataset.canonicalIncidents]
    .filter((row) => text(row.title))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const canonicalById = new Map(canonical.map((row) => [String(row.id), row]));
  const boardById = new Map(
    source.maritimeBoard.confirmedIncidents.map((incident) => [String(incident.id), incident]),
  );

  // A row that is both a vessel event and piracy is represented by the primary
  // vessel timeline only. Piracy-only records remain a secondary subsection,
  // so an incident can never be counted twice on page 4.
  const vesselRows = canonical.filter((row) => {
    const eventClass = text(semantic(row)?.eventClass);
    return (
      classifyVesselIncident(row) !== null ||
      eventClass === "commercial_attack" ||
      eventClass === "commercial_seizure"
    );
  });
  const vesselIds = new Set(vesselRows.map((row) => String(row.id)));
  const piracyRows = canonical.filter(
    (row) => {
      const eventClass = text(semantic(row)?.eventClass);
      return (
        (classifyPiracy(row) !== null || eventClass === "piracy_or_armed_robbery") &&
        !vesselIds.has(String(row.id))
      );
    },
  );
  const timeline = capRows(
    vesselRows.map((row) => timelineItem(row, boardById.get(String(row.id)))),
    SHIPPING_SEVEN_PAGE_TIMELINE_CAP,
  );
  const piracySecondary = capRows(
    piracyRows.map((row) => timelineItem(row, boardById.get(String(row.id)))),
    SHIPPING_SEVEN_PAGE_PIRACY_CAP,
  );

  const register = capRows(
    canonical.map((row) => ({
      ...timelineItem(row, boardById.get(String(row.id))),
      summary: text(source.incidentSummaries?.[String(row.id)]) || text(row.summary) || null,
    })),
    SHIPPING_SEVEN_PAGE_REGISTER_CAP,
  );

  return {
    matrix: matrix(source, canonicalById),
    timeline,
    piracySecondary,
    register,
    geography: geographyCharts(canonical),
    commercialEffects: commercialEffects(canonical),
    canonicalIncidentCount: canonical.length,
  };
}
