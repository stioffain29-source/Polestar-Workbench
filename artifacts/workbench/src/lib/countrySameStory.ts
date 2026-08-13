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
// Five independent merge paths, strongest first:
//   PATH 0  identical canonical (masthead-stripped) title — same story, any
//           date or place (pure syndication).
//   PATH 1  same province + compatible type + same/adjacent day + strong title
//           overlap (Jaccard >= 0.5) — the existing syndication rule.
//   PATH 2  same province + same incident-type family + a SHARED NAMED PREMISES
//           ("sandal factory" -> "sandal") within a wider 3-day window and a
//           modest title overlap — consolidates the same premises event even
//           when phrased differently or reported a few days apart.
//   PATH 3  compatible type + a SHARED STRONG DISTINCTIVE ENTITY (a named armed
//           actor, or a foreign-national victim in a distinctive role) AND a
//           shared event-nature class, within a 3-day window — merges the same
//           event even when outlets phrase it so differently that bag-of-words
//           Jaccard falls below the floor ("American pilot killed by Papua
//           rebels" vs "AMA Air pilot, US citizen, shot dead by OPM"). Requires
//           a strong entity, never generic words, so distinct incidents that
//           merely share common vocabulary are never collapsed.
//   PATH 4  compatible type + BOTH headlines carry an ARMED-CLASH cue (gunfight
//           / firefight / cordon-and-search / forces surround) AND share a
//           DISTINCTIVE PLACE token (the town/premises, not a generic clash or
//           security word) within a tight 2-day window. An armed clash is
//           re-reported across outlets and days as the gunfight, then the
//           cordon, then the "forces surround" update, worded so differently
//           that Jaccard falls below the PATH-1 floor with no foreign-national
//           strong entity to anchor PATH 3 ("Gunfight rages in Shopian" vs
//           "Army, police surround two militants in Shopian as gunfight
//           continues"). The shared place anchor plus the short window keeps a
//           different town, or the same town more than two days apart, separate.
//   PATH 3B compatible with PATH 3's philosophy but for a Papua-specific gap: an
//           armed-actor family match (OPM/TPNPB/KKB — the SAME group under its
//           government vs separatist name) AND a shared fatal event-nature AND
//           an EXACT matching casualty count, within a same/next-day window.
//           Bridges "KKB attacks road workers, five killed" (broad theatre
//           name) and "Five shot dead in Tolikara; Kodam and TPNPB each claim
//           responsibility" (specific regency), which share ZERO other content
//           words. See "Casualty-count anchor (PATH 3B)" below for the full
//           rationale and false-positive tradeoff.
//   PATH 5  a shared DISTINCTIVE PLACE token (same anchor as PATH 4/2b) AND a
//           shared FATAL event-nature class, within a wider 3-day window and
//           NO Jaccard floor -- covers a fatal violent-crime story reported
//           once while facts are unclear ("Woman dead, suspected murder
//           victim in Grogol Petamburan") and again once a suspect/motive is
//           confirmed ("Woman killed by her boyfriend in Grogol Petamburan,
//           West Jakarta"), which shares almost no vocabulary beyond the
//           place name. See the PATH 5 comment at its call site for the
//           accepted false-positive tradeoff.
//
// The province gate on PATHS 1-4 is relaxed only for a SINGLE-THEATRE report
// (crossProvince), where sibling sub-provinces of the one theatre (e.g. Papua
// Pegunungan / Papua Tengah / Papua) are the same area; multi-city reports
// (Jakarta / Indonesia) keep the gate so distinct cities are never merged.

import { canonicalTitleKey } from "./monitorDedupe";
import { isUntranslatedTitle } from "./incidentTitle";

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

// ---------------------------------------------------------------------------
// Entity / synonym-anchored features (PATH 3)
// ---------------------------------------------------------------------------
// Bag-of-words Jaccard misses the same event when outlets phrase it very
// differently. This recognises a small set of synonym classes and STRONG
// DISTINCTIVE ENTITIES so the same event can be merged on shared meaning rather
// than shared wording — while still refusing to merge on generic words.

