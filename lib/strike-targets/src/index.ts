// Shared strike-target rulebook.
//
// Strike target/infrastructure classification was historically implemented
// TWICE with the same conventions: the ingestion classifier (lib/ingest) wrote
// the strikes table's target_category / infrastructure columns, and the
// Missile Strike Tracker dashboard (artifacts/workbench Strikes.tsx) re-derived
// on-screen labels from a near-identical-but-separate set of regexes. A fix to
// one silently left the other stale — the exact drift this module exists to
// prevent. Both surfaces now import the classify helpers (and the role-aware
// `hasMilitaryTargetSignal` / `hasVesselSignal` predicates) from here, so a
// single edit covers ingest, the dashboard, and any future surface.
//
// This module is intentionally pure (no DB, no Node, no I/O) so the browser
// workbench and the Node ingest pipeline can both import it.
//
// IMPORTANT REGEX CONVENTION: stems carry only a LEADING \b, never a trailing
// one, so common inflections still match (refiner -> refinery, petrochem ->
// petrochemical, "energy facilit" -> "energy facilities", "military facilit" ->
// "facilities", "cargo ship" -> "cargo ships", "destroyer" -> "destroyers"). A
// trailing \b on a stem silently drops every inflected form — the historical
// cause of energy/oil/military targets reading "Unknown" and of plural ship
// classes reading wrong. Short ambiguous tokens (crude, lng, grid, mall, home,
// civilian) keep a trailing boundary so they do not over-match (e.g.
// "civilians injured" is a casualty count, not a civilian-area target).
//
// ATTACKER / RESPONDER AWARENESS: pure precedence regex cannot tell WHO struck
// from WHAT was hit. Headlines like "US Central Command disables a tanker"
// (CENTCOM is the attacker), "HMS Lancaster first to respond after a drone
// attack on a tanker" (the warship only responded), or "KC-135 tankers" (a
// refuelling AIRCRAFT, not a ship) used to be mis-stored at ingest. The force
// tokens (US forces / CENTCOM / a named warship) are therefore gated: they only
// count as the struck target when the same clause does NOT frame them as the
// actor (disable/intercept/fire/launch/seize/board/respond/escort/...). Only
// UNAMBIGUOUS attacker/responder verbs gate — passive-capable words
// ("struck/hit/attacked by") never do, so "US troops struck by rocket" stays a
// military target.

export type StrikeTargetCategory =
  | "military_site"
  | "energy_infrastructure"
  | "vessel"
  | "airport_aviation"
  | "port_maritime"
  | "government_facility"
  | "civilian_area"
  | "unknown";

export type StrikeInfrastructure =
  | "power"
  | "oil_gas"
  | "airport"
  | "military"
  | "port"
  | "government"
  | "civilian_residential"
  | "unknown";

// --- Target / infrastructure signal regexes ---

// Concrete physical military installations. These are unambiguously the struck
// target regardless of any actor framing in the headline, so they are NOT
// gated by the attacker-role check below.
export const MILITARY_BASE_SIG =
  /\b(air[\s-]?base|airbase|military (?:base|site|installation|facilit|camp|target)|naval base|navy base|army base|barrack|garrison|prince sultan|muwaffaq salti|al[\s-]?udeid|al[\s-]?dhafra|arifjan|ali al salem|radar (?:site|station)|defen[cs]e site|\binstallation)/i;

// Military refuelling aircraft (KC-135 / KC-46 / KC-10 / "Stratotanker") are
// military assets, never ships — so "KC-135 tankers" reads Military, not Vessel.
// Only refuelling tankers are listed: fighter jets / warplanes are usually the
// ATTACKER, not the target, so they are deliberately omitted.
export const MILITARY_AIRCRAFT_SIG = /\b(kc[\s-]?135|kc[\s-]?46|kc[\s-]?10|stratotanker)\b/i;

// Ambiguous force-actor tokens: a US / coalition force or command that is often
// the ATTACKER or RESPONDER, not the thing hit. Counts as a military target
// only when the clause does NOT frame it as the actor (see hasMilitaryTargetSignal).
export const MILITARY_FORCE_SIG =
  /\b(us (?:forces|base|bases|troops|military|warship|warships|command)|u\.s\.? ?(?:forces|base|bases|troops|military)|american (?:base|forces|warship)|fifth fleet|5th fleet|centcom|central command|command (?:cent(?:er|re)|ship|post|hub)|\btroops)/i;

// Back-compat union of all military signals (base + aircraft + force). Kept for
// any external caller; classifyStrikeTarget uses hasMilitaryTargetSignal so the
// attacker/responder gating applies.
export const MILITARY_SIG = new RegExp(
  `${MILITARY_BASE_SIG.source}|${MILITARY_AIRCRAFT_SIG.source}|${MILITARY_FORCE_SIG.source}`,
  "i",
);

export const OILGAS_SIG =
  /\b(oil ?field|oil facilit|oil storage|oil depot|oil hub|oil refiner|oil installation|refiner|petrochem|\bcrude|gas field|gas plant|gas complex|gas pipeline|pipeline|aramco|adnoc|samref|habshan|mina al[\s-]?ahmadi|mina abdullah|ruwais|kharg|fuel depot|fuel storage|\blng\b|energy facilit|energy infrastructure)/i;

