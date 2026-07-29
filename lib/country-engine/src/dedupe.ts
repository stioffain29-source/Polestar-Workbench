// Deduplication + response linking (owner brief §8-9).
//
// §8: several articles about ONE event become one canonical event, matched on
// same date (±1 day), same/adjacent location, same category, similar
// actors/figures and title similarity. §9: a successful response / follow-up
// (condemnation, investigation opened, suspect arrested days later) is linked to
// the originating event as a related update, NOT counted separately, unless it
// creates a new operational effect.
//
// A conservative, self-contained port of the workbench same-story clusterer
// (artifacts/workbench/src/lib/countrySameStory.ts). Pure — no runtime deps.

import type { IssueCategory, SourceReliability } from "./types";

// A candidate row for clustering.
export interface DedupeCandidate {
  id: string;
  title: string; // English display title where available
  eventDate: string | null; // ISO date
  physicalCountry: string;
  city: string | null;
  provinceOrState: string | null;
  category: IssueCategory;
  reliability: SourceReliability;
  locationPrecision: string; // more precise sorts first for representative pick
  isEnglish: boolean;
}

export interface DuplicateGroup {
  groupId: string;
  representativeId: string;
  supportingSourceIds: string[]; // all members incl. representative
}

const DAY_MS = 86_400_000;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "after",
  "amid", "over", "into", "out", "near", "this", "that", "these", "those", "its",
  "it", "their", "his", "her", "has", "have", "had", "will", "would", "could",
  "than", "then", "not", "new", "say", "says", "said",
]);

