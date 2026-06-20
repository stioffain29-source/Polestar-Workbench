// Maritime Intelligence — the single deterministic dataset that powers BOTH
// the live Shipping monitor (pages/Shipping.tsx) and the Shipping Watch report
// (ShippingReportPreview.tsx + exportShippingReportPdf.ts). Building it here,
// once, guarantees the board and the report can never disagree.
//
// Core principle: vessel-MOVEMENT (AIS) data is CONTEXT, never an incident.
//   * No incident is ever derived from a movement row.
//   * Movement never inflates an incident count and never raises the risk LEVEL
//     on its own — it only ever appears as an indicator or as the movement
//     snapshot.
//   * When no movement rows exist the board degrades cleanly to
//     "movement data unavailable".

import { parseISO } from "date-fns";
import type { MaritimeMovement } from "@workspace/api-client-react";
import {
  classifyPiracy,
  classifyVesselIncident,
  isConfirmedOperationalIncident,
  isLowCredibilityShippingRecord,
  detectChokepoints,
  classifyRegion,
  type Region,
  type ChokepointKey,
  type MaritimeRecordLike,
} from "./shippingAnalysis";
import { dedupeShippingMonitorRows } from "./shippingReportDataset";
import { deriveIncidentCountry } from "./shippingCountry";

// ---------------------------------------------------------------------------
// Incident input + the 11-category maritime taxonomy
// ---------------------------------------------------------------------------

export interface MaritimeIncidentInput {
  id: number | string;
  title: string;
  severity: string;
  occurredAt: string;
  summary?: string | null;
  country?: string | null;
  location?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  topic?: string | null;
}

export type MaritimeIncidentCategory =
  | "Hijacking / seizure"
  | "Boarding"
  | "Explosion / projectile impact"
  | "Attack"
  | "Fired upon"
  | "Attempted attack"
  | "Suspicious approach"
  | "Piracy / armed robbery"
  | "Maritime protest / labour disruption"
  | "Port closure / disruption"
  | "Other confirmed maritime security event";

// Precedence order — most specific / most severe first. classifyMaritimeIncident
// returns the first match, so this array is also the canonical display order.
export const MARITIME_INCIDENT_CATEGORIES: MaritimeIncidentCategory[] = [
  "Hijacking / seizure",
  "Boarding",
  "Explosion / projectile impact",
  "Attack",
  "Fired upon",
  "Attempted attack",
  "Suspicious approach",
  "Piracy / armed robbery",
  "Maritime protest / labour disruption",
  "Port closure / disruption",
  "Other confirmed maritime security event",
];

// Categories that represent kinetic force against shipping. These drive the
// upper risk tiers.
const KINETIC_CATEGORIES = new Set<MaritimeIncidentCategory>([
  "Hijacking / seizure",
  "Explosion / projectile impact",
  "Attack",
  "Fired upon",
]);

const EXPLOSION_RE =
  /\b(explosion|explod\w*|blast|detonat\w*|limpet mine|mine (struck|hit|exploded|blast)|struck by (a |an )?(mine|projectile|missile|drone|torpedo)|projectile (hit|struck|impact|impacted)|ied)\b/i;
const FIRED_UPON_RE =
  /\b(fired (upon|at|on)|opened fire|shots fired|came under fire|gunfire (hit|struck|near|reported)|warning shots?)\b/i;
const ATTEMPTED_RE =
  /\b(attempted (attack|strike|hijack|boarding|seizure)|repel(led|s)?|interc(ept|epted|epts)|foiled|thwart(ed|s)?|near miss|narrowly (missed|avoided)|missile (fell|landed) near|drone (fell|landed) near)\b/i;
const ATTACK_RE =
  /\b(attack(ed|s)?|struck|hit by|set ablaze|ablaze|caught fire|on fire|targeted by .{0,30}(missile|drone|skiff|small craft))\b/i;
const PROTEST_LABOUR_RE =
  /\b((dock|port|stevedore)\s?workers?'? (strike|walkout|stoppage)|dockworkers?'? strike|labou?r (strike|stoppage|walkout|dispute|action)|union (strike|walkout|action)|port (workers? )?strike|protest at (the )?port|port protest|blockad(e|ed|ing) (the )?(port|terminal|berth))\b/i;