// Corroborating synonym classes (the "what happened" + a recurring named actor).
// Overlap in one of these is required ALONGSIDE a shared strong entity before
// PATH 3 merges, so a shared entity alone never collapses two distinct events.
// The armed actor (OPM / Papua rebels / separatists) is only a CORROBORATOR, not
// a strong anchor — it is a recurring actor across many separate Papua incidents,
// so it cannot on its own identify a single event.
const CLASS_PATTERNS: Array<[string, RegExp]> = [
  ["fatal", /\b(killed|kills?|shot\s+dead|gunned\s+down|dead|deaths?|slain|murder\w*|fatal\w*|died|bodies|body)\b/i],
  // Event-nature: a fire / blaze / explosion. Two outlets framing the same
  // fire as "kills 28" and "singer killed" share no other corroborating class,
  // so without this they read as distinct Top-3 developments. Bahasa
  // "kebakaran" (fire) is included for the Indonesian-language feeds. This is a
  // CORROBORATOR only (Top-3 diversity + strong-entity PATH 3); it never folds
  // buckets on its own, so distinct same-city fires are still shown separately.
  ["fire", /\b(fire|blaze|inferno|conflagration|kebakaran|razed|gutted|burn\w*|explos\w*|ledakan)\b/i],
  // Event-nature: a shooting. Two outlets covering the same shooting can frame
  // it as the act ("Shooting at X festival") vs the follow-up ("Crime scene
  // processing after shooting at X"), sharing too few tokens for the Jaccard
  // floor and no other class ("fatal" needs a stated death). CORROBORATOR only
  // (never folds on its own) — a shared distinctive place is still required, so
  // two different shootings in different towns stay separate. Bahasa
  // "penembakan" (shooting) included for Indonesian-language feeds.
  ["shooting", /\b(shooting|shootings|shooter|gunman|gunmen|gunfire|shot|penembakan)\b/i],
  ["evacuation", /\b(evacuat\w*|repatriat\w*|airlift\w*|flown\s+out)\b/i],
  ["abduction", /\b(abduct\w*|kidnap\w*|hostage\w*|held\s+captive|taken\s+captive)\b/i],
  ["injury", /\b(injured|wounded|hurt)\b/i],
  [
    "actor:opm",
    // "KKB" (Kelompok Kriminal Bersenjata, "armed criminal group") is the
    // Indonesian security establishment's official term for the SAME actor
    // TPNPB/OPM call themselves — outlets mix all three names for one armed
    // group depending on whether they take the government or separatist
    // framing ("KKB attacks road workers" vs "TPNPB claim responsibility" can
    // both describe the identical operation). Recognising "kkb" here lets the
    // fatal-count anchor below (PATH 3B) corroborate across that naming split.
    /\b(opm|tpnpb|kkb|west\s+papua\s+liberation(?:\s+army)?|papuan?\s+(?:rebels?|separatists?|insurgents?|militants?|gunmen)|separatist\s+(?:rebels?|fighters?|gunmen))\b/i,
  ],
];

// ---------------------------------------------------------------------------
// Casualty-count anchor (PATH 3B)
// ---------------------------------------------------------------------------
// The same Papua KKB/TPNPB/OPM attack is reported under the government frame
// ("KKB attacks road workers, five killed") and the separatist/neutral frame
// ("Five shot dead in Tolikara; Kodam and TPNPB each claim responsibility") so
// differently that they share ZERO content words — not even a place name, since
// one report uses the broad theatre ("Papua Highlands") and the other the
// specific regency ("Tolikara"). Bag-of-words Jaccard, named-premises, and the
// PATH-4 distinctive-place anchor all require some shared vocabulary, so none
// of them can bridge this pair. The one thing that DOES survive both framings
// is the casualty figure, which is why this is scoped narrowly: it only fires
// when BOTH headlines name the SAME armed-actor family (actor:opm, now
// including "KKB") AND the SAME fatal event-nature AND an EXACT matching
// casualty count, within a tight same/next-day window. This mirrors PATH 3's
// principle (corroborating classes are never sufficient alone) but substitutes
// a matching count for the foreign-national strong entity as the anchor — a
// coincidental exact-count match between two DIFFERENT armed-actor fatal
// events on the same day is rare enough to accept, while an actor-name-only or
// count-only match (already tested as non-merging above) stays a non-merge.

// Small (1-99) casualty counts only — 4-digit numbers are dates/years and are
// deliberately excluded so a shared "2026" can never pose as a shared count.
const SPELLED_SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

