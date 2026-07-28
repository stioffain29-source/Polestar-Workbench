// Narrative generation for @workspace/country-engine (owner brief §14–22, §27,
// §29–31). Pure functions only — no runtime dependencies.
//
// Every analytical sentence is backed by an EvidenceRecord (§29). All prose is
// British English, short sentences, fact separated from judgement, no banned
// phrases (§30), no counts-in-prose beyond the approved formats.
//
// Inputs are ALWAYS the already validated/deduped included CanonicalEvent[].

import type {
  CanonicalEvent,
  EvidenceRecord,
  ClaimType,
  IssueCategory,
  Severity,
} from "./types";
import {
  BANNED_PHRASES,
  BANNED_OPENERS,
  findBannedPhrases,
  findBannedOpeners,
} from "./bannedPhrases";

// Re-export the banned-phrase surface so callers can reach it via ./narrative.
export {
  BANNED_PHRASES,
  BANNED_OPENERS,
  findBannedPhrases,
  findBannedOpeners,
} from "./bannedPhrases";

// ---------------------------------------------------------------------------
// Trend gate (§16) — comparison wording is only permitted with prior data.
// ---------------------------------------------------------------------------

// Words/phrases that assert a change over time. Only legal when comparative
// data (a previous equivalent reporting period) exists.
export const TREND_WORDS: string[] = [
  "rose",
  "fell",
  "increased",
  "decreased",
  "continues",
  "further",
  "escalating",
  "easing",
  "worsening",
  "worsened",
  "improving",
  "improved",
  "deteriorating",
  "deteriorated",
  "building",
  "spreading",
  "stabilising",
  "accelerating",
  "returning to normal",
  "remaining elevated",
  "falling from a high baseline",
  "more prominent",
  "less prominent",
  "up from",
  "down from",
  "compared with the previous",
];

/**
 * §16 — reject any comparison/trend wording unless comparative data exists.
 * Returns the list of offending trend words found in the text. When
 * `hasPriorData` is true, no violations are reported.
 */