const PORT_DISRUPTION_RE =
  /\b(port (closed|closure|shut|shutdown|halted|suspended|congestion|disruption)|terminal (closed|shut|congestion|disruption)|berth (closed|closure|blocked|congestion)|canal (blocked|blockage|closed|congestion)|harbou?r (closure|disruption)|ran aground|aground|grounding|grounded|refloat\w*|salvag\w*|collision|collided|capsiz\w*|sank|sunk|sinking|wreck\w*|oil spill|vessel (stranded|adrift|disabled)|engine failure|breakdown)\b/i;

/**
 * Classify a record into one of the 11 maritime categories, or return null if
 * it is NOT a confirmed operational maritime incident. The confirmed-incident
 * gate runs first, so claims, threats, planning/intent, advisory posture,
 * commentary and movement context can never become an incident here.
 */
export function classifyMaritimeIncident(
  i: MaritimeRecordLike,
): MaritimeIncidentCategory | null {
  if (!isConfirmedOperationalIncident(i)) return null;
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  const piracy = classifyPiracy(i);
  const vessel = classifyVesselIncident(i);

  if (
    piracy === "Hijacking" ||
    vessel === "Seized" ||
    /\b(hijack(ed|ing)?|seiz(e|ed|ure)|commandeer\w*|vessel (taken|captured)|captured (the |a |an )?(ship|tanker|vessel|dhow|carrier))\b/i.test(
      text,
    )
  )
    return "Hijacking / seizure";

  if (piracy === "Boarding" || piracy === "Attempted boarding" || /\bboarded\b/i.test(text))
    return "Boarding";

  if (EXPLOSION_RE.test(text)) return "Explosion / projectile impact";

  if (vessel === "Attack" || ATTACK_RE.test(text)) return "Attack";

  if (FIRED_UPON_RE.test(text)) return "Fired upon";

  if (vessel === "Near miss" || ATTEMPTED_RE.test(text)) return "Attempted attack";

  if (
    piracy === "Suspicious approach" ||
    piracy === "Small craft approach" ||
    /\b(suspicious approach|small craft approach|approached by (a )?skiffs?|skiff (sighted|approach))\b/i.test(
      text,
    )
  )
    return "Suspicious approach";

  if (piracy) return "Piracy / armed robbery";

  if (PROTEST_LABOUR_RE.test(text)) return "Maritime protest / labour disruption";

  if (PORT_DISRUPTION_RE.test(text)) return "Port closure / disruption";

  return "Other confirmed maritime security event";
}

// ---------------------------------------------------------------------------
// Risk score (1-5) using the canonical five-tier risk vocabulary
// ---------------------------------------------------------------------------

export type MaritimeRiskLevel = 1 | 2 | 3 | 4 | 5;
export type Confidence = "low" | "medium" | "high";

// Canonical five-tier vocabulary (no substitution). Level 1 = Insignificant.
export const MARITIME_RISK_LABEL: Record<MaritimeRiskLevel, string> = {
  1: "Insignificant",
  2: "Low",
  3: "Moderate",
  4: "High",
  5: "Extreme",
};

// #A33232 (subdued red) is reserved for level 5 / Extreme only. Level 4 / High
// reads as burnt orange (#D35400), NOT red — red of any family is reserved for
// the Extreme tier per the brand rule (mirrors CARD_RATING_COLORS).
export const MARITIME_RISK_COLOR: Record<MaritimeRiskLevel, string> = {
  1: "#B8C2CC",
  2: "#6FB872",
  3: "#E67E22",
  4: "#D35400",
  5: "#A33232",
};

const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

export interface MaritimeRisk {
  level: MaritimeRiskLevel;
  label: string;
  rationale: string;
  confidence: Confidence;
}

interface ClassifiedIncident extends MaritimeIncidentInput {
  category: MaritimeIncidentCategory;
  occurredDate: Date;
  incidentCountry: string | null;
  region: Region;
  chokepoints: ChokepointKey[];
}