// The small (1-99) casualty-count tokens in a headline, digit and spelled-out
// forms normalised to the same string keys. Exported for tests.
export function victimCountTokens(title: string): Set<string> {
  const out = new Set<string>();
  const digits = title.match(/\b\d{1,2}\b/g);
  if (digits) for (const d of digits) out.add(String(parseInt(d, 10)));
  for (const t of storyTokens(title)) {
    const v = SPELLED_SMALL_NUMBERS[t];
    if (v !== undefined) out.add(String(v));
  }
  return out;
}

// Foreign nationalities -> canonical code (kept small; extend as needed). A
// foreign national in a distinctive role is a strong, event-identifying entity.
// Matched case-INSENSITIVELY against the lower-cased headline.
const NATIONALITY_PATTERNS: Array<[string, RegExp]> = [
  ["us", /\b(american|u\.?s\.?\s+citizen|us\s+national|us\s+citizen|american\s+citizen)\b/i],
  ["au", /\b(australian)\b/i],
  ["uk", /\b(british|briton)\b/i],
  ["nz", /\b(new\s+zealand(?:er)?)\b/i],
];

// Case-SENSITIVE nationality cues, matched against the ORIGINAL-case headline so
// the bare uppercase abbreviation "US" / "U.S." reads as the country while the
// lower-case English pronoun "us" ("shot us", "attacked us") never does. This is
// why the abbreviation is deliberately absent from NATIONALITY_PATTERNS above
// (which runs against lower-cased text). A distinctive victim role is still
// required alongside it, so "kills us" with no role yields no strong entity.
const NATIONALITY_CASE_SENSITIVE: Array<[string, RegExp]> = [
  ["us", /\bU\.?S\.?\b/],
];

// Distinctive victim roles. A foreign national in one of these roles is a strong
// enough entity to anchor a cross-province / below-Jaccard merge.
const ROLE_PATTERNS: Array<[string, RegExp]> = [
  ["pilot", /\b(pilot|aircrew|airman|co-?pilot)\b/i],
  ["missionary", /\b(missionar\w*|pastor|priest)\b/i],
  ["worker", /\b(worker|labourer|laborer|contractor|engineer|technician)\b/i],
  ["teacher", /\b(teacher|lecturer)\b/i],
  ["tourist", /\b(tourist|traveller|traveler|trekker|climber)\b/i],
  ["medic", /\b(nurse|doctor|medic|health\s+worker)\b/i],
];

export interface StoryEntities {
  // Strong, EVENT-IDENTIFYING entities: a foreign-national victim in a
  // distinctive role ("victim:us-pilot"). Only these anchor a PATH 3 merge — a
  // single foreign national is killed/abducted once, so it names one event.
  strong: Set<string>;
  // Corroborating classes: event-nature (fatal / evacuation / abduction /
  // injury) plus the recurring named actor ("actor:opm"). A shared class is
  // required alongside a shared strong entity, never sufficient on its own.
  classes: Set<string>;
}

// Extract the strong distinctive entities and corroborating classes from a
// headline. Pure and count-free. Used only by the PATH 3 entity-anchored merge.
export function storyEntities(title: string): StoryEntities {
  const raw = ` ${title ?? ""} `;
  const hay = raw.toLowerCase();
  const strong = new Set<string>();
  const classes = new Set<string>();
  for (const [name, re] of CLASS_PATTERNS) if (re.test(hay)) classes.add(name);
  // Prefer the case-insensitive cue ("American", "US citizen"); fall back to the
  // case-sensitive uppercase abbreviation ("US" / "U.S.") tested on raw text.
  const nat =
    NATIONALITY_PATTERNS.find(([, re]) => re.test(hay))?.[0] ??
    NATIONALITY_CASE_SENSITIVE.find(([, re]) => re.test(raw))?.[0] ??
    null;
  if (nat) {
    for (const [role, re] of ROLE_PATTERNS) {
      if (re.test(hay)) strong.add(`victim:${nat}-${role}`);
    }
  }
  return { strong, classes };
}

