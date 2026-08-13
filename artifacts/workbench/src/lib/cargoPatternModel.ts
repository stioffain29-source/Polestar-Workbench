// Cargo Watch pattern-report model.
//
// ONE reconciliation source for the redesigned Cargo Watch report. Everything
// the preview and the PDF render — Fast Facts, country map, weekly trend,
// supply-chain exposure, pattern dashboard, weekly activity matrix and the
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
  cargoCountriesFor,
  isCargoRelatedIncident,
  IN_SCOPE_COUNTRIES,
  type CargoIncidentLike,
} from "./cargoAnalysis";
import {
  buildCargoGroupedDataset,
  type CargoClusterInput,
  type CargoIncidentCluster,
  type CargoSourceLink,
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
  OPERATIONAL_RELEVANCE_BY_STAGE,
  stageForIncident,
  stageForCategory,
  isEnforcementOutcome,
  isTheftOnly,
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
import { parseISO, isValid, startOfWeek, addWeeks, addDays, format } from "date-fns";
import { resolveReportWindow } from "./reportWindow";

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
  /** Modal severity among members — used on pattern chips / prose. */
  highestSeverityKey: string;
  highestSeverityLabel: string;
  /** Peak severity among members — used only for pattern-card qualification. */
  peakSeverityKey: string;
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
  // Curated "Key Incidents" card fields. `operationalRelevance` is a
  // deterministic, per-stage line explaining why the event matters
  // operationally; `clientStatus` is a resolved outcome (Suspects arrested,
  // Cargo recovered, Under investigation, Unconfirmed, Ongoing) surfaced ONLY
  // where the source text carries an explicit signal — "" otherwise.
  operationalRelevance: string;
  clientStatus: string;
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

export const MAX_SELECTED_INCIDENTS = 4;

// Resolve a client-facing STATUS for a "Key Incidents" card from the source
// text ALONE — surfaced only where an explicit signal exists, "" otherwise (no
// default "Ongoing", which would be fabrication). Precedence runs strongest
// outcome first: an arrest, then a recovery, then an active investigation, then
// a stated ongoing situation, and finally an unconfirmed/speculative framing.
// A no-arrest / active-pursuit cue: suspects are NOT in custody. It VETOES the
// "Suspects arrested" outcome even when the word "arrest" appears in the text
// ("no arrests", "arrest warrant issued", "manhunt under way", "still at
// large"), so a status can never contradict its own source (spec pt2 / pt7).
export const NO_ARREST_RE =
  /\b(no arrests?|not arrested|yet to be (?:caught|arrested|apprehended)|still at large|remain\w* at large|remains at large|on the run|abscond\w*|manhunt|hunt(?:ing)? for|search(?:ing)? for (?:the )?(?:suspect|suspects|culprit|culprits|perpetrator|perpetrators|attacker|attackers|robber|robbers|thief|thieves|gang)|warrant|sought|fugitive|fled|escaped|evade\w*|no one has been (?:arrested|held)|none (?:have|has) been arrested)\b/i;

// A DESIDERATIVE / PROMISED / FUTURE-arrest cue: someone hopes, urges, demands
// or vows that police WILL arrest — no arrest has actually happened. This also
// vetoes "Suspects arrested" (spec pt2/pt7) so a headline like "…Hopes Police
// Will Quickly Arrest Perpetrators" or "family urges police to arrest" can never
// be reported as a completed arrest. The desire/promise verb must sit within a
// short window before "arrest" so a genuine "two suspects arrested; family had
// urged action" is not swept up by the bare verb alone.
export const PENDING_ARREST_RE =
  /\b(?:hop(?:e|es|ed|ing)|urg(?:e|es|ed|ing)|demand(?:s|ed|ing)?|appeal(?:s|ed|ing)?|plead(?:s|ed|ing)?|call(?:s|ed|ing)?|press(?:es|ed|ing)?|want(?:s|ed|ing)?|seek(?:s|ing)?|await(?:s|ing|ed)?|expect(?:s|ed|ing)?|vow(?:s|ed|ing)?|promis(?:e|es|ed|ing)|pledg(?:e|es|ed|ing)|plan(?:s|ned|ning)?)\b[^.]{0,40}?\barrest\w*|\bto be (?:caught|arrested|apprehended)\b/i;

function deriveClientStatus(signalText: string): string {
  const t = signalText || "";
  if (
    /\b(arrest\w*|detain\w*|apprehend\w*|charged|convict\w*|sentenc\w*|remand\w*|taken into custody|in custody)\b/i.test(
      t,
    ) &&
    !NO_ARREST_RE.test(t)
  )
    return "Suspects arrested";
  if (/\b(recover\w*|recovered|seiz\w*|seized|confiscat\w*|returned)\b/i.test(t))
    return "Cargo recovered";
  if (/\b(investigat\w*|probe|inquiry|manhunt|hunt for|search for|searching for)\b/i.test(t))
    return "Under investigation";
  if (/\b(ongoing|continu\w*|still at large|remain\w* at large|yet to be caught)\b/i.test(t))
    return "Ongoing";
  if (
    /\b(alleged\w*|unconfirmed|reportedly|suspected|claim\w*|purported\w*|no confirmation)\b/i.test(
      t,
    )
  )
    return "Unconfirmed";
  return "";
}

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

function normLocKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function tokenOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size;
}

// Collapse near-duplicate EVENTS among selection candidates so two syndicated
// copies of one incident can never occupy two "Key Incidents" cards. Two
// candidates merge when they share the same day, a normalised location AND the
// same category, and their cleaned summaries overlap by >= 60% of the shorter
// token set. The higher-ranked candidate (bySelectionRank) is kept. Display-only
// — it never touches the full register, Fast Facts or the pattern counts.
function dedupeCandidateEvents(
  candidates: CargoSelectionCandidate[],
): CargoSelectionCandidate[] {
  const ranked = candidates.slice().sort(bySelectionRank);
  const kept: CargoSelectionCandidate[] = [];
  const keptMeta: {
    day: string;
    loc: string;
    category: string;
    toks: Set<string>;
  }[] = [];
  for (const c of ranked) {
    const day = (c.date || "").slice(0, 10);
    const loc = normLocKey(c.row.location);
    const toks = summaryTokens(c.row.summary);
    const dup = keptMeta.some(
      (m) =>
        m.day === day &&
        m.loc === loc &&
        m.category === c.category &&
        tokenOverlapRatio(m.toks, toks) >= 0.6,
    );
    if (dup) continue;
    kept.push(c);
    keptMeta.push({ day, loc, category: c.category, toks });
  }
  return kept;
}