/**
 * Deterministic 1-5 maritime risk from the window's CONFIRMED incidents only.
 * Movement context never raises the level here.
 */
export function computeMaritimeRisk(confirmed: ClassifiedIncident[]): MaritimeRisk {
  if (confirmed.length === 0) {
    return {
      level: 1,
      label: MARITIME_RISK_LABEL[1],
      // A quiet window can be a reporting gap, so confidence is low by design.
      rationale: "No confirmed maritime security incidents in the window.",
      confidence: "low",
    };
  }

  const sevRank = confirmed.reduce(
    (m, r) => Math.max(m, SEV_RANK[(r.severity ?? "").toLowerCase()] ?? 0),
    0,
  );
  const kinetic = confirmed.filter((r) => KINETIC_CATEGORIES.has(r.category));
  const kineticCount = kinetic.length;
  const chokepointKinetic = kinetic.find((r) => r.chokepoints.length > 0) ?? null;
  const hasPiracyish = confirmed.some((r) =>
    (
      ["Boarding", "Attempted attack", "Suspicious approach", "Piracy / armed robbery"] as MaritimeIncidentCategory[]
    ).includes(r.category),
  );
  const hasDisruption = confirmed.some((r) =>
    (
      ["Maritime protest / labour disruption", "Port closure / disruption"] as MaritimeIncidentCategory[]
    ).includes(r.category),
  );

  let level: MaritimeRiskLevel;
  let rationale: string;
  if (chokepointKinetic || sevRank >= 5 || kineticCount >= 2) {
    level = 5;
    rationale = chokepointKinetic
      ? `Confirmed kinetic activity against shipping in the ${chokepointKinetic.chokepoints[0]}.`
      : kineticCount >= 2
        ? "Sustained kinetic activity against shipping this week."
        : "An incident rated Extreme sits in the window.";
  } else if (kineticCount >= 1 || sevRank >= 4) {
    level = 4;
    rationale =
      kineticCount >= 1
        ? "A confirmed kinetic attack on shipping this week."
        : "A High-severity maritime incident this week.";
  } else if (hasDisruption || hasPiracyish || sevRank >= 3) {
    level = 3;
    rationale = hasDisruption
      ? "Port or route disruption in effect."
      : hasPiracyish
        ? "Piracy or armed-robbery activity reported."
        : "Moderate maritime activity this week.";
  } else {
    level = 2;
    rationale = "Low-level maritime activity on file.";
  }

  const confidence: Confidence =
    confirmed.length >= 3 || sevRank >= 4 ? "high" : "medium";

  return { level, label: MARITIME_RISK_LABEL[level], rationale, confidence };
}

// ---------------------------------------------------------------------------
// Business impact — fixed enum, selected deterministically
// ---------------------------------------------------------------------------

export type BusinessImpact =
  | "No material impact"
  | "Crew vigilance advised"
  | "Transit delay risk"
  | "War-risk insurance premium pressure"
  | "Rerouting consideration"
  | "Port / berth disruption"
  | "Cargo delivery delay"
  | "Chartering / fixture caution"
  | "Severe route disruption";

// Fixed priority order so the impact list is always presented the same way.
const BUSINESS_IMPACT_ORDER: BusinessImpact[] = [
  "Severe route disruption",
  "War-risk insurance premium pressure",
  "Rerouting consideration",
  "Port / berth disruption",
  "Cargo delivery delay",
  "Chartering / fixture caution",
  "Transit delay risk",
  "Crew vigilance advised",
  "No material impact",
];

/**
 * Map the confirmed-incident picture to a deterministic set of fixed business
 * impacts. Returns ["No material impact"] when nothing is confirmed.
 */
