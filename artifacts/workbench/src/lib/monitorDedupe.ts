// Conservative syndication dedupe for the topic monitors and their dashboard
// cards. Many outlets re-run the SAME wire under an identical headline; this
// collapses those exact-duplicate rows down to one so the monitor counts (and
// the map, country tallies and loss totals that read off them) reflect
// DISTINCT events, not the number of outlets that re-ran the story.
//
// Unlike the Flashpoint report's `dedupeByTitle`, this has NO fuzzy
// "signature" pass (date-bucket + shared keywords). It keys on the FULL
// canonical title, so two genuinely different stories that merely share a few
// words are never merged — only true syndicated copies collapse.

const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

// Short function words that never disqualify a tail from being a masthead
// ("The Straits Times", "Voice of America").
const MASTHEAD_STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "for",
  "de",
  "la",
  "el",
  "a",
  "an",
]);

/**
 * True when a trailing " - X" / " | X" clause looks like a SOURCE masthead
 * rather than a continuation of the headline. A masthead is either a bare
 * domain ("beritaimn.com") or a short (≤5-word) run whose significant words
 * each carry an uppercase letter ("Reuters", "AP", "The Straits Times",
 * "gCaptain"). A lowercase sentence fragment ("evacuation ordered") is NOT a
 * masthead — so two distinct headlines that merely share a prefix before a
 * dash are never collapsed.
 */
function looksLikeMasthead(tail: string): boolean {
  const t = tail.trim();
  if (!t || t.length > 40) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) return true; // bare domain
  const significant = words.filter((w) => !MASTHEAD_STOPWORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  return significant.every((w) => /[A-Z]/.test(w));
}

/**
 * Canonical key for a headline: drop a trailing " - Source" / " | Source"
 * masthead (the Google-News suffix) WHEN it looks like a publication name,
 * then lowercase, reduce every run of non-alphanumeric characters to a single
 * space, and trim. Two syndicated copies of one headline reduce to the same
 * key; distinct headlines do not. The separator must be space-padded so
 * in-word hyphens ("Iran-backed", "COVID-19") are never mistaken for a
 * boundary, the head must keep ≥2 words, and the tail must be masthead-like,
 * so a dash-introduced subtitle is preserved rather than stripped.
 */
export function canonicalTitleKey(title: string): string {
  let head = title;
  const m = title.match(/^(.*\S)\s[-–—|]\s([^-–—|]+)$/);
  if (m && m[1].trim().split(/\s+/).length >= 2 && looksLikeMasthead(m[2])) {
    head = m[1];
  }
  return head
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface MonitorDedupeRow {
  title: string;
  date: Date;
  severity: string;
}

/**
 * Collapse rows that share a canonical title, keeping the single best copy.
 * Winner order: optional caller `rank` (higher wins) → higher severity →
 * newest date. Rows with an empty canonical key (unkeyable) are always kept.
 * First-occurrence order is preserved.
 */
export function dedupeMonitorRows<T extends MonitorDedupeRow>(
  rows: T[],
  rank?: (row: T) => number,
): T[] {
  const better = (a: T, b: T): boolean => {
    if (rank) {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra > rb;
    }
    const sa = SEV_RANK[(a.severity ?? "").toLowerCase()] ?? 0;
    const sb = SEV_RANK[(b.severity ?? "").toLowerCase()] ?? 0;
    if (sa !== sb) return sa > sb;
    const ta = a.date instanceof Date ? a.date.getTime() : NaN;
    const tb = b.date instanceof Date ? b.date.getTime() : NaN;
    const na = Number.isNaN(ta) ? -Infinity : ta;
    const nb = Number.isNaN(tb) ? -Infinity : tb;
    return na >= nb;
  };
  const byKey = new Map<string, T>();
  let unkeyable = 0;
  for (const r of rows) {
    const k = canonicalTitleKey(r.title) || `__nokey_${unkeyable++}`;
    const prev = byKey.get(k);
    if (!prev || better(r, prev)) byKey.set(k, r);
  }
  return Array.from(byKey.values());
}
