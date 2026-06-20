// Content-based severity classification for ingested incidents.
//
// Both scrapers used to hardcode severity="low", which collapsed the
// Severity Distribution chart into a single bar and made the five-tier
// risk vocabulary (Insignificant, Low, Moderate, High, Extreme)
// meaningless on live data. This module rates each incident from its
// title + summary text so the spread reflects real signal.
//
// Tiers are scanned highest-first; the strongest matching signal wins.
// EXTREME is the only tier that drives the reserved subdued-red (#A33232)
// marker, so its signals are restricted to fatal / mass-casualty /
// emergency-rule language and it stays rare and meaningful by design.

export type Severity = "insignificant" | "low" | "moderate" | "high" | "extreme";

// Ordinal rank for the five-tier vocabulary, lowest -> highest. Used to take
// the STRONGER of two severities (e.g. a text-classified tier vs a tier implied
// by a structured GDELT fatality count) without ever silently downgrading.
export const SEVERITY_RANK: Record<Severity, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

/** Return whichever severity is the more severe of the two. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Severity FLOOR implied by a confirmed fatality count from a structured feed
 * (GDELT). A protest/unrest event with one or more confirmed deaths is at least
 * Extreme (matching the EXTREME tier's casualty signals); a fatality count of
 * zero is informative but carries no floor. Null when no count is known. This
 * lets severity scoring consume the structured fatality field where present and
 * fall back to text classification when absent.
 */
export function severityFromFatalities(fatalities: number | null | undefined): Severity | null {
  if (fatalities === null || fatalities === undefined) return null;
  if (!Number.isFinite(fatalities) || fatalities <= 0) return null;
  return "extreme";
}

// Topics whose incidents are content-classified by classifySeverity.
export type SeverityTopic =
  | "flashpoint"
  | "cargo_watch"
  | "shipping"
  | "energy"
  | "fertiliser"
  | "fuel"
  | "conflict";

// Present-tense fatal headlines. News writes fatal attacks in the present tense
// ("airstrike kills seven civilians", "gunmen kill 24 construction workers",
// "shootout kills 30"), but the EXTREME tier originally listed only the past
// tense ("killed") + "killing(s)", and the conflict HIGH tier carried no
// present-tense kill verb at all — so present-tense mass-casualty events
// under-rated, often collapsing to LOW when no other signal matched. That is the
// exact inconsistency reported: a security op that "killed" one militant read
// Extreme while "junta airstrikes kill 8 civilians" read Low. The two patterns
// below restore parity. Both are tightly bound to a casualty so metaphor —
// "kill switch", "kills demand", "kills 200 jobs", "kills 13 cattle", "Kill
// Count rises" — stays out of the reserved tier.

// A casualty quantity (digits or spelled) with an optional approximator.
const FATAL_QUALIFIER = "(?:at least\\s+|nearly\\s+|around\\s+|about\\s+|up to\\s+|some\\s+|more than\\s+|over\\s+)?";
const FATAL_COUNT =
  "(?:\\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|scores?|hundreds?|several|multiple|many)";
// Non-human / figurative objects that must NOT make "kills N ..." read as a
// casualty ("kills 200 jobs", "kills 13 cattle", "kills demand").
const NON_CASUALTY =
  "(?:jobs?|deals?|sales|orders?|projects?|plans?|bills?|percent|per[- ]?cent|points?|votes?|seats?|startups?|firms?|businesses|companies|stores?|shops?|industr\\w*|sector\\w*|markets?|econom\\w*|tourism|revenue|profits?|growth|hopes?|dreams?|chances?|careers?|momentum|morale|competition|demand|cattle|livestock|animals?|cows?|goats?|sheep|poultry|birds?|chickens?|fish)";