export function deriveBusinessImpact(
  confirmed: ClassifiedIncident[],
): BusinessImpact[] {
  if (confirmed.length === 0) return ["No material impact"];
  const cats = new Set(confirmed.map((r) => r.category));
  const kineticChokepoint = confirmed.some(
    (r) => KINETIC_CATEGORIES.has(r.category) && r.chokepoints.length > 0,
  );
  const out = new Set<BusinessImpact>();

  if (kineticChokepoint) {
    out.add("Severe route disruption");
    out.add("War-risk insurance premium pressure");
    out.add("Rerouting consideration");
  }
  if (
    cats.has("Attack") ||
    cats.has("Explosion / projectile impact") ||
    cats.has("Fired upon") ||
    cats.has("Hijacking / seizure")
  ) {
    out.add("War-risk insurance premium pressure");
    out.add("Crew vigilance advised");
    out.add("Chartering / fixture caution");
  }
  if (
    cats.has("Boarding") ||
    cats.has("Attempted attack") ||
    cats.has("Suspicious approach") ||
    cats.has("Piracy / armed robbery")
  ) {
    out.add("Crew vigilance advised");
  }
  if (
    cats.has("Port closure / disruption") ||
    cats.has("Maritime protest / labour disruption")
  ) {
    out.add("Port / berth disruption");
    out.add("Cargo delivery delay");
    out.add("Transit delay risk");
  }
  if (out.size === 0) out.add("Transit delay risk");

  return BUSINESS_IMPACT_ORDER.filter((b) => out.has(b));
}

// ---------------------------------------------------------------------------
// Movement snapshot (CONTEXT) — built from the maritime_movement table
// ---------------------------------------------------------------------------

export interface MovementTheatre {
  theatre: string;
  chokepoint: string | null;
  dataAsOf: string;
  totalVessels: number | null;
  inboundCount: number | null;
  outboundCount: number | null;
  tankersCount: number | null;
  bulkCarriersCount: number | null;
  containerCount: number | null;
  lngLpgCount: number | null;
  anchoredOrWaitingCount: number | null;
  aisVisibleCount: number | null;
  aisDarkOrGapCount: number | null;
  changeVs7DayBaseline: string | null;
  confidence: string;
  sourceName: string;
  sourceUrl: string | null;
  notes: string | null;
}

export interface MovementSnapshot {
  theatres: MovementTheatre[];
  asOf: string | null;
  sourceName: string | null;
  confidence: Confidence | null;
}

const CONFIDENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/**
 * Summarise the latest movement rows into a snapshot, or null when there is no
 * movement data (the caller then shows "movement data unavailable").
 */
export function buildMovementSnapshot(
  rows: MaritimeMovement[] | null | undefined,
): MovementSnapshot | null {
  if (!rows || rows.length === 0) return null;
  const theatres: MovementTheatre[] = rows
    .map((r) => ({
      theatre: r.theatre,
      chokepoint: r.chokepoint ?? null,
      dataAsOf: r.dataAsOf,
      totalVessels: r.totalVessels ?? null,
      inboundCount: r.inboundCount ?? null,
      outboundCount: r.outboundCount ?? null,
      tankersCount: r.tankersCount ?? null,
      bulkCarriersCount: r.bulkCarriersCount ?? null,
      containerCount: r.containerCount ?? null,
      lngLpgCount: r.lngLpgCount ?? null,
      anchoredOrWaitingCount: r.anchoredOrWaitingCount ?? null,
      aisVisibleCount: r.aisVisibleCount ?? null,
      aisDarkOrGapCount: r.aisDarkOrGapCount ?? null,
      changeVs7DayBaseline: r.changeVs7DayBaseline ?? null,
      confidence: r.confidence,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl ?? null,
      notes: r.notes ?? null,
    }))
    .sort((a, b) => a.theatre.localeCompare(b.theatre));

  const asOf =
    theatres.reduce<string | null>((latest, t) => {
      if (!latest) return t.dataAsOf;
      return new Date(t.dataAsOf) > new Date(latest) ? t.dataAsOf : latest;
    }, null) ?? null;

  // Most conservative (lowest) confidence across theatres.
  let confidence: Confidence | null = null;
  for (const t of theatres) {
    const c = (t.confidence || "").toLowerCase();
    if (c !== "low" && c !== "medium" && c !== "high") continue;
    if (confidence === null || CONFIDENCE_RANK[c] < CONFIDENCE_RANK[confidence]) {
      confidence = c;
    }
  }

  const sourceName = theatres[0]?.sourceName ?? null;
  return { theatres, asOf, sourceName, confidence };
}

