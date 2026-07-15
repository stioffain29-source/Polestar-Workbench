// Conflict-only "same-operation running-tally collapse".
//
// Conflict news reports a SINGLE counter-insurgency operation as a RUNNING
// TALLY across many outlets and days — "75 insurgents killed", then "88",
// "102", "105", "114 militants killed since July 5" — each landing as its own
// incident and inflating the Conflict Watch monitor and report with copies of
// ONE event. This collapses those copies down to the single best row, WITHOUT
// ever merging two distinct events.
//
// Runs ONLY for topic === "conflict", AFTER the generic dedupeMonitorRows
// syndication collapse. Two independent, tightly-gated passes:
//   Pass A (snapshot): same theatre + same militant-kill FIGURE + same UTC day.
//       Kills the different-headline syndications of one snapshot ("75
//       insurgents" / "75 separatists" / "75 BLA militants") that share no
//       masthead, so canonicalTitleKey misses them.
//   Pass B (running tally): same theatre + same EXPLICIT operation anchor —
//       a named operation ("Operation Shaban") OR a "since <Month Day>" start
//       date. Collapses the escalating cumulative counts of one operation.
//
// HARD SAFETY RAILS (zero real-event collateral is the mandate — under-merging
// a couple of copies is always preferred over ever merging distinct events):
//   * Candidacy requires a MILITANT-DIRECTION kill tally: a DIGIT figure bound
//     to a militant/insurgent/rebel/... "killed" phrase. The figure is that
//     capture group, never "any number in the title", so "since July 5" (the 5)
//     or "18 abducted police" can never be read as the tally. Spelled-out
//     counts ("four more terrorists") are left uncollapsed by design.
//   * A PERSONNEL-DIRECTION victim (police / soldiers / personnel / civilians /
//     workers ... killed) is a hard VETO checked FIRST, so the militant ATTACKS
//     that trigger an operation — and mixed roundups ("54 militants, 38
//     personnel killed") — are excluded from candidacy entirely and pass
//     through untouched. An attack can therefore never merge with an operation.
//   * Only rows naming a curated conflict THEATRE cluster; anchors are explicit
//     and NEVER chained (a named op and a since-date stay separate clusters
//     even for the same operation — deliberate under-merge).
//   * Non-candidates are ALWAYS kept, first-occurrence order preserved.

import { SEV_RANK } from "./monitorDedupe";

export interface ConflictCollapseRow {
  title: string;
  displayTitle?: string | null;
  date: Date;
  severity: string;
}

// Curated conflict theatres that exhibit running-tally reporting. Kept
// deliberately small — a theatre is added only once its data shows the
// running-tally pattern, so the collapse can never over-merge a theatre it has
// not been vetted against. Maps every spelling variant to one canonical key.
const THEATRES: { token: string; key: string }[] = [
  { token: "balochistan", key: "balochistan" },
  { token: "baluchistan", key: "balochistan" },
];

// Spelled-out and digit counts, for the PERSONNEL veto only (militant tallies
// require a digit so their figure is rankable).
const NUM =
  "(?:\\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozens?|scores?|several)";

const MILITANT =
  "(?:militant|insurgent|rebel|separatist|terrorist|guerrilla|fighter|cadre|extremist|militia|jihadist)s?";

const PERSONNEL =
  "(?:police|policemen|policeman|officer|officers|cop|cops|personnel|soldier|soldiers|troop|troops|jawan|jawans|civilian|civilians|worker|workers|guard|guards|constable|constables|paramilitary|villager|villagers|labourer|labourers|laborer|laborers|passenger|passengers|hostage|hostages|pilgrim|pilgrims|miner|miners)";

const KILLED =
  "(?:kill(?:s|ed|ing)?|dead|martyred|die[ds]?|gunned down|shot dead|slain|slay|slew)";

// Pass A (anchorless snapshot) only collapses LARGE militant tallies. Two
// genuinely distinct small encounters in one theatre on one day can each report
// the same low figure ("3 militants killed" in a Quetta raid vs a Kech
// gunbattle), and Pass A's key (theatre+figure+day) cannot tell them apart — so
// a low figure is left uncollapsed rather than risk merging distinct events.
// Running-tally / mass-snapshot syndications (the target) run well above this;
// the live cluster this fix addresses was 75+. Anchored tallies are unaffected —
// they collapse in Pass B on their explicit operation anchor regardless of size.
const MIN_SNAPSHOT_FIGURE = 20;