// Human casualty objects, allowing up to two intervening modifier words
// ("3 Lebanese soldiers", "24 construction workers", "suspected Muslim
// militants", "Catholic teacher").
const FATAL_PERSON =
  "(?:civilians?|villagers?|protest[eo]rs?|worshipp?ers?|people|persons?|children|child|students?|residents?|workers?|labou?rers?|migrants?|pilgrims?|mourners?|men|women|policemen|police officers?|officers?|cops?|soldiers?|troops?|militants?|fighters?|rebels?|insurgents?|separatists?|terrorists?|passengers?|commuters?|tourists?|teachers?|drivers?|pilots?|sailors?|guards?|hostages?|prisoners?|detainees?|monks?|priests?|nuns?|doctors?|nurses?|journalists?|activists?|fathers?|sons?|daughters?|mothers?|parents?|couples?|boys?|girls?|infants?|bab(?:y|ies)|toddlers?|teenagers?|relatives?|siblings?|famil(?:y|ies))";

// Present-tense fatal verb + a bare numeric casualty count not bound to a
// figurative object: "airstrike kills 8", "troops kill at least 17",
// "clashes kill 19", "soldier kills 26".
const PRESENT_TENSE_FATAL_COUNT_RE = new RegExp(
  `\\bkill(?:s|ing)?\\b\\s+${FATAL_QUALIFIER}${FATAL_COUNT}\\b(?!\\s+${NON_CASUALTY}\\b)`,
  "i",
);
// Present-tense fatal verb + a human object (optional count, up to two
// intervening modifier words): "kills seven civilians", "kill 24 construction
// workers", "separatists kill Catholic teacher".
const PRESENT_TENSE_FATAL_RE = new RegExp(
  `\\bkill(?:s|ing)?\\b\\s+${FATAL_QUALIFIER}(?:${FATAL_COUNT}\\s+)?(?:\\w+\\s+){0,2}?${FATAL_PERSON}\\b`,
  "i",
);

// Plural strike forms ("airstrikes", "air strikes", "drone strikes") that the
// conflict HIGH tier missed because it only listed the singular "airstrike" /
// "drone strike". Used by the heal predicate below to scope the one-time DB
// upgrade strictly to rows this change affects.
const PLURAL_STRIKE_RE = /\b(air ?strikes|drone strikes)\b/i;

// Natural / accidental cause of death. A lightning, flood, earthquake, heatwave
// or drowning fatality is NOT a security or conflict event, so it must never
// occupy the reserved Extreme tier next to airstrikes and massacres. "strike"
// is deliberately NOT listed bare here — "lightning strike" / "earthquake
// strikes" are natural, and the military senses ("air strike", "missile
// strike") are caught by the keep-list below.
const NATURAL_CAUSE_RE =
  /\b(lightning|flash flood|floods?|flooding|inundat\w*|landslide|mudslide|mudflow|monsoon|cyclone|typhoon|hurricane|tornado|storm surge|earthquake|quake|aftershock|tremor|avalanche|heat ?wave|heatstroke|sun ?stroke|cold ?wave|drown(s|ed|ing)?|snake ?bite|electrocut\w*)\b/i;
// Security, violence or crowd-crush signals that mean a fatality is NOT a pure
// natural disaster. Deliberately broad: the guard errs toward KEEPING Extreme,
// so any of these present cancels the natural-cause suppression (a missed
// downgrade is harmless; wrongly hiding a real massacre is not).
const SECURITY_OR_CROWD_SIGNAL_RE =
  /\b(air ?strikes?|drone|missile|rocket|shell(ed|ing|s)?|artillery|mortar|bomb\w*|blast|explos\w*|grenade|ied|landmine|land mine|gun\w*|shot|shoot\w*|firing|opened fire|ambush\w*|raid\w*|clash\w*|attack\w*|assault\w*|militant\w*|insurgent\w*|terror\w*|rebel\w*|junta|army|troops?|soldiers?|security force|robber\w*|hijack\w*|homicide|murder\w*|kidnap\w*|abduct\w*|hostage|stab\w*|machete|arson|riot\w*|stampede|crush|trampl\w*|crowd|protest\w*|police|ditembak|penembakan|baku tembak|tembak mati|dibunuh|pembunuhan|terbunuh|penyerangan|serangan bersenjata|kekerasan|bentrok\w*|kerusuhan)\b/i;