/**
 * One compact movement line for a theatre, shared by the board card, the
 * report preview AND the PDF so the three surfaces can never disagree. Each
 * fragment is omitted when the provider did not report it (null) — a missing
 * count never becomes a fabricated zero, and movement is CONTEXT only (it never
 * asserts an incident).
 */
export function formatMovementSummary(t: MovementTheatre): string {
  const parts: string[] = [];
  parts.push(t.totalVessels != null ? `${t.totalVessels} vessels tracked` : "Tracked");
  if (t.inboundCount != null && t.outboundCount != null) {
    parts.push(`${t.inboundCount} in / ${t.outboundCount} out`);
  }
  if (t.tankersCount != null) parts.push(`${t.tankersCount} tankers`);
  if (t.bulkCarriersCount != null) parts.push(`${t.bulkCarriersCount} bulk`);
  if (t.containerCount != null) parts.push(`${t.containerCount} container`);
  if (t.lngLpgCount != null) parts.push(`${t.lngLpgCount} LNG/LPG`);
  if (t.anchoredOrWaitingCount != null) parts.push(`${t.anchoredOrWaitingCount} anchored`);
  if (t.aisDarkOrGapCount != null) parts.push(`${t.aisDarkOrGapCount} AIS-dark`);
  if (t.changeVs7DayBaseline) parts.push(`${t.changeVs7DayBaseline} vs 7-day baseline`);
  return parts.join(" \u00b7 ");
}

// ---------------------------------------------------------------------------
// Incident snapshot
// ---------------------------------------------------------------------------

export interface CategoryTally {
  category: MaritimeIncidentCategory;
  count: number;
  highestSeverityKey: string;
}

export interface LatestIncident {
  id: number | string;
  title: string;
  category: MaritimeIncidentCategory;
  severity: string;
  occurredAt: string;
  chokepoint: ChokepointKey | null;
  country: string | null;
  source: string | null;
  sourceUrl: string | null;
}

export interface IncidentSnapshot {
  total: number;
  byCategory: CategoryTally[];
  latest: LatestIncident | null;
}

// ---------------------------------------------------------------------------
// Chokepoint cards
// ---------------------------------------------------------------------------

// The SIX chokepoints surfaced as cards on the board and in the report, in
// display order. Gulf of Oman and Arabian / Persian Gulf stay in the detection
// vocabulary (they enrich Hormuz context) but are not their own cards.
export const BOARD_CHOKEPOINTS: ChokepointKey[] = [
  "Strait of Hormuz",
  "Bab el-Mandeb",
  "Red Sea",
  "Gulf of Aden",
  "Singapore Strait",
  "Malacca Strait",
];

