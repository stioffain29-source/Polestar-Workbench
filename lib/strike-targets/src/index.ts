// Shared strike-target rulebook.
//
// Strike target/infrastructure classification was historically implemented
// TWICE with the same conventions: the ingestion classifier (lib/ingest) wrote
// the strikes table's target_category / infrastructure columns, and the
// Missile Strike Tracker dashboard (artifacts/workbench Strikes.tsx) re-derived
// on-screen labels from a near-identical-but-separate set of regexes. A fix to
// one silently left the other stale — the exact drift this module exists to
// prevent. Both surfaces now import the signal patterns and classify helpers
// from here, so a single edit covers ingest, the dashboard, and any future
// surface.
//
// This module is intentionally pure (no DB, no Node, no I/O) so the browser
// workbench and the Node ingest pipeline can both import it.
//
// IMPORTANT REGEX CONVENTION: stems carry only a LEADING \b, never a trailing
// one, so common inflections still match (refiner -> refinery, petrochem ->
// petrochemical, "energy facilit" -> "energy facilities", "military facilit" ->
// "facilities"). A trailing \b on a stem silently drops every inflected form —
// the historical cause of energy/oil/military targets reading "Unknown". Short
// ambiguous tokens (crude, lng, grid, mall, home, civilian) keep a trailing
// boundary so they do not over-match (e.g. "civilians injured" is a casualty
// count, not a civilian-area target).

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
//
// Military is matched FIRST in classifyStrikeTarget so an interception over a
// US / military air base reads Military, never civil Aviation.
export const MILITARY_SIG =
  /\b(air[\s-]?base|airbase|military (?:base|site|installation|facilit|camp|target)|us (?:forces|base|bases|troops|military|warship|warships|command)|u\.s\.? ?(?:forces|base|bases|troops|military)|american (?:base|forces|warship)|fifth fleet|5th fleet|naval base|navy base|army base|barrack|garrison|prince sultan|muwaffaq salti|al[\s-]?udeid|al[\s-]?dhafra|arifjan|ali al salem|centcom|central command|command (?:cent(?:er|re)|ship|post|hub)|radar (?:site|station)|defen[cs]e site|\btroops|\binstallation)/i;

export const OILGAS_SIG =
  /\b(oil ?field|oil facilit|oil storage|oil depot|oil hub|oil refiner|oil installation|refiner|petrochem|\bcrude|gas field|gas plant|gas complex|gas pipeline|pipeline|aramco|adnoc|samref|habshan|mina al[\s-]?ahmadi|mina abdullah|ruwais|kharg|fuel depot|fuel storage|\blng\b|energy facilit|energy infrastructure)/i;

export const POWER_SIG =
  /\b(power plant|power station|power grid|\bgrid\b|electric|substation|nuclear|reactor|barakah)/i;

export const VESSEL_SIG =
  /\b(oil tanker|\btanker|\bvessel|cargo ship|container ship|merchant ship|merchant vessel|warship|\bfrigate|destroyer|naval vessel|command ship|bulk carrier|freighter|crude carrier|ship (?:hit|struck|attacked|sunk|sinks|sank|sinking)|tanker (?:hit|struck|attacked))/i;

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

/**
 * Canonical strike target category from a text blob. Order is precedence:
 * military beats energy beats vessel beats aviation beats port beats government
 * beats civilian. Used by the ingest classifier to write target_category.
 */
export function classifyStrikeTarget(t: string): StrikeTargetCategory {
  if (MILITARY_SIG.test(t)) return "military_site";
  if (OILGAS_SIG.test(t) || POWER_SIG.test(t)) return "energy_infrastructure";
  if (VESSEL_SIG.test(t)) return "vessel";
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
  if (MILITARY_SIG.test(t)) return "military";
  if (PORT_SIG.test(t)) return "port";
  if (GOVT_SIG.test(t)) return "government";
  if (CIVIL_RESIDENTIAL_SIG.test(t)) return "civilian_residential";
  return "unknown";
}