function storyTokens(title: string): Set<string> {
  return new Set(
    (title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Canonical masthead-stripped title key (identical titles -> same story).
function canonicalTitleKey(title: string): string {
  return (title ?? "")
    .toLowerCase()
    .split(/\s[-–—]\s/)[0]
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

const RELIABILITY_RANK: Record<SourceReliability, number> = {
  High: 4,
  Medium: 3,
  Low: 2,
  Unknown: 1,
};

const PRECISION_RANK: Record<string, number> = {
  "Exact site": 6,
  "Town or city": 5,
  District: 4,
  "Province or state": 3,
  "Country only": 2,
  Unknown: 1,
};

// Same/adjacent location: same city, or same province, or both null.
function locationCompatible(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (a.physicalCountry !== b.physicalCountry) return false;
  const cityA = (a.city ?? "").toLowerCase();
  const cityB = (b.city ?? "").toLowerCase();
  if (cityA && cityB) return cityA === cityB;
  const provA = (a.provinceOrState ?? "").toLowerCase();
  const provB = (b.provinceOrState ?? "").toLowerCase();
  if (provA && provB) return provA === provB;
  // One side unknown -> allow (conservative merge still gated by title/date).
  return true;
}

// Dates within ±1 day, or either unknown.
function dateCompatible(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const da = dateMs(a.eventDate);
  const db = dateMs(b.eventDate);
  if (da === null || db === null) return true;
  return Math.abs(da - db) <= DAY_MS;
}

// Decide whether two candidates describe the same event (conservative).
function sameStory(a: DedupeCandidate, b: DedupeCandidate): boolean {
  // PATH 0: identical canonical title -> same story regardless of date/place.
  const ca = canonicalTitleKey(a.title);
  const cb = canonicalTitleKey(b.title);
  if (ca && ca === cb) return true;

  if (!locationCompatible(a, b)) return false;
  if (!dateCompatible(a, b)) return false;

  const ta = storyTokens(a.title);
  const tb = storyTokens(b.title);
  const jac = jaccard(ta, tb);

  // Same category + strong title overlap.
  if (a.category === b.category && ta.size >= 3 && tb.size >= 3 && jac >= 0.5) {
    return true;
  }
  // Even across categories, a very strong title overlap on a compatible
  // date+location is the same story (e.g. incident vs the arrests over it).
  if (jac >= 0.6) return true;
  return false;
}

// Pick the representative of a group: highest reliability, then most precise
// location, then an English title, then lowest id (stable).
function pickRepresentative(members: DedupeCandidate[]): DedupeCandidate {
  return [...members].sort((a, b) => {
    const r = RELIABILITY_RANK[b.reliability] - RELIABILITY_RANK[a.reliability];
    if (r !== 0) return r;
    const p = (PRECISION_RANK[b.locationPrecision] ?? 0) - (PRECISION_RANK[a.locationPrecision] ?? 0);
    if (p !== 0) return p;
    if (a.isEnglish !== b.isEnglish) return a.isEnglish ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

// Build duplicate groups over the candidates (§8). Deterministic: candidates are
// processed in id order and each is placed in the first compatible group.
export function buildDuplicateGroups(
  candidates: DedupeCandidate[],
): DuplicateGroup[] {
  const order = [...candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const groups: DedupeCandidate[][] = [];
  // Performance indexes (semantics-preserving): sameStory can only merge when
  // dates are within ±1 day OR either date is unknown OR canonical titles are
  // identical (PATH 0). So we only need to scan groups that share a nearby
  // day bucket, groups containing an unknown-date member, or groups sharing an
  // exact canonical title key. This keeps the scan near-linear on large
  // country windows instead of O(n²).
  const byTitleKey = new Map<string, Set<number>>(); // canonical title -> group idxs
  const byDay = new Map<number, Set<number>>(); // day key -> group idxs
  const nullDateGroups = new Set<number>();
  const dayKey = (d: string | null): number | null => {
    const ms = dateMs(d);
    return ms === null ? null : Math.floor(ms / DAY_MS);
  };
  const indexMember = (gi: number, m: DedupeCandidate): void => {
    const tk = canonicalTitleKey(m.title);
    if (tk) {
      let s = byTitleKey.get(tk);
      if (!s) byTitleKey.set(tk, (s = new Set()));
      s.add(gi);
    }
    const dk = dayKey(m.eventDate);
    if (dk === null) {
      nullDateGroups.add(gi);
    } else {
      let s = byDay.get(dk);
      if (!s) byDay.set(dk, (s = new Set()));
      s.add(gi);
    }
  };
  for (const cand of order) {
    // Candidate groups to test, in ascending group index for determinism
    // (matches the previous first-compatible-group scan order).
    const todo = new Set<number>();
    const tk = canonicalTitleKey(cand.title);
    if (tk) for (const gi of byTitleKey.get(tk) ?? []) todo.add(gi);
    const dk = dayKey(cand.eventDate);
    if (dk === null) {
      for (let gi = 0; gi < groups.length; gi += 1) todo.add(gi);
    } else {
      for (const k of [dk - 1, dk, dk + 1]) {
        for (const gi of byDay.get(k) ?? []) todo.add(gi);
      }
      for (const gi of nullDateGroups) todo.add(gi);
    }
    let placed = false;
    for (const gi of [...todo].sort((a, b) => a - b)) {
      const g = groups[gi];
      if (g.some((m) => sameStory(m, cand))) {
        g.push(cand);
        indexMember(gi, cand);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([cand]);
      indexMember(groups.length - 1, cand);
    }
  }
  return groups.map((members) => {
    const rep = pickRepresentative(members);
    const supporting = [...members]
      .map((m) => m.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      groupId: rep.id,
      representativeId: rep.id,
      supportingSourceIds: supporting,
    };
  });
}

// ---------------------------------------------------------------------------
// Response linking (§9)
// ---------------------------------------------------------------------------

export interface ResponseCandidate {
  id: string;
  title: string;
  eventDate: string | null;
  physicalCountry: string;
  city: string | null;
  category: IssueCategory;
  // True when the record is itself a pure response/update (no new occurrence).
  isResponseOnly: boolean;
  // True when the response creates a NEW operational effect (§9) — then it is a
  // separate event and must NOT be demoted.
  createsNewEffect: boolean;
}

export interface ResponseLink {
  responseId: string;
  originatingEventId: string;
}

const RESPONSE_RE =
  /\b(condemn\w*|investigation (?:opened|launched|into|underway)|probe (?:ordered|launched)|arrest\w* (?:in connection|days later|following the)|suspect\w* (?:arrested|detained|charged) (?:days later|weeks later|over the|following the)|charged over the|calls? for (?:calm|peace|an investigation)|offers? condolences|pays? tribute|visits? (?:the )?(?:site|families)|holds? talks)\b/i;

// True when a title/summary is a response-only follow-up.
export function isResponseOnly(title: string): boolean {
  return RESPONSE_RE.test(title ?? "");
}

// Link response/update records to their originating event (§9). A response is
// linked to the most plausible originating event: same physical country +
// same/adjacent location + same category, occurring on or before the response.
// Responses that create a new operational effect are NOT linked (they stand as
// their own event).
export function linkResponses(events: ResponseCandidate[]): ResponseLink[] {
  const links: ResponseLink[] = [];
  const origins = events.filter((e) => !e.isResponseOnly);
  const ordered = [...events].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const resp of ordered) {
    if (!resp.isResponseOnly || resp.createsNewEffect) continue;
    let best: ResponseCandidate | null = null;
    for (const origin of origins) {
      if (origin.id === resp.id) continue;
      if (origin.physicalCountry !== resp.physicalCountry) continue;
      if (origin.category !== resp.category) continue;
      const cityR = (resp.city ?? "").toLowerCase();
      const cityO = (origin.city ?? "").toLowerCase();
      if (cityR && cityO && cityR !== cityO) continue;
      // Origin should occur on or before the response.
      const dr = dateMs(resp.eventDate);
      const doo = dateMs(origin.eventDate);
      if (dr !== null && doo !== null && doo > dr) continue;
      if (best === null || best.id > origin.id) best = origin;
    }
    if (best) links.push({ responseId: resp.id, originatingEventId: best.id });
  }
  return links;
}