export interface ChokepointCard {
  key: ChokepointKey;
  risk: MaritimeRisk;
  /** Confirmed incidents tagged to this chokepoint in the window. */
  incidentCount: number;
  lastConfirmed: LatestIncident | null;
  /** Matched movement-context theatre, or null when no AIS data. */
  movement: MovementTheatre | null;
  businessImpact: BusinessImpact[];
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Source health
// ---------------------------------------------------------------------------

export interface MaritimeSourceHealth {
  incidentsAvailable: boolean;
  movementAvailable: boolean;
  movementAsOf: string | null;
  movementSource: string | null;
  movementConfidence: Confidence | null;
  note: string;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface MaritimeIntelligence {
  windowStart: Date;
  windowEnd: Date;
  bluf: string;
  risk: MaritimeRisk;
  movementSnapshot: MovementSnapshot | null;
  incidentSnapshot: IncidentSnapshot;
  /** The six spec chokepoints, each with its own risk / count / movement. */
  chokepointCards: ChokepointCard[];
  /** Number of board chokepoints with ≥1 confirmed incident in the window. */
  chokepointsAffected: number;
  /** Every confirmed incident in the window (drives the confirmed table). */
  confirmedIncidents: LatestIncident[];
  keyRiskIndicators: string[];
  businessImpact: BusinessImpact[];
  watchNext: string[];
  sourceHealth: MaritimeSourceHealth;
}

export interface BuildMaritimeIntelligenceArgs {
  incidents: MaritimeIncidentInput[];
  movement: MaritimeMovement[] | null | undefined;
  /** Days in the window; defaults to 7. Ignored when windowStart/End given. */
  windowDays?: number;
  /** End of window; defaults to now. */
  asOf?: Date;
  /** Explicit window (used by the report so it aligns to the report period). */
  windowStart?: Date;
  windowEnd?: Date;
}

function safeDate(iso: string): Date {
  try {
    return parseISO(iso);
  } catch {
    return new Date(NaN);
  }
}

function stripTrailingPublisher(title: string): string {
  // "Tanker struck in Gulf of Oman - Reuters" -> "Tanker struck in Gulf of Oman"
  return title.replace(/\s+[-–|]\s+[A-Z][^-–|]{1,40}$/u, "").trim() || title.trim();
}

function toLatestIncident(r: ClassifiedIncident): LatestIncident {
  return {
    id: r.id,
    title: stripTrailingPublisher(r.title),
    category: r.category,
    severity: r.severity,
    occurredAt: r.occurredAt,
    chokepoint: r.chokepoints[0] ?? null,
    country: r.incidentCountry,
    source: r.source ?? null,
    sourceUrl: r.sourceUrl ?? null,
  };
}

function impactSentence(impacts: BusinessImpact[]): string {
  const named = impacts.filter((b) => b !== "No material impact").slice(0, 2);
  if (named.length === 0) return "";
  const lower = named.map((b) => b.charAt(0).toLowerCase() + b.slice(1));
  const phrase =
    lower.length === 1 ? lower[0] : `${lower[0]} and ${lower[1]}`;
  return ` The main commercial exposure is ${phrase}.`;
}

/**
 * Build the one shared Maritime Intelligence board. Pure and deterministic.
 */
export function buildMaritimeIntelligence(
  args: BuildMaritimeIntelligenceArgs,
): MaritimeIntelligence {
  const { movement } = args;
  // Scope to shipping-topic incidents so the report (which is handed ALL topics)
  // and the live Shipping monitor (server-filtered to topic "shipping") build
  // from the EXACT same incident set. Without this the two surfaces could
  // diverge — maritime-looking rows from cargo/flashpoint/fuel/energy would
  // inflate the report's incident picture but not the monitor's.
  const incidents = args.incidents.filter((i) => i.topic === "shipping");
  const windowDays = args.windowDays ?? 7;
  const windowEnd = args.windowEnd ?? args.asOf ?? new Date();
  const windowStart =
    args.windowStart ??
    new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // 1. Scope (APAC + Middle East) + credibility screen + syndication dedupe —
  //    the exact same pipeline the Shipping monitor and report already use.
  const enriched = incidents.map((i) => {
    const incidentCountry = deriveIncidentCountry(i);
    return {
      ...i,
      incidentCountry,
      region: classifyRegion(incidentCountry),
      occurredDate: safeDate(i.occurredAt),
    };
  });
  const inScopeClean = enriched
    .filter((i) => i.region !== "Out of scope")
    .filter((i) => !isLowCredibilityShippingRecord(i));
  const deduped = dedupeShippingMonitorRows(inScopeClean);

  // 2. Window the deduped set.
  const windowRows = deduped.filter(
    (i) =>
      !isNaN(i.occurredDate.getTime()) &&
      i.occurredDate >= windowStart &&
      i.occurredDate <= windowEnd,
  );

  // 3. Keep ONLY confirmed operational incidents, each tagged with a category.
  //    classifyMaritimeIncident gates on isConfirmedOperationalIncident, so
  //    claims/threats/advisory posture/movement context are all excluded.
  const confirmed: ClassifiedIncident[] = windowRows
    .map((i) => {
      const category = classifyMaritimeIncident(i);
      if (!category) return null;
      return {
        ...i,
        category,
        chokepoints: detectChokepoints(i),
      } as ClassifiedIncident;
    })
    .filter((x): x is ClassifiedIncident => x !== null)
    .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());

