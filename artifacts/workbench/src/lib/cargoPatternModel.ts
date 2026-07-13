// Cargo Watch pattern-report model.
//
// ONE reconciliation source for the redesigned Cargo Watch report. Everything
// the preview and the PDF render — Fast Facts, country map, weekly trend,
// supply-chain exposure, pattern dashboard, weekly activity matrix, priority
// matrix and the condensed appendix — is derived HERE from a single
// deduplicated set of unique
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
  WEEKLY_PATTERN_ROW_LABEL,
  ACTIVITY_MATRIX_MIN_INCIDENTS,
  ACTIVITY_MATRIX_MAX_WEEKS,
  type CargoStageKey,
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
import { parseISO, isValid, startOfWeek, addWeeks, format } from "date-fns";

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

export interface CargoActivityWeek {
  key: string; // Monday week-start, yyyy-MM-dd
  label: string; // "06 Jun"
}

export interface CargoActivityRow {
  stageKey: CargoStageKey;
  label: string;
  weekCounts: number[]; // aligned to CargoActivityMatrix.weeks
  unconfirmed: number; // incidents in this row with no usable date
  total: number; // weekCounts sum + unconfirmed
}

export interface CargoActivitySparseItem {
  id: string;
  date: string; // ISO occurredAt, "" when none
  dateLabel: string; // "06 Jun" or "Date unconfirmed"
  pattern: string; // stage row label
  location: string; // "" when none
  severityKey: string;
  severityLabel: string;
}

// Weekly Activity by Pattern — a frequency matrix of unique incidents across
// supply-chain stages (rows) and reporting weeks (columns). Every unique
// incident lands in exactly one cell, so weeklyTotals + unconfirmedTotal
// reconcile with `total` (== totalUnique) by construction. Cell shading is
// FREQUENCY (scaled by maxCell), never severity.
export interface CargoActivityMatrix {
  sufficient: boolean; // total >= ACTIVITY_MATRIX_MIN_INCIDENTS
  total: number; // == totalUnique
  weeks: CargoActivityWeek[];
  rows: CargoActivityRow[]; // one per stage, fixed STAGE_ORDER
  weeklyTotals: number[]; // aligned to weeks
  unconfirmedTotal: number;
  hasUnconfirmed: boolean;
  maxCell: number; // max body/unconfirmed cell, for the shade scale
  statement: string; // data-derived; "" when total === 0
  sparseItems: CargoActivitySparseItem[]; // populated when 0 < total < min
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
  // Register/curated-card fields. Blank ("") when the source is silent — never
  // fabricated. `confidenceLabel` is the raw enrichment tier (High/Medium/Low)
  // used on the Selected Incidents card and the exported register, distinct
  // from the terser `confidence` column which only ever reads "Unconfirmed".
  country: string;
  confidenceLabel: string; // "High" | "Medium" | "Low" | ""
  status: string; // enrichment lifecycle status, "" when unknown
  cargoType: string; // "" when not reported
  company: string; // company / operator, "" when not reported
  source: string; // publisher name, "" when unknown
  sourceUrl: string; // "" when unknown
}

// Input to the deterministic Selected Incidents chooser. One per unique
// incident, carrying the compact row it would emit plus the signals the six
// selection criteria read.
export interface CargoSelectionCandidate {
  id: string;
  date: string; // ISO occurredAt
  category: string;
  stage: CargoStageKey;
  consequence: number; // 0..1
  country: string; // "" when unknown
  signalText: string; // title + summary, for insider/enforcement matching
  row: CargoAppendixRow;
}

export const MAX_SELECTED_INCIDENTS = 6;

// Law-enforcement disruption / recovery cues (criterion f). Enforcement-stage
// categories (arrests) plus seizure/recovery wording that lands in other stages
// (e.g. a port narcotics seizure). Kept narrow so a plain theft never matches.
const LAW_ENFORCEMENT_RE =
  /\b(arrest\w*|seiz\w*|seized|recover\w*|recovered|interdict\w*|confiscat\w*|bust\w*|dismantl\w*|raid\w*|charged|convict\w*|sentenc\w*|detain\w*|apprehend\w*)\b/i;