// A militant-direction kill tally, capturing the militant figure (digits only).
const MILITANT_KILL_RE: RegExp[] = [
  new RegExp(`\\b(\\d{1,4})\\s+(?:\\S+\\s+){0,3}?${MILITANT}\\b[^.]{0,40}?\\b${KILLED}\\b`, "i"),
  new RegExp(`\\b${KILLED}\\b[^.]{0,20}?\\b(\\d{1,4})\\s+(?:\\S+\\s+){0,3}?${MILITANT}\\b`, "i"),
];

// A personnel-direction victim killed — the ATTACK side. Any match vetoes
// candidacy so an attack (or a mixed attack+operation roundup) is never
// collapsed into an operation cluster.
const PERSONNEL_KILL_RE: RegExp[] = [
  new RegExp(`\\b${NUM}\\s+(?:\\S+\\s+){0,3}?${PERSONNEL}\\b[^.]{0,40}?\\b${KILLED}\\b`, "i"),
  new RegExp(`\\b${KILLED}\\b[^.]{0,20}?\\b${NUM}\\s+(?:\\S+\\s+){0,3}?${PERSONNEL}\\b`, "i"),
];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12,
  december: 12,
};

function textOf(row: ConflictCollapseRow): string {
  return row.displayTitle ?? row.title ?? "";
}

/**
 * The militant-kill figure for a row, or null when the row is NOT a militant
 * running-tally candidate. Returns null when a personnel victim is present
 * (veto, checked first) or when no digit militant-kill tally is found.
 * Exported for tests.
 */