  // 4. Incident snapshot.
  const tallyMap = new Map<MaritimeIncidentCategory, CategoryTally>();
  for (const r of confirmed) {
    const existing = tallyMap.get(r.category);
    const sevKey = (r.severity ?? "").toLowerCase();
    if (existing) {
      existing.count += 1;
      if ((SEV_RANK[sevKey] ?? 0) > (SEV_RANK[existing.highestSeverityKey] ?? 0)) {
        existing.highestSeverityKey = sevKey;
      }
    } else {
      tallyMap.set(r.category, {
        category: r.category,
        count: 1,
        highestSeverityKey: sevKey,
      });
    }
  }
  const byCategory = MARITIME_INCIDENT_CATEGORIES.filter((c) =>
    tallyMap.has(c),
  ).map((c) => tallyMap.get(c)!);

  const latestRow = confirmed[0] ?? null;
  const latest: LatestIncident | null = latestRow ? toLatestIncident(latestRow) : null;

  const incidentSnapshot: IncidentSnapshot = {
    total: confirmed.length,
    byCategory,
    latest,
  };

  // The full confirmed list (already date-sorted, newest first) drives the
  // confirmed-incidents table on the board and report.
  const confirmedIncidents: LatestIncident[] = confirmed.map(toLatestIncident);

  // 5. Risk + business impact (incident-driven only).
  const risk = computeMaritimeRisk(confirmed);
  const businessImpact = deriveBusinessImpact(confirmed);

  // 6. Movement snapshot (context).
  const movementSnapshot = buildMovementSnapshot(movement);

  // 6a. Per-chokepoint cards (the six spec chokepoints). Each card scores risk
  //     from its OWN confirmed subset and matches a movement theatre by name —
  //     movement is context only and never adds to the incident count.
  const matchChokepointMovement = (key: ChokepointKey): MovementTheatre | null => {
    if (!movementSnapshot) return null;
    const k = key.toLowerCase();
    return (
      movementSnapshot.theatres.find((t) => {
        const theatre = (t.theatre ?? "").toLowerCase();
        const cp = (t.chokepoint ?? "").toLowerCase();
        return (
          theatre.includes(k) ||
          k.includes(theatre) ||
          (cp && (cp.includes(k) || k.includes(cp)))
        );
      }) ?? null
    );
  };
  const chokepointCards: ChokepointCard[] = BOARD_CHOKEPOINTS.map((key) => {
    const subset = confirmed.filter((r) => r.chokepoints.includes(key));
    const cpRisk = computeMaritimeRisk(subset);
    return {
      key,
      risk: cpRisk,
      incidentCount: subset.length,
      lastConfirmed: subset[0] ? toLatestIncident(subset[0]) : null,
      movement: matchChokepointMovement(key),
      businessImpact: deriveBusinessImpact(subset),
      confidence: cpRisk.confidence,
    };
  });
  const chokepointsAffected = chokepointCards.filter((c) => c.incidentCount > 0).length;

  // 7. Key risk indicators — terse, no parenthetical counts. Incident-driven
  //    indicators first, then movement CONTEXT indicators (clearly framed as
  //    indicators, never as proof of intent).
  const keyRiskIndicators: string[] = [];
  const cats = new Set(confirmed.map((r) => r.category));
  const chokepointFreq = new Map<ChokepointKey, number>();
  for (const r of confirmed)
    for (const cp of r.chokepoints)
      chokepointFreq.set(cp, (chokepointFreq.get(cp) ?? 0) + 1);
  let topChokepoint: ChokepointKey | null = null;
  let topChokepointN = 0;
  for (const [cp, n] of chokepointFreq)
    if (n > topChokepointN) {
      topChokepointN = n;
      topChokepoint = cp;
    }