// ---------------------------------------------------------------------------
// Armed-clash syndication features (PATH 4)
// ---------------------------------------------------------------------------
// An armed clash (a gunfight / firefight / cordon-and-search operation) is
// re-reported by many outlets and across days — the gunfight, then the cordon,
// then the "forces surround the hideout" update — worded so differently that
// bag-of-words Jaccard drops below the PATH-1 floor and there is no foreign-
// national strong entity for PATH 3. The DISTINCTIVE PLACE (the town/premises)
// plus a tight window is what identifies the single operation.

// Both headlines must carry one of these cues before PATH 4 will consider them.
const ARMED_CLASH_RE =
  /\b(gun[- ]?fight|gun[- ]?battle|fire[- ]?fight|shoot[- ]?out|exchange of fire|encounter|cordon(?:[- ]and[- ]search)?|besieged?|siege|surround(?:ed|s|ing)?|trapped|holed up|clash(?:es)?|ambush(?:ed)?)\b/i;

// Generic clash / security / operational / count / broad-geography tokens that
// can NEVER anchor a PATH-4 merge: they recur across every unrelated clash, so
// only a token OUTSIDE this set (a specific town or premises name) counts as a
// distinctive place anchor. Deliberately over-inclusive on broad-geography
// words (directions, region names, generic terrain) so two DIFFERENT towns in
// the same region are never merged on the region name alone — missing a merge
// is safer here than a false one.
const CLASH_GENERIC_TOKENS = new Set([
  // clash / kinetic vocabulary
  "gunfight", "gunbattle", "battle", "firefight", "shootout", "shoot", "shot",
  "encounter", "encounters", "cordon", "siege", "besieged", "surround",
  "surrounded", "surrounds", "surrounding", "trapped", "holed", "gunfire",
  "gun", "guns", "firing", "fire", "exchange", "clash", "clashes", "ambush",
  "shooting", "shootings", "shooter", "penembakan",
  "ambushed", "raid", "raids", "crackdown", "operation", "operations", "search",
  "blast", "attack", "attacks",
  // forces / actors
  "security", "forces", "force", "army", "navy", "air", "police", "crpf",
  "cisf", "itbp", "bsf", "ssb", "jawan", "jawans", "troops", "troop", "soldier",
  "soldiers", "militant", "militants", "militia", "terrorist", "terrorists",
  "terror", "gunman", "gunmen", "insurgent", "insurgents", "rebel", "rebels",
  "fighter", "fighters", "let", "linked", "group", "outfit", "cadre", "cadres",
  // outcome / temporal / status filler
  "kill", "kills", "killed", "killing", "killings", "dead", "death", "deaths", "injured",
  "wounded", "hurt", "hiding", "continues", "continue", "continued", "ongoing",
  "underway", "rages", "raging", "tighten", "tightens", "tightened", "hours",
  "hour", "day", "days", "live", "updates", "update", "breaking", "reported",
  "report", "amid",
  // counts
  "one", "two", "three", "four", "five", "several", "many",
  // armed-group / actor NAMES — an org name recurs across every unrelated
  // operation, so it can never anchor a merge (two DIFFERENT towns' Lashkar
  // encounters remain two events). Bare "let" is already listed above.
  "lashkar", "toiba", "taiba", "jaish", "mohammed", "muhammad", "hizbul",
  "hizb", "mujahideen", "jem", "jkm", "tpnpb", "opm", "bla", "bra", "ttp",
  "isis", "isil", "daesh", "taliban", "naxal", "naxals", "naxalite",
  "naxalites", "maoist", "maoists", "plga", "hamas", "hezbollah",
  // role / status of the combatant (recurs across operations, not a place)
  "commander", "commanders", "chief", "leader", "leaders", "hideout",
  "hideouts", "operative", "operatives", "associate", "associates", "handler",
  "handlers", "ultra", "ultras", "overground", "wanted", "aide", "aides",
  // additional kinetic / outcome status
  "armed", "contact", "contacts", "martyr", "martyred", "martyrs", "gunned",
  "neutralised", "neutralized", "eliminated", "nabbed", "arrested", "detained",
  "apprehended", "held", "surrendered", "surrender",
  // broad geography / generic terrain (never a distinctive place anchor)
  "south", "north", "east", "west", "central", "region", "regions", "district",
  "districts", "area", "areas", "village", "villages", "town", "city", "valley",
  "forest", "forests", "field", "fields", "orchard", "orchards", "border",
  "hills", "hill", "range", "sector", "zone", "kashmir", "jammu",
  // broad regions / provinces / theatres (never a distinctive TOWN anchor) so
  // two different towns of the same theatre never merge on the theatre name.
  "papua", "balochistan", "baluchistan", "mindanao", "manipur", "nagaland",
  "assam", "tripura", "mizoram", "meghalaya", "sindh", "punjab", "waziristan",
  "khyber", "pakhtunkhwa", "aceh", "sulawesi", "sulu", "bastar", "highlands",
  "highland",
]);

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
  // Optional ORIGINAL-LANGUAGE (pre-translation) headline. When a caller can
  // supply it (the structured report builder, whose `title` is already resolved
  // to the English display_title so bilingual copies of one story diverge and no
  // longer match on `title`), an ADDITIVE cross-language merge path lets a
  // translated copy and its still-untranslated sibling cluster on their shared
  // original headline. Absent (e.g. the page-level consolidator, whose `title`
  // is already the raw title) → the extra path is inert and nothing changes.
  rawTitle?: string | null;
}

