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
import {
  INDIRECT_ASSESSED_SENTENCE,
  INDIRECT_ASSESSED_SENTENCE_ALT,
} from "./impact";

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

/**
 * Owner rule: only real, impactful incidents may shape the assessment. An
 * event is "material" when it is Moderate+ severity, carries reported harm,
 * has a confirmed operational effect, or is still ongoing. A Low-severity
 * one-off with no continuing disruption (e.g. a routine rescue) is NOT
 * material and must not reach the Top 3, drive category implications, or set
 * the principal concern.
 */
function isMaterialEvent(e: CanonicalEvent): boolean {
  return (
    severityRank(e.severity) >= SEVERITY_RANK.Moderate ||
    (e.casualties ?? 0) > 0 ||
    (e.injuries ?? 0) > 0 ||
    !!e.confirmedOperationalEffect ||
    e.eventStatus === "Ongoing"
  );
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
 * §15/§31 — compact reference form of a title for the BLUF when the mandatory
 * top-development references alone would blow the 120-word cap. Trims at a
 * CLAUSE BOUNDARY ONLY (semicolon, colon, dash, or a comma followed by a
 * subordinating/coordinating connective) so the shortened reference is always
 * a true statement drawn verbatim from the stored title — never a mid-clause
 * fragment, never fabricated. Titles without a clause boundary (or whose
 * first clause is too short to stand alone) are returned whole.
 */
const CLAUSE_BOUNDARY_RE =
  /\s*(?:;|—|–|-{2,})\s*|:\s+|,\s+(?:as|after|amid|while|following|with|before|which|who|where|when|and|but)\b/i;

export function compactTitle(title: string): string {
  const full = naturaliseTitle(title);
  const m = CLAUSE_BOUNDARY_RE.exec(full);
  if (!m || m.index === 0) return full;
  const clause = full.slice(0, m.index).trim();
  // A stand-alone clause needs enough substance to identify the story.
  if (countWords(clause) < 4) return full;
  return clause;
}

/**
 * Priority-location list for BLUF / Current Situation / Pole Star View.
 * Prefers sub-national locations and NEVER mixes the country name into the
 * list when sub-national ones exist (naming the whole country as a "location"
 * reads as filler). `hasUnlocated` is true when at least one event carried no
 * sub-national location while others did — callers render a country-level
 * phrase ("with the remainder unlocated") so no event is silently dropped.
 */
function priorityLocations(events: CanonicalEvent[]): {
  locations: string[];
  hasUnlocated: boolean;
  unlocatedCount: number;
  totalCount: number;
} {
  const locations = unique(
    events.map((e) => subNationalLocation(e) ?? ""),
  );
  const unlocatedCount = events.filter((e) => !subNationalLocation(e)).length;
  const hasUnlocated = locations.length > 0 && unlocatedCount > 0;
  return { locations, hasUnlocated, unlocatedCount, totalCount: events.length };
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
export function formatDate(iso: string | null): string {
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
export function categoryPhrase(c: IssueCategory): string {
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

/**
 * §14 — the ranked top developments (up to three). ONE shared selection used by
 * buildTopThree AND the narrative sections (BLUF), so every Top-3 story is
 * referenced in the written analysis and the QC cross-check cannot diverge.
 * Excludes commentary/background/not-an-incident/cancelled (§14).
 */
function topRankedEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  const eligible = events.filter(
    (e) =>
      e.eventStatus !== "Commentary" &&
      e.eventStatus !== "Background" &&
      e.eventStatus !== "Not an incident" &&
      e.eventStatus !== "Cancelled" &&
      // Owner rule: Top Developments are reserved for events with material
      // security or operational significance. Fewer than three (or none) is
      // correct when the week produced nothing that qualifies.
      isMaterialEvent(e),
  );
  // Same-story guard (owner-flagged): an event and its follow-up ("suspects
  // named in the X clash") must not occupy two of the three slots. Two events
  // are the same story when they are linked by duplicate/related ids, or share
  // category + a distinctive proper-noun title anchor within a 2-day window.
  const ranked = rankEvents(eligible);
  const picked: CanonicalEvent[] = [];
  for (const e of ranked) {
    if (picked.some((p) => isSameStory(p, e))) continue;
    picked.push(e);
    if (picked.length === 3) break;
  }
  return picked;
}

// Geographic/administrative filler that must not count as a story anchor (see
// the same-event clustering rule: shared place words merge DISTINCT events).
const STORY_ANCHOR_FILLER = new Set([
  "jakarta", "central", "north", "south", "east", "west", "greater",
  "police", "district", "village", "province", "regency", "city", "island",
]);

function isSameStory(a: CanonicalEvent, b: CanonicalEvent): boolean {
  if (a.duplicateGroupId && a.duplicateGroupId === b.duplicateGroupId) return true;
  if (a.relatedEventIds.includes(b.eventId) || b.relatedEventIds.includes(a.eventId)) {
    return true;
  }
  if (a.issueCategory !== b.issueCategory) return false;
  if (!a.eventDate || !b.eventDate) return false;
  const dayDiff =
    Math.abs(Date.parse(a.eventDate) - Date.parse(b.eventDate)) / 86_400_000;
  if (!(dayDiff <= 2)) return false;
  // A shared PLACE name must never merge two distinct events (two separate
  // crimes in the same district are two stories). Exclude every token drawn
  // from either event's resolved location fields from anchor matching.
  const placeTokens = new Set<string>();
  for (const e of [a, b]) {
    for (const field of [e.city, e.district, e.provinceOrState]) {
      for (const w of (field ?? "").toLowerCase().split(/[^a-z]+/)) {
        if (w.length >= 4) placeTokens.add(w);
      }
    }
  }
  // Proper-noun anchors only: drop the title's leading word first (sentence
  // case makes any opening word capitalized — "Armed robbery…" is not an
  // anchor), then keep remaining capitalized tokens minus geographic filler
  // and minus resolved place names.
  const tokens = (t: string): Set<string> =>
    new Set(
      (t.replace(/^\s*\S+/, "").match(/\b[A-Z][a-z]{4,}\b/g) ?? [])
        .map((s) => s.toLowerCase())
        .filter((s) => !STORY_ANCHOR_FILLER.has(s) && !placeTokens.has(s)),
    );
  const ta = tokens(a.eventTitle);
  for (const t of tokens(b.eventTitle)) if (ta.has(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Assessed-meaning helpers — deterministic synthesis drawn ONLY from stored
// event attributes (category, location, status, casualties). These give the
// narrative its "what this means for operators" layer without inventing facts.
// ---------------------------------------------------------------------------

// Per-category operator implication, written to be proportionate and generic
// to the category (never event-specific claims). Used where no confirmed or
// assessed operational effect exists — the implication follows from the stored
// category alone, so it is an evidence-linked Assessment, not fabrication.
const CATEGORY_IMPLICATIONS: Partial<Record<IssueCategory, string>> = {
  "Violent crime":
    "bears directly on staff safety and journey planning around the affected area",
  "Theft and robbery":
    "points to a property and vehicle crime concern for premises and movements nearby",
  "Organised crime":
    "signals criminal activity capable of touching legitimate commerce in the affected area",
  "Communal or tribal violence":
    "can close roads and draw in bystanders at short notice, so nearby movement carries added risk",
  Terrorism:
    "raises the possibility of deliberate violence around public and commercial locations nearby",
  Insurgency:
    "indicates armed activity that can affect road movement and rural operations in the wider area",
  "Political violence":
    "raises tension around political events and gatherings in the affected area",
  "Civil unrest":
    "can disrupt access, traffic and working hours around assembly points at short notice",
  "Strike or labour action":
    "can interrupt services and staffing where the affected workforce operates",
  "Governance and regulatory":
    "may change the rules or permissions under which local operations run",
  "Policing operation":
    "brings checkpoints and short-notice road restrictions to the surrounding area",
  Aviation: "affects flight reliability and connections through the airports involved",
  Maritime:
    "can affect movement by sea where ports or scheduled services are involved",
  "Road and rail": "affects journey times and overland freight on the routes involved",
  Utilities: "affects power or water reliability for sites in the served area",
  Telecommunications:
    "affects connectivity and communications for operations in the served area",
  Infrastructure:
    "affects the reliability of fixed infrastructure that local operations depend on",
  "Fire and accident": "highlights safety conditions around the site involved",
  "Natural hazard":
    "can affect access, utilities and staff availability across the affected area",
  Health: "bears on staff health precautions and medical planning in the affected area",
  "Supply chain":
    "affects the movement and availability of goods through the routes involved",
  "Other operational disruption":
    "may interrupt routine operations in the affected area",
};

/**
 * Sub-national locations that recorded MORE THAN ONE event this period, ordered
 * by how many events each carried (highest first). A repeat location is the
 * strongest deterministic signal of sustained (rather than one-off) pressure.
 */
function repeatSubLocations(events: CanonicalEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const sub = subNationalLocation(e);
    if (!sub) continue;
    counts.set(sub, (counts.get(sub) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([loc]) => loc);
}

/** Events that recorded deaths or injuries. */
function harmEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  return events.filter((e) => (e.casualties ?? 0) > 0 || (e.injuries ?? 0) > 0);
}

/** "deaths", "injuries" or "deaths or injuries" — only what was reported. */
function harmPhrase(events: CanonicalEvent[]): string | null {
  const deaths = events.some((e) => (e.casualties ?? 0) > 0);
  const injuries = events.some((e) => (e.injuries ?? 0) > 0);
  if (deaths && injuries) return "deaths or injuries";
  if (deaths) return "deaths";
  if (injuries) return "injuries";
  return null;
}

/**
 * §16-legal trajectory wording. ONLY called when priorPeriodEvents exists —
 * comparative wording is banned otherwise. Compares volume and worst severity
 * of the current window against the previous equivalent window.
 */
function trajectorySentence(
  events: CanonicalEvent[],
  priorPeriodEvents: CanonicalEvent[],
  variant = 0,
): string {
  const delta = events.length - priorPeriodEvents.length;
  // §16 — comparative claims always carry the figures they rest on.
  const figures = `(${events.length} validated ${events.length === 1 ? "event" : "events"} against ${priorPeriodEvents.length})`;
  // Repetition guard: this sentence renders in both the BLUF and the Outlook —
  // the second surface uses alternate wording so the same sentence never
  // appears verbatim twice. Same facts, same figures.
  const volume =
    delta >= 2
      ? variant === 0
        ? `Reporting volume increased compared with the previous period ${figures}`
        : `Validated reporting ran higher than in the previous period ${figures}`
      : delta <= -2
        ? variant === 0
          ? `Reporting volume fell compared with the previous period ${figures}`
          : `Validated reporting ran lower than in the previous period ${figures}`
        : variant === 0
          ? `Reporting volume was broadly in line with the previous period ${figures}`
          : `Validated reporting held near the previous period's level ${figures}`;
  const worst = (list: CanonicalEvent[]): number =>
    list.reduce((m, e) => Math.max(m, severityRank(e.severity)), -1);
  const cur = worst(events);
  const prev = worst(priorPeriodEvents);
  const sev =
    prev < 0 || cur === prev
      ? ""
      : cur > prev
        ? ", and the most serious reporting worsened"
        : ", while the most serious reporting eased";
  return `${volume}${sev}.`;
}

/**
 * The category that carries the report's real weight — seriousness-first, not
 * volume-first. Ranked by worst severity, then reported harm, then count, so a
 * cluster of routine maritime items can never outrank a High violent-crime
 * event as "the main concern".
 */
function principalCategoryBySeriousness(
  events: CanonicalEvent[],
): IssueCategory {
  // Owner rule: a single Low-rated event must not elevate its whole category
  // to a principal concern. Judge only material events; fall back to the full
  // set when nothing qualifies (so quiet weeks still produce a sentence).
  const material = events.filter(isMaterialEvent);
  const pool = material.length > 0 ? material : events;
  let best: { cat: IssueCategory; score: number } | null = null;
  for (const [cat, list] of groupByCategory(pool)) {
    const worst = list.reduce((m, e) => Math.max(m, severityRank(e.severity)), 0);
    const harm = list.reduce(
      (n, e) => n + (e.casualties ?? 0) + (e.injuries ?? 0),
      0,
    );
    const score = worst * 10000 + Math.min(harm, 99) * 100 + list.length;
    if (!best || score > best.score) best = { cat, score };
  }
  return best!.cat;
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
  const ranked = topRankedEvents(events);

  // Repeat suppression: the derived category implication is generic to the
  // category, so printing it verbatim on more than one of the three slots is
  // boilerplate, not analysis. Each implication string appears at most once;
  // later same-category items keep their harm/ongoing sentences (event-specific)
  // and otherwise omit rather than repeat (§14 — omit, never pad).
  const usedImplications = new Set<string>();

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
    } else if (
      e.assessedOperationalRelevance &&
      !usedImplications.has(e.assessedOperationalRelevance.trim())
    ) {
      // Repetition guard: the assessed relevance is a fixed template sentence,
      // so two developments can carry identical text — emit it once, omit the
      // repeat (§14 — omit, never pad).
      businessSentence = e.assessedOperationalRelevance.trim();
      usedImplications.add(businessSentence);
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
    } else if (!e.confirmedOperationalEffect && !e.assessedOperationalRelevance) {
      // No stored effect — derive a proportionate assessed meaning from the
      // event's OWN stored attributes (category, status, casualties). This is
      // still evidence-linked (the implication follows from the stored
      // category), so the report explains why the event matters instead of
      // leaving the reader with a bare headline.
      // Owner rule: the derived category implication is only proportionate
      // when the event itself is material — a Low one-off with no harm or
      // continuing disruption gets no manufactured business meaning.
      const implication = isMaterialEvent(e)
        ? CATEGORY_IMPLICATIONS[e.issueCategory]
        : undefined;
      const isRepeat = implication != null && usedImplications.has(implication);
      if (implication) {
        const harm = harmPhrase([e]);
        const parts: string[] = [];
        if (harm) {
          parts.push(
            `The reported ${harm} make this a staff-safety concern first.`,
          );
        }
        if (!isRepeat) {
          usedImplications.add(implication);
          parts.push(`For operators, an event of this kind ${implication}.`);
        }
        if (e.eventStatus === "Ongoing") {
          parts.push(
            "The situation was reported as ongoing, so conditions nearby may change at short notice.",
          );
        }
        businessSentence = parts.length > 0 ? parts.join(" ") : null;
        if (businessSentence) {
        claims.push(
          makeClaim({
            claimText: businessSentence,
            section: "Top Developments",
            supportingEventIds: [e.eventId],
            supportingSourceIds: e.supportingSourceIds,
            claimType: "Assessment",
            confidence: 70,
          }),
        );
        }
      }
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

  // §14/§15 — the BLUF anchors on the SAME ranked Top-3 selection as
  // buildTopThree so the lead sentence and the Top Developments section can
  // never diverge, and every Top-3 story is referenced in the analysis.
  const topRanked = topRankedEvents(events);
  const lead = topRanked[0] ?? mostSignificant(events)!;
  const byCat = groupByCategory(events);
  const topCategories = [...byCat.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([c]) => categoryPhrase(c));
  const { locations: allLocations } = priorityLocations(events);
  // Tautology guard: never list the report's own theatre name as a location.
  const locations = allLocations
    .filter((l) => l.toLowerCase() !== countryName.toLowerCase())
    .slice(0, 3);

  // Sentence 1 — most significant development with location + date. The title
  // is naturalised (never a raw wire headline) and the location clause is
  // omitted when the location is Country only / Unknown (§14/§15).
  //
  // §31 — when the mandatory reference sentences built from FULL titles would
  // alone exceed the 120-word cap, fall back to the compact (clause-boundary
  // trimmed) reference form so the BLUF names every headline story AND stays
  // within the limit. Compaction never invents words — it only drops trailing
  // clauses — and the §33 reference check accepts the compact form.
  const otherTop = topRanked.slice(1);
  // Owner rule: the BLUF is natural prose in OUR words — never raw or quoted
  // source headlines. Each development is summarised as category + harm +
  // place + date, all drawn from stored event attributes.
  const describeEvent = (e: CanonicalEvent): string => {
    const harm = harmPhrase([e]);
    return `${categoryPhrase(e.issueCategory)}${harm ? ` with reported ${harm}` : ""}${locationClause(e)} on ${formatDate(e.eventDate)}`;
  };
  const s1 = `The most serious validated development in ${countryName} was ${describeEvent(lead)}.`;
  // Repetition guard (owner-flagged): when the other top developments share the
  // lead's category and location, naming each in full reads as the same clause
  // three times ("violent crime in East Jakarta on ... and violent crime in
  // East Jakarta on ..."). Group same category+location stories into ONE
  // clause carrying all their dates, and prefix "further" when the group
  // repeats the lead's category+location.
  const descKey = (e: CanonicalEvent): string =>
    `${categoryPhrase(e.issueCategory)}|${locationClause(e)}`;
  const leadKey = descKey(lead);
  const otherGroups = new Map<string, CanonicalEvent[]>();
  for (const e of otherTop) {
    const k = descKey(e);
    const g = otherGroups.get(k);
    if (g) g.push(e);
    else otherGroups.set(k, [e]);
  }
  const otherClauses = [...otherGroups.entries()].map(([k, evs]) => {
    if (evs.length === 1 && k !== leadKey) return describeEvent(evs[0]);
    const first = evs[0];
    const harm = harmPhrase(evs);
    const dates = [...new Set(evs.map((ev) => formatDate(ev.eventDate)))];
    const prefix = k === leadKey ? "further " : "";
    return `${prefix}${categoryPhrase(first.issueCategory)}${harm ? ` with reported ${harm}` : ""}${locationClause(first)} on ${joinAnd(dates)}`;
  });
  const s1bText =
    otherTop.length > 0
      ? `The period also brought ${joinAnd(otherClauses)}.`
      : "";
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

  // Sentence 1b — the OTHER ranked top developments, each named with its
  // location, so the written analysis acknowledges every headline story (not
  // only the single lead). Deterministic, drawn only from stored titles and
  // resolved locations — no fabrication.
  let s1b = "";
  if (otherTop.length > 0) {
    s1b = s1bText;
    claims.push(
      makeClaim({
        claimText: s1b,
        section: "Bottom Line Up Front",
        supportingEventIds: otherTop.map((e) => e.eventId),
        supportingSourceIds: otherTop.flatMap((e) => e.supportingSourceIds),
        claimType: "Confirmed fact",
        confidence: Math.min(
          ...otherTop.map((e) => e.classificationConfidence),
        ),
      }),
    );
  }

  // Sentence 2 — assessed reporting pattern this period. Where one sub-national
  // location carried repeat reporting, say so — concentration is the single
  // most useful pattern judgement a reader can act on. Otherwise state the
  // dispersion honestly.
  const catText = joinAnd(topCategories);
  const locText = locations.length ? joinAnd(locations) : countryName;
  const repeats = repeatSubLocations(events);
  const s2 = repeats.length
    ? `During the reporting period, ${catText || "security"} events made up most of the reporting, and ${repeats[0]} carried a disproportionate share of it.`
    : `During the reporting period, ${catText || "security"} events were the main concerns, recorded in ${locText} rather than concentrated in a single centre.`;
  claims.push(
    makeClaim({
      claimText: s2,
      section: "Bottom Line Up Front",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Assessment",
      confidence: 75,
    }),
  );

  // Sentence 2b — trajectory against the previous period. ONLY when prior data
  // exists (§16 — comparative wording is illegal otherwise).
  let s2b = "";
  if (priorPeriodEvents) {
    s2b = trajectorySentence(events, priorPeriodEvents);
    claims.push(
      makeClaim({
        claimText: s2b,
        section: "Bottom Line Up Front",
        supportingEventIds: events.map((e) => e.eventId),
        supportingMetric: `current=${events.length}; prior=${priorPeriodEvents.length}`,
        claimType: "Trend",
        confidence: 75,
      }),
    );
  }

  // Sentence 3 — practical meaning for operations (only evidence-based).
  let s3 = "";
  // §14/§15 — the BLUF's operational sentence must come from the validated
  // top developments, never from a story the reader is not shown.
  const confirmed = topRanked.find((e) => e.confirmedOperationalEffect);
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
    // No confirmed effect — draw the lead event's category implication so the
    // reader is told what the week means, not just what happened.
    const implication = isMaterialEvent(lead)
      ? CATEGORY_IMPLICATIONS[lead.issueCategory]
      : undefined;
    const focusLoc = subNationalLocation(lead);
    if (implication) {
      s3 = `For operations, the immediate significance is that the lead event ${implication}${focusLoc ? `, so plans touching ${focusLoc} deserve the closest attention` : ""}.`;
    } else {
      const scope =
        locations.length > 1 ? "varies by location" : "appears localised";
      s3 = `Businesses should note that risk ${scope} and plan movement around the affected areas.`;
    }
    claims.push(
      makeClaim({
        claimText: s3,
        section: "Bottom Line Up Front",
        supportingEventIds: [lead.eventId],
        supportingSourceIds: lead.supportingSourceIds,
        claimType: "Assessment",
        confidence: 70,
      }),
    );
  }

  // §14/§15 — s1 (the lead) and s1b (the other ranked top developments) are
  // MANDATORY: every Top-3 story must be referenced in the BLUF, so the word
  // cap may only trim the optional analytical tail (s2/s2b/s3), never the
  // top-development references. If the mandatory sentences alone exceed the
  // cap they are kept whole — the §33 section-word-count check will surface
  // that visibly instead of the reference being dropped silently.
  const mandatory = [s1, s1b].filter(Boolean).join(" ");
  const blufCap = Math.max(BLUF_MAX_WORDS, countWords(mandatory));
  let text = capWords(
    [s1, s1b, s2, s2b, s3].filter(Boolean).join(" "),
    blufCap,
  );

  // §16 — strip trend wording if there is no comparative data. The composed
  // BLUF uses "During the reporting period" (neutral) so this is defensive.
  const trend = assertNoUnsupportedTrend(text, hasPriorData);
  if (trend.length > 0) {
    // Fall back to the neutral event-led sentences only (lead + other top
    // developments), mirroring the tolerance already extended to s1: quoted
    // event titles are facts, not analytical trend claims.
    text = capWords(mandatory, blufCap);
  }

  return { value: text, claims };
}

function lowerFirst(s: string): string {
  if (!s) return s;
  // Never de-capitalise an acronym ("PNG's East New Britain…" must not become
  // "pNG's…") — if the second character is also upper case, leave it intact.
  if (s.length > 1 && /[A-Z]/.test(s.charAt(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
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
  // §15 — prefer sub-national locations; never mix the country name into the
  // list when located events exist ("mainly in Morobe and Papua New Guinea").
  const { locations: subLocations } = priorityLocations(catEvents);
  const locations = subLocations.slice(0, 4);
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
  const { locations: rawLocations } = priorityLocations(events);
  // Tautology guard (owner-flagged): "concentrated in Jakarta" inside the
  // Jakarta report says nothing — drop any location equal to the report's own
  // theatre name from the concentration list.
  const locations = rawLocations.filter(
    (l) => l.toLowerCase() !== countryName.toLowerCase(),
  );

  const s1 = locations.length
    ? `Security incidents in ${countryName} during the reporting period were concentrated in ${joinAnd(locations.slice(0, 3))}.`
    : `Security incidents in ${countryName} during the reporting period were recorded at country level only, without located concentrations.`;
  const s2 = `${capitaliseFirst(joinAnd(principal.slice(0, 2)) || "Security events")} were the principal concerns.`;

  // Assessed synthesis — repeat-location pressure and casualty framing, both
  // drawn only from stored attributes.
  const repeats = repeatSubLocations(events);
  const repeatEvents = events.filter((e) => {
    const sub = subNationalLocation(e);
    return sub != null && repeats.slice(0, 2).includes(sub);
  });
  const s2b = repeats.length
    ? `${joinAnd(repeats.slice(0, 2))} generated repeat reporting within the period, so the pressure there is sustained rather than a one-off.`
    : "";
  const harmed = harmEvents(events);
  const harm = harmPhrase(harmed);
  const s2c = harm
    ? `Some of the reporting involved ${harm}, which raises the stakes for staff working in or moving through the affected areas.`
    : "";
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
  );
  if (s2b) {
    claims.push(
      makeClaim({
        claimText: s2b,
        section: "Current Situation",
        supportingEventIds: repeatEvents.map((e) => e.eventId),
        claimType: "Assessment",
        confidence: 75,
      }),
    );
  }
  if (s2c) {
    claims.push(
      makeClaim({
        claimText: s2c,
        section: "Current Situation",
        supportingEventIds: harmed.map((e) => e.eventId),
        claimType: "Assessment",
        confidence: 75,
      }),
    );
  }
  claims.push(
    makeClaim({
      claimText: s3,
      section: "Current Situation",
      supportingEventIds: events.map((e) => e.eventId),
      claimType: "Assessment",
      confidence: 70,
    }),
  );

  const text = capWords(
    [s1, s2, s2b, s2c, s3].filter(Boolean).join(" "),
    CURRENT_SITUATION_MAX_WORDS,
  );
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
  // Repetition guard (owner-flagged): assessedOperationalRelevance is a fixed
  // template sentence, so several categories can carry the identical text.
  // Emit each verbatim assessed sentence ONCE across the whole section —
  // repeating it per category is boilerplate, not analysis.
  const usedAssessed = new Set<string>();

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

    if (assessed.length > 0 && !usedAssessed.has(assessed[0].assessedOperationalRelevance!.trim())) {
      const e = assessed[0];
      const raw = e.assessedOperationalRelevance!.trim();
      usedAssessed.add(raw);
      // A Top Development card already carries the fixed Indirect template
      // verbatim; this section restates it in alternate wording (same meaning)
      // so the identical sentence never renders twice in one report.
      const sentence =
        raw === INDIRECT_ASSESSED_SENTENCE ? INDIRECT_ASSESSED_SENTENCE_ALT : raw;
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
  // Seriousness-first: the outlook's "main concern" must follow the most
  // serious reporting, never the most frequent category.
  const principalCategory = principalCategoryBySeriousness(events);
  const principal: [IssueCategory, CanonicalEvent[]] = [
    principalCategory,
    byCat.get(principalCategory) ?? events,
  ];
  const ongoing = events.filter((e) => e.eventStatus === "Ongoing");
  // §15 — prefer sub-national locations; fall back to the country name only
  // when nothing in the pool is located below country level.
  const { locations: subLocations } = priorityLocations(
    ongoing.length ? ongoing : events,
  );
  const locations = subLocations.slice(0, 3);

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

  // Repeat-location grounding — where a location carried repeat reporting this
  // period it is the most defensible setting for renewed incidents; otherwise
  // fall back to the plain review sentence.
  const repeats = repeatSubLocations(events);
  const repeatEvents = events.filter((e) => {
    const sub = subNationalLocation(e);
    return sub != null && repeats.slice(0, 3).includes(sub);
  });
  const s2 = repeats.length
    ? `${joinAnd(repeats.slice(0, 3))} saw repeat reporting within the period and ${repeats.length === 1 ? "is" : "are"} the most likely setting for renewed incidents.`
    : `${joinAnd(locations) || events[0].physicalCountry} should remain under review because incidents were reported there during the period.`;
  claims.push(
    makeClaim({
      claimText: s2,
      section: "Outlook",
      supportingEventIds: (repeats.length
        ? repeatEvents
        : ongoing.length
          ? ongoing
          : events
      ).map((e) => e.eventId),
      claimType: "Forecast",
      confidence: 70,
    }),
  );

  const parts = [s1, s2];

  // Trajectory framing — legal only with prior data (§16).
  if (priorPeriodEvents) {
    const s2b = `${trajectorySentence(events, priorPeriodEvents, 1)} The coming days should be judged against that direction rather than any single event.`;
    parts.push(s2b);
    claims.push(
      makeClaim({
        claimText: s2b,
        section: "Outlook",
        supportingEventIds: events.map((e) => e.eventId),
        supportingMetric: `current=${events.length}; prior=${priorPeriodEvents.length}`,
        claimType: "Trend",
        confidence: 72,
      }),
    );
  }

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

  // De-escalation indicator — only where casualty-bearing reporting exists to
  // anchor it. Gives the reader a concrete sign of reduced concern, not filler.
  const harmed = harmEvents(events);
  const harm = harmPhrase(harmed);
  if (harm) {
    const anchor =
      repeats[0] ?? subNationalLocation(harmed[0]) ?? harmed[0].physicalCountry;
    const s4 = `A run of days without reported ${harm} in ${anchor} would be the clearest sign of reduced concern.`;
    parts.push(s4);
    claims.push(
      makeClaim({
        claimText: s4,
        section: "Outlook",
        supportingEventIds: harmed.map((e) => e.eventId),
        claimType: "Forecast",
        confidence: 70,
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
  priorPeriodEvents: CanonicalEvent[] | null = null,
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

  const { locations } = priorityLocations(events);
  const scope = locations.length > 1 ? "localised and varies by location" : "localised";
  // Seriousness-first — the View's "drives the current concern" judgement must
  // track the most serious reporting, never the most frequent category.
  const principal = principalCategoryBySeriousness(events);

  // Exposure orientation — is the week's reporting mostly about how people and
  // goods move, or about the safety of staff and premises? Derived from the
  // stored category mix only.
  const MOVEMENT_CATEGORIES = new Set<IssueCategory>([
    "Civil unrest",
    "Strike or labour action",
    "Policing operation",
    "Aviation",
    "Maritime",
    "Road and rail",
    "Supply chain",
  ]);
  const SAFETY_CATEGORIES = new Set<IssueCategory>([
    "Violent crime",
    "Theft and robbery",
    "Organised crime",
    "Communal or tribal violence",
    "Terrorism",
    "Insurgency",
    "Political violence",
  ]);
  const movementCount = events.filter((e) => MOVEMENT_CATEGORIES.has(e.issueCategory)).length;
  const safetyCount = events.filter((e) => SAFETY_CATEGORIES.has(e.issueCategory)).length;
  const focusPhrase =
    movementCount > 0 && safetyCount > 0
      ? "both movement planning and the safety of staff and premises"
      : movementCount > 0
        ? "how people and goods move"
        : safetyCount > 0
          ? "the safety of staff and premises"
          : "routine operational planning";

  // What actually happened this period — the honest anchor. Grounded in the
  // worst reported event's category and place so the View opens with substance
  // rather than a generic posture line.
  const worstEvent = rankEvents(events)[0];
  const anchorPlace = locationLabel(worstEvent);
  // Never name the whole country as a "location" — if the worst event resolved
  // no sub-national place, anchor on the category alone.
  const anchorSentence =
    anchorPlace && anchorPlace !== worstEvent.physicalCountry
      ? `The most serious reporting this period was ${categoryPhrase(worstEvent.issueCategory)} around ${anchorPlace}; other items were routine by comparison.`
      : `The most serious reporting this period was ${categoryPhrase(worstEvent.issueCategory)}; other items were routine by comparison.`;

  // Candidate judgement sentences — each grounded, each tested for overlap.
  const candidates: { text: string; claimType: ClaimType }[] = [
    { text: anchorSentence, claimType: "Assessment" },
    {
      text: `Taken together, the week's reporting matters most for ${focusPhrase}, and that is where checks should focus first.`,
      claimType: "Assessment",
    },
    {
      text: `On assessment, the risk is ${scope}, and it is best managed through location-specific decisions rather than country-wide measures.`,
      claimType: "Assessment",
    },
    {
      text: `The key judgement is that ${categoryPhrase(principal)} drives the current concern, while other categories contributed limited, separate disruption.`,
      claimType: "Assessment",
    },
    {
      text: locations.length
        ? `Businesses should prioritise verified route and site information for ${joinAnd(locations.slice(0, 2))} over broad precautionary measures.`
        : `Businesses should prioritise verified route and site information for the affected areas over broad precautionary measures.`,
      claimType: "Assessment",
    },
  ];

  // Trajectory judgement — legal only with prior data (§16).
  if (priorPeriodEvents) {
    const worst = (list: CanonicalEvent[]): number =>
      list.reduce((m, e) => Math.max(m, severityRank(e.severity)), -1);
    const cur = worst(events);
    const prev = worst(priorPeriodEvents);
    const volDelta = events.length - priorPeriodEvents.length;
    const direction =
      cur > prev || volDelta >= 2
        ? "worsened"
        : cur < prev || volDelta <= -2
          ? "eased"
          : "held broadly steady";
    candidates.push({
      text: `Set against the previous period, the direction of reporting ${direction}, and planning weight should follow that direction rather than any single headline event.`,
      claimType: "Trend",
    });
  }

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

  // The View must read as a considered judgement, never a one-liner: when the
  // overlap filter (vs BLUF/Outlook) trims the set below three sentences, top
  // back up from the skipped candidates in priority order. Repeating a thread
  // the BLUF touched is the lesser evil than shipping a single-line View.
  if (kept.length < 3) {
    for (const c of candidates) {
      if (kept.length >= 3) break;
      if (kept.includes(c.text)) continue;
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

  const polestarView = buildPolestarView(
    events,
    {
      bluf: bluf.value,
      outlook: outlook.value,
    },
    priorPeriodEvents,
  );
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