  if ([...cats].some((c) => KINETIC_CATEGORIES.has(c))) {
    keyRiskIndicators.push(
      topChokepoint
        ? `Confirmed kinetic activity against shipping in the ${topChokepoint}.`
        : "Confirmed kinetic activity against shipping this week.",
    );
  }
  if (topChokepoint) {
    keyRiskIndicators.push(`${topChokepoint} is the most-affected chokepoint this week.`);
  }
  if (
    cats.has("Piracy / armed robbery") ||
    cats.has("Boarding") ||
    cats.has("Suspicious approach")
  ) {
    keyRiskIndicators.push("Piracy or armed-robbery activity reported against vessels.");
  }
  if (
    cats.has("Port closure / disruption") ||
    cats.has("Maritime protest / labour disruption")
  ) {
    keyRiskIndicators.push("Port, terminal or labour disruption in effect.");
  }
  if (movementSnapshot) {
    const darkTheatre = movementSnapshot.theatres.find(
      (t) => (t.aisDarkOrGapCount ?? 0) > 0,
    );
    if (darkTheatre) {
      keyRiskIndicators.push(
        `AIS dark or gap reporting noted at ${darkTheatre.theatre} — an indicator only, not proof of intent.`,
      );
    }
    const surgeTheatre = movementSnapshot.theatres.find(
      (t) => (t.anchoredOrWaitingCount ?? 0) > 0 && /(up|rise|increase|surge|\+)/i.test(t.changeVs7DayBaseline ?? ""),
    );
    if (surgeTheatre) {
      keyRiskIndicators.push(
        `Elevated vessels anchored or waiting at ${surgeTheatre.theatre} versus the seven-day baseline.`,
      );
    }
  }
  if (keyRiskIndicators.length === 0) {
    keyRiskIndicators.push("No active maritime security indicators in the window.");
  }

  // 8. Watch next — terse forward-looking bullets.
  const watchNext: string[] = [];
  if (
    confirmed.some((r) => KINETIC_CATEGORIES.has(r.category) && r.chokepoints.length > 0)
  ) {
    watchNext.push(
      `Watch the ${topChokepoint ?? "affected chokepoint"} for follow-on attacks and insurer war-risk repricing.`,
    );
  } else if ([...cats].some((c) => KINETIC_CATEGORIES.has(c))) {
    watchNext.push("Watch for follow-on attacks and a possible advisory or escort response.");
  }
  if (cats.has("Port closure / disruption") || cats.has("Maritime protest / labour disruption")) {
    watchNext.push("Watch for port-closure escalation and cargo backlog.");
  }
  if (cats.has("Piracy / armed robbery") || cats.has("Boarding") || cats.has("Suspicious approach")) {
    watchNext.push("Watch high-risk anchorages for further boardings.");
  }
  if (!movementSnapshot) {
    watchNext.push("Confirm vessel movement with a licensed AIS provider — movement data unavailable.");
  }
  if (watchNext.length === 0) {
    watchNext.push("No active maritime security driver; monitor for new reporting.");
  }

  // 9. BLUF — bottom line up front.
  const bluf =
    risk.level === 1
      ? "Maritime risk is Insignificant. No confirmed maritime security incidents this week; routine vigilance only."
      : `Maritime risk is ${risk.label}. ${risk.rationale}${impactSentence(businessImpact)}`;

  // 10. Source health.
  const sourceHealth: MaritimeSourceHealth = {
    incidentsAvailable: deduped.length > 0,
    movementAvailable: movementSnapshot !== null,
    movementAsOf: movementSnapshot?.asOf ?? null,
    movementSource: movementSnapshot?.sourceName ?? null,
    movementConfidence: movementSnapshot?.confidence ?? null,
    note: movementSnapshot
      ? "Movement context from a licensed AIS provider. Movement is context, never an incident."
      : "Movement data unavailable. Incident picture is from news-feed reporting only.",
  };

  return {
    windowStart,
    windowEnd,
    bluf,
    risk,
    movementSnapshot,
    incidentSnapshot,
    chokepointCards,
    chokepointsAffected,
    confirmedIncidents,
    keyRiskIndicators,
    businessImpact,
    watchNext,
    sourceHealth,
  };
}
