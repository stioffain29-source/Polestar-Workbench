// Conflict-only "same-event syndication collapse" for DIFFERENT-headline copies
// of ONE incident that the conservative title/canonical dedupe cannot bridge.
//
// The running-tally fold (conflictOperationCollapse) only touches militant-KILL
// operation snapshots — a civilian/personnel victim is a hard veto there. But
// conflict news ALSO re-runs a single small event under wholly different
// headlines, e.g. one Kuki farmer shot dead in Manipur's Kangpokpi landing as:
//   "Armed men kill 53-year-old farmer in Manipur's Kangpokpi"
//   "Man shot dead by suspected militants in Manipur's Kangpokpi"
//   "Kuki farmer shot dead while working in jhum field in Manipur's Kangpokpi"
// These share no masthead and few title words, so canonicalTitleKey keeps all
// three and the monitor/report over-count one killing three times.
//
// This is a TIGHTLY-gated fuzzy pass, deliberately NOT flashpoint's
// clusterSameEvent (whose shared>=2 threshold is met by two place tokens alone,
// and whose distinctSubjects veto conversely blocks the very copies above). It
// links a pair ONLY when ALL hold:
//   (1) same non-empty attributed country (exact; no unknown-wildcard);
//   (2) event dates within 48h;
//   (3) >= 3 shared ANCHOR tokens over the masthead-stripped TITLE, where
//       anchors EXCLUDE country-name tokens, pure digits, and the generic
//       casualty / action / actor / reporting vocabulary that varies outlet-to-
//       outlet for one event — so two place tokens alone (country + district)
//       can NEVER reach the bar; a shared victim/occupation/specific-noun anchor
//       is also required. The summary is deliberately NOT read: in this data it
//       is the full title with the SOURCE MASTHEAD appended (space-separated, so
//       canonicalTitleKey cannot strip it), which would inject masthead words
//       ("today", "rediff") as anchors and could falsely merge two distinct
//       same-district events from the same outlet — collateral the mandate bans;
//   (4) digit-conflict veto — if BOTH texts carry small (age/count) numbers and
//       they share NONE, never link (guards distinct casualty figures).
//
// HARD MANDATE: zero real-event collateral — always prefer UNDER-merging. Two
// genuinely distinct same-day, same-district killings share only the two place
// tokens (=2) and so never merge. A likely-same event that a headline mis-
// districts (Kangpokpi vs Tamenglong) also stays separate rather than risk it.
// Non-candidates are always kept; first-occurrence order is preserved.

import { SEV_RANK, canonicalTitleKey } from "./monitorDedupe";
import { militantKillFigure } from "./conflictOperationCollapse";

export interface ConflictSameEventRow {
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  date: Date;
  severity: string;
  country?: string | null;
}

// Two syndicated copies of one conflict event are rarely reported more than a
// day apart; 48h absorbs cross-outlet occurredAt drift without reaching into a
// second, distinct event.
const SAME_EVENT_WINDOW_MS = 48 * 60 * 60 * 1000;

// A shared victim/occupation/specific-noun anchor on TOP of the two place
// tokens is required, so the effective bar is "same district AND a shared
// content word". Three is the smallest count that guarantees that.
const MIN_SHARED = 3;

// Anchors shorter than this are dropped as noise (possessive "s", stray
// initials). Conflict place/victim tokens are comfortably longer.
const MIN_TOKEN_LEN = 3;