/**
 * True if the text describes a natural / accidental death (lightning, flood,
 * earthquake, drowning, …) with NO security, violence or crowd-crush signal —
 * i.e. a fatality that must NOT read as a reserved-tier security Extreme.
 * Exported so the one-time DB heal can downgrade such mis-rated machine rows.
 */
export function isNaturalCauseDeath(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  return NATURAL_CAUSE_RE.test(hay) && !SECURITY_OR_CROWD_SIGNAL_RE.test(hay);
}

// Illness / biographical / commemorative death. A bare "death" word can appear
// in a human-interest or obituary context — "after the death of his father to
// Covid-19", "dies at 82 after a long illness", "death anniversary", "late
// father" — which is NOT a security event and must never occupy the reserved
// Extreme tier next to airstrikes and massacres. (Reported case: an entertainer
// reflecting on his late father's Covid death read EXTREME.) Mirrors
// isNaturalCauseDeath: an explicit illness/biographical cue with NO security,
// violence or crowd signal cancels the Extreme rating; the row still falls
// through to the lower tiers on any other signal.
const ILLNESS_BIO_DEATH_RE =
  /\b(covid|coronavirus|cancer|leukae?mia|tumou?r|illness|ailment|disease|pneumonia|heart attack|cardiac|stroke|diabet\w*|kidney|liver failure|sepsis|organ failure|natural causes|old age|passed away|passing|obituary|laid to rest|funeral|wake|memorial service|in memoriam|condolences?|dies? (?:at|aged)\s+\d+|died (?:at|aged)\s+\d+|aged \d+|death anniversary|anniversary of (?:his|her|their|the) death|death of (?:his|her|their|my|the late)\b|lost (?:his|her|their|my) (?:father|mother|dad|mum|mom|husband|wife|son|daughter|brother|sister|grand\w+)|late (?:father|mother|dad|husband|wife|son|daughter|brother|sister|grand\w+))\b/i;

/**
 * True if the text describes an illness / biographical / commemorative death
 * (Covid, cancer, "passed away", obituary, "death of his father", a death
 * anniversary, …) with NO security, violence or crowd signal — a death that
 * must NOT read as a reserved-tier security Extreme. Exported so the one-time
 * DB heal can downgrade such mis-rated machine rows.
 */
export function isBiographicalOrIllnessDeath(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  return ILLNESS_BIO_DEATH_RE.test(hay) && !SECURITY_OR_CROWD_SIGNAL_RE.test(hay);
}

// Indonesian-language violence signals. The classifier is otherwise English-only,
// so a Bahasa headline ("Pelajar … ditembak saat operasi militer" — a student
// shot during a military operation) carried NO English keyword and collapsed to
// the LOW default though it describes a shooting. These terms are distinctly
// Indonesian (no English homonym); the ambiguous ones are deliberately excluded
// (bare "serangan" = also "serangan jantung"/heart attack; bare "tewas"/"korban
// jiwa" = also disaster death tolls) so a non-security Indonesian death does not
// reach the reserved tiers. ID_FATAL terms denote a violent killing → Extreme;
// ID_VIOLENCE terms denote a violent/injurious act → High.
const ID_FATAL_RE =
  /\b(dibunuh|pembunuhan|terbunuh|tembak mati|ditembak mati|tewas ditembak)\b/i;
const ID_VIOLENCE_RE =
  /\b(ditembak|penembakan|baku tembak|penyerangan|serangan bersenjata|kekerasan|bentrokan|bentrok|kerusuhan|melukai|terluka|luka tembak)\b/i;

/**
 * True if the text carries an Indonesian-language fatal or violence signal.
 * Exported so the one-time DB heal can scope its UPGRADE strictly to the Bahasa
 * rows this change re-rates.
 */
export function hasIndonesianViolenceSignal(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  return ID_FATAL_RE.test(hay) || ID_VIOLENCE_RE.test(hay);
}