export function militantKillFigure(text: string): number | null {
  if (PERSONNEL_KILL_RE.some((re) => re.test(text))) return null; // attack side — veto
  for (const re of MILITANT_KILL_RE) {
    const m = re.exec(text);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Canonical theatre key named in the text, or null. Exported for tests. */
export function detectTheatre(text: string): string | null {
  const hay = ` ${text.toLowerCase()} `;
  for (const { token, key } of THEATRES) {
    const i = hay.indexOf(token);
    if (i === -1) continue;
    const before = hay[i - 1];
    const after = hay[i + token.length];
    const wordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
    if (!wordChar(before) && !wordChar(after)) return key;
  }
  return null;
}

/**
 * The explicit operation anchor for Pass B: a named operation ("op:shaban")
 * takes precedence, else a "since <Month Day>" start date ("since:7-5"), else
 * null (the row does not cluster in Pass B). Exported for tests.
 */
export function operationAnchor(text: string): string | null {
  const op = /\boperation\s+([a-z][a-z'’-]{2,})/i.exec(text);
  if (op) return `op:${op[1]!.toLowerCase().replace(/[’']/g, "'")}`;

  const s1 = /\bsince\s+(?:the\s+)?([a-z]+)\.?\s+(\d{1,2})\b/i.exec(text);
  if (s1) {
    const m = MONTHS[s1[1]!.toLowerCase()];
    if (m) return `since:${m}-${parseInt(s1[2]!, 10)}`;
  }
  const s2 = /\bsince\s+(?:the\s+)?(\d{1,2})\s+([a-z]+)\b/i.exec(text);
  if (s2) {
    const m = MONTHS[s2[2]!.toLowerCase()];
    if (m) return `since:${m}-${parseInt(s2[1]!, 10)}`;
  }
  return null;
}

function utcDay(d: Date): string | null {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * The operation's START year, folded into the Pass B key so a "since July 5"
 * tally from one year never merges with a "since July 5" tally from another.
 * The monitor collapses the FULL incident list before windowing, so without
 * this a 2025 operation and a 2026 operation sharing a start date and theatre
 * would merge and drop last year's real event. For a "since <Month Day>" anchor
 * whose month is LATER than the row's own month, the start date fell in the
 * PREVIOUS calendar year (a tally reported in January of an operation begun the
 * previous December), so the year wraps back. A named operation has no start
 * date, so its best-available year is the row's own. Returns null on a bad date.
 */
function anchorStartYear(anchor: string, d: Date): number | null {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const rowYear = d.getUTCFullYear();
  const since = /^since:(\d{1,2})-\d{1,2}$/.exec(anchor);
  if (since) {
    const sinceMonth = parseInt(since[1]!, 10);
    const rowMonth = d.getUTCMonth() + 1;
    return sinceMonth > rowMonth ? rowYear - 1 : rowYear;
  }
  return rowYear;
}

// True when candidate `a` (figure aFig) is a better cluster representative than
// `b` (figure bFig). Order: highest militant figure -> highest severity ->
// newest date. Severity sits ABOVE recency deliberately: these are copies of
// ONE event, and this is a no-understatement risk product — the highest
// severity any copy was classified at is the safe severity to keep (mirroring
// dedupeMonitorRows). For a running tally the figure already dominates, so
// severity/date only decide same-figure snapshot ties.
function better(
  a: ConflictCollapseRow,
  aFig: number,
  b: ConflictCollapseRow,
  bFig: number,
): boolean {
  if (aFig !== bFig) return aFig > bFig;
  const sa = SEV_RANK[(a.severity ?? "").toLowerCase()] ?? 0;
  const sb = SEV_RANK[(b.severity ?? "").toLowerCase()] ?? 0;
  if (sa !== sb) return sa > sb;
  const ta = a.date instanceof Date ? a.date.getTime() : NaN;
  const tb = b.date instanceof Date ? b.date.getTime() : NaN;
  const na = Number.isNaN(ta) ? -Infinity : ta;
  const nb = Number.isNaN(tb) ? -Infinity : tb;
  return na >= nb;
}

// Generic single-pass collapse. `keyOf` returns a cluster key for a candidate
// row (given its militant figure) or null to keep the row untouched. The
// cluster winner is kept in the FIRST position the cluster appeared, so
// first-occurrence order is preserved.
function collapsePass<T extends ConflictCollapseRow>(
  rows: T[],
  keyOf: (row: T, figure: number) => string | null,
): T[] {
  const out: T[] = [];
  const idxByKey = new Map<string, number>();
  const figByKey = new Map<string, number>();
  for (const r of rows) {
    const fig = militantKillFigure(textOf(r));
    if (fig === null) {
      out.push(r);
      continue;
    }
    const key = keyOf(r, fig);
    if (key === null) {
      out.push(r);
      continue;
    }
    const prevIdx = idxByKey.get(key);
    if (prevIdx === undefined) {
      idxByKey.set(key, out.length);
      figByKey.set(key, fig);
      out.push(r);
    } else if (better(r, fig, out[prevIdx]!, figByKey.get(key)!)) {
      out[prevIdx] = r;
      figByKey.set(key, fig);
    }
  }
  return out;
}

/**
 * Collapse a conflict incident list's same-operation running-tally duplicates.
 * Safe to call on any conflict row list (monitor or report). Non-conflict
 * callers should not use this.
 */
export function collapseConflictOperations<T extends ConflictCollapseRow>(
  rows: T[],
): T[] {
  // Pass A — snapshot: theatre + militant figure + same UTC day. Only LARGE
  // figures cluster here (see MIN_SNAPSHOT_FIGURE) so two distinct small
  // same-day encounters sharing a low figure are never merged.
  const passA = collapsePass(rows, (r, fig) => {
    if (fig < MIN_SNAPSHOT_FIGURE) return null;
    const theatre = detectTheatre(textOf(r));
    if (!theatre) return null;
    const day = utcDay(r.date);
    if (day === null) return null;
    return `A|${theatre}|${fig}|${day}`;
  });
  // Pass B — running tally: theatre + explicit operation anchor + start year.
  // The start year keeps a "since July 5" tally from one year merging with the
  // same-dated tally from another when the monitor collapses the full list.
  return collapsePass(passA, (r) => {
    const theatre = detectTheatre(textOf(r));
    if (!theatre) return null;
    const anchor = operationAnchor(textOf(r));
    if (!anchor) return null;
    const year = anchorStartYear(anchor, r.date);
    if (year === null) return null;
    return `B|${theatre}|${anchor}|${year}`;
  });
}