export function assertNoUnsupportedTrend(
  text: string,
  hasPriorData: boolean,
): string[] {
  if (!text || hasPriorData) return [];
  const haystack = text.toLowerCase();
  const violations: string[] = [];
  for (const word of TREND_WORDS) {
    // Word-boundary match to avoid catching substrings (e.g. "further" inside
    // "furthermore" is still a trend word, but "increased" inside a larger
    // token would be unusual — use boundaries for whole-word trend markers).
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    if (re.test(haystack)) violations.push(word);
  }
  return violations;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Evidence records (§29)
// ---------------------------------------------------------------------------

let claimCounter = 0;

/** Reset the internal claim id counter (deterministic output in tests). */
export function resetClaimIds(): void {
  claimCounter = 0;
}

export interface MakeClaimInput {
  claimText: string;
  section: string;
  supportingEventIds?: string[];
  supportingSourceIds?: string[];
  supportingMetric?: string | null;
  claimType: ClaimType;
  confidence?: number;
}

/**
 * §29 — build an internal EvidenceRecord for a single analytical sentence.
 * Every rendered analytical sentence must be linked to one of these.
 */
export function makeClaim(input: MakeClaimInput): EvidenceRecord {
  claimCounter += 1;
  return {
    claimId: `claim-${claimCounter}`,
    claimText: input.claimText,
    section: input.section,
    supportingEventIds: input.supportingEventIds ?? [],
    supportingSourceIds: input.supportingSourceIds ?? [],
    supportingMetric: input.supportingMetric ?? null,
    claimType: input.claimType,
    confidence: input.confidence ?? 80,
  };
}

// ---------------------------------------------------------------------------
// Word-cap enforcement — trim at sentence boundaries, never mid-sentence.
// ---------------------------------------------------------------------------

/** Count words in a string (whitespace-delimited). */
export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Split prose into sentences, preserving terminal punctuation. */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:["'”’)]+)?|\S+$/g);
  if (!matches) return text.trim() ? [text.trim()] : [];
  return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * Enforce a maximum word count WITHOUT cutting a sentence in half. Whole
 * sentences are dropped from the end until the remainder fits within `max`
 * words. If even the first sentence exceeds the cap it is kept whole (a
 * complete sentence is preferable to a truncated fragment — §30 "grammatically
 * complete").
 */
export function capWords(text: string, max: number): string {
  if (countWords(text) <= max) return text.trim();
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let total = 0;
  for (const sentence of sentences) {
    const w = countWords(sentence);
    if (kept.length > 0 && total + w > max) break;
    kept.push(sentence);
    total += w;
    if (total >= max) break;
  }
  return kept.join(" ").trim();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  Insignificant: 0,
  Low: 1,
  Moderate: 2,
  High: 3,
  Extreme: 4,
};

function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 0;
}

/** Human-readable location for an event, most specific first. */
function locationLabel(e: CanonicalEvent): string {
  return (
    e.city ||
    e.district ||
    e.provinceOrState ||
    e.physicalCountry ||
    "an unspecified location"
  );
}

/**
 * §14/§15 — turn a possibly raw wire headline into a natural-language title.
 * Never render an all-caps/shouty headline or trailing wire cruft in prose.
 *  - Strips leading/trailing colons, semicolons, dashes and surrounding quotes.
 *  - Collapses internal whitespace.
 *  - If the string is "shouty" (mostly upper case), converts it to sentence
 *    case (leading capital, remainder lower case). Naturally-cased titles are
 *    left intact so genuine proper nouns are preserved.
 */
export function naturaliseTitle(title: string): string {
  if (!title) return "";
  // Collapse whitespace and strip leading/trailing wire punctuation.
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’\s:;\-–—]+/, "").replace(/["'“”‘’\s:;\-–—]+$/, "");
  t = t.trim();
  if (!t) return "";

  // Detect a shouty headline: of the alphabetic characters, if the vast
  // majority are upper case, treat the whole title as ALL-CAPS wire text.
  const letters = t.replace(/[^A-Za-z]/g, "");
  const upper = t.replace(/[^A-Z]/g, "");
  const isShouty = letters.length > 0 && upper.length / letters.length >= 0.7;

  if (isShouty) {
    t = t.toLowerCase();
  }

  // Ensure a leading capital.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/**
 * §15 — the sub-national location for an event, or null when the location is
 * Country only / Unknown (in which case no location clause should be rendered).
 */
function subNationalLocation(e: CanonicalEvent): string | null {
  if (e.locationPrecision === "Country only" || e.locationPrecision === "Unknown") {
    return null;
  }
  const sub = e.city || e.district || e.provinceOrState;
  return sub || null;
}

/**
 * §15 — a location clause such as " in Morobe", or "" when the location is
 * Country only / Unknown. Never produces "at <Country>".
 */
function locationClause(e: CanonicalEvent): string {
  const sub = subNationalLocation(e);
  return sub ? ` in ${sub}` : "";
}

/** Format an ISO date into a plain British-English date, e.g. "5 March". */
function formatDate(iso: string | null): string {
  if (!iso) return "an undated occasion";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthName = MONTHS[month - 1] ?? "";
  if (!monthName) return iso;
  return `${day} ${monthName} ${year}`;
}

/** Lower-case a category label for mid-sentence use. */
function categoryPhrase(c: IssueCategory): string {
  return c.charAt(0).toLowerCase() + c.slice(1);
}

/** Combine a list into "a, b and c". */
function joinAnd(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Unique, order-preserving list. */
function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

/** Rank events by §14 factors and return them highest-priority first. */
function rankEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  return [...events].sort((a, b) => {
    // Deaths / serious injuries.
    const casA = (a.casualties ?? 0) + (a.injuries ?? 0);
    const casB = (b.casualties ?? 0) + (b.injuries ?? 0);
    // Severity.
    const sevA = severityRank(a.severity);
    const sevB = severityRank(b.severity);
    // Direct operational impact (confirmed effect present).
    const opA = a.confirmedOperationalEffect ? 1 : 0;
    const opB = b.confirmedOperationalEffect ? 1 : 0;
    // Continuing threat.
    const ongoingA = a.eventStatus === "Ongoing" ? 1 : 0;
    const ongoingB = b.eventStatus === "Ongoing" ? 1 : 0;

    if (sevB !== sevA) return sevB - sevA;
    if (casB !== casA) return casB - casA;
    if (opB !== opA) return opB - opA;
    if (ongoingB !== ongoingA) return ongoingB - ongoingA;
    // Confidence as final tie-break.
    return b.classificationConfidence - a.classificationConfidence;
  });
}

/** The single most significant validated event. */
function mostSignificant(events: CanonicalEvent[]): CanonicalEvent | null {
  const ranked = rankEvents(events);
  return ranked[0] ?? null;
}

/** Group events by primary issue category. */
function groupByCategory(
  events: CanonicalEvent[],
): Map<IssueCategory, CanonicalEvent[]> {
  const map = new Map<IssueCategory, CanonicalEvent[]>();
  for (const e of events) {
    const list = map.get(e.issueCategory) ?? [];
    list.push(e);
    map.set(e.issueCategory, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// §14 — Top Three Developments
// ---------------------------------------------------------------------------

export interface TopDevelopment {
  eventId: string;
  title: string;
  date: string | null;
  location: string;
  category: IssueCategory;
  severity: Severity;
  factualSentence: string;
  // Proportionate, evidence-based; null when there is no basis (omit, not
  // invent — §14).
  businessSentence: string | null;
}

export interface NarrativeResult<T> {
  value: T;
  claims: EvidenceRecord[];
}

/**
 * §14 — select the top developments (up to three) from validated, deduped,
 * confirmed events, ranked by severity + operational relevance + confirmed
 * status. Each entry carries a factual sentence and a proportionate,
 * evidence-based business sentence (omitted where there is no basis).
 */
export function buildTopThree(
  events: CanonicalEvent[],
): NarrativeResult<TopDevelopment[]> {
  const claims: EvidenceRecord[] = [];
  // §14 excludes commentary/background/not-an-incident/cancelled from top slots.
  const eligible = events.filter(
    (e) =>
      e.eventStatus !== "Commentary" &&
      e.eventStatus !== "Background" &&
      e.eventStatus !== "Not an incident" &&
      e.eventStatus !== "Cancelled",
  );
  const ranked = rankEvents(eligible).slice(0, 3);

  const value: TopDevelopment[] = ranked.map((e) => {
    const location = locationLabel(e);
    const factualSentence = e.eventSummary.trim();
    claims.push(
      makeClaim({
        claimText: factualSentence,
        section: "Top Developments",
        supportingEventIds: [e.eventId],
        supportingSourceIds: e.supportingSourceIds,
        claimType: "Confirmed fact",
        confidence: e.classificationConfidence,
      }),
    );

    // Business sentence — only where there is a confirmed effect or an assessed
    // operational relevance; otherwise omit (do not invent — §14).
    let businessSentence: string | null = null;
    if (e.confirmedOperationalEffect) {
      businessSentence = e.confirmedOperationalEffect.trim();
      claims.push(
        makeClaim({
          claimText: businessSentence,
          section: "Top Developments",
          supportingEventIds: [e.eventId],
          supportingSourceIds: e.supportingSourceIds,
          claimType: "Confirmed fact",
          confidence: e.classificationConfidence,
        }),
      );
    } else if (e.assessedOperationalRelevance) {
      businessSentence = e.assessedOperationalRelevance.trim();
      claims.push(
        makeClaim({
          claimText: businessSentence,
          section: "Top Developments",
          supportingEventIds: [e.eventId],
          supportingSourceIds: e.supportingSourceIds,
          claimType: "Assessment",
          confidence: e.classificationConfidence,
        }),
      );
    }

    return {
      eventId: e.eventId,
      title: naturaliseTitle(e.eventTitle),
      date: e.eventDate,
      location,
      category: e.issueCategory,
      severity: e.severity,
      factualSentence,
      businessSentence,
    };
  });

  return { value, claims };
}

// ---------------------------------------------------------------------------
// §15 — Bottom Line Up Front (≤120 words)
// ---------------------------------------------------------------------------

const BLUF_MAX_WORDS = 120;

/**
 * §15 — Bottom Line Up Front. Approved three-part structure:
 *  1. Most significant validated development (with location + date).
 *  2. Overall reporting pattern THIS period — categories and where concentrated.
 *  3. Practical meaning for business operations (only evidence-based).
 * ≤120 words. Never begins with a banned opener or a copied headline.
 */
export function buildBluf(
  events: CanonicalEvent[],
  countryName: string,
  priorPeriodEvents: CanonicalEvent[] | null,
): NarrativeResult<string> {
  const claims: EvidenceRecord[] = [];
  const hasPriorData = priorPeriodEvents != null;

  if (events.length === 0) {
    const text = capWords(
      `Reporting was limited in ${countryName} during the period, and no significant validated security events were recorded.`,
      BLUF_MAX_WORDS,
    );
    claims.push(
      makeClaim({
        claimText: text,
        section: "Bottom Line Up Front",
        claimType: "Confirmed fact",
        confidence: 90,
      }),
    );
    return { value: text, claims };
  }

  const lead = mostSignificant(events)!;
  const byCat = groupByCategory(events);
  const topCategories = [...byCat.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([c]) => categoryPhrase(c));
  const locations = unique(events.map((e) => locationLabel(e))).slice(0, 3);

  // Sentence 1 — most significant development with location + date. The title
  // is naturalised (never a raw wire headline) and the location clause is
  // omitted when the location is Country only / Unknown (§14/§15).
  const s1 =
    `The most serious validated development in ${countryName} was ` +
    `${lowerFirst(naturaliseTitle(lead.eventTitle))}${locationClause(lead)} on ${formatDate(lead.eventDate)}.`;
  claims.push(
    makeClaim({
      claimText: s1,
      section: "Bottom Line Up Front",
      supportingEventIds: [lead.eventId],
      supportingSourceIds: lead.supportingSourceIds,
      claimType: "Confirmed fact",
      confidence: lead.classificationConfidence,
    }),
  );

  // Sentence 2 — reporting pattern this period (categories + concentration).
  const catText = joinAnd(topCategories);
  const locText = locations.length ? joinAnd(locations) : countryName;
  const s2 =
    `During the reporting period, ${catText || "security"} events were the main concerns, ` +
    `recorded mainly in ${locText}.`;
  claims.push(
    makeClaim({
      claimText: s2,
      section: "Bottom Line Up Front",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Assessment",
      confidence: 75,
    }),
  );

  // Sentence 3 — practical meaning for operations (only evidence-based).
  let s3 = "";
  const confirmed = events.find((e) => e.confirmedOperationalEffect);
  if (confirmed && confirmed.confirmedOperationalEffect) {
    s3 = `${confirmed.confirmedOperationalEffect.trim()}`;
    if (!/[.!?]$/.test(s3)) s3 += ".";
    claims.push(
      makeClaim({
        claimText: s3,
        section: "Bottom Line Up Front",
        supportingEventIds: [confirmed.eventId],
        supportingSourceIds: confirmed.supportingSourceIds,
        claimType: "Confirmed fact",
        confidence: confirmed.classificationConfidence,
      }),
    );
  } else {
    // No confirmed effect — state the localised nature only (evidence-based).
    const scope =
      locations.length > 1 ? "varies by location" : "appears localised";
    s3 = `Businesses should note that risk ${scope} and plan movement around the affected areas.`;
    claims.push(
      makeClaim({
        claimText: s3,
        section: "Bottom Line Up Front",
        supportingEventIds: events.map((e) => e.eventId),
        claimType: "Assessment",
        confidence: 70,
      }),
    );
  }

  let text = capWords([s1, s2, s3].join(" "), BLUF_MAX_WORDS);

  // §16 — strip trend wording if there is no comparative data. The composed
  // BLUF uses "During the reporting period" (neutral) so this is defensive.
  const trend = assertNoUnsupportedTrend(text, hasPriorData);
  if (trend.length > 0) {
    // Fall back to the neutral lead sentence only.
    text = capWords(s1, BLUF_MAX_WORDS);
  }

  return { value: text, claims };
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// §17 — Category introductions (≤90 words each)
// ---------------------------------------------------------------------------

const CATEGORY_INTRO_MAX_WORDS = 90;

/**
 * §17 — approved category-introduction format. States what was reported (types,
 * locations, dates), the severity range, and the most notable event. No generic
 * sector talk. ≤90 words.
 */
export function buildCategoryIntro(
  category: IssueCategory,
  catEvents: CanonicalEvent[],
): NarrativeResult<string> {
  const claims: EvidenceRecord[] = [];
  if (catEvents.length === 0) {
    return { value: "", claims };
  }

  const count = catEvents.length;
  const locations = unique(catEvents.map((e) => locationLabel(e))).slice(0, 4);
  const notable = mostSignificant(catEvents)!;
  const severities = catEvents.map((e) => e.severity);
  const minSev = severities.reduce((a, b) =>
    severityRank(a) <= severityRank(b) ? a : b,
  );
  const maxSev = severities.reduce((a, b) =>
    severityRank(a) >= severityRank(b) ? a : b,
  );

  const eventWord = count === 1 ? "event" : "events";
  const s1 = `${count} validated ${categoryPhrase(category)} ${eventWord} were recorded, mainly in ${joinAnd(locations) || notable.physicalCountry}.`;
  const sevText =
    minSev === maxSev
      ? `Severity was rated ${minSev}.`
      : `Severity ranged from ${minSev} to ${maxSev}.`;
  const s2 = `The most serious was ${lowerFirst(naturaliseTitle(notable.eventTitle))} on ${formatDate(notable.eventDate)}.`;

  // Confirmed effect, where any.
  let s3 = "";
  const effect = catEvents.find((e) => e.confirmedOperationalEffect);
  if (effect && effect.confirmedOperationalEffect) {
    s3 = `${effect.confirmedOperationalEffect.trim()}`;
    if (!/[.!?]$/.test(s3)) s3 += ".";
  }

  claims.push(
    makeClaim({
      claimText: s1,
      section: `Category: ${category}`,
      supportingEventIds: catEvents.map((e) => e.eventId),
      supportingMetric: `count=${count}`,
      claimType: "Confirmed fact",
      confidence: 85,
    }),
    makeClaim({
      claimText: s2,
      section: `Category: ${category}`,
      supportingEventIds: [notable.eventId],
      supportingSourceIds: notable.supportingSourceIds,
      claimType: "Confirmed fact",
      confidence: notable.classificationConfidence,
    }),
  );
  if (s3) {
    claims.push(
      makeClaim({
        claimText: s3,
        section: `Category: ${category}`,
        supportingEventIds: [effect!.eventId],
        supportingSourceIds: effect!.supportingSourceIds,
        claimType: "Confirmed fact",
        confidence: effect!.classificationConfidence,
      }),
    );
  }

  const text = capWords(
    [s1, sevText, s2, s3].filter(Boolean).join(" "),
    CATEGORY_INTRO_MAX_WORDS,
  );
  return { value: text, claims };
}

// ---------------------------------------------------------------------------
// §18 — Current Situation (≤120 words)
// ---------------------------------------------------------------------------

const CURRENT_SITUATION_MAX_WORDS = 120;

/**
 * §18 — Current Situation. Country-specific, references actual reported events.
 * If reporting was limited, say exactly that. ≤120 words.
 */
export function buildCurrentSituation(
  events: CanonicalEvent[],
  countryName: string,
): NarrativeResult<string> {
  const claims: EvidenceRecord[] = [];

  if (events.length === 0) {
    const text = `Reporting was limited in ${countryName} during the period. No significant validated security events were recorded.`;
    claims.push(
      makeClaim({
        claimText: text,
        section: "Current Situation",
        claimType: "Confirmed fact",
        confidence: 90,
      }),
    );
    return { value: capWords(text, CURRENT_SITUATION_MAX_WORDS), claims };
  }

  const byCat = groupByCategory(events);
  const principal = [...byCat.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([c]) => categoryPhrase(c));
  const locations = unique(events.map((e) => locationLabel(e)));

  const s1 = `Security incidents in ${countryName} during the reporting period were concentrated in ${joinAnd(locations.slice(0, 3)) || countryName}.`;
  const s2 = `${capitaliseFirst(joinAnd(principal.slice(0, 2)) || "Security events")} were the principal concerns.`;
  const s3 =
    locations.length > 1
      ? "The incidents do not currently form a single nationwide pattern; risk varies by location, and movement decisions should be based on current conditions at the destination."
      : "The incidents remain localised, and movement decisions should be based on current conditions at the destination.";

  claims.push(
    makeClaim({
      claimText: s1,
      section: "Current Situation",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Confirmed fact",
      confidence: 85,
    }),
    makeClaim({
      claimText: s2,
      section: "Current Situation",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Assessment",
      confidence: 75,
    }),
    makeClaim({
      claimText: s3,
      section: "Current Situation",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Assessment",
      confidence: 70,
    }),
  );

  const text = capWords([s1, s2, s3].join(" "), CURRENT_SITUATION_MAX_WORDS);
  return { value: text, claims };
}

function capitaliseFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// §19 — Operational Impact (≤50 words per category)
// ---------------------------------------------------------------------------

const OPERATIONAL_IMPACT_MAX_WORDS = 50;

export interface OperationalImpactEntry {
  category: IssueCategory;
  text: string;
}

/**
 * §19 — per-category operational impact. Only event-linked impacts, drawn from
 * confirmedOperationalEffect / assessedOperationalRelevance. Categories with
 * nothing to say are SKIPPED, not invented. ≤50 words per category.
 */
export function buildOperationalImpact(
  eventsByCategory: Map<IssueCategory, CanonicalEvent[]>,
): NarrativeResult<OperationalImpactEntry[]> {
  const claims: EvidenceRecord[] = [];
  const value: OperationalImpactEntry[] = [];

  for (const [category, catEvents] of eventsByCategory) {
    const confirmed = catEvents.filter((e) => e.confirmedOperationalEffect);
    const assessed = catEvents.filter(
      (e) => !e.confirmedOperationalEffect && e.assessedOperationalRelevance,
    );

    // Nothing event-linked to say — skip (do not invent — §19).
    if (confirmed.length === 0 && assessed.length === 0) continue;

    const parts: string[] = [];

    if (confirmed.length > 0) {
      const e = confirmed[0];
      const sentence = `${e.confirmedOperationalEffect!.trim()}`;
      parts.push(sentence.endsWith(".") ? sentence : `${sentence}.`);
      claims.push(
        makeClaim({
          claimText: sentence,
          section: `Operational Impact: ${category}`,
          supportingEventIds: [e.eventId],
          supportingSourceIds: e.supportingSourceIds,
          claimType: "Confirmed fact",
          confidence: e.classificationConfidence,
        }),
      );
    }

    if (assessed.length > 0) {
      const e = assessed[0];
      const sentence = `${e.assessedOperationalRelevance!.trim()}`;
      parts.push(sentence.endsWith(".") ? sentence : `${sentence}.`);
      claims.push(
        makeClaim({
          claimText: sentence,
          section: `Operational Impact: ${category}`,
          supportingEventIds: [e.eventId],
          supportingSourceIds: e.supportingSourceIds,
          claimType: "Assessment",
          confidence: e.classificationConfidence,
        }),
      );
    }

    value.push({
      category,
      text: capWords(parts.join(" "), OPERATIONAL_IMPACT_MAX_WORDS),
    });
  }

  return { value, claims };
}

// ---------------------------------------------------------------------------
// §20 — Recommendations (from the approved menu only)
// ---------------------------------------------------------------------------

export type RecommendationGroup =
  | "Movement"
  | "Site security"
  | "Staff awareness"
  | "Transport and logistics"
  | "Escalation";

export interface ApprovedRecommendation {
  group: RecommendationGroup;
  text: string;
  // Predicate deciding whether at least one included event triggers this
  // recommendation.
  trigger: (events: CanonicalEvent[]) => CanonicalEvent[];
}

// Helpers for trigger predicates.
function hasCategory(e: CanonicalEvent, ...cats: IssueCategory[]): boolean {
  return (
    cats.includes(e.issueCategory) ||
    e.secondaryCategories.some((c) => cats.includes(c))
  );
}
function isViolent(e: CanonicalEvent): boolean {
  return hasCategory(
    e,
    "Violent crime",
    "Communal or tribal violence",
    "Terrorism",
    "Insurgency",
    "Political violence",
  );
}
function isTransport(e: CanonicalEvent): boolean {
  return hasCategory(e, "Aviation", "Maritime", "Road and rail", "Supply chain");
}
function isPolicing(e: CanonicalEvent): boolean {
  return hasCategory(e, "Policing operation");
}
function isUnrest(e: CanonicalEvent): boolean {
  return hasCategory(e, "Civil unrest", "Strike or labour action");
}
function hasConfirmedEffect(e: CanonicalEvent): boolean {
  return Boolean(e.confirmedOperationalEffect);
}
function hasRestriction(e: CanonicalEvent): boolean {
  const text = `${e.confirmedOperationalEffect ?? ""} ${e.transportImpact ?? ""} ${e.continuityImpact ?? ""}`.toLowerCase();
  return /curfew|closure|closed|restrict|roadblock|suspend|blockad/.test(text);
}

/**
 * §20 — the approved recommendation menu, transcribed VERBATIM from the brief.
 * Each option carries the trigger condition that decides whether at least one
 * actual included event justifies it. Nothing outside this menu may be
 * recommended. Stronger measures (site closure, guard reinforcement, etc.) are
 * intentionally absent — they require event-specific evidence not modelled here.
 */
export const APPROVED_RECOMMENDATIONS: ApprovedRecommendation[] = [
  // MOVEMENT
  {
    group: "Movement",
    text: "Confirm current route conditions before travel into affected districts.",
    trigger: (events) => events.filter((e) => isViolent(e) || isUnrest(e) || isPolicing(e)),
  },
  {
    group: "Movement",
    text: "Avoid non-essential after-hours movement where recent violence has occurred.",
    trigger: (events) => events.filter((e) => isViolent(e)),
  },
  {
    group: "Movement",
    text: "Allow extra travel time where police activity or local gatherings are reported.",
    trigger: (events) => events.filter((e) => isPolicing(e) || isUnrest(e)),
  },
  {
    group: "Movement",
    text: "Maintain an alternative route where disruption has been confirmed.",
    trigger: (events) => events.filter((e) => hasConfirmedEffect(e) || hasRestriction(e)),
  },
  // SITE SECURITY
  {
    group: "Site security",
    text: "Review access arrangements at sites close to reported incidents.",
    trigger: (events) => events.filter((e) => isViolent(e) || hasRestriction(e)),
  },
  {
    group: "Site security",
    text: "Confirm after-hours escalation procedures with guards and site managers.",
    trigger: (events) => events.filter((e) => isViolent(e)),
  },
  {
    group: "Site security",
    text: "Check that emergency contacts and reporting lines remain current.",
    trigger: (events) => events.filter((e) => isViolent(e) || isUnrest(e)),
  },
  // STAFF AWARENESS
  {
    group: "Staff awareness",
    text: "Brief affected staff on specific locations and current restrictions.",
    trigger: (events) => events.filter((e) => hasRestriction(e) || isUnrest(e)),
  },
  {
    group: "Staff awareness",
    text: "Reinforce immediate reporting of roadblocks, violence or police activity.",
    trigger: (events) => events.filter((e) => isViolent(e) || isPolicing(e) || isUnrest(e)),
  },
  {
    group: "Staff awareness",
    text: "Share only verified areas to avoid.",
    trigger: (events) => events.filter((e) => isViolent(e) || hasRestriction(e)),
  },
  // TRANSPORT AND LOGISTICS
  {
    group: "Transport and logistics",
    text: "Confirm airport, port and road status before affected movements.",
    trigger: (events) => events.filter((e) => isTransport(e) || hasRestriction(e)),
  },
  {
    group: "Transport and logistics",
    text: "Check supplier and delivery routes where disruption is reported.",
    trigger: (events) => events.filter((e) => isTransport(e) || hasConfirmedEffect(e)),
  },
  {
    group: "Transport and logistics",
    text: "Hold alternatives for time-sensitive journeys.",
    trigger: (events) => events.filter((e) => isTransport(e) || hasRestriction(e)),
  },
  // ESCALATION
  {
    group: "Escalation",
    text: "Escalate when violence approaches a business location or staff route.",
    trigger: (events) => events.filter((e) => isViolent(e)),
  },
  {
    group: "Escalation",
    text: "Escalate when official movement restrictions affect access.",
    trigger: (events) => events.filter((e) => hasRestriction(e)),
  },
  {
    group: "Escalation",
    text: "Escalate when a direct operational effect is confirmed.",
    trigger: (events) => events.filter((e) => hasConfirmedEffect(e)),
  },
];

const RECOMMENDATIONS_MAX = 10;
const RECOMMENDATION_MAX_WORDS = 22;

export interface Recommendation {
  group: RecommendationGroup;
  text: string;
}

/**
 * §20 — build recommendations from the approved menu only. Each returned action
 * is triggered by at least one actual included event; claims link them. Maximum
 * of 10 actions, each ≤22 words.
 */
export function buildRecommendations(
  events: CanonicalEvent[],
): NarrativeResult<Recommendation[]> {
  const claims: EvidenceRecord[] = [];
  const value: Recommendation[] = [];

  for (const rec of APPROVED_RECOMMENDATIONS) {
    if (value.length >= RECOMMENDATIONS_MAX) break;
    const triggering = rec.trigger(events);
    if (triggering.length === 0) continue;
    if (countWords(rec.text) > RECOMMENDATION_MAX_WORDS) continue; // menu is compliant; defensive
    value.push({ group: rec.group, text: rec.text });
    claims.push(
      makeClaim({
        claimText: rec.text,
        section: "Recommended Actions",
        supportingEventIds: triggering.map((e) => e.eventId),
        claimType: "Recommendation",
        confidence: 75,
      }),
    );
  }

  return { value, claims };
}

// ---------------------------------------------------------------------------
// §21 — Outlook (≤150 words)
// ---------------------------------------------------------------------------

const OUTLOOK_MAX_WORDS = 150;

/**
 * §21 — Outlook. What is likely to continue based on the reported pattern; no
 * invented escalation triggers. Only indicator statements grounded in events.
 * ≤150 words. Trend wording only where prior data exists (§16).
 */
export function buildOutlook(
  events: CanonicalEvent[],
  priorPeriodEvents: CanonicalEvent[] | null,
): NarrativeResult<string> {
  const claims: EvidenceRecord[] = [];
  const hasPriorData = priorPeriodEvents != null;

  if (events.length === 0) {
    const text = "Reporting was limited this period, and no clear forward indicators were identified.";
    claims.push(
      makeClaim({
        claimText: text,
        section: "Outlook",
        claimType: "Forecast",
        confidence: 70,
      }),
    );
    return { value: capWords(text, OUTLOOK_MAX_WORDS), claims };
  }

  const byCat = groupByCategory(events);
  const principal = [...byCat.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0];
  const principalCategory = principal[0];
  const ongoing = events.filter((e) => e.eventStatus === "Ongoing");
  const locations = unique(
    (ongoing.length ? ongoing : events).map((e) => locationLabel(e)),
  ).slice(0, 3);

  const s1 = `${capitaliseFirst(categoryPhrase(principalCategory))} is likely to remain the main concern during the next seven days.`;
  claims.push(
    makeClaim({
      claimText: s1,
      section: "Outlook",
      supportingEventIds: principal[1].map((e) => e.eventId),
      claimType: "Forecast",
      confidence: 70,
    }),
  );

  const s2 = `${joinAnd(locations) || events[0].physicalCountry} should remain under review because incidents were reported there during the period.`;
  claims.push(
    makeClaim({
      claimText: s2,
      section: "Outlook",
      supportingEventIds: (ongoing.length ? ongoing : events).map(
        (e) => e.eventId,
      ),
      claimType: "Forecast",
      confidence: 70,
    }),
  );

  const parts = [s1, s2];

  // Only include ongoing-dispute indicator where grounded in an ongoing event.
  if (ongoing.length > 0) {
    const sub = subNationalLocation(ongoing[0]);
    const where = sub
      ? `in ${sub}`
      : `across ${ongoing[0].physicalCountry}`;
    const s3 = `Continuing incidents ${where} remain the clearest indicator to monitor.`;
    parts.push(s3);
    claims.push(
      makeClaim({
        claimText: s3,
        section: "Outlook",
        supportingEventIds: ongoing.map((e) => e.eventId),
        claimType: "Forecast",
        confidence: 72,
      }),
    );
  }

  let text = capWords(parts.join(" "), OUTLOOK_MAX_WORDS);
  const trend = assertNoUnsupportedTrend(text, hasPriorData);
  if (trend.length > 0) {
    text = capWords([s1, s2].join(" "), OUTLOOK_MAX_WORDS);
  }
  return { value: text, claims };
}

// ---------------------------------------------------------------------------
// §22 — Pole Star View (≤180 words)
// ---------------------------------------------------------------------------

const POLESTAR_VIEW_MAX_WORDS = 180;

export interface PolestarViewSections {
  bluf?: string;
  outlook?: string;
}

/**
 * Sentence-overlap check — returns true when `candidate` largely repeats one of
 * the reference sections (§22 non-repetition; §29 "repeats another section
 * without adding value").
 */
function overlapsExisting(
  candidate: string,
  references: string[],
  threshold = 0.6,
): boolean {
  const cand = tokenSet(candidate);
  if (cand.size === 0) return false;
  for (const ref of references) {
    const refSet = tokenSet(ref);
    if (refSet.size === 0) continue;
    let shared = 0;
    for (const t of cand) if (refSet.has(t)) shared += 1;
    if (shared / cand.size >= threshold) return true;
  }
  return false;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/**
 * §22 — Pole Star View. Assessed judgement that must ADD content (checked for
 * non-repetition against the BLUF and Outlook via sentence overlap). Grounded,
 * no banned phrases. ≤180 words.
 */
export function buildPolestarView(
  events: CanonicalEvent[],
  sections: PolestarViewSections,
): NarrativeResult<string> {
  const claims: EvidenceRecord[] = [];
  const refs = [sections.bluf ?? "", sections.outlook ?? ""].filter(Boolean);

  if (events.length === 0) {
    const text = "On balance, the limited reporting supports routine vigilance rather than any change to current operating arrangements.";
    claims.push(
      makeClaim({
        claimText: text,
        section: "Pole Star View",
        claimType: "Assessment",
        confidence: 70,
      }),
    );
    return { value: capWords(text, POLESTAR_VIEW_MAX_WORDS), claims };
  }

  const locations = unique(events.map((e) => locationLabel(e)));
  const scope = locations.length > 1 ? "localised and varies by location" : "localised";
  const byCat = groupByCategory(events);
  const principal = [...byCat.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0][0];

  // Candidate judgement sentences — each grounded, each tested for overlap.
  const candidates: { text: string; claimType: ClaimType }[] = [
    {
      text: `On assessment, the risk is ${scope}, and it is best managed through location-specific decisions rather than country-wide measures.`,
      claimType: "Assessment",
    },
    {
      text: `The key judgement is that ${categoryPhrase(principal)} drives the current concern, while other categories contributed limited, separate disruption.`,
      claimType: "Assessment",
    },
    {
      text: `Businesses should prioritise verified route and site information for ${joinAnd(locations.slice(0, 2))} over broad precautionary measures.`,
      claimType: "Assessment",
    },
  ];

  const kept: string[] = [];
  for (const c of candidates) {
    if (overlapsExisting(c.text, [...refs, ...kept])) continue;
    kept.push(c.text);
    claims.push(
      makeClaim({
        claimText: c.text,
        section: "Pole Star View",
        supportingEventIds: events.map((e) => e.eventId),
        claimType: c.claimType,
        confidence: 72,
      }),
    );
  }

  // Guarantee at least one sentence even if everything overlapped.
  if (kept.length === 0) {
    const fallback = `On assessment, the concern remains ${scope}, and location-specific planning is the appropriate response.`;
    kept.push(fallback);
    claims.push(
      makeClaim({
        claimText: fallback,
        section: "Pole Star View",
        supportingEventIds: events.map((e) => e.eventId),
        claimType: "Assessment",
        confidence: 70,
      }),
    );
  }

  const text = capWords(kept.join(" "), POLESTAR_VIEW_MAX_WORDS);
  return { value: text, claims };
}

// ---------------------------------------------------------------------------
// buildCountryNarrative — assemble everything (§27 sparse handling)
// ---------------------------------------------------------------------------

export interface BuildNarrativeOptions {
  countryName: string;
  priorPeriodEvents?: CanonicalEvent[] | null;
}

export interface CountryNarrative {
  isSparse: boolean;
  bluf: string;
  topThree: TopDevelopment[];
  categoryIntros: { category: IssueCategory; text: string }[];
  currentSituation: string;
  operationalImpact: OperationalImpactEntry[];
  recommendations: Recommendation[];
  outlook: string;
  polestarView: string;
  // Present only for sparse reports (§27).
  shortReport: string | null;
  claims: EvidenceRecord[];
  sectionWordCounts: Record<string, number>;
}

// §27 sparse short-report text.
const SPARSE_REPORT_TEXT =
  "Reporting was limited this period. No significant validated security events were recorded, and no further analysis is warranted.";

/**
 * Assemble the full country narrative. `events` are the already validated,
 * deduped, INCLUDED canonical events. §27: with zero included events, return
 * the approved short-report text and omit the analytical sections rather than
 * padding.
 */
export function buildCountryNarrative(
  events: CanonicalEvent[],
  opts: BuildNarrativeOptions,
): CountryNarrative {
  resetClaimIds();
  const { countryName } = opts;
  const priorPeriodEvents = opts.priorPeriodEvents ?? null;
  const claims: EvidenceRecord[] = [];
  const sectionWordCounts: Record<string, number> = {};

  // §27 — sparse handling.
  if (events.length === 0) {
    const shortReport = `Reporting was limited in ${countryName} this period. No significant validated security events were recorded, and no further analysis is warranted.`;
    claims.push(
      makeClaim({
        claimText: shortReport,
        section: "Short Report",
        claimType: "Confirmed fact",
        confidence: 90,
      }),
    );
    sectionWordCounts["Short Report"] = countWords(shortReport);
    return {
      isSparse: true,
      bluf: "",
      topThree: [],
      categoryIntros: [],
      currentSituation: "",
      operationalImpact: [],
      recommendations: [],
      outlook: "",
      polestarView: "",
      shortReport,
      claims,
      sectionWordCounts,
    };
  }

  const byCat = groupByCategory(events);

  const bluf = buildBluf(events, countryName, priorPeriodEvents);
  claims.push(...bluf.claims);
  sectionWordCounts["Bottom Line Up Front"] = countWords(bluf.value);

  const topThree = buildTopThree(events);
  claims.push(...topThree.claims);

  const categoryIntros: { category: IssueCategory; text: string }[] = [];
  for (const [category, catEvents] of byCat) {
    const intro = buildCategoryIntro(category, catEvents);
    if (!intro.value) continue;
    claims.push(...intro.claims);
    categoryIntros.push({ category, text: intro.value });
    sectionWordCounts[`Category: ${category}`] = countWords(intro.value);
  }

  const currentSituation = buildCurrentSituation(events, countryName);
  claims.push(...currentSituation.claims);
  sectionWordCounts["Current Situation"] = countWords(currentSituation.value);

  const operationalImpact = buildOperationalImpact(byCat);
  claims.push(...operationalImpact.claims);
  for (const entry of operationalImpact.value) {
    sectionWordCounts[`Operational Impact: ${entry.category}`] = countWords(
      entry.text,
    );
  }

  const recommendations = buildRecommendations(events);
  claims.push(...recommendations.claims);

  const outlook = buildOutlook(events, priorPeriodEvents);
  claims.push(...outlook.claims);
  sectionWordCounts["Outlook"] = countWords(outlook.value);

  const polestarView = buildPolestarView(events, {
    bluf: bluf.value,
    outlook: outlook.value,
  });
  claims.push(...polestarView.claims);
  sectionWordCounts["Pole Star View"] = countWords(polestarView.value);

  return {
    isSparse: false,
    bluf: bluf.value,
    topThree: topThree.value,
    categoryIntros,
    currentSituation: currentSituation.value,
    operationalImpact: operationalImpact.value,
    recommendations: recommendations.value,
    outlook: outlook.value,
    polestarView: polestarView.value,
    shortReport: null,
    claims,
    sectionWordCounts,
  };
}

export { SPARSE_REPORT_TEXT };