// Deterministic ordering: consequence desc -> date desc -> id asc. Used for both
// per-criterion representative choice and the final display order, so preview,
// PDF and tests can never disagree.
function bySelectionRank(
  a: CargoSelectionCandidate,
  b: CargoSelectionCandidate,
): number {
  return (
    b.consequence - a.consequence ||
    b.date.localeCompare(a.date) ||
    a.id.localeCompare(b.id)
  );
}

function bestOf(
  candidates: CargoSelectionCandidate[],
): CargoSelectionCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.slice().sort(bySelectionRank)[0];
}

// Choose <= MAX_SELECTED_INCIDENTS incidents that demonstrate the period's
// operational picture across six criteria, in order:
//   (a) most-frequent operational pattern
//   (b) highest-consequence pattern
//   (c) main affected geography
//   (d) largest positive within-window change (surge week), skipped if < 2 weeks
//   (e) a credible insider / organised-crime indicator
//   (f) a law-enforcement disruption / recovery
// Picks are de-duplicated by id (an incident satisfying several criteria counts
// once), then topped up by consequence so the section is never short when data
// exists. Explicitly NOT the six most recent. No "vs previous period" claim is
// ever emitted — criterion (d) only influences WHICH incident is shown.
export function selectIncidents(
  candidates: CargoSelectionCandidate[],
  opts: { max?: number } = {},
): CargoAppendixRow[] {
  const max = opts.max ?? MAX_SELECTED_INCIDENTS;
  if (candidates.length === 0) return [];
  // Collapse any repeated incident id up front so the "one card per incident"
  // invariant holds on every path (candidates are normally pre-deduped, but the
  // guarantee must not depend on that).
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  if (unique.length <= max) {
    return unique.slice().sort(bySelectionRank).map((c) => c.row);
  }
  candidates = unique;

  // Frequency + mean consequence per category (patterns).
  const catCount = new Map<string, number>();
  const catConsSum = new Map<string, number>();
  const countryCount = new Map<string, number>();
  for (const c of candidates) {
    catCount.set(c.category, (catCount.get(c.category) ?? 0) + 1);
    catConsSum.set(c.category, (catConsSum.get(c.category) ?? 0) + c.consequence);
    if (c.country) {
      countryCount.set(c.country, (countryCount.get(c.country) ?? 0) + 1);
    }
  }

  // (a) most-frequent pattern: highest count, tie-break higher mean consequence,
  //     then category name for stability.
  let freqCat: string | null = null;
  for (const [cat, count] of catCount) {
    if (freqCat === null) {
      freqCat = cat;
      continue;
    }
    const bestCount = catCount.get(freqCat) ?? 0;
    if (count > bestCount) freqCat = cat;
    else if (count === bestCount) {
      const meanA = (catConsSum.get(cat) ?? 0) / count;
      const meanBest = (catConsSum.get(freqCat) ?? 0) / bestCount;
      if (meanA > meanBest || (meanA === meanBest && cat < freqCat)) freqCat = cat;
    }
  }

  // (b) highest-consequence pattern: highest mean, tie-break higher count.
  let consCat: string | null = null;
  for (const [cat, count] of catCount) {
    const mean = (catConsSum.get(cat) ?? 0) / count;
    if (consCat === null) {
      consCat = cat;
      continue;
    }
    const bestCount = catCount.get(consCat) ?? 0;
    const bestMean = (catConsSum.get(consCat) ?? 0) / bestCount;
    if (mean > bestMean) consCat = cat;
    else if (mean === bestMean) {
      if (count > bestCount || (count === bestCount && cat < consCat)) consCat = cat;
    }
  }

  // (c) main geography: most-reported country.
  let mainCountry: string | null = null;
  for (const [country, count] of countryCount) {
    if (mainCountry === null) {
      mainCountry = country;
      continue;
    }
    const bestCount = countryCount.get(mainCountry) ?? 0;
    if (count > bestCount || (count === bestCount && country < mainCountry)) {
      mainCountry = country;
    }
  }

  // (d) largest positive within-window change. Bucket candidates into
  //     Monday-anchored weeks and find the week whose count most exceeds the
  //     preceding week's. Needs at least two distinct weeks; otherwise skipped.
  const weekKey = (iso: string): string | null => {
    const d = parseISO(iso);
    if (!isValid(d)) return null;
    return startOfWeek(d, { weekStartsOn: 1 }).toISOString().slice(0, 10);
  };
  const weekBuckets = new Map<string, CargoSelectionCandidate[]>();
  for (const c of candidates) {
    const wk = weekKey(c.date);
    if (!wk) continue;
    const arr = weekBuckets.get(wk);
    if (arr) arr.push(c);
    else weekBuckets.set(wk, [c]);
  }
  let surgeWeek: string | null = null;
  const orderedWeeks = [...weekBuckets.keys()].sort();
  if (orderedWeeks.length >= 2) {
    let bestDelta = 0;
    for (let i = 1; i < orderedWeeks.length; i++) {
      const delta =
        (weekBuckets.get(orderedWeeks[i])?.length ?? 0) -
        (weekBuckets.get(orderedWeeks[i - 1])?.length ?? 0);
      if (delta > bestDelta) {
        bestDelta = delta;
        surgeWeek = orderedWeeks[i];
      }
    }
  }

  // (e) insider / organised-crime indicator.
  const orgInsider = candidates.filter(
    (c) => ORG_CRIME_RE.test(c.signalText) || INSIDER_RE.test(c.signalText),
  );
  // (f) law-enforcement disruption / recovery.
  const enforcement = candidates.filter(
    (c) => c.stage === "enforcement" || LAW_ENFORCEMENT_RE.test(c.signalText),
  );

  const picks: CargoSelectionCandidate[] = [];
  const pushUnique = (c: CargoSelectionCandidate | null) => {
    if (c && !picks.some((p) => p.id === c.id)) picks.push(c);
  };

  pushUnique(freqCat ? bestOf(candidates.filter((c) => c.category === freqCat)) : null);
  pushUnique(consCat ? bestOf(candidates.filter((c) => c.category === consCat)) : null);
  pushUnique(
    mainCountry ? bestOf(candidates.filter((c) => c.country === mainCountry)) : null,
  );
  pushUnique(surgeWeek ? bestOf(weekBuckets.get(surgeWeek) ?? []) : null);
  pushUnique(bestOf(orgInsider));
  pushUnique(bestOf(enforcement));

  // Top up by consequence so a data-rich period always fills the section.
  if (picks.length < max) {
    for (const c of candidates.slice().sort(bySelectionRank)) {
      if (picks.length >= max) break;
      pushUnique(c);
    }
  }

  return picks.slice(0, max).sort(bySelectionRank).map((c) => c.row);
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
  activity: CargoActivityMatrix;
  matrix: CargoMatrix;
  appendix: CargoAppendixRow[]; // FULL deduplicated register (Workbench only)
  selected: CargoAppendixRow[]; // <= 6 curated Selected Incidents (client PDF)
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

  // 7. Weekly activity matrix — rows are the six supply-chain stages, columns
  //    are contiguous Monday-anchored reporting weeks (min..max), plus a TOTAL
  //    and a "date unconfirmed" bucket. Each unique incident lands in exactly
  //    one cell (its stage x its week, or the unconfirmed bucket when it has no
  //    usable date), so weeklyTotals + unconfirmedTotal reconcile with
  //    totalUnique. Shading is FREQUENCY (renderer scales by maxCell).
  const datedDerived: { der: Derived; date: Date }[] = [];
  const undatedByStage = new Map<CargoStageKey, number>();
  for (const d of derived) {
    const iso = d.primary.occurredAt ?? "";
    const dt = iso ? parseISO(iso) : new Date(NaN);
    if (iso && isValid(dt)) datedDerived.push({ der: d, date: dt });
    else undatedByStage.set(d.stage, (undatedByStage.get(d.stage) ?? 0) + 1);
  }

  const weeks: CargoActivityWeek[] = [];
  const weekPos = new Map<string, number>();
  if (datedDerived.length > 0) {
    const times = datedDerived.map((x) => x.date.getTime());
    let cursor = startOfWeek(new Date(Math.min(...times)), { weekStartsOn: 1 });
    const lastStart = startOfWeek(new Date(Math.max(...times)), {
      weekStartsOn: 1,
    });
    while (
      cursor.getTime() <= lastStart.getTime() &&
      weeks.length < ACTIVITY_MATRIX_MAX_WEEKS
    ) {
      const key = format(cursor, "yyyy-MM-dd");
      weekPos.set(key, weeks.length);
      weeks.push({ key, label: format(cursor, "dd MMM") });
      cursor = addWeeks(cursor, 1);
    }
  }

  const activityRows: CargoActivityRow[] = STAGE_ORDER.map((key) => {
    const weekCounts = new Array<number>(weeks.length).fill(0);
    let unconfirmed = undatedByStage.get(key) ?? 0;
    for (const { der, date } of datedDerived) {
      if (der.stage !== key) continue;
      const wkKey = format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const pos = weekPos.get(wkKey);
      if (pos != null) weekCounts[pos] += 1;
      else unconfirmed += 1; // defensive: date beyond the capped range
    }
    const total = weekCounts.reduce((s, n) => s + n, 0) + unconfirmed;
    return {
      stageKey: key,
      label: WEEKLY_PATTERN_ROW_LABEL[key],
      weekCounts,
      unconfirmed,
      total,
    };
  });

  const weeklyTotals = weeks.map((_, i) =>
    activityRows.reduce((s, r) => s + r.weekCounts[i], 0),
  );
  const unconfirmedTotal = activityRows.reduce((s, r) => s + r.unconfirmed, 0);
  const datedTotal = weeklyTotals.reduce((s, n) => s + n, 0);
  const maxCell = activityRows.reduce(
    (mx, r) => Math.max(mx, r.unconfirmed, ...r.weekCounts),
    0,
  );

  const activitySufficient = totalUnique >= ACTIVITY_MATRIX_MIN_INCIDENTS;
  const sparseItems: CargoActivitySparseItem[] =
    totalUnique > 0 && !activitySufficient
      ? derived
          .slice()
          .sort((a, b) =>
            (b.primary.occurredAt ?? "").localeCompare(
              a.primary.occurredAt ?? "",
            ),
          )
          .map((d) => {
            const iso = d.primary.occurredAt ?? "";
            const dt = iso ? parseISO(iso) : new Date(NaN);
            const hasDate = !!iso && isValid(dt);
            return {
              id: String(d.primary.id ?? d.cluster.id),
              date: hasDate ? iso : "",
              dateLabel: hasDate ? format(dt, "dd MMM") : "Date unconfirmed",
              pattern: WEEKLY_PATTERN_ROW_LABEL[d.stage],
              location: shortLocation(d.primary),
              severityKey: d.sevKey,
              severityLabel: SEV_LABEL[d.sevKey] ?? d.sevKey,
            };
          })
      : [];

  const activity: CargoActivityMatrix = {
    sufficient: activitySufficient,
    total: totalUnique,
    weeks,
    rows: activityRows,
    weeklyTotals,
    unconfirmedTotal,
    hasUnconfirmed: unconfirmedTotal > 0,
    maxCell,
    statement: buildActivityStatement(
      weeks,
      weeklyTotals,
      activityRows,
      datedTotal,
      totalUnique,
    ),
    sparseItems,
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
      const e = d.cluster.enrichment;
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
        confidence: e.confidence === "Low" ? "Unconfirmed" : "",
        country: cargoCountry(toIncidentLike(d.primary)) ?? "",
        confidenceLabel: e.confidence ?? "",
        status: e.status ?? "",
        cargoType: e.cargoType ?? "",
        company: e.company ?? "",
        source: (d.primary.source ?? "").trim(),
        sourceUrl: (d.primary.sourceUrl ?? "").trim(),
      };
    });

  // Curated Selected Incidents — a small, deterministic set (<= 6) chosen to
  // demonstrate the period's operational picture (most-frequent pattern,
  // highest-consequence pattern, main geography, the largest within-window
  // change, a credible insider/organised indicator and a law-enforcement
  // disruption/recovery). NOT the six most recent. Built from the same derived
  // set as the full register, keyed by id so the two never disagree.
  const rowById = new Map(appendix.map((r) => [r.id, r]));
  const candidates: CargoSelectionCandidate[] = derived
    .map((d) => {
      const id = String(d.primary.id ?? d.cluster.id);
      const row = rowById.get(id);
      if (!row) return null;
      return {
        id,
        date: d.primary.occurredAt,
        category: d.category,
        stage: d.stage,
        consequence: d.consequence,
        country: row.country,
        signalText: primaryText(d.primary),
        row,
      } satisfies CargoSelectionCandidate;
    })
    .filter((c): c is CargoSelectionCandidate => c !== null);
  const selected = selectIncidents(candidates);

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
    activity,
    matrix,
    appendix,
    selected,
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