// Choose <= MAX_SELECTED_INCIDENTS incidents that best illustrate the period's
// main operational patterns, across three archetypes, in order:
//   (a) most-frequent operational pattern (the dominant threat)
//   (b) highest-consequence pattern (the most operationally significant event)
//   (c) an event that broadens the picture — a different affected geography OR
//       supply-chain stage from those already picked
// Enforcement outcomes are NOT a Key-Incidents archetype: they live in their own
// panel and the candidate set passed here is already operational-only (spec pt1,
// pt5). Picks are de-duplicated by id (an incident satisfying several archetypes
// counts once), then topped up so the section fills when data exists — preferring
// a fresh country+category combination before a second card from an
// already-represented combination. Ordered by significance (bySelectionRank).
// Explicitly NOT the most recent, and NO "vs previous period" / surge claim.
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
  for (const c of candidates) {
    catCount.set(c.category, (catCount.get(c.category) ?? 0) + 1);
    catConsSum.set(c.category, (catConsSum.get(c.category) ?? 0) + c.consequence);
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

  const picks: CargoSelectionCandidate[] = [];
  const pushUnique = (c: CargoSelectionCandidate | null) => {
    if (c && !picks.some((p) => p.id === c.id)) picks.push(c);
  };

  // (a) the dominant pattern and (b) the most operationally significant event.
  pushUnique(freqCat ? bestOf(candidates.filter((c) => c.category === freqCat)) : null);
  pushUnique(consCat ? bestOf(candidates.filter((c) => c.category === consCat)) : null);

  // (c) broaden the picture: the strongest event whose affected geography or
  //     supply-chain stage is not already represented among the picks.
  const diverse = candidates.filter((c) => {
    if (picks.some((p) => p.id === c.id)) return false;
    const newCountry = !!c.country && !picks.some((p) => p.country === c.country);
    const newStage = !picks.some((p) => p.stage === c.stage);
    return newCountry || newStage;
  });
  pushUnique(bestOf(diverse));

  // (d) most recent sourced incident — ensures the Fast Facts "Latest Incident"
  // date always appears somewhere in the report body (Key Incidents).
  const latest = candidates
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || bySelectionRank(a, b))[0];
  pushUnique(latest ?? null);

  // Top up so a data-rich period always fills the section, but prefer an event
  // that adds a fresh country+category combination before allowing a second
  // card from an already-represented combination (a genuine cluster).
  if (picks.length < max) {
    const combo = (c: CargoSelectionCandidate) => `${c.country}|${c.category}`;
    const takenCombos = new Set(picks.map(combo));
    for (const c of candidates.slice().sort(bySelectionRank)) {
      if (picks.length >= max) break;
      if (picks.some((p) => p.id === c.id)) continue;
      if (takenCombos.has(combo(c))) continue;
      pushUnique(c);
      takenCombos.add(combo(c));
    }
    for (const c of candidates.slice().sort(bySelectionRank)) {
      if (picks.length >= max) break;
      pushUnique(c);
    }
  }

  return picks.slice(0, max).sort(bySelectionRank).map((c) => c.row);
}

export interface CargoAssessment {
  situation: string;
  // WHAT MATTERS — up to 3, each stating a pattern AND why it matters (spec pt4).
  whatMatters: string[];
  // IMPLICATIONS — up to 3, each tied to a specific incident/pattern (spec pt4,
  // renamed from the old `businessPriorities`). `implicationIncidentIds` runs in
  // parallel: the id of the incident/pattern each implication is drawn from, so
  // the validation gate can prove provenance.
  implications: string[];
  implicationIncidentIds: string[];
  watchNext: string[]; // 3-4 (spec pt4)
  polestarView: string; // 120-160 words, six elements (spec pt4)
}

// Enforcement outcomes (arrests, seizures, recoveries) shown in their OWN panel
// and EXCLUDED from every operational total, so the incident/pattern/country
// figures count reported theft and loss only (spec pt1).
export interface CargoEnforcementPanel {
  total: number;
  rows: CargoAppendixRow[];
  statement: string; // data-derived, never a "media coverage" claim
}

export interface CargoPatternModel {
  totalUnique: number; // OPERATIONAL unique incidents (enforcement excluded)
  isEmpty: boolean;
  clusters: CargoIncidentCluster[];
  primaries: CargoClusterInput[]; // OPERATIONAL cluster primaries
  fastFacts: TopicFastFactCard[];
  extras: CargoReportExtras;
  intensity: Map<string, CargoCountryIntensity>;
  mapTitle: string; // theft-only predicate drives the wording (spec pt3)
  mapCaption: string;
  trendCaption: string;
  stageCategoryNote: string;
  highSeverityNote: string;
  namedPlaces: string[];
  stages: CargoStageSummary[];
  patterns: CargoPatternCard[]; // <= MAX_PATTERN_CARDS dashboard cards
  activity: CargoActivityMatrix;
  matrix: CargoMatrix;
  appendix: CargoAppendixRow[]; // FULL deduplicated OPERATIONAL register
  selected: CargoAppendixRow[]; // <= MAX_SELECTED_INCIDENTS curated Key Incidents
  enforcement: CargoEnforcementPanel; // separate enforcement panel (spec pt1)
  executiveSummary: string; // one analytical paragraph (spec TASK A)
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

// Sensational / tabloid adjectives that add colour but no operational meaning
// (spec pt3). Stripped from the DISPLAYED summary so titles read neutrally.
// DISPLAY-ONLY — the underlying incident text and dedupe keys are untouched.
export const SENSATIONAL_RE =
  /\b(shocking|shockingly|horrific|horrifying|horrifically|brazen|brazenly|daring|audacious|terrifying|terrifyingly|rampag\w*|bloodbath|carnage|maraud\w*|fearless|nightmare|mayhem|dramatic|dramatically|stunning|stunningly|explosive|frenzy|frenzied|terror\w*|shocker|jaw-dropping|gut-wrenching|hair-raising|blood-curdling)\b/gi;

// Ethnic / nationality descriptor sitting immediately before a perpetrator or
// group noun (spec pt3 — "drop ethnic descriptors"). The descriptor is dropped
// while the perpetrator noun is kept, so "Bangladeshi gang" -> "gang". The
// lookahead is deliberately confined to PERPETRATOR nouns, so a legitimate
// "Indonesian police" or "Malaysian port" is never touched. DISPLAY-ONLY.
export const ETHNIC_DESCRIPTOR_RE =
  /\b(rohingya|bangladeshi|indonesian|malaysian|filipino|filipina|indian|pakistani|nigerian|chinese|myanmar|burmese|thai|vietnamese|cambodian|african|arab|bengali|nepali|nepalese|sri lankan)\s+(?=(gang|gangs|men\b|man\b|nationals?|migrants?|suspects?|robbers?|thieves|thief|syndicate|group|mob|nationals|foreigners?|immigrants?)\b)/gi;

// Neutralise a DISPLAYED summary: strip sensational adjectives and ethnic
// perpetrator descriptors, then tidy whitespace/leading punctuation and restore
// a leading capital. No fabrication — words are only ever REMOVED, never added.
export function neutraliseSummary(text: string): string {
  let s = (text || "")
    .replace(ETHNIC_DESCRIPTOR_RE, "")
    .replace(SENSATIONAL_RE, "");
  s = s
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/^[\s,;:–-]+/, "")
    .trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

// Cleaned, neutralised one-line summary for a title (register + panels).
function cleanSummary(title: string): string {
  return neutraliseSummary(
    firstSentence(stripWireCruft(title) || title),
  );
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

// The first source name that will actually RENDER (contains a Latin letter),
// paired with its URL, drawn from a cluster's deduped source links. A wholly
// non-Latin outlet name ("দৈনিক ইনকিলাব") shows on screen but blanks in the
// Roboto PDF, so preferring a renderable name keeps preview == PDF and never
// prints an empty "Source:" line. Returns blanks when nothing is renderable —
// both renderers already skip a falsy source.
function renderableSourceLink(
  links: CargoSourceLink[],
): { source: string; sourceUrl: string } {
  for (const l of links) {
    const s = (l.source ?? "").trim();
    if (/[A-Za-z]/.test(s)) return { source: s, sourceUrl: (l.url ?? "").trim() };
  }
  return { source: "", sourceUrl: "" };
}

// --- Second-pass syndication collapse -------------------------------------
//
// buildCargoGroupedDataset already dedupes copies of one event that share a
// coarse {group, category, country, port} bucket. A residual class survives it:
// the SAME event reported by outlets that frame it differently enough to land
// in different category/port buckets (e.g. one headline says "bonded lorry",
// another "container", a third "warehouse"). This conservative second pass
// merges clusters that are the same country, within four days, and pass EITHER
// acceptance path below, so the enforcement panel, Key Incidents and Fast Facts
// count one event once.
//
// Two acceptance paths:
//  (1) BALANCED — >= two DISTINCTIVE shared tokens at Jaccard >= 0.34. Handles
//      evenly-worded copies.
//  (2) CONTAINMENT — heavy syndication: many outlets rewrite ONE bust, and the
//      longer copies carry attribution/framing tokens ("according to <outlet>",
//      a force's proper name) that unfairly depress Jaccard even though a
//      concise copy is near-fully contained in the longer one. This path fires
//      when >= THREE distinctive tokens are shared AND the smaller token set is
//      at least half contained (overlap coefficient >= 0.5). The three-token
//      floor keeps it clear of same-location different-event pairs, which share
//      only their place/subject tokens (<= two here).
//
// A candidate is accepted if it passes EITHER path against ANY cluster already
// in the group (bounded transitive chaining), not only the seed. One real event
// draws copies whose framing diverges enough that a terse copy and a
// heavily-attributed copy under-share DIRECTLY (e.g. one carries "according to
// <outlet>, Location: <place>", the other a force's proper name), yet both share
// a strong link with a THIRD copy that names the ringleader/suspect count. The
// strict per-link thresholds still gate every hop, so unrelated events cannot
// daisy-chain: two genuinely different crime stories rarely share three
// DISTINCTIVE (generic- and country-stripped) tokens within four days.

const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const COLLAPSE_JACCARD_MIN = 0.34;
const COLLAPSE_OVERLAP_MIN = 0.5;
const COLLAPSE_OVERLAP_SHARED_MIN = 3;

// Generic crime/logistics vocabulary carries no discriminating signal for "is
// this the same event", so it is stripped before the token overlap is measured.
// Exact forms plus prefixes for the inflected families (arrest/arrested/…).
const COLLAPSE_GENERIC_EXACT = new Set<string>([
  "police", "stolen", "stole", "robbed", "cargo", "goods", "over",
  "including", "busted", "bust",
  // A shared country is already a merge precondition, so counting the country
  // name as a shared distinctive token would double-count it.
  ...IN_SCOPE_COUNTRIES.map((c) => c.toLowerCase()),
]);
const COLLAPSE_GENERIC_PREFIXES = [
  "arrest", "detain", "suspect", "seiz", "recover", "theft", "steal",
  "robber", "truck", "lorr", "gang", "case", "raid", "loot",
];

function isGenericCollapseToken(raw: string): boolean {
  if (COLLAPSE_GENERIC_EXACT.has(raw)) return true;
  return COLLAPSE_GENERIC_PREFIXES.some((p) => raw.startsWith(p));
}

// Distinctive stemmed tokens for the collapse overlap test. Lower-cased alpha
// runs of length >= 4, generic vocabulary removed, then a light stem (ies->y,
// es/s stripped) so plural/singular framings of one noun match. "syndicate" and
// "mastermind" are deliberately kept (they discriminate real repeat events).
function collapseTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 4) continue;
    if (isGenericCollapseToken(raw)) continue;
    let stem = raw;
    if (stem.endsWith("ies")) stem = `${stem.slice(0, -3)}y`;
    else if (stem.endsWith("es")) stem = stem.slice(0, -2);
    else if (stem.endsWith("s")) stem = stem.slice(0, -1);
    out.add(stem);
  }
  return out;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) n++;
  return n;
}