const DAY = 86_400_000;

// Cluster rows describing the same real-world event. Returns clusters of input
// INDICES; within each cluster the FIRST index is the representative (highest
// severity, then newest), because rows are processed in that order.
export interface ClusterOptions {
  // When true (a SINGLE-THEATRE country report, e.g. Papua / West Papua), the
  // province gate on PATHS 1-3 is relaxed: sibling sub-provinces of the one
  // theatre are treated as the same area, so the same event tagged to Papua
  // Pegunungan / Papua Tengah / Papua is not blocked from merging. Multi-city
  // reports (Jakarta / Indonesia) leave it false so distinct cities never merge.
  crossProvince?: boolean;
}

export function clusterSameStoryRows(
  rows: SameStoryRow[],
  options: ClusterOptions = {},
): number[][] {
  const order = rows.map((_, i) => i).sort((a, b) => {
    if (rows[b].severityRank !== rows[a].severityRank)
      return rows[b].severityRank - rows[a].severityRank;
    return rows[b].dateMs - rows[a].dateMs;
  });
  const feats = rows.map((r) => {
    const toks = storyTokens(r.title);
    const raw = r.rawTitle && r.rawTitle.trim() ? r.rawTitle : null;
    return {
      toks,
      prem: namedPremises(r.title),
      canon: canonicalTitleKey(r.title),
      ent: storyEntities(r.title),
      // PATH 3B: small casualty-count tokens (digit and spelled), for the
      // armed-actor + fatal-class + matching-count anchor below.
      victimCount: victimCountTokens(r.title),
      // PATH 4: whether the headline reports an armed clash, and its DISTINCTIVE
      // place tokens (content tokens minus the generic clash/security/geography
      // vocabulary) — the specific town/premises that identifies one operation.
      clash: ARMED_CLASH_RE.test(r.title),
      placeToks: new Set(
        [...toks].filter((t) => !CLASH_GENERIC_TOKENS.has(t)),
      ),
      // Additive cross-language merge signals — computed ONLY when the caller
      // supplies a raw pre-translation headline (see SameStoryRow.rawTitle).
      rawCanon: raw ? canonicalTitleKey(raw) : "",
      rawToks: raw ? storyTokens(raw) : null,
    };
  });
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
      // PATH 0-raw: identical canonical ORIGINAL-LANGUAGE title. Additive — lets a
      // translated copy and its still-untranslated sibling of the SAME story merge
      // even though their resolved (display) titles diverge by language. Inert
      // unless BOTH rows carry a rawTitle, so nothing the resolved-title paths
      // already merge is ever un-merged.
      if (f.rawCanon && f.rawCanon === ff.rawCanon) {
        c.members.push(i);
        placed = true;
        break;
      }
      const dd = Math.abs(rr.dateMs - r.dateMs);
      // PATH 3: entity/synonym-anchored merge for the same event phrased so
      // differently across outlets that Jaccard falls below the floor. Requires
      // a shared STRONG DISTINCTIVE ENTITY (foreign-national victim in a
      // distinctive role) AND a shared event-nature class, within a 3-day window
      // — never generic words alone, so distinct incidents that merely share
      // common vocabulary never merge. Evaluated BEFORE the province and
      // compatible-type gates (like PATH 0): a shared strong entity identifies
      // ONE event even when outlets file it under different categories (Homicide
      // / Aviation / Other security) or geocode it to different sub-provinces, so
      // those gates must not block it. This mirrors the crossProvince relaxation
      // but derives it from event identity rather than a per-theatre flag, so the
      // nationwide reports (Indonesia) also collapse a single foreign-national
      // casualty story that outlets split across provinces and categories.
      const sharedStrong = [...f.ent.strong].some((e) => ff.ent.strong.has(e));
      const sharedClass = [...f.ent.classes].some((cl) => ff.ent.classes.has(cl));
      if (dd <= 3 * DAY && sharedStrong && sharedClass) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 3B: armed-actor + fatal-class + matching-casualty-count anchor.
      // See "Casualty-count anchor (PATH 3B)" above for the full rationale —
      // this bridges the SAME event reported under the government ("KKB")
      // and separatist ("TPNPB") framings with different place granularity,
      // where every other path shares zero anchor vocabulary. Evaluated
      // before the province gate (like PATH 3) since the two framings may
      // even geocode to different sub-provinces of the same theatre.
      const sharedArmedActor =
        f.ent.classes.has("actor:opm") && ff.ent.classes.has("actor:opm");
      const sharedFatalClass =
        f.ent.classes.has("fatal") && ff.ent.classes.has("fatal");
      const sharedCount = [...f.victimCount].some((n) => ff.victimCount.has(n));
      if (
        dd <= DAY &&
        sharedArmedActor &&
        sharedFatalClass &&
        f.victimCount.size > 0 &&
        ff.victimCount.size > 0 &&
        sharedCount
      ) {
        c.members.push(i);
        placed = true;
        break;
      }
      // Province gate (skipped for a single-theatre report, where sibling
      // sub-provinces are the same area). Both-null counts as a match; one-null
      // is a mismatch. PATH 3 above has already run, so a strong-entity event is
      // never blocked here; this gate guards only the weaker PATHS 1/2/4.
      if (!options.crossProvince && (rr.province ?? null) !== (r.province ?? null)) continue;
      const jac = tokenJaccard(ff.toks, f.toks);
      // PATH 2: shared named premises within a wider window (the sandal-factory
      // -fire case), gated by a modest overlap so a fluke shared modifier across
      // very different headlines cannot merge two distinct events. Evaluated
      // BEFORE the compatible-type gate (like PATH 3): a distinctive shared
      // premises identifies ONE event even when outlets file it under different
      // categories — e.g. a massacre and the ARRESTS over that same massacre are
      // coded Homicide vs Policing yet are the same story — so a type mismatch
      // must not block it. The province gate above still applies, and the
      // shared-premises + jaccard>=0.25 floor keeps two genuinely distinct
      // events that merely share a common modifier apart.
      const sharedPrem = [...f.prem].some((p) => ff.prem.has(p));
      if (dd <= 3 * DAY && sharedPrem && jac >= 0.25) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 2b: a shared DISTINCTIVE incident / place NAME (a longer proper-noun
      // token, not generic clash / security / geography vocabulary) plus a modest
      // overlap on the same or adjacent day. Merges ONE named event re-reported so
      // differently that Jaccard sits just below the PATH-1 floor — e.g.
      // "Twenty-seven locked-up from second 'Sambio massacre' arrest" vs
      // "TWENTY-SEVEN ARRESTED AND CHARGED OVER SAMBIO MASSACRE" (shared "sambio",
      // jac 0.44). Evaluated BEFORE the compatible-type gate (like PATH 2/3) so a
      // massacre and the ARRESTS over it — coded Homicide vs Policing — still
      // merge. The distinctive shared token (>= 5 chars, so short place stems like
      // "enga" never anchor) plus the tight same/adjacent-day window keeps two
      // genuinely distinct events that share only generic vocabulary apart, so
      // formulaic tribal-clash headlines never over-merge.
      const sharedDistinctiveName = [...f.placeToks].some(
        (t) => t.length >= 5 && ff.placeToks.has(t),
      );
      if (dd <= DAY && sharedDistinctiveName && jac >= 0.35) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 5: shared distinctive place token + shared FATAL class, wider
      // window, no Jaccard floor. A single fatal violent-crime event is often
      // reported once while facts are still unclear ("Woman dead, suspected
      // murder victim in Grogol Petamburan") and again once a suspect/motive
      // is confirmed a day or two later ("Woman killed by her boyfriend in
      // Grogol Petamburan, West Jakarta over WhatsApp message") -- headlines
      // that share almost no vocabulary beyond the place name (jac ~0.23 for
      // this real pair: below PATH 2b's 0.35 floor, and PATH 2b's 1-day
      // window is too tight for the ~2-day gap between the initial and
      // follow-up report). The DISTINCTIVE PLACE token (a specific
      // neighbourhood/premises name, never a generic clash/security/
      // geography word -- same anchor as PATH 2b) plus a shared FATAL
      // event-nature class is accepted as sufficient evidence within a
      // 3-day window, with no Jaccard floor: the two corroborating signals
      // (a specific named place + a violent death) together are strong
      // enough that a coincidental match is rare. Known tradeoff (accepted,
      // same principle as PATH 3B): two DIFFERENT fatal incidents that
      // happen to name the SAME specific place within 3 days will also
      // merge -- not silently hidden, see the locked-in test case.
      const sharedFatalPlace =
        f.ent.classes.has("fatal") &&
        ff.ent.classes.has("fatal") &&
        [...f.placeToks].some((t) => t.length >= 5 && ff.placeToks.has(t));
      if (dd <= 3 * DAY && sharedFatalPlace) {
        c.members.push(i);
        placed = true;
        break;
      }
      const compatType =
        rr.typeKey === r.typeKey ||
        (!!rr.category && rr.category === r.category) ||
        (!!rr.displayCategory && rr.displayCategory === r.displayCategory);
      if (!compatType) continue;
      // PATH 1: strong title overlap, same/adjacent day.
      if (dd <= DAY && ff.toks.size >= 3 && f.toks.size >= 3 && jac >= 0.5) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 1-raw: strong ORIGINAL-LANGUAGE title overlap, same/adjacent day.
      // Additive companion to PATH 1 for bilingual duplicates whose resolved
      // titles diverge by language but whose original headlines still overlap
      // strongly. Gated identically (province + compatible type, already checked
      // above) and inert unless both rows carry a rawTitle.
      if (
        f.rawToks &&
        ff.rawToks &&
        dd <= DAY &&
        ff.rawToks.size >= 3 &&
        f.rawToks.size >= 3 &&
        tokenJaccard(ff.rawToks, f.rawToks) >= 0.5
      ) {
        c.members.push(i);
        placed = true;
        break;
      }
      // PATH 4: armed-clash syndication. BOTH headlines report an armed clash
      // (gunfight / firefight / cordon-and-search / forces surround) AND share a
      // DISTINCTIVE PLACE token — the specific town or premises, never a generic
      // clash/security/broad-geography word — within a tight 2-day window and a
      // compatible type. The place anchor plus the short window keeps a
      // different town, or the same town more than two days apart, separate; a
      // small Jaccard floor guards against a single fluke token collapsing two
      // long unrelated headlines.
      const sharedPlace = [...f.placeToks].some((p) => ff.placeToks.has(p));
      if (dd <= 2 * DAY && ff.clash && f.clash && sharedPlace && jac >= 0.1) {
        c.members.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ repIdx: i, members: [i] });
  }
  return clusters.map((c) => c.members);
}

