// Cargo Watch pattern-report model.
//
// ONE reconciliation source for the redesigned Cargo Watch report. Everything
// the preview and the PDF render — Fast Facts, country map, weekly trend,
// supply-chain exposure, pattern dashboard, timeline, priority matrix and the
// condensed appendix — is derived HERE from a single deduplicated set of unique
// incidents (the cluster primaries). Because every surface counts the same
// deduped set, the totals reconcile by construction (spec "DEDUPLICATION
// REQUIREMENTS").
//
// No fabrication: fields are left blank when a value is not reported, and the
// consequence score uses only the documented weights in cargoPatternConfig.

import {
  classifyCargoCategory,
  parseUsdLoss,
  cargoCountry,
  type CargoIncidentLike,
} from "./cargoAnalysis";
import {
  buildCargoGroupedDataset,
  type CargoClusterInput,
  type CargoIncidentCluster,
} from "./cargoGroupedDataset";
import {
  buildCargoReportExtras,
  type CargoReportExtras,
} from "./cargoReportData";
import { buildCargoCountryIntensity } from "./cargoReportChoropleth";
import type { CargoCountryIntensity } from "./cargoChoropleth";
import {
  computeTopicFastFacts,
  filterTopicReportIncidents,
  type TopicFastFactCard,
  type TopicFastFactsIncident,
} from "./topicFastFacts";
import { SEV_RANK, SEV_LABEL, sevKey } from "./pdfChrome";
import { stripWireCruft } from "./incidentTitle";
import {
  STAGE_ORDER,
  STAGE_META,
  stageForCategory,
  laneForStage,
  TIMELINE_LANE_ORDER,
  TIMELINE_LANE_LABEL,
  type CargoStageKey,
  type CargoLaneKey,
  SEVERITY_WEIGHT,
  USD_HIGH_MIN,
  USD_MID_MIN,
  USD_HIGH_BONUS,
  USD_MID_BONUS,
  VIOLENCE_BONUS,
  ORG_INSIDER_BONUS,
  REPEAT_BONUS,
  BUSINESS_INTERRUPTION_BONUS,
  MAX_RAW_SCORE,
  VIOLENCE_RE,
  ORG_CRIME_RE,
  INSIDER_RE,
  BUSINESS_INTERRUPTION_RE,
  CONSEQUENCE_HIGH_MIN,
  MATRIX_MIN_INCIDENTS,
  MATRIX_MIN_PATTERNS,
  MATRIX_MAX_POINTS,
  MIN_PATTERN_INCIDENTS,
  PATTERN_SEVERITY_FLOOR,
  MAX_PATTERN_CARDS,
} from "./cargoPatternConfig";

// --- Output shapes --------------------------------------------------------

export interface CargoStageSummary {
  key: CargoStageKey;
  label: string;
  count: number;
  sharePct: number; // 0..100, rounded
  highestSeverityKey: string | null;
  highestSeverityLabel: string; // "—" when the stage is empty
  mainCountry: string | null; // null -> "Not attributed" at render time
  primaryConcern: string;
}

export interface CargoPatternCard {
  id: string;
  name: string; // taxonomy category label
  stageKey: CargoStageKey;
  count: number;
  sharePct: number;
  primaryGeography: string | null;
  highestSeverityKey: string;
  highestSeverityLabel: string;
  operationalConcern: string;
  controlAffected: string[];
  watchNext: string;
  frequency: number; // == count
  consequenceMean: number; // 0..1
  significance: number; // total consequence weight, for ranking
}

export interface CargoTimelineMarker {
  id: string;
  laneKey: CargoLaneKey;
  date: string; // ISO occurredAt
  shortLocation: string; // "" when none
  category: string;
  severityKey: string;
}

export interface CargoTimelineLane {
  key: CargoLaneKey;
  label: string;
  markers: CargoTimelineMarker[];
}

export interface CargoTimeline {
  lanes: CargoTimelineLane[];
  start: string | null;
  end: string | null;
  total: number;
}