// Generic vocabulary that must NOT anchor a same-event match. Casualty, action
// and actor-descriptor words vary outlet-to-outlet for the SAME event ("armed
// men kill" vs "man shot dead by suspected militants"), so counting them would
// both fail to merge real copies AND risk merging two DIFFERENT attacks that
// merely share "gunmen"/"killed". Excluding them leaves only discriminating
// content (places, victim occupations, specific nouns) to reach the threshold.
// Do NOT add place names, victim occupations (farmer/teacher/pilgrim), or
// specific event nouns (church/convoy/temple/market/mosque/school) here.
const NON_ANCHOR = new Set<string>([
  // function / connective words
  "the", "a", "an", "of", "in", "on", "at", "to", "by", "for", "and", "or",
  "with", "from", "into", "onto", "over", "after", "before", "near", "amid",
  "amidst", "while", "as", "its", "his", "her", "their", "our", "was", "were",
  "are", "is", "be", "been", "being", "that", "this", "these", "those", "who",
  "whom", "which", "what", "when", "where", "how", "why", "out", "up", "down",
  "off", "against", "during", "between", "among", "per", "via", "about",
  "around", "across", "than", "then", "there", "here", "not", "no",
  // reporting cruft
  "says", "say", "said", "report", "reports", "reported", "reportedly",
  "breaking", "live", "video", "watch", "news", "update", "updates", "updated",
  "latest", "following", "claim", "claims", "claimed", "alleged", "allegedly",
  "according", "amidst",
  // casualty / action / violence (vary per outlet for one event)
  "kill", "kills", "killed", "killing", "killings", "dead", "death", "deaths",
  "die", "dies", "died", "dying", "toll", "wound", "wounds", "wounded",
  "injure", "injured", "injures", "injury", "injuries", "hurt", "casualty",
  "casualties", "fatality", "fatalities", "victim", "victims", "attack",
  "attacks", "attacked", "ambush", "ambushed", "ambushes", "shoot", "shoots",
  "shot", "shooting", "shootings", "gun", "guns", "gunfire", "gunned", "fire",
  "fired", "firing", "blast", "blasts", "explosion", "explosions", "bomb",
  "bombs", "bombing", "bombings", "murder", "murders", "murdered", "slain",
  "slay", "slew", "assault", "assaulted", "raid", "raids", "raided", "clash",
  "clashes", "clashed", "violence", "violent", "strike", "strikes", "struck",
  "hit", "hits", "abduct", "abducted", "abduction", "kidnap", "kidnapped",
  "kidnapping",
  // actor descriptors (generic, vary per outlet)
  "militant", "militants", "insurgent", "insurgents", "rebel", "rebels",
  "separatist", "separatists", "terrorist", "terrorists", "gunman", "gunmen",
  "armed", "assailant", "assailants", "attacker", "attackers", "suspect",
  "suspects", "suspected", "unidentified", "unknown", "group", "groups",
  "cadre", "cadres", "extremist", "extremists", "militia", "militias",
  "fighter", "fighters", "men", "man", "people", "person", "persons",
  "individual", "individuals", "male", "female", "woman", "women", "youth",
  "youths",
  // security-force actors (generic; vary per outlet) — NB keep "rifles" as an
  // anchor: it is part of the unit name "Assam Rifles", a real discriminator.
  "police", "security", "forces", "force", "troops", "troop", "personnel",
  "jawan", "jawans", "soldier", "soldiers", "army", "paramilitary", "commando",
  "commandos", "officer", "officers", "cop", "cops", "guard", "guards",
  "constable", "constables", "trooper", "troopers", "operative", "operatives",
  // insurgent actors / ranks (generic)
  "maoist", "maoists", "naxal", "naxals", "naxalite", "naxalites", "khawarij",
  "fitna", "ultras", "ultra", "commander", "commanders", "leader", "leaders",
  "chief", "chiefs",
  // operation / encounter vocabulary (generic beat words)
  "encounter", "encounters", "operation", "operations", "gunbattle",
  "gunfight", "crossfire", "offensive", "cordon", "combing", "anti", "counter",
  "insurgency", "counterinsurgency", "counterterrorism", "terror", "op",
  // generic weapon / seizure nouns (specific values like gold/cash stay anchors)
  "arms", "weapon", "weapons", "ammunition", "ammo", "explosive", "explosives",
  "ied", "ieds", "grenade", "grenades", "pistol", "arsenal", "cache", "dump",
  "dumps", "haul", "hideout", "hideouts",
  // event-CLASS marker words — these decide the class gate, they must never also
  // count as content anchors (else two distinct arrests/seizures merge on them).
  "arrest", "arrested", "arrests", "nabbed", "detained", "detain", "apprehend",
  "apprehended", "chargesheet", "chargesheets", "chargesheeted", "accused",
  "custody", "remand", "recover", "recovered", "recovery", "recovers", "seize",
  "seized", "seizure", "seizes", "surrender", "surrendered", "surrenders",
  "tribute", "tributes", "homage", "condemn", "condemns", "condemned",
  "condemnation", "mourn", "mourns", "mourned", "mourning", "cremated",
  "cremation", "funeral", "respects", "denies", "deny", "denied", "honour",
  "honours", "honoured", "honor", "honors", "honored", "manhunt", "hunt",
  "search", "probe", "strategy", "revamp", "overhaul", "withdrawal", "review",
  "reviews", "timeline", "analysis", "explained", "explainer", "policy",
  // spelled-out small numbers (counts) — kept out of anchors AND fed to the
  // digit-conflict veto so "Eight killed" vs "Two killed" never merge.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred",
  // generic intensifiers / framing
  "massive", "major", "deadly", "fresh", "dreaded", "top", "more", "several",
  "many", "worth", "around", "bust", "busts", "wanted",
  // age / descriptor cruft
  "year", "years", "old", "aged", "age",
  // generic geographic filler — administrative nouns that ACCOMPANY a real
  // place name but carry no discriminating signal of their own, so they must
  // never supply the third anchor between two DISTINCT events at the same named
  // place. "Man killed in Kangpokpi district" vs "Woman killed in Kangpokpi
  // district" would otherwise anchor to {manipur, kangpokpi, district} = 3 and
  // merge two different killings. The real place token (kangpokpi) still
  // anchors; only the filler is dropped, so genuine same-event copies that
  // share a victim/occupation/specific-noun anchor are unaffected.
  "district", "districts", "village", "villages", "area", "areas", "town",
  "towns", "region", "regions", "state", "states", "border", "borders",
  "city", "cities", "tehsil", "taluk", "taluka", "subdivision",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// The same-event signature reads the masthead-stripped TITLE only. Conflict
// summaries are the full title with a space-appended source masthead that
// canonicalTitleKey cannot strip (no dash/pipe separator), so folding the
// summary in would add masthead words as false anchors — see the header note.
// canonicalTitleKey also drops a trailing " | Source" / " - Source" suffix that
// some titles carry, giving parity with the monitor's own dedupe key.
function textOf(row: ConflictSameEventRow): string {
  return canonicalTitleKey(row.title);
}

/** Discriminating anchor tokens (see NON_ANCHOR). Exported for tests. */
export function anchorTokens(
  text: string,
  country?: string | null,
): Set<string> {
  const countryToks = new Set(tokenize(country ?? ""));
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (t.length < MIN_TOKEN_LEN) continue;
    if (/^\d+$/.test(t)) continue; // pure digit — never an anchor
    if (NON_ANCHOR.has(t)) continue;
    if (countryToks.has(t)) continue;
    out.add(t);
  }
  return out;
}

// Spelled-out small numbers, normalised to the same string keys as the numeric
// veto so "Seven more terrorists" conflicts with "Four terrorists".
const SPELLED_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

// Small (age / count) numbers only; four-digit numbers (years) are ignored so a
// shared/mismatched "2026" never drives the veto. Both numeric ("4") and
// spelled ("four") counts are normalised together.
function digitTokens(text: string): Set<string> {
  const out = new Set<string>();
  const m = text.match(/\b\d{1,3}\b/g);
  if (m) for (const d of m) out.add(String(parseInt(d, 10)));
  for (const t of tokenize(text)) {
    const v = SPELLED_NUMBERS[t];
    if (v !== undefined) out.add(String(v));
  }
  return out;
}

// True when BOTH texts carry small numbers and they share NONE — the two rows
// report different casualty ages/counts, so they are different events.
//
// The test is subset-based, NOT "share no number": a merge is vetoed only when
// EACH side carries a small number the other lacks (conflicting counts, e.g.
// "8 killed, 30 buildings" vs "2 killed, 8 injured" — the shared "8" is a
// killed-vs-injured coincidence, not agreement). When one side's numbers are a
// SUBSET of the other's ("21 found" vs "21 found, toll rises to 30") the extra
// number is just added detail from the same event, so the merge is allowed.
// Subset-veto is strictly more conservative than share-none (it vetoes
// everything share-none did, plus partial-overlap conflicts), so it can only
// UNDER-merge relative to the old rule — the mandated-safe failure direction.
function digitsConflict(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let aExtra = false;
  for (const x of a)
    if (!b.has(x)) {
      aExtra = true;
      break;
    }
  if (!aExtra) return false; // a ⊆ b — added detail only, not a conflict
  for (const x of b) if (!a.has(x)) return true; // each has a number the other lacks
  return false; // b ⊆ a — added detail only, not a conflict
}

// Which of two copies survives: higher severity, then newer date. Mirrors
// dedupeMonitorRows so the surviving row is consistent across every pass.
function better(a: ConflictSameEventRow, b: ConflictSameEventRow): boolean {
  const sa = SEV_RANK[(a.severity ?? "").toLowerCase()] ?? 0;
  const sb = SEV_RANK[(b.severity ?? "").toLowerCase()] ?? 0;
  if (sa !== sb) return sa > sb;
  const ta = a.date instanceof Date ? a.date.getTime() : NaN;
  const tb = b.date instanceof Date ? b.date.getTime() : NaN;
  const na = Number.isNaN(ta) ? -Infinity : ta;
  const nb = Number.isNaN(tb) ? -Infinity : tb;
  return na >= nb;
}

// ---------------------------------------------------------------------------
// Event-class gate. Anchor overlap ALONE cannot separate a same-report
// syndication from DISTINCT follow-on coverage of the same incident: a tribute,
// manhunt or policy story recites the SAME named entities and even the same
// action words ("personnel killed in Ukhrul ambush") as the original attack, so
// {assam, rifles, ukhrul} already clears the anchor bar between the attack and
// its aftermath coverage. We therefore fingerprint each title into a
// precedence-ordered class and ONLY let same-class rows link. The four "meta"
// classes (reaction/aftermath/policy/explainer) plus named operations and
// running tallies are NON-candidates: they never merge with anything and pass
// through untouched (tallies/ops are folded later by collapseConflictOperations).
//
// Precedence puts the meta classes FIRST because they recite kinetic words, and
// candidate classes (kinetic/arrest/seizure/surrender) last. Over-matching a
// meta class can only turn a real syndication into a singleton — i.e. it can
// only UNDER-merge, the mandated-safe failure — so the meta patterns are
// deliberately generous.
type EventClass =
  | "reaction"
  | "aftermath"
  | "policy"
  | "explainer"
  | "operation"
  | "arrest"
  | "seizure"
  | "surrender"
  | "kinetic"
  | "other";

// Only these classes may fold; every other class is a permanent singleton.
const CANDIDATE_CLASSES = new Set<EventClass>([
  "kinetic",
  "arrest",
  "seizure",
  "surrender",
]);

// REACTION: statements/ceremonies ABOUT an incident (tribute, condemnation,
// denial) — not the incident itself.
const RE_REACTION =
  /\b(tribute|tributes|homage|condol\w*|condemn\w*|mourn\w*|cremat\w*|funeral|buried|respects|denies|denied|deny|honou?rs?|honou?red|honou?ring|obituar\w*|condolence\w*)\b/i;
// AFTERMATH-OPS: the hunt/search/probe that FOLLOWS an attack.
const RE_AFTERMATH =
  /\b(manhunt|combing)\b|\b(search|joint|massive)\s+\w*\s*(operation|operations|hunt)\b|\bhunt\b|\boperations?\s+continue\w*\b|\bsearch\s+(underway|launched|begins|on|intensif\w*)\b|\bprobe\b/i;
// POLICY: strategy / review / legislative response.
const RE_POLICY =
  /\b(strategy|revamp|overhaul|withdrawal|on\s+card|clear\s+way|counter-?insurgency\s+(strateg\w*|plan|policy)|to\s+review|review\s+of|reviews?\b|policy)\b/i;
// EXPLAINER: timelines, analyses, backgrounders.
const RE_EXPLAINER =
  /\b(timeline|analysis|explained|explainer|death\s+throes|decades-long|in-depth|opinion|a\s+look\s+at|profile|backgrounder)\b/i;
// ARREST / legal process.
const RE_ARREST =
  /\b(arrest\w*|nabbed|detain\w*|apprehend\w*|chargesheet\w*|accused|custody|remand|interpol|red\s+(corner\s+)?notice)\b/i;
// SEIZURE of arms / cash / caches.
const RE_SEIZURE = /\b(recover\w*|seiz\w*|cache|arms\s+dump|confiscat\w*|haul)\b/i;
// SURRENDER.
const RE_SURRENDER = /\bsurrender\w*\b/i;
// KINETIC: the violent act itself (default when no meta/candidate class matched).
const RE_KINETIC =
  /\b(kill\w*|dead|shot|shoot\w*|ambush\w*|attack\w*|blast\w*|explos\w*|bomb\w*|encounter\w*|gun\w*|fir(e|ed|ing)|clash\w*|massacre\w*|slain|slay|murder\w*|wound\w*|injur\w*|assault\w*|raid\w*|firefight|gunbattle|gunfight|crossfire|abduct\w*|kidnap\w*|neutralis\w*|neutraliz\w*|martyr\w*)\b/i;
// Named operation ("Operation Shaban") in ORIGINAL case — a proper-noun name,
// so match a capital O followed by a Capitalised name. Deferred wholesale to
// collapseConflictOperations, which owns the running death-toll snapshots.
const RE_NAMED_OP = /\bOperation\s+[A-Z][\w-]*/;

// Classify from the masthead-stripped title. `raw` is the original-case title
// (only used for the proper-noun named-operation test).
function classifyEventClass(text: string, raw: string): EventClass {
  if (militantKillFigure(text) !== null) return "operation"; // running tally
  if (RE_NAMED_OP.test(raw)) return "operation";
  if (RE_REACTION.test(text)) return "reaction";
  if (RE_AFTERMATH.test(text)) return "aftermath";
  if (RE_POLICY.test(text)) return "policy";
  if (RE_EXPLAINER.test(text)) return "explainer";
  if (RE_ARREST.test(text)) return "arrest";
  if (RE_SEIZURE.test(text)) return "seizure";
  if (RE_SURRENDER.test(text)) return "surrender";
  if (RE_KINETIC.test(text)) return "kinetic";
  return "other";
}

/**
 * Group different-headline syndications of ONE conflict event into clusters of
 * INDICES (into `rows`), in first-occurrence order. Rows that link to nothing
 * come back as singleton clusters. Exposed so callers/tests/diagnostics can see
 * exactly which rows fold together. See collapseConflictSameEvent for the rules.
 */
export function groupConflictSameEvent<T extends ConflictSameEventRow>(
  rows: T[],
): number[][] {
  const n = rows.length;
  if (n < 2) return rows.map((_, i) => [i]);

  const anchors = rows.map((r) => anchorTokens(textOf(r), r.country));
  const digits = rows.map((r) => digitTokens(textOf(r)));
  const countryKey = rows.map((r) => (r.country ?? "").trim().toLowerCase());
  const cls = rows.map((r) => classifyEventClass(textOf(r), r.title));

  // A row can seed/join a cluster only if it is a candidate class, names a
  // country, and carries enough discriminating anchors to reach the bar. Every
  // non-candidate row (meta class, named operation, running tally, unknown
  // country, too few anchors) stays a singleton and passes through untouched.
  const candidate = rows.map(
    (_, i) =>
      CANDIDATE_CLASSES.has(cls[i]!) &&
      !!countryKey[i] &&
      anchors[i]!.size >= MIN_SHARED,
  );

  // Pairwise link test between two candidate rows: same class, same country,
  // within the window, no digit conflict, and >= MIN_SHARED shared anchors.
  const pairLinks = (i: number, j: number): boolean => {
    if (cls[i] !== cls[j]) return false;
    if (countryKey[i] !== countryKey[j]) return false;
    const dt = Math.abs(rows[i]!.date.getTime() - rows[j]!.date.getTime());
    if (!Number.isFinite(dt) || dt > SAME_EVENT_WINDOW_MS) return false;
    if (digitsConflict(digits[i]!, digits[j]!)) return false;
    const a = anchors[i]!;
    const b = anchors[j]!;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;
    for (const t of small) if (big.has(t)) shared++;
    return shared >= MIN_SHARED;
  };

  // COMPLETE-LINKAGE, greedy in first-occurrence order: a row joins an existing
  // cluster only if it pairwise-links to EVERY member. Complete (not single)
  // linkage is essential — single-linkage transitively chains A–B–C so an
  // attack, its policy follow-up and a separate arrest fuse through a shared
  // hub. Requiring agreement with every member keeps each cluster internally
  // consistent, and combined with the class gate delivers the zero-collateral
  // mandate at the cost of accepted partial (under-)merging of large clusters.
  const clusters: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!candidate[i]) {
      clusters.push([i]); // permanent singleton
      continue;
    }
    let placed = false;
    for (const c of clusters) {
      const rep = c[0]!;
      if (!candidate[rep] || cls[rep] !== cls[i]) continue;
      let all = true;
      for (const m of c)
        if (!pairLinks(i, m)) {
          all = false;
          break;
        }
      if (all) {
        c.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }
  return clusters;
}

/**
 * Collapse different-headline syndications of ONE conflict event down to the
 * single best copy. Safe to call on any conflict row list (monitor or report);
 * the same-country gate is internal, so an unbucketed monitor call and the
 * report's per-country-bucketed call fold identically. Non-conflict callers
 * should not use this.
 */
export function collapseConflictSameEvent<T extends ConflictSameEventRow>(
  rows: T[],
): T[] {
  const n = rows.length;
  if (n < 2) return rows;
  const out: T[] = [];
  for (const cluster of groupConflictSameEvent(rows)) {
    let best = cluster[0]!;
    for (const idx of cluster) if (better(rows[idx]!, rows[best]!)) best = idx;
    out.push(rows[best]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Authoritative same-event collapse by the server-stamped event_cluster_key.
// ---------------------------------------------------------------------------
// The conflict ingest runs a server-side LLM same-event pass that stamps
// incidents.event_cluster_key on rows judged to be the SAME real event
// syndicated under different headlines (see lib/ingest conflictEventCluster).
// This runs FIRST in the conflict fold — ahead of the fuzzy title passes — so
// the authoritative grouping wins and the downstream heuristics only clean up
// what the LLM could not key. Rows with no key (the common case) pass through
// untouched and unchanged; only rows sharing a non-empty key collapse to one.
//
// Survivor per key: highest severity tier, then newest date — mirroring the
// generic monitor dedupe. The survivor takes the position of the group's FIRST
// member so first-occurrence order is preserved.
export function collapseByEventClusterKey<
  T extends { eventClusterKey?: string | null; date: Date; severity: string },
>(rows: T[]): T[] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, idx) => {
    const key = r.eventClusterKey?.trim();
    if (!key) return;
    const g = groups.get(key);
    if (g) g.push(idx);
    else groups.set(key, [idx]);
  });
  if (groups.size === 0) return rows;

  const survivor = new Map<string, number>();
  for (const [key, idxs] of groups) {
    let best = idxs[0]!;
    for (const i of idxs) {
      const a = rows[i]!;
      const b = rows[best]!;
      const sa = SEV_RANK[(a.severity ?? "").toLowerCase()] ?? 0;
      const sb = SEV_RANK[(b.severity ?? "").toLowerCase()] ?? 0;
      const ta = a.date instanceof Date ? a.date.getTime() : NaN;
      const tb = b.date instanceof Date ? b.date.getTime() : NaN;
      if (sa > sb || (sa === sb && (Number.isNaN(tb) || (!Number.isNaN(ta) && ta > tb)))) {
        best = i;
      }
    }
    survivor.set(key, best);
  }

  const out: T[] = [];
  const emitted = new Set<string>();
  rows.forEach((r, idx) => {
    const key = r.eventClusterKey?.trim();
    if (!key) {
      out.push(r);
      return;
    }
    if (emitted.has(key)) return;
    emitted.add(key);
    out.push(rows[survivor.get(key)!]!);
  });
  return out;
}