export const POWER_SIG =
  /\b(power plant|power station|power grid|\bgrid\b|electric|substation|nuclear|reactor|barakah)/i;

// Merchant / civilian vessels — when present, a real ship was the target. No
// trailing \b on the group: a trailing boundary drops plurals ("cargo ships").
export const MERCHANT_VESSEL_SIG =
  /\b(oil tanker|\btanker|\bvessel|cargo ship|container ship|merchant ship|merchant vessel|bulk carrier|freighter|crude carrier)/i;

// Naval combatants that may be the RESPONDER / escort rather than the struck
// ship (gated by COMBATANT_ACTOR_FRAME in hasVesselSignal).
export const COMBATANT_SIG = /\b(warship|frigate|destroyer|naval vessel|command ship)/i;

// Back-compat union vessel signal (used to be the single VESSEL_SIG). Prefer
// hasVesselSignal, which adds aircraft-tanker and responder awareness.
export const VESSEL_SIG = new RegExp(
  `${MERCHANT_VESSEL_SIG.source}|${COMBATANT_SIG.source}|ship (?:hit|struck|attacked|sunk|sinks|sank|sinking)|tanker (?:hit|struck|attacked)`,
  "i",
);

export const PORT_SIG = /\b(\bport\b|harbour|harbor|jetty|\bdock|\bberth|anchorage)/i;

export const AIRPORT_SIG =
  /\b(international airport|\bairport|air terminal|aviation|airfield|runway|terminal 1|terminal 2|civil aviation|passenger flight)/i;

export const GOVT_SIG =
  /\b(government building|ministry|palace|parliament|presidential|royal court|embassy)/i;

// Trailing \b on the bare "civilian" token: "civilians injured" is a casualty
// count, not a civilian-area target. Aluminium smelters (Alba / EGA) are
// civilian industrial targets.
export const CIVIL_SIG =
  /\b(residential|neighbou?rhood|civilian\b|\bhome\b|\bhouse|\bmarket|\bmall\b|school|hospital|mosque|housing|settlement|aluminium|aluminum)/i;

// Dashboard-only target class (ingest has no Industrial enum). Exported here so
// the dashboard sources every target signal from the one rulebook.
export const INDUSTRIAL_SIG =
  /\b(factory|factories|warehouse|industrial zone|industrial estate)/i;

// Narrow residential-only signal used for the infrastructure column's
// civilian_residential value (distinct from the broader CIVIL_SIG above).
const CIVIL_RESIDENTIAL_SIG = /\b(residential|neighbou?rhood|\bhome\b|\bhouse|housing)/i;

// Maritime combines vessel + port signals — the dashboard renders both ingest
// enums (vessel, port_maritime) under one "Maritime" label.
export const MARITIME_SIG = new RegExp(`${VESSEL_SIG.source}|${PORT_SIG.source}`, "i");

// --- Attacker / responder role gating ---
//
// UNAMBIGUOUS attacker/responder verb stems. "struck / hit / attacked /
// targeted" are deliberately excluded — they are passive-capable ("US troops
// struck BY a rocket" = target), so using them to infer an attacker role would
// drop legitimate military targets.
const ACTOR_VERB =
  "(?:disabl\\w*|intercept\\w*|shoots?\\s+down|shot\\s+down|downed|down\\s+(?:a|an|the|\\d|drone|drones|missile|missiles|uav|projectile)|destroy(?:s|ed|ing)?|launch\\w*|fir(?:e|es|ed|ing)|sink\\w*|sank|sunk|seiz\\w*|board(?:s|ed|ing)?|redirect\\w*|repel\\w*|thwart\\w*|respond\\w*|escort\\w*|patrol\\w*|blockad\\w*)";

// A military FORCE named in subject (attacker/responder) position: the force
// token followed within a short span by an unambiguous actor verb. Matches
// "US Central Command disables a tanker", "US forces shoot down a drone".
const MILITARY_ACTOR_FRAME = new RegExp(
  `\\b(us|u\\.s\\.?|american|americans|centcom|central command|coalition|fifth fleet|5th fleet|naval forces|navy|warships?|frigate|destroyer)\\b[^.;:]{0,30}?\\b${ACTOR_VERB}`,
  "i",
);

// A naval combatant in responder / escort position rather than as the struck ship.
const COMBATANT_ACTOR_FRAME = new RegExp(
  `\\b(warships?|frigate|destroyer|naval vessel|command ship|navy)\\b[^.;:]{0,30}?\\b${ACTOR_VERB}`,
  "i",
);

// Strip "tanker"/"ship" mentions that are actually a refuelling AIRCRAFT so the
// vessel check below does not read "KC-135 tanker" as a ship.
function stripAircraftTankers(t: string): string {
  return t
    .replace(/\bkc[\s-]?(?:135|46|10)\b[\w\s-]*?\btankers?\b/gi, " ")
    .replace(/\b(?:aerial|refuel\w*|stratotanker)\b[\w\s-]*?\btankers?\b/gi, " ")
    .replace(/\btankers?\s+(?:aircraft|plane|planes|jet|jets|aeroplane|airplane)\b/gi, " ")
    .replace(/\bkc[\s-]?(?:135|46|10)\b/gi, " ")
    .replace(/\bstratotanker\b/gi, " ");
}