// One data-derived sentence beneath the Weekly Activity by Pattern matrix. It
// characterises the distribution the reader is looking at (timing and lead
// pattern) without restating cell counts — no record-count annotations in
// prose. Returns "" when there is nothing to describe.
function buildActivityStatement(
  weeks: CargoActivityWeek[],
  weeklyTotals: number[],
  rows: CargoActivityRow[],
  datedTotal: number,
  grandTotal: number,
): string {
  if (grandTotal === 0) return "";

  const ranked = rows
    .filter((r) => r.total > 0)
    .slice()
    .sort((a, b) => b.total - a.total);
  const leadLabel = ranked[0] ? ranked[0].label.toLowerCase() : "cargo crime";

  if (datedTotal === 0) {
    return "Reported incidents this period carry no confirmed event date, so no weekly distribution can be shown.";
  }

  if (weeks.length === 1) {
    return `Reported activity fell within a single reporting week (week of ${weeks[0].label}), led by ${leadLabel}.`;
  }

  let peakIdx = 0;
  for (let i = 1; i < weeklyTotals.length; i++) {
    if (weeklyTotals[i] > weeklyTotals[peakIdx]) peakIdx = i;
  }
  const peakShare = weeklyTotals[peakIdx] / datedTotal;
  const lastTwo =
    (weeklyTotals[weeklyTotals.length - 1] ?? 0) +
    (weeklyTotals[weeklyTotals.length - 2] ?? 0);
  const lastTwoShare = lastTwo / datedTotal;

  if (peakShare >= 0.5) {
    return `Reported activity concentrated in the week of ${weeks[peakIdx].label}, led by ${leadLabel}.`;
  }
  if (weeks.length >= 3 && lastTwoShare >= 0.6) {
    return `Reported activity clustered in the final two reporting weeks, led by ${leadLabel}.`;
  }
  const leadShare = ranked[0] ? ranked[0].total / grandTotal : 0;
  if (leadShare >= 0.5) {
    return `Reporting spread across the period, with ${leadLabel} the most frequently reported pattern.`;
  }
  return "Reporting stayed dispersed across the period, with no single week or pattern dominating.";
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