export type CargoQuadrant =
  | "Monitor"
  | "Emerging Concern"
  | "Persistent Exposure"
  | "Priority Action";

export interface CargoMatrixPoint {
  id: string;
  name: string;
  frequency: number; // unique incident count
  consequence: number; // 0..1
  quadrant: CargoQuadrant;
}

export interface CargoMatrix {
  sufficient: boolean;
  points: CargoMatrixPoint[];
  freqThreshold: number;
  consequenceThreshold: number;
}

export interface CargoAppendixRow {
  id: string;
  date: string; // ISO occurredAt
  location: string; // "" when not reported
  category: string;
  summary: string; // one sentence, cleaned
  severityLabel: string;
  severityKey: string;
  confidence: string; // "" unless analytically relevant ("Unconfirmed")
}

export interface CargoAssessment {
  situation: string;
  whatMatters: string[]; // up to 3
  businessPriorities: string[]; // up to 5, each tied to a pattern
  watchNext: string[]; // up to 6
  polestarView: string;
}

export interface CargoPatternModel {
  totalUnique: number;
  isEmpty: boolean;
  clusters: CargoIncidentCluster[];
  primaries: CargoClusterInput[];
  fastFacts: TopicFastFactCard[];
  extras: CargoReportExtras;
  intensity: Map<string, CargoCountryIntensity>;
  mapCaption: string;
  trendCaption: string;
  stages: CargoStageSummary[];
  patterns: CargoPatternCard[]; // <= MAX_PATTERN_CARDS dashboard cards
  timeline: CargoTimeline;
  matrix: CargoMatrix;
  appendix: CargoAppendixRow[];
  assessment: CargoAssessment;
}

export interface CargoPatternModelInput extends CargoClusterInput {
  id?: string | number;
}

export interface CargoPatternModelOptions {
  issueDate: string;
  topicLabel?: string;
}

// --- Helpers --------------------------------------------------------------

function toIncidentLike(p: CargoClusterInput): CargoIncidentLike {
  return {
    title: p.title,
    summary: p.summary ?? null,
    source: p.source ?? null,
    location: p.location ?? null,
    country: p.country ?? null,
    analystInScope: p.analystInScope ?? null,
  };
}