// Fatalities, mass casualties, emergency rule. Reserved tier — drives the
// subdued-red marker only.
const EXTREME: RegExp[] = [
  /\b(killed|dead|deaths?|died|fatal(it(y|ies))?|massacre|killings?|slain|shot dead|gunned down|burn(ed|t) (?:to death|alive)|stampede)\b/i,
  ID_FATAL_RE,
  PRESENT_TENSE_FATAL_RE,
  PRESENT_TENSE_FATAL_COUNT_RE,
  /\b(martial law|state of emergency|emergency declared)\b/i,
  /\b(dozens|scores|hundreds|mass) (killed|dead|feared dead)\b/i,
  /\b(mass casualt|multiple (deaths|fatalities))\b/i,
];

// Violence, injuries, weapons, severe coercive response or disruption.
const HIGH: RegExp[] = [
  /\b(injur(y|ies|ed)|wounded|hurt|casualt(y|ies)|trampled|hospitalis(ed)|hospitaliz(ed))\b/i,
  /\b(violent|violence|riot(s|ing|ed)?|clash(es|ed)?|looting|looted|arson|torch(ed)?|set (on )?fire|set ablaze|ransack)\b/i,
  /\b(tear[- ]?gas|rubber bullets?|water cannon|baton[- ]?charge|live (rounds?|fire|ammunition)|gunfire|opened fire|firing|lathi[- ]?charge)\b/i,
  /\b(curfew|crackdown|mass arrests?|state forces (open|fire))\b/i,
  /\b(at gunpoint|armed (robbery|men|gang|hijack|heist)|gunpoint|brandish|machete|hijack(ed|ing) at|held up)\b/i,
  /\b(stormed|besieg(e|ed)|breach(ed)? the|overran)\b/i,
  ID_VIOLENCE_RE,
];

// Active confrontation, arrests, blockades, operational disruption.
const MODERATE: RegExp[] = [
  /\b(arrest(s|ed)?|detain(ed|ment)?|roadblock|road block|blockad(e|ed)|barricad(e|ed)|stand[- ]?off|confront(ation|ed)?|scuffle|skirmish)\b/i,
  /\b(general strike|nationwide strike|mass (protest|rally|march)|thousands (of )?(protest|march|rally|gather)|shut(s| |down)|stoppage|walkout|sit[- ]?in occupy|occupy(ing)?)\b/i,
  /\b(seal tamper|tampered seal|broke into|break[- ]?in|forced entry)\b/i,
];

// Forward-looking, advisory, or aftermath-only language with no active
// incident. Genuinely minor — kept rare.
const INSIGNIFICANT: RegExp[] = [
  /\b(plan(s|ned|ning)? to|call(s|ed|ing)? for|threaten(s|ed|ing)? to|vow(s|ed)? to|set to|to hold (a )?(protest|strike|rally)|may (strike|protest)|could (strike|protest)|urg(e|ed|ing)|appeal(ed|s)? for|warn(s|ed|ing) of|advisory|alert issued|postpon(e|ed)|call(ed)? off|suspend(ed)? (the )?strike)\b/i,
];

