// Same-story consolidation for the Country Report (spec §2 deduplication).
//
// Several outlets re-run the SAME real-world event under near-identical or
// differently-phrased headlines, and a single event (e.g. a factory fire) is
// often reported across more than one day. The structured report builder and
// the page-level chart/map/Fast-Facts feed must both collapse those into ONE
// incident so the customer report never shows the same event twice.
//
// This is the single, shared, deterministic clustering authority. It is
// deliberately CONSERVATIVE — it only merges items that share strong evidence
// of being the same event, so two genuinely distinct incidents that merely
// share a few words are never collapsed (no over-merge, no data loss).
//
// Three independent merge paths, strongest first:
//   PATH 0  identical canonical (masthead-stripped) title — same story, any
//           date or place (pure syndication).
//   PATH 1  same province + compatible type + same/adjacent day + strong title
//           overlap (Jaccard >= 0.5) — the existing syndication rule.
//   PATH 2  same province + same incident-type family + a SHARED NAMED PREMISES
//           ("sandal factory" -> "sandal") within a wider 3-day window and a
//           modest title overlap — consolidates the same premises event even
//           when phrased differently or reported a few days apart.

import { canonicalTitleKey } from "./monitorDedupe";

const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

// Function words stripped before headlines are compared, so similarity reflects
// content words only. Mirrors the list the report builder used previously.
const STORY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "after",
  "amid", "over", "into", "out", "near", "this", "that", "these", "those", "its",
  "it", "their", "his", "her", "has", "have", "had", "will", "would", "could",
  "than", "then", "not", "new", "say", "says", "said",
]);

export function storyTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STORY_STOPWORDS.has(t)),
  );
}

export function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Premises-type nouns. The distinctive word IMMEDIATELY before one of these is
// the "premises modifier" that identifies a specific site ("sandal factory",
// "Tanah Abang market"). Two headlines sharing the same modifier before the
// same kind of premises are almost certainly the same event.
const PREMISES_TYPES = new Set([
  "factory", "plant", "mill", "refinery", "warehouse", "depot", "godown",
  "market", "mall", "store", "shop", "supermarket", "minimart", "showroom",
  "workshop", "garage", "terminal", "tower", "hotel", "mosque", "church",
  "temple", "school", "hospital", "clinic", "station", "port", "wharf",
  "complex", "estate", "plaza", "apartment", "apartments", "restaurant",
  "cafe", "office", "bank", "kiosk", "stall",
]);

// Words that, even when sitting before a premises noun, are too generic to
// identify a SPECIFIC site (so they never count as a distinctive modifier).
const GENERIC_MODIFIERS = new Set([
  "the", "a", "an", "old", "new", "big", "small", "main", "local", "city",
  "town", "central", "north", "south", "east", "west", "near", "huge", "large",
  "major", "massive", "fire", "blaze", "factory", "plant", "market", "building",
  "house", "home", "shop", "store",
]);

// The distinctive modifiers naming a specific premises in a headline.
export function namedPremises(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 1; i < words.length; i++) {
    if (!PREMISES_TYPES.has(words[i])) continue;
    const mod = words[i - 1];
    if (
      mod.length >= 3 &&
      !STORY_STOPWORDS.has(mod) &&
      !GENERIC_MODIFIERS.has(mod) &&
      !PREMISES_TYPES.has(mod)
    ) {
      out.add(mod);
    }
  }
  return out;
}

const FIRE_RE = /(fire|blaze|gutt|razed|inferno|burn|explos)/;

// Normalise an incident to a coarse type family used for compatibility. Fire
// and explosion incidents collapse to one "fire" family (so a fire reported as
// "blaze" and "explosion" can still consolidate); everything else keys off the
// curated category label.
export function incidentTypeKey(
  title: string,
  category: string | null | undefined,
): string {
  const hay = `${title} ${category ?? ""}`.toLowerCase();
  if (FIRE_RE.test(hay)) return "fire";
  return (category ?? "").trim().toLowerCase() || "other";
}

export interface SameStoryRow {
  title: string;
  // Geographic anchor. Both-null counts as a match (national items). Callers
  // that cannot resolve a province should pass null for every row so the
  // geographic gate is a no-op and the title/premises evidence decides.
  province: string | null;
  typeKey: string;
  dateMs: number;
  severityRank: number;
  // Optional secondary compatibility signals (report-builder parity).
  category?: string | null;
  displayCategory?: string | null;
}

const DAY = 86_400_000;

// Cluster rows describing the same real-world event. Returns clusters of input
// INDICES; within each cluster the FIRST index is the representative (highest
// severity, then newest), because rows are processed in that order.
export function clusterSameStoryRows(rows: SameStoryRow[]): number[][] {
  const order = rows.map((_, i) => i).sort((a, b) => {
    if (rows[b].severityRank !== rows[a].severityRank)
      return rows[b].severityRank - rows[a].severityRank;
    return rows[b].dateMs - rows[a].dateMs;
  });
  const feats = rows.map((r) => ({
    toks: storyTokens(r.title),
    prem: namedPremises(r.title),
    canon: canonicalTitleKey(r.title),
  }));
  interface Cluster {
    repIdx: number;
    members: number[];
  }
  const clusters: Cluster[] = [];
  for (const i of order) {
    const r = rows[i];
    const f = feats[i];
    let placed = false;
    for (const c of clusters) {
      const j = c.repIdx;
      const rr = rows[j];
      const ff = feats[j];
      // PATH 0: identical canonical title — same story regardless of date/place.
      if (f.canon && f.canon === ff.canon) {
        c.members.push(i);
        placed = true;
        break;
      }
      // Both-null province counts as a match; one-null is a mismatch.
      if ((rr.province ?? null) !== (r.province ?? null)) continue;
      const compatType =
        rr.typeKey === r.typeKey ||
        (!!rr.category && rr.category === r.category) ||
        (!!rr.displayCategory && rr.displayCategory === r.displayCategory);
      if (!compatType) continue;
      const dd = Math.abs(rr.dateMs - r.dateMs);
      const jac = tokenJaccard(ff.toks, f.toks);
      // PATH 1: strong title overlap, same/adjacent day.
      if (dd <= DAY && ff.toks.size >= 3 && f.toks.size >= 3 && jac >= 0.5) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 2: shared named premises within a wider window (the sandal-factory
      // -fire case), gated by a modest overlap so a fluke shared modifier across
      // very different headlines cannot merge two distinct events.
      const sharedPrem = [...f.prem].some((p) => ff.prem.has(p));
      if (dd <= 3 * DAY && sharedPrem && jac >= 0.25) {
        c.members.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ repIdx: i, members: [i] });
  }
  return clusters.map((c) => c.members);
}

// Page-level convenience: collapse a window of raw incidents to one row per
// consolidated story, keeping the representative (highest severity, then
// newest). Province is intentionally left null for every row so the title /
// premises evidence decides (the page cannot resolve config provinces, and the
// set is already scoped to one country).
export function consolidateCountryStories<
  T extends {
    title: string;
    severity?: string | null;
    occurredAt: string;
    category?: string | null;
  },
>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const sr: SameStoryRow[] = rows.map((r) => ({
    title: r.title ?? "",
    province: null,
    typeKey: incidentTypeKey(r.title ?? "", r.category ?? null),
    dateMs: Number.isNaN(Date.parse(r.occurredAt)) ? 0 : Date.parse(r.occurredAt),
    severityRank: SEV_RANK[(r.severity ?? "").toLowerCase()] ?? 0,
    category: r.category ?? null,
  }));
  return clusterSameStoryRows(sr).map((cluster) => rows[cluster[0]]);
}