// Explicit ship-as-target framing (incl. disable/seize/board/redirect/blockade)
// so "US military fires missile to disable ship" reads as a vessel target, not
// the US force. Operates on aircraft-tanker-stripped text.
//
// The noun->verb branch allows an OPTIONAL passive auxiliary span between the
// noun and the participle so passive framings classify too: "ship was seized",
// "vessel has been sunk", "tankers have been boarded". The noun carries an
// optional trailing `s?` so plurals ("ships were sunk") match as well. The verb
// list is the SET of attack participles a struck vessel takes — interception /
// escort / patrol words are deliberately excluded (those frame a responder, not
// the target).
const VESSEL_TARGET_FRAME =
  /\b(?:ship|tanker|vessel)s?\s+(?:(?:was|were|is|are|has|have|had|been|being|got)\s+){0,3}(?:hit|struck|attacked|sunk|sinks|sank|sinking|seized|boarded|disabled|redirected)\b|\b(?:disabl\w*|seiz\w*|board\w*|redirect\w*|sink\w*|blockad\w*)\s+(?:a |an |the |its )?(?:ship|tanker|vessel)s?\b/i;

// A bare vessel noun anywhere in the text (used only to confirm context for the
// follow-on "another sunk" clause below).
const VESSEL_NOUN_SIG = /\b(?:ship|tanker|vessel)s?\b/i;

// A follow-on clause whose subject ("another") refers back to a vessel named
// earlier in the sentence: "One ship seized, another sunk", "Two tankers hit,
// another boarded overnight". Only counts when a vessel noun is also present
// (see hasVesselSignal) so it cannot fire on an unrelated "another sunk".
const ANOTHER_ATTACKED_FRAME =
  /\banother\s+(?:(?:was|were|has|have|had|been|being|got)\s+){0,3}(?:sunk|seized|boarded|disabled|hit|struck|attacked)\b/i;

/**
 * Whether the text describes a MILITARY target that was struck — base/aircraft
 * signals always count; force-actor signals (US forces / CENTCOM / a named
 * warship) count only when they are NOT framed as the attacker/responder.
 */
export function hasMilitaryTargetSignal(t: string): boolean {
  if (MILITARY_BASE_SIG.test(t) || MILITARY_AIRCRAFT_SIG.test(t)) return true;
  if (MILITARY_FORCE_SIG.test(t) && !MILITARY_ACTOR_FRAME.test(t)) return true;
  return false;
}

/**
 * Whether the text describes a VESSEL that was struck. Merchant/civilian ships
 * and explicit "ship hit/seized/disabled" framing always count; a bare naval
 * combatant counts only when it is NOT framed as the responder/escort; and a
 * refuelling-aircraft "tanker" never counts.
 */
export function hasVesselSignal(t: string): boolean {
  const s = stripAircraftTankers(t);
  if (MERCHANT_VESSEL_SIG.test(s)) return true;
  if (VESSEL_TARGET_FRAME.test(s)) return true;
  if (VESSEL_NOUN_SIG.test(s) && ANOTHER_ATTACKED_FRAME.test(s)) return true;
  if (COMBATANT_SIG.test(s) && !COMBATANT_ACTOR_FRAME.test(s)) return true;
  return false;
}

/**
 * Canonical strike target category from a text blob. Order is precedence:
 * military beats energy beats vessel beats aviation beats port beats government
 * beats civilian. Used by the ingest classifier to write target_category. The
 * military and vessel branches are attacker/responder aware (see the helpers
 * above) so the struck target is not confused with who fired.
 */
export function classifyStrikeTarget(t: string): StrikeTargetCategory {
  if (hasMilitaryTargetSignal(t)) return "military_site";
  if (OILGAS_SIG.test(t) || POWER_SIG.test(t)) return "energy_infrastructure";
  if (hasVesselSignal(t)) return "vessel";
  if (AIRPORT_SIG.test(t)) return "airport_aviation";
  if (PORT_SIG.test(t)) return "port_maritime";
  if (GOVT_SIG.test(t)) return "government_facility";
  if (CIVIL_SIG.test(t)) return "civilian_area";
  return "unknown";
}

/**
 * Canonical infrastructure category from a text blob. Used by the ingest
 * classifier to write the infrastructure column.
 */
export function classifyStrikeInfrastructure(t: string): StrikeInfrastructure {
  if (POWER_SIG.test(t)) return "power";
  if (OILGAS_SIG.test(t)) return "oil_gas";
  if (AIRPORT_SIG.test(t)) return "airport";
  if (hasMilitaryTargetSignal(t)) return "military";
  if (PORT_SIG.test(t)) return "port";
  if (GOVT_SIG.test(t)) return "government";
  if (CIVIL_RESIDENTIAL_SIG.test(t)) return "civilian_residential";
  return "unknown";
}