// A headline LED by an advocacy / statement / commemoration verb — "<group>
// demands ban / seeks justice / condemns / mourns / pays tribute ...". The
// event being reported is the REACTION; any casualty or violence words it
// carries ("...for six slain", "condemns the killing of") are REFERENCES to a
// prior event, not a fresh attack — so they must not drive the reserved
// Extreme / High tiers (see the reaction guard in classifySeverity). Anchored
// on the first few words so a fresh-attack headline that merely ENDS with a
// reaction ("3 injured in armed attack, mob protests treatment") is NOT caught.
// Protest / rally / clash words are deliberately excluded — they can BE the
// violent event ("Protest turns deadly, dozens killed").
const REACTION_LEAD_RE =
  /^(?:[\w’'".&()\-]+[\s,;:]+){0,4}(demand(s|ed|ing)?|seek(s|ing)?\s+(justice|a\s+ban|ban|probe|inquiry|action|accountability|compensation|redress)|call(s|ed|ing)?\s+for|condemn(s|ed|ing|ation)?|denounc(e|es|ed|ing|ation)|decr(y|ies|ied)|urg(e|es|ed|ing)\b|appeal(s|ed|ing)?\s+for|mourn(s|ed|ing)?|pay(s|ing)?\s+tribute|tribute|condol|vigil|petition(s|ed|ing)?|memorandum|boycott(s|ed|ing)?|slam(s|med|ming)?|blame(s|d)?|accus(e|es|ed|ing)|hail(s|ed|ing)?|welcom(e|es|ed|ing)|reject(s|ed|ing)?|refus(e|es|ed|ing|al)|summon(s|ed|ing)?)/i;

/**
 * True if the headline is led by an advocacy / statement verb — i.e. it reports
 * a REACTION to a prior event rather than a fresh incident. Mirrors the gate
 * applied inside classifySeverity; exported so the one-time DB heal can scope
 * its downgrade to exactly this class of mis-rated rows.
 */
export function isReactionLed(title: string): boolean {
  return REACTION_LEAD_RE.test(title);
}

/**
 * True if the text is escalated specifically by the present-tense / present-
 * participle fatal-verb or plural-strike additions to the classifier
 * ("airstrike kills seven civilians", "junta airstrikes kill 8 civilians",
 * "airstrike ... killing father and son", "fresh airstrikes on the village").
 * Exported so the one-time DB heal can scope its UPGRADE to exactly the rows
 * this change affects, never sweeping rows that differ from the current
 * classifier for unrelated historical reasons.
 */
export function isPresentTenseFatalOrPluralStrike(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  return (
    PRESENT_TENSE_FATAL_RE.test(hay) ||
    PRESENT_TENSE_FATAL_COUNT_RE.test(hay) ||
    PLURAL_STRIKE_RE.test(hay)
  );
}

// A fatal word ("killed", "eight dead", "fatalities") co-occurring with a
// kinetic attack noun (airstrike, shelling, drone, IED, …). This conjunction is
// the unambiguous signature of a deadly security attack, so the Extreme rating
// the base classifier already assigns it is trustworthy — unlike a bare "death"
// word, which collides with "sentenced to death" / "death anniversary". Used by
// the one-time heal to upgrade legacy/auto rows whose stored tier predates the
// classifier (e.g. "Eight killed in junta airstrike on bridge" stored as High).
const FATAL_WORD_RE =
  /\b(killed|kill|kills|killing|dead|deaths?|died|fatal(?:it(?:y|ies))?|slain|massacre|gunned down|shot dead|burn(?:ed|t) (?:to death|alive))\b/i;
const KINETIC_ATTACK_NOUN_RE =
  /\b(air ?strikes?|drone strikes?|drone|shell(?:ed|ing|s)?|artillery|mortar\w*|missile\w*|rocket\w*|bomb(?:ed|ing|s)?|car bomb|grenade\w*|ied|landmine\w*|land mine|opened fire|ambush\w*)\b/i;

export function isFatalKineticAttack(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  return FATAL_WORD_RE.test(hay) && KINETIC_ATTACK_NOUN_RE.test(hay);
}

// Judicial / commemorative uses of "death" that are NOT a killing event: a
// court sentence, the death penalty, death row, a death anniversary. The bare
// "death" in the EXTREME tier matches these, so an "ousted PM sentenced to
// death" wrongly reads as a reserved-tier massacre. The guard strips ONLY these
// phrases and re-tests EXTREME, so a genuine fatal headline that ALSO mentions
// a sentence ("10 killed; mastermind sentenced to death") still rates Extreme.
const JUDICIAL_DEATH_RE =
  /\b(sentenced to death|death sentences?|death penalty|capital punishment|on death row|death row|death anniversary|faces? (?:the )?death penalty|commute[ds]? (?:the )?death)\b/i;

export function isJudicialDeath(title: string, summary: string): boolean {
  const hay = `${title}\n${summary}`;
  if (!JUDICIAL_DEATH_RE.test(hay)) return false;
  const stripped = hay.replace(new RegExp(JUDICIAL_DEATH_RE.source, "gi"), " ");
  return !EXTREME.some((re) => re.test(stripped));
}

/**
 * Rate an incident's severity from its text.
 *
 * @param topic  "flashpoint" (civil unrest), "cargo_watch" (cargo crime) or
 *               "shipping" (maritime security / disruption).
 *               Cargo incidents describe a completed theft, so their floor
 *               is "low" (pilferage) rising to "moderate" for a substantive
 *               theft; civil-unrest items default to "low" (peaceful/planned
 *               protest) absent stronger signal. Shipping rates a kinetic
 *               vessel/port attack as "high" and a seizure / closure /
 *               disruption as "moderate" — extreme stays reserved for the
 *               casualty/emergency signals in the EXTREME tier above.
 */
export function classifySeverity(
  title: string,
  summary: string,
  topic: SeverityTopic,
): Severity {
  const hay = `${title}\n${summary}`;

  // Reaction guard (civil unrest + conflict only). A headline led by an
  // advocacy / statement verb is reporting a REACTION to a prior event, so its
  // casualty / violence words are references — they must not trigger the
  // reserved Extreme / High tiers. The underlying attack, if newsworthy, carries
  // its own row. Scoped to flashpoint/conflict because in commodity / maritime
  // topics a reaction-framed deadly attack is far more likely to be the only
  // record of a genuine kinetic event, so their escalation stays intact.
  const reactionLed =
    (topic === "flashpoint" || topic === "conflict") && REACTION_LEAD_RE.test(title);

  // Natural-cause guard. A lightning / flood / earthquake / drowning death with
  // no security or crowd-crush signal is not a security event, so it must not
  // occupy the reserved Extreme tier. It still falls through to the High /
  // Moderate tiers below if it carries injury or disruption words.
  const naturalCauseDeath = isNaturalCauseDeath(title, summary);

  // Judicial-death guard. A death sentence / death-row / death-penalty headline
  // is not a killing event, so it must not occupy the reserved Extreme tier.
  const judicialDeath = isJudicialDeath(title, summary);

  // Illness / biographical guard. An obituary / human-interest death (Covid,
  // cancer, "death of his father", a death anniversary) with NO security signal
  // must not occupy the reserved Extreme tier. Like the natural-cause guard it
  // only suppresses the bare-death EXTREME match; a genuine violent death keeps
  // its own security signal so this never fires on a real attack.
  const biographicalDeath = isBiographicalOrIllnessDeath(title, summary);

  if (
    !reactionLed &&
    !naturalCauseDeath &&
    !judicialDeath &&
    !biographicalDeath &&
    EXTREME.some((re) => re.test(hay))
  )
    return "extreme";
  if (!reactionLed && HIGH.some((re) => re.test(hay))) return "high";
  if (MODERATE.some((re) => re.test(hay))) return "moderate";

  // Cargo crime: an actual theft (stolen/robbery/burglary/heist) without
  // weapons is still a material loss → moderate. Pilferage / petty /
  // attempted / recovered stays low.
  if (topic === "cargo_watch") {
    if (/\b(pilferage|petty|attempted|foiled|recovered|minor)\b/i.test(hay)) return "low";
    if (/\b(theft|stolen|stole|robbery|robbed|burglary|burgl|heist|loot|cargo crime)\b/i.test(hay)) {
      return "moderate";
    }
  }

  // Shipping: a kinetic strike on a vessel or port (missile / drone /
  // projectile / explosion / fire / sinking) is a high-severity maritime
  // incident even without confirmed casualties (those escalate to extreme
  // via the EXTREME tier). A seizure / boarding / hijack / detention or a
  // chokepoint closure / blockade / major disruption is a moderate
  // operational event. Forward-looking / advisory framing falls through to
  // the INSIGNIFICANT / low default below.
  if (topic === "shipping") {
    if (
      /\b(missile|drone|projectile|torpedo|rocket|explosion|explosive|blast|struck|set (on )?fire|set ablaze|ablaze|sinking|sank|sunk|limpet mine|mine attack)\b/i.test(hay)
    ) {
      return "high";
    }
    if (
      /\b(seiz(e|ed|ure|ing)|board(ed|ing)|hijack(ed|ing)?|detain(ed|ment)?|captured|impound(ed)?|commandeer(ed)?|closure|closed|blockad(e|ed)|shutdown|congestion|backlog|reroute|re-?route|divert(ed|s)?|diversion|stoppage|suspend(ed|s)?)\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  // Energy: a kinetic strike on grid infrastructure (substation / pipeline /
  // transmission / power plant + fire / explosion / attack / sabotage) is a
  // high-severity event even without confirmed casualties (those escalate via
  // EXTREME). A blackout / outage / load-shedding / shortage / rationing / cut
  // / crisis is a moderate operational disruption. Tariff-only / advisory
  // framing falls through to insignificant / low.
  if (topic === "energy") {
    if (
      /\b(substation|transmission|pipeline|power (plant|station)|grid|powerline|power line) .{0,30}(fire|explosion|blast|attack|sabotag|struck|bomb|destroyed)\b/i.test(hay) ||
      /\b(substation fire|pipeline attack|pipeline sabotage|substation attack)\b/i.test(hay)
    ) {
      return "high";
    }
    if (
      /\b(blackout|power outage|power cut|load[ -]?shedd|grid (failure|collapse)|electricity (shortage|crisis)|power (shortage|crisis|rationing)|outage|blackouts?)\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  // Fuel: a kinetic strike on a refinery / depot / pipeline / tanker (fire /
  // explosion / attack) is high. A shortage / rationing / queue / stockout /
  // closure / halt / supply cut / disruption is a moderate operational event.
  // Price-only commentary falls through to insignificant / low.
  if (topic === "fuel") {
    if (
      /\b(refinery|fuel depot|oil depot|pipeline|tanker|fuel terminal) .{0,30}(fire|explosion|blast|attack|sabotag|struck|ablaze|bomb)\b/i.test(hay) ||
      /\b(refinery fire|refinery attack|depot fire)\b/i.test(hay)
    ) {
      return "high";
    }
    if (
      /\b(shortage|rationing|stockout|queue|queues|dry pump|ran out|closure|closed|halt(ed|s)?|outage|supply (cut|halt|squeeze|disruption)|disruption|panic buying)\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  // Fertiliser: a shortage / stockout / supply crisis / export ban / plant
  // closure or outage is a moderate operational event. Violent farmer-protest
  // clashes are already escalated by the shared HIGH / MODERATE tiers above.
  // Price-only or subsidy-debate framing falls through to insignificant / low.
  if (topic === "fertiliser") {
    if (
      /\b(shortage|stockout|supply (crisis|cut|halt|squeeze|disruption)|export ban|export halt|black market|panic buying|plant (closure|shutdown|outage|halt)|rationing)\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  // Conflict: an active armed engagement (clash / firefight / gun battle /
  // ambush / shootout / IED / bombing / insurgent or militant attack) is a
  // high-severity event even without a confirmed casualty word (fatalities and
  // mass casualties already escalate to EXTREME above via the shared tiers). A
  // raid / operation / arrest / standoff / blockade by security forces is a
  // moderate operational event. Forward-looking / advisory framing falls
  // through to insignificant / low.
  if (topic === "conflict") {
    if (
      !reactionLed &&
      /\b(armed clash|armed clashes|gun ?battle|gun ?fight|firefight|shoot[- ]?out|cross[- ]?fire|exchange of fire|ambush(ed|es)?|ied|improvised explosive|roadside bomb|land ?mine|car bomb|grenade attack|bomb(ing|s)? attack|suicide bomb|air ?strikes?|drone strikes?|insurgent attack|militant attack|rebel attack|armed attack|armed assault|massacre|kidnap(ped|ping)?|abduct(ed|ion)?|hostage)\b/i.test(hay)
    ) {
      return "high";
    }
    if (
      /\b(raid(ed|s)?|offensive|operation|crackdown|arrest(s|ed)?|detain(ed|ment)?|stand[- ]?off|blockade|roadblock|curfew|patrol|deploy(ed|ment)?|skirmish|incursion|seiz(e|ed|ure))\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  if (INSIGNIFICANT.some((re) => re.test(hay))) return "insignificant";
  return "low";
}