function primaryText(p: CargoClusterInput): string {
  return `${p.title} ${p.summary ?? ""}`;
}

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  // Split on the first sentence-ending punctuation followed by a space/end.
  const m = t.match(/^(.*?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  // Guard against an over-long single "sentence" (a headline with no stop).
  return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s;
}

// Short display location — the incident location without a trailing country
// echo. Empty string when nothing usable is reported (renderers leave it blank
// rather than printing "Location not reported").
function shortLocation(p: CargoClusterInput): string {
  const loc = (p.location ?? "").trim();
  if (loc) return loc;
  return "";
}

function severityKeyOf(p: CargoClusterInput): string {
  return sevKey(p.severity ?? null);
}

function severityRankOf(p: CargoClusterInput): number {
  return SEV_RANK[severityKeyOf(p)] ?? 0;
}

function highestSeverity(primaries: CargoClusterInput[]): {
  key: string | null;
  label: string;
} {
  let key: string | null = null;
  let rank = 0;
  for (const p of primaries) {
    const r = severityRankOf(p);
    if (r > rank) {
      rank = r;
      key = severityKeyOf(p);
    }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

function topCountry(primaries: CargoClusterInput[]): string | null {
  const counts = new Map<string, number>();
  for (const p of primaries) {
    const c = cargoCountry(toIncidentLike(p));
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

// Per-cluster raw operational-consequence score (documented weights in
// cargoPatternConfig). `repeatKeys` carries the country/port values that recur
// across the whole deduped set, so a cluster on a repeat route/facility earns
// the repeat bonus.
function rawConsequence(
  p: CargoClusterInput,
  repeatCountries: Set<string>,
): number {
  const text = primaryText(p);
  let score = severityRankOf(p) * SEVERITY_WEIGHT;

  const usd = parseUsdLoss(toIncidentLike(p));
  if (usd != null) {
    if (usd >= USD_HIGH_MIN) score += USD_HIGH_BONUS;
    else if (usd >= USD_MID_MIN) score += USD_MID_BONUS;
  }

  if (VIOLENCE_RE.test(text)) score += VIOLENCE_BONUS;
  if (ORG_CRIME_RE.test(text) || INSIDER_RE.test(text)) score += ORG_INSIDER_BONUS;
  if (BUSINESS_INTERRUPTION_RE.test(text)) score += BUSINESS_INTERRUPTION_BONUS;

  const c = cargoCountry(toIncidentLike(p));
  if (c && repeatCountries.has(c)) score += REPEAT_BONUS;

  return score;
}

function normalisedConsequence(
  p: CargoClusterInput,
  repeatCountries: Set<string>,
): number {
  return rawConsequence(p, repeatCountries) / MAX_RAW_SCORE;
}

// --- Model builder --------------------------------------------------------

export function buildCargoPatternModel(
  incidents: CargoPatternModelInput[],
  opts: CargoPatternModelOptions,
): CargoPatternModel {
  const { issueDate } = opts;
  const topicLabel = opts.topicLabel ?? "Cargo Watch";

  // 0. Apply the SAME window + cargo-scope gate the Fast Facts card uses, up
  //    front. This makes reconciliation a property of the model itself: the
  //    cluster primaries are drawn only from this gated set, so re-running the
  //    gate inside computeTopicFastFacts is idempotent and the "Total Records"
  //    card can never disagree with the cluster count. (Production callers pass
  //    an already-in-scope set, so this is a no-op there.)
  const prepared = incidents.map((i) => ({
    ...i,
    topic: i.topic ?? "cargo_watch",
    severity: i.severity ?? "",
    occurredAt: i.occurredAt,
  })) as (CargoPatternModelInput & TopicFastFactsIncident)[];
  const windowed = filterTopicReportIncidents(prepared, "cargo_watch", issueDate);

  // 1. Cluster the gated set into unique incidents. `clusters` is the FULL,
  //    uncapped, deduplicated set; its `primary` records are the single
  //    reconciliation source every surface below counts.
  const dataset = buildCargoGroupedDataset(windowed, {
    referenceDate: issueDate,
  });
  const clusters = dataset.clusters;
  const primaries: CargoClusterInput[] = clusters.map((c) => c.primary);
  const totalUnique = primaries.length;
  const isEmpty = totalUnique === 0;

  // 2. Fast Facts, extras (USD/commodity/trend) and country intensity — all fed
  //    the SAME deduped primaries, so "Total Records", the map and the trend
  //    reconcile with the cluster count.
  const fastFacts: TopicFastFactCard[] = computeTopicFastFacts({
    topic: "cargo_watch",
    issueDate,
    incidents: primaries as unknown as TopicFastFactsIncident[],
    topicLabel,
  });

  const choroInput = primaries.map((p) => ({
    title: p.title,
    summary: p.summary ?? null,
    source: p.source ?? null,
    location: p.location ?? null,
    country: p.country ?? null,
    occurredAt: p.occurredAt,
  }));
  const extras = buildCargoReportExtras(choroInput);
  const intensity = buildCargoCountryIntensity(choroInput);

  // 3. Repeat-route/facility signal for the consequence score: any country that
  //    appears on two or more unique incidents in the period.
  const countryFreq = new Map<string, number>();
  for (const p of primaries) {
    const c = cargoCountry(toIncidentLike(p));
    if (c) countryFreq.set(c, (countryFreq.get(c) ?? 0) + 1);
  }
  const repeatCountries = new Set(
    [...countryFreq.entries()].filter(([, n]) => n >= 2).map(([c]) => c),
  );

  // 4. Attach derived fields to each cluster primary once.
  interface Derived {
    cluster: CargoIncidentCluster;
    primary: CargoClusterInput;
    category: string;
    stage: CargoStageKey;
    lane: CargoLaneKey;
    sevKey: string;
    sevRank: number;
    consequence: number; // normalised 0..1
  }
  const derived: Derived[] = clusters.map((cl) => {
    const p = cl.primary;
    const category = classifyCargoCategory(toIncidentLike(p));
    const stage = stageForCategory(category);
    return {
      cluster: cl,
      primary: p,
      category,
      stage,
      lane: laneForStage(stage),
      sevKey: severityKeyOf(p),
      sevRank: severityRankOf(p),
      consequence: normalisedConsequence(p, repeatCountries),
    };
  });

  // 5. Supply-chain exposure — one summary per stage, in fixed order.
  const stages: CargoStageSummary[] = STAGE_ORDER.map((key) => {
    const members = derived.filter((d) => d.stage === key);
    const meta = STAGE_META[key];
    const hs = highestSeverity(members.map((m) => m.primary));
    return {
      key,
      label: meta.label,
      count: members.length,
      sharePct:
        totalUnique > 0
          ? Math.round((members.length / totalUnique) * 100)
          : 0,
      highestSeverityKey: hs.key,
      highestSeverityLabel: hs.label,
      mainCountry: topCountry(members.map((m) => m.primary)),
      primaryConcern: meta.primaryConcern,
    };
  });

  // 6. Pattern groups — grouped by taxonomy CATEGORY (finer than stage, so the
  //    dashboard is distinct from the supply-chain graphic). Each group's
  //    consequence is the mean normalised score of its members; significance is
  //    the total consequence weight (frequency x mean) for ranking.
  const byCategory = new Map<string, Derived[]>();
  for (const d of derived) {
    const arr = byCategory.get(d.category) ?? [];
    arr.push(d);
    byCategory.set(d.category, arr);
  }
  const allPatterns: CargoPatternCard[] = [...byCategory.entries()].map(
    ([category, members]) => {
      const stage = members[0].stage;
      const meta = STAGE_META[stage];
      const hs = highestSeverity(members.map((m) => m.primary));
      const consequenceMean =
        members.reduce((s, m) => s + m.consequence, 0) / members.length;
      const geo = topCountry(members.map((m) => m.primary));
      return {
        id: `pattern-${stage}-${category}`.replace(/\s+/g, "-").toLowerCase(),
        name: category,
        stageKey: stage,
        count: members.length,
        sharePct:
          totalUnique > 0
            ? Math.round((members.length / totalUnique) * 100)
            : 0,
        primaryGeography: geo,
        highestSeverityKey: hs.key ?? "low",
        highestSeverityLabel: hs.label,
        operationalConcern: meta.primaryConcern,
        controlAffected: meta.controlAffected,
        watchNext: geo
          ? `${meta.watchNext} Focus: ${geo}.`
          : meta.watchNext,
        frequency: members.length,
        consequenceMean,
        significance: consequenceMean * members.length,
      };
    },
  );

  // Dashboard cards: only meaningful patterns (>= MIN_PATTERN_INCIDENTS OR a
  // High/Extreme severity floor), top MAX_PATTERN_CARDS by significance. Never
  // pad with weak categories.
  const patterns = allPatterns
    .filter(
      (p) =>
        p.count >= MIN_PATTERN_INCIDENTS ||
        (SEV_RANK[p.highestSeverityKey] ?? 0) >= PATTERN_SEVERITY_FLOOR,
    )
    .sort((a, b) => b.significance - a.significance)
    .slice(0, MAX_PATTERN_CARDS);

  // 7. Timeline — five category lanes, staging-yard folded into inland
  //    transport. One marker per unique incident (reconciles with the total).
  const timelineDates = primaries
    .map((p) => p.occurredAt)
    .filter((d): d is string => !!d)
    .sort();
  const lanes: CargoTimelineLane[] = TIMELINE_LANE_ORDER.map((key) => {
    const markers = derived
      .filter((d) => d.lane === key)
      .map((d) => ({
        id: String(d.primary.id ?? d.cluster.id),
        laneKey: key,
        date: d.primary.occurredAt,
        shortLocation: shortLocation(d.primary),
        category: d.category,
        severityKey: d.sevKey,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { key, label: TIMELINE_LANE_LABEL[key], markers };
  });
  const timeline: CargoTimeline = {
    lanes,
    start: timelineDates[0] ?? null,
    end: timelineDates[timelineDates.length - 1] ?? null,
    total: totalUnique,
  };

  // 8. Priority matrix — plot pattern GROUPS (not individual incidents). High
  //    frequency uses the mean pattern frequency (>= 2); high consequence uses
  //    the documented CONSEQUENCE_HIGH_MIN mid-point.
  const distinctPatterns = allPatterns.length;
  const meanFrequency =
    distinctPatterns > 0 ? totalUnique / distinctPatterns : 0;
  const freqThreshold = Math.max(2, Math.round(meanFrequency));
  const matrixSufficient =
    totalUnique >= MATRIX_MIN_INCIDENTS &&
    distinctPatterns >= MATRIX_MIN_PATTERNS;
  const matrixPoints: CargoMatrixPoint[] = allPatterns
    .slice()
    .sort((a, b) => b.significance - a.significance)
    .slice(0, MATRIX_MAX_POINTS)
    .map((p) => {
      const freqHigh = p.frequency >= freqThreshold;
      const consHigh = p.consequenceMean >= CONSEQUENCE_HIGH_MIN;
      const quadrant: CargoQuadrant = freqHigh
        ? consHigh
          ? "Priority Action"
          : "Persistent Exposure"
        : consHigh
          ? "Emerging Concern"
          : "Monitor";
      return {
        id: p.id,
        name: p.name,
        frequency: p.frequency,
        consequence: p.consequenceMean,
        quadrant,
      };
    });
  const matrix: CargoMatrix = {
    sufficient: matrixSufficient,
    points: matrixPoints,
    freqThreshold,
    consequenceThreshold: CONSEQUENCE_HIGH_MIN,
  };

  // 9. Condensed appendix — one row per unique incident, one cleaned sentence.
  //    Missing fields are left blank (no repeated "not reported"). Confidence
  //    is only surfaced when it is "Low" (rendered "Unconfirmed"), otherwise
  //    left blank to avoid clutter.
  const appendix: CargoAppendixRow[] = derived
    .slice()
    .sort((a, b) => b.primary.occurredAt.localeCompare(a.primary.occurredAt))
    .map((d) => {
      const conf = d.cluster.enrichment.confidence;
      return {
        id: String(d.primary.id ?? d.cluster.id),
        date: d.primary.occurredAt,
        location: shortLocation(d.primary),
        category: d.category,
        summary: firstSentence(
          stripWireCruft(d.primary.title) || d.primary.title,
        ),
        severityLabel: SEV_LABEL[d.sevKey] ?? d.sevKey,
        severityKey: d.sevKey,
        confidence: conf === "Low" ? "Unconfirmed" : "",
      };
    });

  // 10. Data-derived captions (spec PAGE 2). No hardcoded names/dates.
  const mapCaption = buildMapCaption(intensity, totalUnique);
  const trendCaption = buildTrendCaption(extras, stages);

  // 11. Operational assessment defaults (editor overrides applied at render).
  const assessment = buildAssessment(
    primaries,
    patterns,
    stages,
    extras,
    totalUnique,
  );

  return {
    totalUnique,
    isEmpty,
    clusters,
    primaries,
    fastFacts,
    extras,
    intensity,
    mapCaption,
    trendCaption,
    stages,
    patterns,
    timeline,
    matrix,
    appendix,
    assessment,
  };
}

// --- Data-derived captions ------------------------------------------------

function buildMapCaption(
  intensity: Map<string, CargoCountryIntensity>,
  totalUnique: number,
): string {
  if (totalUnique === 0) return "";
  const entries = [...intensity.entries()].sort(
    (a, b) => (b[1].count ?? 0) - (a[1].count ?? 0),
  );
  if (entries.length === 0) {
    return "Insufficient location data for a meaningful geographic comparison.";
  }
  const [name, top] = entries[0];
  const share = totalUnique > 0 ? Math.round((top.count / totalUnique) * 100) : 0;
  if (entries.length === 1) {
    return `All located reporting this period sits in ${name}, which may partly reflect stronger local media coverage.`;
  }
  return `Reporting was concentrated in ${name} (${share}% of located incidents), although this may partly reflect stronger local media coverage.`;
}

function buildTrendCaption(
  extras: CargoReportExtras,
  stages: CargoStageSummary[],
): string {
  const trend = extras.trend;
  if (trend.length < 2) return "";
  const last = trend[trend.length - 1].count;
  const prev = trend[trend.length - 2].count;
  const leadStage = stages
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((s) => s.count > 0)[0];
  const driver = leadStage ? ` driven mainly by ${leadStage.label.toLowerCase()} incidents` : "";
  if (last > prev) {
    return `Activity increased during the final reporting week${driver}.`;
  }
  if (last < prev) {
    return `Activity eased during the final reporting week relative to the preceding week.`;
  }
  return `Activity held broadly steady across the closing weeks of the period.`;
}

// --- Assessment defaults --------------------------------------------------

function buildAssessment(
  primaries: CargoClusterInput[],
  patterns: CargoPatternCard[],
  stages: CargoStageSummary[],
  extras: CargoReportExtras,
  totalUnique: number,
): CargoAssessment {
  if (totalUnique === 0) {
    return {
      situation:
        "No qualifying cargo-security incidents were identified during the reporting period. Reporting remains limited and should be treated as indicative rather than comprehensive.",
      whatMatters: [],
      businessPriorities: [],
      watchNext: [],
      polestarView:
        "With no qualifying incidents this period, there is no basis for a change in the standing cargo-security posture.",
    };
  }

  const leadStage = stages
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((s) => s.count > 0)[0];
  const geo = topCountry(primaries);
  const geoPhrase = geo ? ` and concentrated in ${geo}` : "";
  const limited = totalUnique < 5;
  const limitNote = limited
    ? " Reporting remains limited and should be treated as indicative rather than comprehensive."
    : "";

  const situation = leadStage
    ? `Cargo exposure this period was led by ${leadStage.label.toLowerCase()} activity${geoPhrase}.${limitNote}`
    : `Cargo exposure this period is spread across the supply chain${geoPhrase}.${limitNote}`;

  const whatMatters: string[] = patterns.slice(0, 3).map((p) => {
    const where = p.primaryGeography ? ` centred on ${p.primaryGeography}` : "";
    return `${p.name}: ${p.count} unique incident${p.count === 1 ? "" : "s"}${where}, stressing ${p.operationalConcern.toLowerCase()}.`;
  });

  const businessPriorities: string[] = patterns.slice(0, 5).map((p) => {
    const controls = p.controlAffected.slice(0, 2).join(" and ").toLowerCase();
    return `Reinforce ${controls} against ${p.name.toLowerCase()}${p.primaryGeography ? ` in ${p.primaryGeography}` : ""}.`;
  });

  const watchNext: string[] = [];
  for (const p of patterns) {
    if (watchNext.length >= 6) break;
    if (!watchNext.includes(p.watchNext)) watchNext.push(p.watchNext);
  }

  const usd = extras.usd;
  const usdPhrase =
    usd.count > 0
      ? " Confirmed loss figures cover only a minority of records, so the true financial exposure is understated."
      : "";
  const polestarView = `The available reporting is consistent with ${leadStage ? `continued ${leadStage.label.toLowerCase()} exposure` : "diffuse cargo-security exposure"}${geo ? ` around ${geo}` : ""}, rather than a confirmed, coordinated campaign.${usdPhrase}`;

  return {
    situation,
    whatMatters,
    businessPriorities,
    watchNext,
    polestarView,
  };
}