// ---------------------------------------------------------------------------
// Readable (English) representative selection
// ---------------------------------------------------------------------------
// Foreign-language incident headlines are translated into an English
// `display_title` by a BOUNDED per-run ingest backfill, so the NEWEST rows of a
// still-unfolding story lag untranslated for ~a day. Because a cluster's
// representative is "highest severity, then NEWEST" (the clusterSameStoryRows
// seed order), that newest row is the one LEAST likely to be translated yet — so
// every country surface would systematically lead with raw Bahasa even though an
// English version of the SAME story already exists lower in the cluster.
//
// Given one already-formed cluster (indices into the caller's rows, cluster[0] =
// the natural representative), return the index of the representative to SHOW.
// Normally cluster[0]; but when cluster[0] still renders in a foreign language,
// re-select — WITHIN THE SAME top severity tier — the NEWEST member that renders
// in English. Never downgrades severity; picks an intact real row (no fabricated
// or mis-attributed text). Falls back to cluster[0] when no English sibling
// exists in that tier (an honest coverage gap the UntranslatedBadge still flags).
export function readableRepresentativeIndex(
  cluster: number[],
  rendersForeign: (idx: number) => boolean,
  severityRank: (idx: number) => number,
  dateMs: (idx: number) => number,
): number {
  const repIdx = cluster[0];
  if (!rendersForeign(repIdx)) return repIdx;
  const topRank = severityRank(repIdx);
  let best: number | null = null;
  for (const idx of cluster) {
    if (severityRank(idx) !== topRank) continue; // never downgrade the severity tier
    if (rendersForeign(idx)) continue; // must render in English
    if (best === null || dateMs(idx) > dateMs(best)) best = idx;
  }
  return best ?? repIdx;
}