function dedupeSourceLinkList(links: CargoSourceLink[]): CargoSourceLink[] {
  const seen = new Set<string>();
  const out: CargoSourceLink[] = [];
  for (const l of links) {
    const key = `${l.source ?? ""}|${l.url ?? ""}`;
    if (key === "|" || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function mergeClusterGroup(group: CargoIncidentCluster[]): CargoIncidentCluster {
  // Canonical = highest stored primary severity, then most recent, then a
  // deterministic title/id tie-break (mirrors the dataset's own precedence).
  const canonical = [...group].sort((a, b) => {
    const rs = severityRankOf(b.primary) - severityRankOf(a.primary);
    if (rs !== 0) return rs;
    const td =
      new Date(b.primary.occurredAt).getTime() -
      new Date(a.primary.occurredAt).getTime();
    if (td !== 0) return td;
    const tc = (a.primary.title ?? "").localeCompare(b.primary.title ?? "");
    if (tc !== 0) return tc;
    return String(a.primary.id ?? "").localeCompare(String(b.primary.id ?? ""));
  })[0];
  const supporting: CargoClusterInput[] = [];
  for (const cl of group) {
    if (cl !== canonical) supporting.push(cl.primary);
    supporting.push(...cl.supporting);
  }
  return {
    ...canonical,
    supporting,
    sourceLinks: dedupeSourceLinkList(group.flatMap((cl) => cl.sourceLinks)),
    clusterSize: supporting.length + 1,
    maxSeverityRank: Math.max(...group.map((cl) => cl.maxSeverityRank)),
    latestOccurredAt: group
      .map((cl) => cl.latestOccurredAt)
      .sort()
      .slice(-1)[0],
  };
}

// Does candidate token set `cand` pass either acceptance path against member
// token set `member`? (Same country + time window are enforced by the caller.)
function collapseTokensMatch(member: Set<string>, cand: Set<string>): boolean {
  const shared = intersectionSize(member, cand);
  if (shared < 2) return false;
  const union = member.size + cand.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  const smaller = Math.min(member.size, cand.size);
  const overlap = smaller === 0 ? 0 : shared / smaller;
  const balanced = jaccard >= COLLAPSE_JACCARD_MIN;
  const contained =
    shared >= COLLAPSE_OVERLAP_SHARED_MIN && overlap >= COLLAPSE_OVERLAP_MIN;
  return balanced || contained;
}

// Greedy conservative merge: clusters arrive sorted by impact, so each seed is
// the strongest of its group and only later (weaker/equal) clusters are absorbed
// into it. A candidate is matched against ANY cluster already in the group
// (bounded transitive chaining) — see the header note — and the group is grown
// to a fixed point so a linking copy encountered late still pulls in copies that
// only chain through it. Every hop still passes the strict per-link thresholds,
// so unrelated events can never daisy-chain together. Same country and a
// four-day window (seed-relative, so the whole group spans one event) gate every
// candidate before any token test.
function collapseSyndicatedClusters(
  clusters: CargoIncidentCluster[],
): CargoIncidentCluster[] {
  const tagged = clusters.map((cl) => ({
    cl,
    country: cargoCountry(toIncidentLike(cl.primary)),
    time: new Date(cl.primary.occurredAt).getTime(),
    tokens: collapseTokens(primaryText(cl.primary)),
  }));
  const used = new Array(tagged.length).fill(false);
  const out: CargoIncidentCluster[] = [];
  for (let i = 0; i < tagged.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const seed = tagged[i];
    const group = [seed.cl];
    const groupTokens: Set<string>[] = [seed.tokens];
    if (seed.country && !Number.isNaN(seed.time)) {
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = i + 1; j < tagged.length; j++) {
          if (used[j]) continue;
          const cand = tagged[j];
          if (!cand.country || cand.country !== seed.country) continue;
          if (Number.isNaN(cand.time)) continue;
          if (Math.abs(seed.time - cand.time) > FOUR_DAYS_MS) continue;
          if (!groupTokens.some((m) => collapseTokensMatch(m, cand.tokens))) {
            continue;
          }
          used[j] = true;
          group.push(cand.cl);
          groupTokens.push(cand.tokens);
          grew = true;
        }
      }
    }
    out.push(group.length === 1 ? seed.cl : mergeClusterGroup(group));
  }
  return out;
}

function topCountry(primaries: CargoClusterInput[]): string | null {
  // Same multi-country resolver as the map, Security Read and Country Breakdown
  // so pattern geography and executive summary cannot contradict route-side prose
  // by counting only the first stored country token.
  const counts = new Map<string, number>();
  for (const p of primaries) {
    for (const c of cargoCountriesFor(toIncidentLike(p))) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
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

/** Keep only control labels supported by the incident corpus. */
function evidenceGatedControls(corpus: string, controls: string[]): string[] {
  const t = corpus.toLowerCase();
  const gated = controls.filter((c) => {
    const lc = c.toLowerCase();
    if (/driver/.test(lc) && !/\bdriver/.test(t)) return false;
    if (/escort|convoy/.test(lc) && !/\b(escort|convoy)/.test(t)) return false;
    if (/insider|collusion/.test(lc) && !/\b(insider|employee|staff|collusion)/.test(t))
      return false;
    if (/seal/.test(lc) && !/\bseal/.test(t)) return false;
    if (/route planning|corridor/.test(lc) && !/\b(route|corridor|highway|nh[- ]?\d)/.test(t))
      return false;
    if (/tracking|telematics|gps/.test(lc) && !/\b(track\w*|gps|telematics)/.test(t))
      return false;
    return true;
  });
  return gated.length > 0 ? gated : ["In-transit custody"];
}

interface CountryExposure {
  country: string;
  total: number;
  hub: number;
  route: number;
}

const HUB_STAGE: ReadonlySet<CargoStageKey> = new Set([
  "warehouse_depot",
  "staging_yard",
  "port_terminal",
]);

function countryExposures(primaries: CargoClusterInput[]): CountryExposure[] {
  const map = new Map<string, CountryExposure>();
  for (const p of primaries) {
    for (const c of cargoCountriesFor(toIncidentLike(p))) {
      const cat = classifyCargoCategory(toIncidentLike(p));
      const stage = stageForIncident(cat, primaryText(p));
      const cur = map.get(c) ?? { country: c, total: 0, hub: 0, route: 0 };
      cur.total += 1;
      if (HUB_STAGE.has(stage)) cur.hub += 1;
      else if (stage === "inland_transport" || stage === "inland_waterway")
        cur.route += 1;
      map.set(c, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function extractNamedPlaces(primaries: CargoClusterInput[]): string[] {
  const counts = new Map<string, number>();
  for (const p of primaries) {
    const loc = shortLocation(p);
    if (loc && loc.length >= 3) counts.set(loc, (counts.get(loc) ?? 0) + 1);
    const text = primaryText(p);
    for (const m of text.match(/\bNH[- ]?\d+[A-Z]?\b/gi) ?? []) {
      const nh = m.toUpperCase().replace(/\s+/, "-");
      counts.set(nh, (counts.get(nh) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([place]) => place);
}

function buildStageCategoryNote(
  stages: CargoStageSummary[],
  derived: Array<{ category: string; stage: CargoStageKey }>,
): string {
  const inland = stages.find((s) => s.key === "inland_transport");
  if (!inland || inland.count === 0) {
    return "Supply-chain stages count where in the movement chain each incident occurred. Incident-type categories (below) classify the method; stage and category totals measure different things.";
  }
  const transitCat = "Cargo theft in transit";
  const transitN = derived.filter(
    (d) => d.category === transitCat && d.stage === "inland_transport",
  ).length;
  if (inland.count === transitN) {
    return "Inland transport is a movement-stage total. Cargo theft in transit is the matching incident-type category within it. Stage totals and pattern categories measure different things and need not match when other road-side categories also occur.";
  }
  const other = new Map<string, number>();
  for (const d of derived) {
    if (d.stage !== "inland_transport" || d.category === transitCat) continue;
    other.set(d.category, (other.get(d.category) ?? 0) + 1);
  }
  const parts = [...other.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat} (${n})`);
  const otherTotal = inland.count - transitN;
  return `Inland transport (${inland.count}) is a movement-stage total. Cargo theft in transit (${transitN}) is one incident-type category within it; the other ${otherTotal} inland-transport incident${otherTotal === 1 ? "" : "s"} are ${parts.join(", ")}. Stages and categories measure different things and need not match.`;
}

function buildHighSeverityNote(appendix: CargoAppendixRow[]): string {
  const highs = appendix.filter((r) => r.severityKey === "high");
  if (highs.length !== 1) return "";
  const r = highs[0];
  const why =
    VIOLENCE_RE.test(r.summary) || /\b(killed|fatal|dead|murder|hostage|shoot)\b/i.test(r.summary)
      ? "violence or fatalities in the reporting"
      : parseUsdLoss({
            title: r.summary,
            summary: null,
            source: null,
          }) != null
        ? "a source-stated loss figure"
        : "operational consequence beyond a routine inventory loss";
  const where = r.location || r.country || "the affected area";
  return `The single High rating reflects ${why} (${r.category}${where ? `, ${where}` : ""}). Arrest or recovery reports elsewhere in the period are rated separately and do not inherit this tier.`;
}

function enforcementDisplaySeverity(text: string): { key: string; label: string } {
  if (
    VIOLENCE_RE.test(text) &&
    /\b(killed|fatal|dead|murder\w*|hostage|shoot\w*|gunman|gunmen|injured|wounded)\b/i.test(
      text,
    )
  ) {
    return { key: "high", label: "High" };
  }
  const usd = parseUsdLoss({ title: text, summary: null, source: null });
  if (usd != null && usd >= USD_MID_MIN) {
    return { key: "moderate", label: "Moderate" };
  }
  return { key: "low", label: "Low" };
}

function weekEffectiveDays(
  point: { date: string; partial?: boolean },
  issueDate: string,
): number {
  if (!point.partial) return 7;
  const win = resolveReportWindow("cargo_watch", issueDate);
  const weekStart = parseISO(point.date);
  const weekEnd = addDays(weekStart, 6);
  const start = weekStart.getTime() < win.start.getTime() ? win.start : weekStart;
  const end = weekEnd.getTime() > win.end.getTime() ? win.end : weekEnd;
  const days =
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.min(7, days));
}

/** Modal severity among members; unknown/blank tiers are ignored. */
function modalSeverity(primaries: CargoClusterInput[]): {
  key: string | null;
  label: string;
} {
  const sevCount = new Map<string, number>();
  for (const p of primaries) {
    const k = severityKeyOf(p);
    if (!k || !(k in SEV_RANK)) continue;
    sevCount.set(k, (sevCount.get(k) ?? 0) + 1);
  }
  let key: string | null = null;
  let bestN = -1;
  for (const [k, n] of sevCount) {
    if (
      n > bestN ||
      (n === bestN && (SEV_RANK[k] ?? 0) > (SEV_RANK[key ?? ""] ?? 0))
    ) {
      bestN = n;
      key = k;
    }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
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
  // Second-pass syndication collapse — merge residual cross-bucket copies of one
  // event so every downstream surface (Fast Facts, enforcement, Key Incidents)
  // counts it once. Applied to the FULL cluster set before any partition.
  const clusters = collapseSyndicatedClusters(dataset.clusters);

  // 1a. Partition the deduped clusters into OPERATIONAL theft/loss events and
  //     ENFORCEMENT outcomes (arrests, seizures, recoveries). Enforcement is a
  //     RESPONSE to cargo crime, not a fresh event, so it is EXCLUDED from every
  //     operational total below (records, patterns, supply-chain %, theft map,
  //     trend, country totals) and shown in its own panel instead (spec pt1).
  //     The decision is per-incident and title-first — no cross-incident match.
  const classified = clusters.map((cl) => {
    const p = cl.primary;
    const category = classifyCargoCategory(toIncidentLike(p));
    const title = p.title ?? "";
    return {
      cluster: cl,
      primary: p,
      category,
      title,
      isEnforcement: isEnforcementOutcome(category, title),
    };
  });
  const operationalClustered = classified.filter((c) => !c.isEnforcement);
  const enforcementClustered = classified.filter((c) => c.isEnforcement);

  const primaries: CargoClusterInput[] = operationalClustered.map((c) => c.primary);
  const totalUnique = primaries.length;
  const isEmpty = totalUnique === 0;

  // 2. Fast Facts, extras (USD/commodity/trend) and country intensity — all fed
  //    the SAME deduped OPERATIONAL primaries, so "Total Records", the map and
  //    the trend reconcile with the operational cluster count (enforcement out).
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
  const extras = buildCargoReportExtras(choroInput, issueDate);
  const intensity = buildCargoCountryIntensity(choroInput);

  // 3. Repeat-route/facility signal for the consequence score: any country that
  //    appears on two or more unique OPERATIONAL incidents in the period.
  const countryFreq = new Map<string, number>();
  for (const p of primaries) {
    const c = cargoCountry(toIncidentLike(p));
    if (c) countryFreq.set(c, (countryFreq.get(c) ?? 0) + 1);
  }
  const repeatCountries = new Set(
    [...countryFreq.entries()].filter(([, n]) => n >= 2).map(([c]) => c),
  );

  // 4. Attach derived fields to each OPERATIONAL cluster primary once. Stage
  //    uses stageForIncident (not stageForCategory) so the inland-waterway
  //    override applies (Mithamoin barge/ferry/jetty movement -> inland waterway
  //    rather than road, spec pt2).
  interface Derived {
    cluster: CargoIncidentCluster;
    primary: CargoClusterInput;
    category: string;
    stage: CargoStageKey;
    sevKey: string;
    sevRank: number;
    consequence: number; // normalised 0..1
  }
  const derived: Derived[] = operationalClustered.map((oc) => {
    const p = oc.primary;
    const category = oc.category;
    const stage = stageForIncident(category, primaryText(p));
    return {
      cluster: oc.cluster,
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
    const modal = modalSeverity(members.map((m) => m.primary));
    // Prefer modal for the stage chip when members exist; fall back to peak.
    // Never invent High for blank/unknown severity.
    const sevKeyOut = modal.key ?? hs.key;
    const sevLabelOut =
      modal.label !== "—" ? modal.label : hs.label;
    return {
      key,
      label: meta.label,
      count: members.length,
      sharePct:
        totalUnique > 0
          ? Math.round((members.length / totalUnique) * 100)
          : 0,
      highestSeverityKey: sevKeyOut,
      highestSeverityLabel: sevLabelOut,
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
      // Stage for the whole pattern card = the MODAL stage among its members,
      // NOT an arbitrary first member. A category (e.g. "Cargo theft in transit")
      // is dominated by one stage; a lone reclassified outlier (e.g. a single
      // inland-waterway hit) must never make a road-dominated card read as
      // river/barge in its concern, controls and watch-next. Ties break toward
      // the category's canonical stage so the aggregate stays honest and stable.
      const stageCounts = new Map<CargoStageKey, number>();
      for (const m of members)
        stageCounts.set(m.stage, (stageCounts.get(m.stage) ?? 0) + 1);
      const canonicalStage = stageForCategory(category);
      const stage = [...stageCounts.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          (a[0] === canonicalStage ? -1 : b[0] === canonicalStage ? 1 : 0),
      )[0][0];
      const meta = STAGE_META[stage];
      // Display the MODAL severity so pattern chips agree with the executive
      // summary's "predominantly Moderate" read. Peak High still qualifies the
      // card via PATTERN_SEVERITY_FLOOR below.
      const modal = modalSeverity(members.map((m) => m.primary));
      const peak = highestSeverity(members.map((m) => m.primary));
      const consequenceMean =
        members.reduce((s, m) => s + m.consequence, 0) / members.length;
      const geo = topCountry(members.map((m) => m.primary));
      const memberText = members.map((m) => primaryText(m.primary)).join(" ");
      const controls = evidenceGatedControls(memberText, meta.controlAffected);
      // Specific watch line: named place or country when available — never a
      // bare "same corridor" without naming it.
      const watchBase = meta.watchNext;
      const place = extractNamedPlaces(members.map((m) => m.primary))[0];
      const watchGeo = place ?? geo;
      const watchNext = watchGeo
        ? `${watchBase.replace(/\.$/, "")} involving ${category.toLowerCase()} around ${watchGeo}.`
        : `${watchBase.replace(/\.$/, "")} for ${category.toLowerCase()}.`;
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
        highestSeverityKey: modal.key ?? peak.key ?? "moderate",
        highestSeverityLabel: modal.label !== "—" ? modal.label : peak.label,
        peakSeverityKey: peak.key ?? modal.key ?? "moderate",
        operationalConcern: meta.primaryConcern,
        controlAffected: controls,
        watchNext,
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
        (SEV_RANK[p.peakSeverityKey] ?? 0) >= PATTERN_SEVERITY_FLOOR,
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

  // Column labels are CLIPPED to the report window [window.start, issueDate] so a
  // Monday-anchored week never advertises days outside the reporting period
  // (spec pt4). Partial weeks (first/last week truncated to the window) are
  // marked so the matrix cannot look like a full calendar week. Bucketing still
  // keys on the Monday ISO `key`.
  const win = resolveReportWindow("cargo_watch", issueDate);
  const winStartMs = win.start.getTime();
  const winEndMs = win.end.getTime();
  const weekRangeLabel = (weekStart: Date): string => {
    const weekEnd = addDays(weekStart, 6);
    const clippedStart = weekStart.getTime() < winStartMs;
    const clippedEnd = weekEnd.getTime() > winEndMs;
    const dispStart = clippedStart ? win.start : weekStart;
    const dispEnd = clippedEnd ? win.end : weekEnd;
    const a = format(dispStart, "d MMM");
    const b = format(dispEnd, "d MMM");
    const range = a === b ? a : `${a}\u2013${b}`;
    return clippedStart || clippedEnd ? `${range}*` : range;
  };

  const weeks: CargoActivityWeek[] = [];
  const weekPos = new Map<string, number>();
  if (datedDerived.length > 0) {
    // Anchor columns to the REPORT WINDOW Mondays (not the first/last incident)
    // so the matrix cannot advertise weeks that start before the period label.
    let cursor = startOfWeek(win.start, { weekStartsOn: 1 });
    const lastStart = startOfWeek(win.end, { weekStartsOn: 1 });
    while (
      cursor.getTime() <= lastStart.getTime() &&
      weeks.length < ACTIVITY_MATRIX_MAX_WEEKS
    ) {
      const key = format(cursor, "yyyy-MM-dd");
      weekPos.set(key, weeks.length);
      weeks.push({ key, label: weekRangeLabel(cursor) });
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
        summary: cleanSummary(d.primary.title),
        severityLabel: SEV_LABEL[d.sevKey] ?? d.sevKey,
        severityKey: d.sevKey,
        confidence: e.confidence === "Low" ? "Unconfirmed" : "",
        country: cargoCountry(toIncidentLike(d.primary)) ?? "",
        confidenceLabel: e.confidence ?? "",
        status: e.status ?? "",
        cargoType: e.cargoType ?? "",
        company: e.company ?? "",
        ...renderableSourceLink(d.cluster.sourceLinks),
        operationalRelevance: OPERATIONAL_RELEVANCE_BY_STAGE[d.stage] ?? "",
        clientStatus: deriveClientStatus(primaryText(d.primary)),
      };
    });

  // Curated "Key Incidents" — a small, deterministic set (<= MAX_SELECTED_INCIDENTS)
  // that best illustrates the period's main operational patterns (dominant
  // pattern, highest-consequence event and a broadening geography/stage). NOT the
  // most recent, and enforcement outcomes are NOT eligible (own panel, spec pt5).
  // Built from the same operational derived set as the full register, keyed by id
  // so the two never disagree. A stricter cargo-relatedness gate (drops ordinary
  // personal robberies), an UNCONFIRMED gate (Low-confidence rows are excluded
  // from Key Incidents, spec pt2) and an event de-duplication pass apply to the
  // CARDS ONLY — the full register keeps every unique row.
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
    .filter((c): c is CargoSelectionCandidate => c !== null)
    .filter((c) => isCargoRelatedIncident(c.signalText))
    .filter((c) => c.row.confidence !== "Unconfirmed")
    // Key Incidents lead the report, so a Low/Insignificant-tier event never
    // qualifies (spec pt5) — it stays in the full register but not on a card.
    .filter((c) => (SEV_RANK[c.row.severityKey] ?? 0) >= 3);
  // Every Key Incident must carry a source and date (spec pt5), so prefer
  // sourced candidates. Fall back to the unfiltered set only when nothing has a
  // source, so a source-poor period still fills the section rather than blocking
  // on the validation gate.
  const sourcedCandidates = candidates.filter((c) => (c.row.source ?? "").trim() !== "");
  const selected = selectIncidents(
    dedupeCandidateEvents(sourcedCandidates.length > 0 ? sourcedCandidates : candidates),
  );

  // 9a. Enforcement panel — the deduped enforcement outcomes, as their own set
  //     of register rows, EXCLUDED from every operational total above. Rows are
  //     built exactly like the operational appendix (cleaned, neutralised
  //     summary) and ordered most-recent first. The statement is data-derived
  //     (a plain count of reported outcomes) and NEVER a "media coverage" claim.
  const enforcementRows: CargoAppendixRow[] = enforcementClustered
    .slice()
    .sort((a, b) => b.primary.occurredAt.localeCompare(a.primary.occurredAt))
    .map((ec) => {
      const e = ec.cluster.enrichment;
      const p = ec.primary;
      const text = primaryText(p);
      const sev = enforcementDisplaySeverity(text);
      return {
        id: String(p.id ?? ec.cluster.id),
        date: p.occurredAt,
        location: shortLocation(p),
        category: ec.category,
        summary: cleanSummary(p.title),
        severityLabel: sev.label,
        severityKey: sev.key,
        confidence: e.confidence === "Low" ? "Unconfirmed" : "",
        country: cargoCountry(toIncidentLike(p)) ?? "",
        confidenceLabel: e.confidence ?? "",
        status: e.status ?? "",
        cargoType: e.cargoType ?? "",
        company: e.company ?? "",
        ...renderableSourceLink(ec.cluster.sourceLinks),
        operationalRelevance: "",
        clientStatus: deriveClientStatus(primaryText(p)),
      };
    });
  const enforcement: CargoEnforcementPanel = {
    total: enforcementRows.length,
    rows: enforcementRows,
    statement:
      enforcementRows.length === 0
        ? "No enforcement outcomes reported this period."
        : `${enforcementRows.length} enforcement ${
            enforcementRows.length === 1 ? "outcome" : "outcomes"
          } reported this period (arrests, seizures or recoveries). Dates reflect when the enforcement action was reported, not necessarily when the underlying theft occurred. These are shown separately and excluded from the incident totals above.`,
  };

  const namedPlaces = extractNamedPlaces(primaries);
  const stageCategoryNote = buildStageCategoryNote(stages, derived);
  const highSeverityNote = buildHighSeverityNote(appendix);

  // 9b. Map title — a theft-only predicate (spec pt3). When every operational
  //     category present is a theft/loss category the map plots theft; otherwise
  //     it plots the broader "security reporting".
  const operationalCategories = derived.map((d) => d.category);
  const mapTitle = isTheftOnly(operationalCategories)
    ? "Cargo Theft Incidents by Country"
    : "Cargo Security Reporting by Country";

  // 10. Data-derived captions (spec PAGE 2). No hardcoded names/dates.
  const mapCaption = buildMapCaption(intensity, totalUnique);
  const trendCaption = buildTrendCaption(extras, stages, issueDate);

  // 11. Operational assessment defaults (editor overrides applied at render).
  const assessment = buildAssessment(
    primaries,
    patterns,
    stages,
    extras,
    totalUnique,
    selected,
    appendix,
    namedPlaces,
    countryExposures(primaries),
  );

  const model: CargoPatternModel = {
    totalUnique,
    isEmpty,
    clusters,
    primaries,
    fastFacts,
    extras,
    intensity,
    mapTitle,
    mapCaption,
    trendCaption,
    stageCategoryNote,
    highSeverityNote,
    namedPlaces,
    stages,
    patterns,
    activity,
    matrix,
    appendix,
    selected,
    enforcement,
    executiveSummary: "",
    assessment,
  };
  model.executiveSummary = buildCargoExecutiveSummary(model);
  return model;
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
    return `All located reporting this period sits in ${name}.`;
  }
  return `Reporting was concentrated in ${name} (${share}% of located incidents).`;
}

function buildTrendCaption(
  extras: CargoReportExtras,
  stages: CargoStageSummary[],
  issueDate: string,
): string {
  const trend = extras.trend;
  if (trend.length < 2) return "";
  const lastPt = trend[trend.length - 1];
  const prevPt = trend[trend.length - 2];
  const lastDays = weekEffectiveDays(lastPt, issueDate);
  const prevDays = weekEffectiveDays(prevPt, issueDate);
  const lastRate = lastPt.count / lastDays;
  const prevRate = prevPt.count / prevDays;
  const leadStage = stages
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((s) => s.count > 0)[0];
  const driver = leadStage ? ` driven mainly by ${leadStage.label.toLowerCase()} incidents` : "";
  const partialNote =
    lastPt.partial || prevPt.partial
      ? ", comparing incidents per day because one or both weeks are partial"
      : "";
  if (lastRate > prevRate * 1.08) {
    return `Activity increased during the final reporting week${driver}${partialNote}.`;
  }
  if (lastRate < prevRate * 0.92) {
    return `Activity was lower during the final reporting week than the preceding week${driver}${partialNote}.`;
  }
  return `Activity held broadly steady across the closing weeks of the period${partialNote}.`;
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

// --- Executive summary (spec TASK A) --------------------------------------

// STRICT rising check for the weekly totals: only true when the last three
// reporting weeks are monotonically non-decreasing AND the final week exceeds
// the first of the three. Anything shorter, flat or choppy is NOT "rising", so
// the summary never claims a trend the data does not support.
export function isWeeklyRising(weeklyTotals: number[]): boolean {
  const t = weeklyTotals.slice(-3);
  if (t.length < 3) return false;
  return t[2] > t[0] && t[2] >= t[1] && t[1] >= t[0];
}

// Build the single-paragraph analytical executive summary. Deterministic and
// data-derived: names the dominant supply-chain stage, the leading one or two
// patterns, the principal geography (not every country), law-enforcement only
// where material, the overall severity and the main operational implication. No
// record counts, no numerals, none of the banned crutch phrases; "rising" and
// organised-crime framing appear only when the data supports them. Appends the
// exact indicative-reporting note only when reporting is thin (< 5 unique).
export function buildCargoExecutiveSummary(model: CargoPatternModel): string {
  if (model.totalUnique === 0) {
    return "No qualifying cargo-security incidents were identified during the reporting period. Reporting remains indicative rather than comprehensive.";
  }

  const leadStage = model.stages
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((s) => s.count > 0)[0];
  const stagePhrase = leadStage
    ? `${leadStage.label.toLowerCase()} activity`
    : "activity spread across the supply chain";

  const leadPatterns = model.patterns.slice(0, 2).map((p) => p.name.toLowerCase());
  let patternClause: string;
  if (leadPatterns.length >= 2) {
    patternClause = `, with ${leadPatterns[0]} and ${leadPatterns[1]} the clearest drivers of exposure`;
  } else if (leadPatterns.length === 1) {
    patternClause = `, with ${leadPatterns[0]} the clearest driver of exposure`;
  } else {
    patternClause = "";
  }
  const risingClause = isWeeklyRising(model.activity.weeklyTotals)
    ? ", and reported activity rose towards the end of the period"
    : "";
  const s1 = `Cargo-security reporting this period centred on ${stagePhrase}${patternClause}${risingClause}.`;

  const geo = topCountry(model.primaries);
  const s2 = geo
    ? `Reporting was most concentrated in ${geo}.`
    : `Reporting was geographically dispersed, with no single country dominating.`;

  const sevCount = new Map<string, number>();
  for (const r of model.appendix) {
    const k = r.severityKey || sevKey(r.severityLabel);
    sevCount.set(k, (sevCount.get(k) ?? 0) + 1);
  }
  let modalKey = "moderate";
  let modalN = -1;
  let highestKey = "insignificant";
  for (const [k, n] of sevCount) {
    if (n > modalN || (n === modalN && (SEV_RANK[k] ?? 0) > (SEV_RANK[modalKey] ?? 0))) {
      modalN = n;
      modalKey = k;
    }
    if ((SEV_RANK[k] ?? 0) > (SEV_RANK[highestKey] ?? 0)) highestKey = k;
  }
  const modalLabel = (SEV_LABEL[modalKey] ?? modalKey).toLowerCase();
  const highCount = [...sevCount.entries()]
    .filter(([k]) => (SEV_RANK[k] ?? 0) >= 4)
    .reduce((s, [, n]) => s + n, 0);
  const s3 =
    highCount === 1
      ? `Overall severity was predominantly ${modalLabel}, with one High-rated operational incident reflecting violence, loss or disruption rather than a law-enforcement outcome.`
      : (SEV_RANK[highestKey] ?? 0) > (SEV_RANK[modalKey] ?? 0)
        ? `Overall severity was predominantly ${modalLabel}, with a minority of events reaching ${(SEV_LABEL[highestKey] ?? highestKey).toLowerCase()} severity.`
        : `Overall severity was predominantly ${modalLabel}, with no higher-tier events recorded.`;

  const concern = leadStage
    ? leadStage.primaryConcern.toLowerCase()
    : "cargo-in-transit protection";
  const s4 = `This keeps ${concern} the main operational priority for the period.`;

  const thinNote =
    model.totalUnique < 5 ? " Reporting remains indicative rather than comprehensive." : "";

  return `${s1} ${s2} ${s3} ${s4}${thinNote}`;
}

// --- Assessment defaults --------------------------------------------------

function buildAssessment(
  primaries: CargoClusterInput[],
  patterns: CargoPatternCard[],
  stages: CargoStageSummary[],
  extras: CargoReportExtras,
  totalUnique: number,
  selected: CargoAppendixRow[],
  appendix: CargoAppendixRow[],
  namedPlaces: string[],
  exposures: CountryExposure[],
): CargoAssessment {
  if (totalUnique === 0) {
    return {
      situation:
        "No qualifying cargo-security incidents were identified during the reporting period. Reporting remains limited and should be treated as indicative rather than comprehensive.",
      whatMatters: [],
      implications: [],
      implicationIncidentIds: [],
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
  const india = exposures.find((e) => e.country === "India");
  const bangladesh = exposures.find((e) => e.country === "Bangladesh");
  let geoPhrase = geo ? `, with reporting concentrated in ${geo}` : "";
  if (india && bangladesh) {
    geoPhrase = `, with India carrying most warehouse and depot-linked exposure (${india.hub} hub-side of ${india.total} records) and Bangladesh most inland-transit exposure (${bangladesh.route} route-side of ${bangladesh.total} records)`;
  } else if (india && india.hub >= india.route) {
    geoPhrase = `, with India the main pressure point on warehouse and depot-linked incidents`;
  } else if (bangladesh && bangladesh.route >= bangladesh.hub) {
    geoPhrase = `, with Bangladesh the main pressure point on inland-transit incidents`;
  } else if (geo) {
    geoPhrase = `, with reporting concentrated in ${geo}`;
  }
  const limited = totalUnique < 5;
  const limitNote = limited
    ? " Reporting remains limited and should be treated as indicative rather than comprehensive."
    : "";

  const leadPatternNames = patterns.slice(0, 2).map((p) => p.name.toLowerCase());
  const patternClause =
    leadPatternNames.length >= 2
      ? `, with ${leadPatternNames[0]} and ${leadPatternNames[1]} the clearest patterns`
      : leadPatternNames.length === 1
        ? `, with ${leadPatternNames[0]} the clearest pattern`
        : "";

  const situation = leadStage
    ? `Reported events this period fell mainly in ${leadStage.label.toLowerCase()}${geoPhrase}${patternClause}.${limitNote}`
    : `Reported events this period were spread across the supply chain${geoPhrase}${patternClause}.${limitNote}`;

  const audiences = ["cargo owners", "logistics operators", "security teams"];
  const whatMatters: string[] = patterns.slice(0, 3).map((p, i) => {
    const where = p.primaryGeography ? ` in ${p.primaryGeography}` : "";
    const who = audiences[i % audiences.length];
    if (p.primaryGeography === "India" || (india && p.primaryGeography === "India")) {
      return `${p.name}${where} is adding to warehouse and depot-side inventory risk for ${who} this period.`;
    }
    if (p.primaryGeography === "Bangladesh" || (bangladesh && p.primaryGeography === "Bangladesh")) {
      return `${p.name}${where} is adding to inland-transit loss and delay exposure for ${who} this period.`;
    }
    return `${p.name}${where} accounts for a material share of reported losses, raising near-term fulfilment and insurance exposure for ${who}.`;
  });

  // IMPLICATIONS — up to three practical implications, each tied to a SPECIFIC
  // reported incident (spec pt4). Drawn from the curated Key Incidents first,
  // topped up from the operational register so each implication traces to a real
  // incident id — never a generic security control. The stage is re-derived from
  // the incident text so an inland-waterway event reads as such, not road.
  const implicationRows: CargoAppendixRow[] = [...selected];
  for (const r of appendix) {
    if (implicationRows.length >= 3) break;
    if (!implicationRows.some((x) => x.id === r.id)) implicationRows.push(r);
  }
  const implications: string[] = [];
  const implicationIncidentIds: string[] = [];
  for (const row of implicationRows.slice(0, 3)) {
    const st = stageForIncident(row.category, `${row.category} ${row.summary}`);
    const stageLabel = (STAGE_META[st]?.label ?? "supply-chain").toLowerCase();
    const cat = row.category.toLowerCase();
    const where = row.country
      ? ` in ${row.country}`
      : row.location
        ? ` at ${row.location}`
        : "";
    const detail = row.summary.split(/[.!?]/)[0]?.trim() ?? row.summary;
    implications.push(
      `The ${cat}${where} case confirms ${stageLabel} as a live exposure point: ${detail}.`,
    );
    implicationIncidentIds.push(row.id);
  }

  const watchNext: string[] = [];
  for (const p of patterns) {
    if (watchNext.length >= 4) break;
    if (p.watchNext && !watchNext.includes(p.watchNext)) watchNext.push(p.watchNext);
  }
  if (watchNext.length < 3) {
    const corpus = appendix.map((r) => r.summary).join(" ").toLowerCase();
    const topUps = [
      namedPlaces.length >= 2
        ? `Repeat incidents around ${namedPlaces.slice(0, 2).join(" and ")}.`
        : namedPlaces.length === 1
          ? `Repeat incidents around ${namedPlaces[0]}.`
          : "",
      india && bangladesh
        ? `Whether India warehouse losses and Bangladesh transit losses continue on separate tracks rather than converging.`
        : "",
      leadStage
        ? `Repeat use of the methods characterising ${leadStage.label.toLowerCase()} incidents.`
        : "",
      /\binsider|employee|staff|collusion\b/i.test(corpus)
        ? "Any further reporting naming insider or staff involvement."
        : "",
      "Reports naming the same targeted cargo types more than once.",
    ].filter(Boolean);
    for (const t of topUps) {
      if (watchNext.length >= 3) break;
      if (!watchNext.includes(t)) watchNext.push(t);
    }
  }
  const watchNextCapped = watchNext.slice(0, 4);

  const polestarView = buildPolestarView({
    leadStage,
    geo,
    leadPatternNames,
    stages,
    totalUnique,
    appendix,
    india,
    bangladesh,
  });

  return {
    situation,
    whatMatters,
    implications,
    implicationIncidentIds,
    watchNext: watchNextCapped,
    polestarView,
  };
}

// POLESTAR VIEW — 120-160 words covering six required elements in order (spec
// pt4): (1) the principal analytical judgement, (2) what the data supports,
// (3) what the data does not support, (4) important reporting limitations,
// (5) the near-term outlook and (6) the confidence level. Deterministic and
// data-derived; no fabrication and no banned crutch phrases. Sentences are
// written full enough that the six-element paragraph reliably clears the
// 120-word floor the validation gate enforces.
function buildPolestarView(args: {
  leadStage: CargoStageSummary | undefined;
  geo: string | null;
  leadPatternNames: string[];
  stages: CargoStageSummary[];
  totalUnique: number;
  appendix: CargoAppendixRow[];
  india?: CountryExposure;
  bangladesh?: CountryExposure;
}): string {
  const { leadStage, geo, leadPatternNames, totalUnique, appendix, india, bangladesh } =
    args;
  const stagePhrase = leadStage
    ? `${leadStage.label.toLowerCase()} exposure`
    : "exposure spread across the supply chain";
  const patternsPhrase =
    leadPatternNames.length >= 2
      ? `${leadPatternNames[0]} and ${leadPatternNames[1]}`
      : leadPatternNames.length === 1
        ? leadPatternNames[0]
        : "recurring cargo theft";

  // Modal severity for the "what the data supports" element.
  const sevCount = new Map<string, number>();
  for (const r of appendix) {
    const k = r.severityKey || sevKey(r.severityLabel);
    sevCount.set(k, (sevCount.get(k) ?? 0) + 1);
  }
  let modalKey = "moderate";
  let modalN = -1;
  for (const [k, n] of sevCount) {
    if (n > modalN || (n === modalN && (SEV_RANK[k] ?? 0) > (SEV_RANK[modalKey] ?? 0))) {
      modalN = n;
      modalKey = k;
    }
  }
  const modalLabel = (SEV_LABEL[modalKey] ?? modalKey).toLowerCase();

  const confidenceWord =
    totalUnique < 5 ? "low" : totalUnique < 12 ? "moderate" : "moderate";
  const confidenceBasis =
    totalUnique < 5
      ? "reflecting thin open-source coverage and limited enrichment"
      : "reflecting open-source volume that is often single-source rather than independently corroborated, plus enrichment gaps";

  const judgement =
    india && bangladesh
      ? `The standing judgement is that reported cargo crime this period remains opportunistic and financially motivated: India is the main warehouse and depot concern, Bangladesh the main inland-transit concern, not a coordinated cross-border campaign.`
      : `The standing judgement is that reported cargo crime this period remains opportunistic and financially motivated${geo ? `, with the clearest pressure around ${geo}` : ""}, not a coordinated or politically driven campaign.`;
  const supports = `What the records support is ${patternsPhrase} affecting ${stagePhrase}, with ${modalLabel} severity the most common outcome for fresh operational incidents.`;
  const notSupport = `They do not establish an organised cross-border network, driver-vetting or escort gaps as default explanations, or a statistically meaningful surge. Arrest and recovery reports are dated to enforcement actions and are not treated as fresh thefts in this period.`;
  const limits = `Open-source reporting and enrichment remain partial: loss values, cargo types and movement stage are frequently unstated, so totals and shares are indicative, not exhaustive.`;
  const outlook =
    india && bangladesh
      ? `Near-term outlook: further warehouse-side incidents are most likely in India and further transit-side incidents in Bangladesh unless local enforcement or operator measures change.`
      : `Near-term outlook: further ${leadStage ? leadStage.label.toLowerCase() : "cargo-security"} incidents of a similar character are likely${geo ? ` in and around ${geo}` : ""}, absent a change in local enforcement or operators' own measures.`;
  const confidence = `Overall analytical confidence is ${confidenceWord}, ${confidenceBasis}.`;

  return `${judgement} ${supports} ${notSupport} ${limits} ${outlook} ${confidence}`;
}
