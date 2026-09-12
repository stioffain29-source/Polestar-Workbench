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
  // Legacy persisted label; reconciled to High at the output boundary.
  severe: 4,
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
  ["shooting", /\b(shoot\w*|shooter|gunman|gunmen|gunfire|shot|penembakan)\b/i],
  ["evacuation", /\b(evacuat\w*|repatriat\w*|airlift\w*|flown\s+out)\b/i],
  ["abduction", /\b(abduct\w*|kidnap\w*|hostage\w*|held\s+captive|taken\s+captive)\b/i],
  ["injury", /\b(injured|wounded|hurt)\b/i],
  ["missing", /\b(missing|disappear\w*|unaccounted)\b/i],
  ["survivor", /\b(surviv\w*|rescued|safe|alive)\b/i],
  ["search", /\b(search(?:ed|ing)?|retriev\w*|recovered)\b/i],
  ["assistance", /\b(assistance|assist(?:ed|ing)?|help(?:ed|ing)?|support)\b/i],
  ["surrender", /\bsurrend(?:er|ered|ers|ering)\b/i],
  ["attack", /\b(attack\w*|assault\w*|raids?|ambush\w*)\b/i],
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

const FACILITY_RE = /\b(kindergarten|school|nursery|daycare|childcare|primary school|elementary school)\b/gi;
const ROLE_RE = /\b(teacher|wife|husband|police officer|policeman|policewoman|gunman|shooter)\b/gi;
const VICTIM_ROLE_RE = /\b(civil servants?|government employees?|civilian officials?|regency employees?|agricultur(?:e|al)\s+(?:department|office|agency|division|employee|worker)s?)\b/gi;
// Transport names are unusually stable across re-headlines ("MV X", "the
// vessel X", "X ferry"). Keep only explicit name forms here: generic "ferry"
// and "ship" must never become event anchors.
const NAMED_VESSEL_RE = /\b(?:m\/?v|mv|vessel|ship)\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})/gi;
const VESSEL_SUFFIX_RE = /\b([a-z][a-z0-9-]+(?:\s+[a-z][a-z0-9-]+)?)\s+(?:ferry|vessel|ship|boat)\b/gi;

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
  location?: string | null;
  country?: string | null;
  summary?: string | null;
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
  /** Test/diagnostic hook; merge predicates remain authoritative. */
  onCandidateComparison?: () => void;
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
    const semanticText = `${r.title} ${r.rawTitle ?? ""} ${r.summary ?? ""}`;
    const toks = storyTokens(r.title);
    const raw = r.rawTitle && r.rawTitle.trim() ? r.rawTitle : null;
    return {
      toks,
      semanticToks: storyTokens(semanticText),
      prem: namedPremises(r.title),
      canon: canonicalTitleKey(r.title),
      ent: storyEntities(r.title),
      semanticEnt: storyEntities(semanticText),
      facilities: (() => {
        const found = new Set((semanticText.match(FACILITY_RE) ?? []).map((v) => v.toLowerCase()));
        // Specific child-care sites must not collapse into a generic school
        // report merely because a follow-on uses the broader word "school".
        if ([...found].some((v) => v !== "school")) found.delete("school");
        return found;
      })(),
      roles: new Set((semanticText.match(ROLE_RE) ?? []).map((v) => v.toLowerCase())),
      victimRoles: new Set((semanticText.match(VICTIM_ROLE_RE) ?? []).map((v) => v.toLowerCase())),
      semanticPrem: namedPremises(semanticText),
      vesselKeys: new Set(
        [...semanticText.matchAll(NAMED_VESSEL_RE), ...semanticText.matchAll(VESSEL_SUFFIX_RE)]
          .map((m) => m[1]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
            .replace(/\s+(?:ferry|ship|vessel|boat|the)$/g, ""))
          .filter((v) => v.length >= 3 && !/^(?:a|the|this|one|ferry|ship|vessel)$/.test(v)),
      ),
      // PATH 3B: small casualty-count tokens (digit and spelled), for the
      // armed-actor + fatal-class + matching-count anchor below.
      victimCount: victimCountTokens(r.title),
      semanticVictimCount: victimCountTokens(semanticText),
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
      locationToks: storyTokens(r.location ?? ""),
      semanticLocationToks: storyTokens(semanticText),
    };
  });
  interface Cluster {
    repIdx: number;
    members: number[];
    cohortCounts: Set<string>;
    cohortRoles: Set<string>;
    cohortMechanisms: Set<string>;
    cohortPlaces: Set<string>;
    cohortActors: Set<string>;
    publishedCohort?: {
      counts: Set<string>;
      roles: Set<string>;
      places: Set<string>;
      actors: Set<string>;
    };
  }
  const clusters: Cluster[] = [];
  // Candidate index: the old implementation tested every existing cluster for
  // every row, which turns a large nationwide window into O(n²). These keys are
  // only a retrieval accelerator — every merge predicate below still runs, so
  // content and merge semantics are unchanged. Indexing every member (not just
  // the representative) preserves transitive clustering.
  const index = new Map<string, Set<number>>();
  const addIndex = (key: string, clusterId: number) => {
    if (!key) return;
    let set = index.get(key);
    if (!set) index.set(key, (set = new Set()));
    set.add(clusterId);
  };
  const indexFeatures = (idx: number, clusterId: number) => {
    const f = feats[idx];
    const r = rows[idx];
    if (f.canon) addIndex(`canon:${f.canon}`, clusterId);
    if (f.rawCanon) addIndex(`raw:${f.rawCanon}`, clusterId);
    // A translated row's raw title is the canonical title of its untranslated
    // sibling. Index both namespaces so this additive bilingual path remains
    // reachable without falling back to a full cluster scan.
    if (f.rawCanon) addIndex(`canon:${f.rawCanon}`, clusterId);
    addIndex(`type:${r.typeKey}|day:${Math.floor(r.dateMs / DAY)}`, clusterId);
    addIndex(`province:${r.province ?? ""}|type:${r.typeKey}|day:${Math.floor(r.dateMs / DAY)}`, clusterId);
    for (const t of f.toks) if (t.length >= 5) addIndex(`tok:${t}`, clusterId);
    for (const e of f.ent.strong) addIndex(`entity:${e}`, clusterId);
    for (const e of f.ent.classes) addIndex(`class:${e}|day:${Math.floor(r.dateMs / DAY)}`, clusterId);
    for (const e of f.semanticEnt.classes) addIndex(`sclass:${e}|day:${Math.floor(r.dateMs / DAY)}`, clusterId);
    for (const e of f.facilities) addIndex(`facility:${e}`, clusterId);
    for (const e of f.roles) addIndex(`role:${e}`, clusterId);
    for (const e of f.victimRoles) addIndex(`vrole:${e}`, clusterId);
    for (const n of f.semanticVictimCount) {
      for (const e of f.victimRoles) addIndex(`cohort:${n}:${e}`, clusterId);
    }
    for (const p of f.prem) addIndex(`prem:${p}`, clusterId);
    for (const p of f.semanticPrem) addIndex(`sprem:${p}`, clusterId);
    for (const v of f.vesselKeys) addIndex(`vessel:${v}`, clusterId);
    for (const p of f.placeToks) addIndex(`place:${p}`, clusterId);
    for (const p of f.locationToks) addIndex(`loc:${p}`, clusterId);
    for (const p of f.semanticLocationToks) if (p.length >= 4) addIndex(`sloc:${p}`, clusterId);
  };
  const addToCluster = (c: Cluster, idx: number) => {
    c.members.push(idx);
    const f = feats[idx];
    for (const n of f.semanticVictimCount) c.cohortCounts.add(n);
    for (const role of f.victimRoles) c.cohortRoles.add(role);
    for (const e of f.semanticEnt.classes) {
      if (e === "fatal" || e === "shooting" || e === "attack") c.cohortMechanisms.add(e);
      if (e.startsWith("actor:")) c.cohortActors.add(e);
    }
    for (const p of f.semanticLocationToks) if (p.length >= 5) c.cohortPlaces.add(p);
  };
  const indexClusterCohort = (c: Cluster, clusterId: number) => {
    // Aggregate anchors are monotonic. Only publish newly-added keys; walking
    // the full union for every merge made high-duplication Indonesia windows
    // quadratic in index updates.
    const published = c.publishedCohort ?? (c.publishedCohort = {
      counts: new Set<string>(), roles: new Set<string>(), places: new Set<string>(), actors: new Set<string>(),
    });
    let newCount = false;
    for (const n of c.cohortCounts) if (!published.counts.has(n)) {
      published.counts.add(n); newCount = true;
    }
    let newRole = false;
    for (const role of c.cohortRoles) if (!published.roles.has(role)) {
      published.roles.add(role); newRole = true;
    }
    if (newCount || newRole)
      for (const n of c.cohortCounts)
        for (const role of c.cohortRoles) addIndex(`cohort:${n}:${role}`, clusterId);
    for (const p of c.cohortPlaces) if (!published.places.has(p)) {
      published.places.add(p);
      addIndex(`sloc:${p}`, clusterId);
    }
    for (const a of c.cohortActors) if (!published.actors.has(a)) {
      published.actors.add(a);
      addIndex(`actor:${a}`, clusterId);
    }
  };
  for (const i of order) {
    const r = rows[i];
    const f = feats[i];
    let placed = false;
    const candidateIds = new Set<number>();
    const addCandidates = (key: string) => {
      for (const id of index.get(key) ?? []) candidateIds.add(id);
    };
    if (f.canon) addCandidates(`canon:${f.canon}`);
    if (f.rawCanon) addCandidates(`raw:${f.rawCanon}`);
      addCandidates(`canon:${f.canon}`);
    const day = Math.floor(r.dateMs / DAY);
    for (const e of f.ent.strong) addCandidates(`entity:${e}`);
    for (const e of f.ent.classes) {
      for (const d of [day - 3, day - 2, day - 1, day, day + 1, day + 2, day + 3]) {
        addCandidates(`class:${e}|day:${d}`);
      }
    }
    for (const p of f.prem) addCandidates(`prem:${p}`);
    for (const p of f.semanticPrem) addCandidates(`sprem:${p}`);
    for (const v of f.vesselKeys) addCandidates(`vessel:${v}`);
    for (const p of f.placeToks) addCandidates(`place:${p}`);
    for (const p of f.locationToks) addCandidates(`loc:${p}`);
    for (const p of f.semanticLocationToks) if (p.length >= 4) addCandidates(`sloc:${p}`);
    for (const e of f.semanticEnt.classes) {
      for (const d of [day - 3, day - 2, day - 1, day, day + 1, day + 2, day + 3])
        addCandidates(`sclass:${e}|day:${d}`);
    }
    for (const n of f.semanticVictimCount) {
      for (const e of f.victimRoles) addCandidates(`cohort:${n}:${e}`);
    }
    for (const t of f.toks) if (t.length >= 5) addCandidates(`tok:${t}`);
    // Cluster creation order is the prior scan order, retaining deterministic
    // representative selection and transitive placement behaviour.
    const candidateClusters = [...candidateIds].sort((a, b) => a - b);
    for (const clusterId of candidateClusters) {
      options.onCandidateComparison?.();
      const c = clusters[clusterId]!;
      const j = c.repIdx;
      const rr = rows[j];
      const ff = feats[j];
      // PATH 0: identical canonical title — same story regardless of date/place.
      if (f.canon && f.canon === ff.canon) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      // PATH 0-raw: identical canonical ORIGINAL-LANGUAGE title. Additive — lets a
      // translated copy and its still-untranslated sibling of the SAME story merge
      // even though their resolved (display) titles diverge by language. Inert
      // unless BOTH rows carry a rawTitle, so nothing the resolved-title paths
      // already merge is ever un-merged.
      if (f.rawCanon && f.rawCanon === ff.rawCanon) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      if (
        (f.rawCanon && f.rawCanon === ff.canon) ||
        (ff.rawCanon && ff.rawCanon === f.canon)
      ) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      const dd = Math.abs(rr.dateMs - r.dateMs);
      if (r.country && rr.country && r.country.toLowerCase() !== rr.country.toLowerCase()) continue;
      const sharedFacility = [...f.facilities].some((x) => ff.facilities.has(x));
      const sharedRole = [...f.roles].some((x) => ff.roles.has(x));
      const actorRole = (x: typeof f) =>
        [...x.roles].some((r) => /gunman|shooter|police/.test(r));
      const violentClass = (x: typeof f) =>
        x.semanticEnt.classes.has("fatal") ||
        x.semanticEnt.classes.has("shooting") ||
        x.semanticEnt.classes.has("attack");
      const followOnClass = (x: typeof f) =>
        x.semanticEnt.classes.has("surrender") ||
        x.semanticEnt.classes.has("evacuation") ||
        x.semanticEnt.classes.has("injury");
      // Facility + compatible actor/victim role + violent semantic evidence is
      // a bounded event identity anchor. It bridges act, safety/evacuation and
      // surrender reports even when the representative title changes entirely.
      if (
        dd <= 3 * DAY &&
        sharedFacility &&
        (violentClass(f) && violentClass(ff) ||
          (followOnClass(f) || followOnClass(ff)) &&
            (f.semanticEnt.classes.has("shooting") || ff.semanticEnt.classes.has("shooting"))) &&
        // A facility-class shooting/fatal chain is the identity anchor even
        // when a follow-on headline changes from the police/wife framing to a
        // generic gunman/surrender framing and therefore has no shared role.
        (sharedRole || actorRole(f) && actorRole(ff) ||
          (f.semanticEnt.classes.has("shooting") || ff.semanticEnt.classes.has("shooting")))
      ) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      const sharedLocation = [...f.locationToks].some(
        (t) => t.length >= 4 && ff.locationToks.has(t),
      );
      const followOnPair =
        ((f.ent.classes.has("evacuation") || f.ent.classes.has("injury")) &&
          (ff.ent.classes.has("attack") || ff.ent.classes.has("fatal"))) ||
        ((ff.ent.classes.has("evacuation") || ff.ent.classes.has("injury")) &&
          (f.ent.classes.has("attack") || f.ent.classes.has("fatal")));
      if (dd <= 2 * DAY && sharedLocation && followOnPair) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      // A named vessel is an event identity anchor, not merely a transport
      // type.  Follow-on reports often omit "MV" and switch to "the vessel",
      // so use the normalized name extracted from title + summary.  If no
      // vessel name survives, a shared specific site/location plus fire and a
      // casualty/outcome signal still bridges the same rescue/search chain.
      const sharedVessel = [...f.vesselKeys].some((v) => ff.vesselKeys.has(v));
      const sharedSemanticPlace = [...f.semanticPrem].some((p) => ff.semanticPrem.has(p)) ||
        sharedLocation ||
        [...f.semanticLocationToks].some((p) => p.length >= 4 && ff.semanticLocationToks.has(p));
      const fireOutcome = (x: typeof f) =>
        x.semanticEnt.classes.has("fatal") ||
        x.semanticEnt.classes.has("missing") ||
        x.semanticEnt.classes.has("survivor") ||
        x.semanticEnt.classes.has("search") ||
        x.semanticEnt.classes.has("assistance");
      if (
        dd <= 3 * DAY &&
        (sharedVessel ||
          (sharedSemanticPlace &&
            (f.semanticEnt.classes.has("fire") || ff.semanticEnt.classes.has("fire")) &&
            fireOutcome(f) && fireOutcome(ff)))
      ) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      // Named transport/site fires often change from "fire aboard ferry" to
      // "vessel blaze" between publishers.  A shared specific location,
      // compatible fire family, and a short reporting window are sufficient;
      // location remains mandatory so unrelated fires do not collapse.
      const sharedFire = f.ent.classes.has("fire") && ff.ent.classes.has("fire");
      const sameType =
        rr.typeKey === r.typeKey ||
        (!!rr.category && rr.category === r.category) ||
        (!!rr.displayCategory && rr.displayCategory === r.displayCategory);
      if (dd <= 2 * DAY && sharedLocation && sharedFire && sameType) {
        addToCluster(c, i);
        placed = true;
        break;
      }
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
        addToCluster(c, i);
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
        addToCluster(c, i);
        placed = true;
        break;
      }
      // A casualty cohort is a durable event signature across aftermath,
      // identity and official-response headlines. Require the exact cohort
      // count (three), a shared civil-service/agriculture role, and a violent
      // fatal mechanism; place or shared armed-actor evidence then prevents
      // unrelated civil-servant incidents from collapsing.
      const sharedCohortRole = [...f.victimRoles].some((v) => c.cohortRoles.has(v));
      const sharedThree = f.semanticVictimCount.has("3") && c.cohortCounts.has("3");
      const cohortMechanism = (x: typeof f) =>
        x.semanticEnt.classes.has("fatal") ||
        x.semanticEnt.classes.has("shooting") ||
        x.semanticEnt.classes.has("attack");
      const cohortPlace = [...f.semanticLocationToks].some(
        (t) => t.length >= 5 && c.cohortPlaces.has(t),
      );
      const cohortActor = [...f.semanticEnt.classes].some(
        (e) => e.startsWith("actor:") && c.cohortActors.has(e),
      );
      const clusterMechanism = c.cohortMechanisms.size > 0;
      if (
        dd <= 3 * DAY &&
        sharedThree &&
        (sharedCohortRole || cohortPlace) &&
        cohortMechanism(f) &&
        clusterMechanism &&
        (cohortPlace || cohortActor)
      ) {
        addToCluster(c, i);
        placed = true;
        break;
      }
      // Investigation/follow-on headlines can retain only the specific
      // regency/site and victim role ("government employee", "civil servant")
      // while dropping the original casualty wording.  Those are one shooting
      // when the place and role remain shared within the bounded window.
      const sharedVictimRole = [...f.victimRoles].some((v) => ff.victimRoles.has(v));
      const sharedSpecificPlace = [...f.semanticLocationToks].some(
        (t) => t.length >= 5 && ff.semanticLocationToks.has(t),
      );
      const sharedNamedSubplace = [...f.semanticLocationToks].some(
        (t) => t.length >= 10 && ff.semanticLocationToks.has(t) &&
          !["shooting", "shootings", "civilian", "government", "employee", "employees",
            "agriculture", "agricultural", "department", "victims", "victim",
            "american", "national", "commander", "operation"].includes(t),
      );
      if (
        dd <= 3 * DAY &&
        sharedSpecificPlace &&
        (sharedVictimRole || sharedNamedSubplace) &&
        (
          f.semanticEnt.classes.has("shooting") &&
          ff.semanticEnt.classes.has("shooting") ||
          sharedVictimRole &&
          (f.semanticEnt.classes.has("shooting") || ff.semanticEnt.classes.has("shooting") ||
            f.semanticEnt.classes.has("fatal") || ff.semanticEnt.classes.has("fatal"))
        )
      ) {
        addToCluster(c, i);
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
        addToCluster(c, i);
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
        addToCluster(c, i);
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
        addToCluster(c, i);
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
        addToCluster(c, i);
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
        addToCluster(c, i);
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
        addToCluster(c, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const clusterId = clusters.length;
      clusters.push({
        repIdx: i,
        members: [i],
        cohortCounts: new Set(feats[i].semanticVictimCount),
        cohortRoles: new Set(feats[i].victimRoles),
        cohortMechanisms: new Set(
          [...feats[i].semanticEnt.classes].filter((e) =>
            e === "fatal" || e === "shooting" || e === "attack",
          ),
        ),
        cohortPlaces: new Set(
          [...feats[i].semanticLocationToks].filter((p) => p.length >= 5),
        ),
        cohortActors: new Set(
          [...feats[i].semanticEnt.classes].filter((e) => e.startsWith("actor:")),
        ),
      });
      indexFeatures(i, clusterId);
    } else {
      const clusterId = candidateClusters.find((id) => clusters[id]!.members.includes(i));
      if (clusterId !== undefined) {
        indexFeatures(i, clusterId);
        indexClusterCohort(clusters[clusterId]!, clusterId);
      }
    }
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
// exists in that tier; untranslated rows fail closed at the API read gate.
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
    location?: string | null;
    country?: string | null;
    summary?: string | null;
  },
>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const sr: SameStoryRow[] = rows.map((r) => ({
    title: r.displayTitle?.trim() || r.title || "",
    rawTitle: r.displayTitle?.trim() ? r.title ?? null : null,
    province: null,
    typeKey: incidentTypeKey(
      r.displayTitle?.trim() || r.title || "",
      r.category ?? null,
    ),
    dateMs: Number.isNaN(Date.parse(r.occurredAt)) ? 0 : Date.parse(r.occurredAt),
    severityRank: SEV_RANK[(r.severity ?? "").toLowerCase()] ?? 0,
    category: r.category ?? null,
    location: r.location ?? null,
    country: r.country ?? null,
    summary: r.summary ?? null,
  }));
  return clusterSameStoryRows(sr).map((cluster) => {
    // The cluster is ordered by the strongest validated picture (severity, then
    // recency).  Keep that picture when selecting a readable representative,
    // but never let an unrecognised legacy label (notably "severe") leak into
    // the five-tier country-report vocabulary.
    const allowed = cluster
      .filter((idx) => sr[idx].severityRank > 0)
      .sort((a, b) => sr[b].severityRank - sr[a].severityRank || sr[b].dateMs - sr[a].dateMs);
    const best = allowed[0] ?? cluster[0];
    const representative = readableRepresentativeIndex(
      cluster,
      (idx) => isUntranslatedTitle(rows[idx].title, rows[idx].displayTitle),
      (idx) => sr[idx].severityRank,
      (idx) => sr[idx].dateMs,
    );
    const source = rows[representative] ?? rows[best];
    if (!source) return rows[cluster[0]];
    const bestSeverityRaw = String(rows[best]?.severity ?? "").toLowerCase();
    // Older persisted rows occasionally use "severe"; the country engine has
    // exactly five permitted tiers, so reconcile that legacy value downward
    // rather than exposing a sixth severity or silently up-rating an event.
    const bestSeverity = bestSeverityRaw === "severe" ? "high" : bestSeverityRaw;
    // Preserve provenance for consumers that understand it.  The source row
    // remains the underlying incident; these fields are additive and therefore
    // safe for older callers and API shapes.
    const merged = { ...source } as T & {
      sourceMembers?: T[];
      latestFollowOn?: T;
    };
    merged.severity = (["insignificant", "low", "moderate", "high", "extreme"] as string[]).includes(bestSeverity)
      ? (bestSeverity as T["severity"])
      : (String(source.severity ?? "").toLowerCase() === "severe"
        ? ("high" as T["severity"])
        : (source.severity as T["severity"]));
    merged.sourceMembers = cluster.map((idx) => rows[idx]);
    if ("summary" in source) {
      const summaries = cluster
        .map((idx) => (rows[idx] as T & { summary?: string | null }).summary ?? "")
        .map((s) => s.trim())
        .filter(Boolean);
      (merged as T & { summary?: string }).summary = [...new Set(summaries)].join(" ");
    }
    const latestIdx = cluster.reduce(
      (latest, idx) => (sr[idx].dateMs > sr[latest].dateMs ? idx : latest),
      cluster[0],
    );
    if (cluster.length > 1) merged.latestFollowOn = rows[latestIdx];
    return merged as T;
  });
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