// Page-level convenience: collapse a window of raw incidents to one row per
// consolidated story, keeping the representative (highest severity, then
// newest — but preferring a translated English version of the SAME story when
// the natural representative is still untranslated; see
// readableRepresentativeIndex). Province is intentionally left null for every
// row so the title / premises evidence decides (the page cannot resolve config
// provinces, and the set is already scoped to one country).
export function consolidateCountryStories<
  T extends {
    title: string;
    displayTitle?: string | null;
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
  return clusterSameStoryRows(sr).map(
    (cluster) =>
      rows[
        readableRepresentativeIndex(
          cluster,
          (idx) => isUntranslatedTitle(rows[idx].title, rows[idx].displayTitle),
          (idx) => sr[idx].severityRank,
          (idx) => sr[idx].dateMs,
        )
      ],
  );
}

// ---------------------------------------------------------------------------
// Selection-time story-similarity (Layer B: Top-3 diversity guard)
// ---------------------------------------------------------------------------
// The same-story clusterer above is deliberately CONSERVATIVE at ingest, so a
// syndicated event can still survive as two clusters when outlets file it under
// different categories / sub-provinces or word it below the merge floor. The
// Top-3 selector needs a slightly broader, symmetric "are these the same story?"
// check to avoid showing one real-world event twice among the three headline
// developments. This exposes the same primitives the clusterer uses so both
// surfaces stay consistent; it never mutates or merges data — it only informs
// selection.

// The distinctive PLACE tokens of a headline: content tokens minus the generic
// clash / security / broad-geography vocabulary. The specific town or premises
// that identifies one operation. Exported for the Top-3 diversity guard.
export function placeTokens(title: string): Set<string> {
  return new Set([...storyTokens(title)].filter((t) => !CLASH_GENERIC_TOKENS.has(t)));
}

export interface StorySimInput {
  title: string;
  dateMs: number;
}

export interface StorySimilarity {
  // A shared STRONG DISTINCTIVE ENTITY (foreign-national victim in a role) —
  // event-identifying on its own.
  sharedStrong: boolean;
  // Bag-of-words Jaccard over the two headlines.
  jaccard: number;
  // A shared distinctive place token AND a shared event-nature class within a
  // 3-day window — the same operation re-reported.
  sharedPlaceClass: boolean;
  // The two representatives fall within a 3-day window. Exposed so the REMOVAL
  // (fold) path can require it: PNG tribal-violence headlines are formulaic, so
  // two genuinely distinct clashes weeks apart can hit jaccard>=0.5; folding the
  // second out of the buckets on that alone would silently drop a real incident.
  within3d: boolean;
}

// Symmetric story-similarity signals between two headline representatives, for
// the Top-3 diversity guard. Pure and count-free.
export function storySimilarity(a: StorySimInput, b: StorySimInput): StorySimilarity {
  const ea = storyEntities(a.title);
  const eb = storyEntities(b.title);
  const sharedStrong = [...ea.strong].some((e) => eb.strong.has(e));
  const jaccard = tokenJaccard(storyTokens(a.title), storyTokens(b.title));
  const pa = placeTokens(a.title);
  const pb = placeTokens(b.title);
  const sharedPlace = [...pa].some((p) => pb.has(p));
  const sharedClass = [...ea.classes].some((c) => eb.classes.has(c));
  const within3d = Math.abs(a.dateMs - b.dateMs) <= 3 * DAY;
  return {
    sharedStrong,
    jaccard,
    sharedPlaceClass: sharedPlace && sharedClass && within3d,
    within3d,
  };
}
