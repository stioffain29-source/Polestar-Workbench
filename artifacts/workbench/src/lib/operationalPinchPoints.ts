// ---------------------------------------------------------------------------
// Operational-map impact-level model (GLOBAL country-report standard).
//
// Country-report maps are REPORTING-DRIVEN, not standing: a location is only
// mapped when the current reporting window carries a specific operationally
// relevant event there. This module is the single source of truth for the
// impact-level rating, its colours, the deterministic "business relevance" label
// and the fixed map wording, shared by BOTH render paths in CountryReportMap.tsx
// (the configured-zone mode and the per-coordinate dot mode) so the two never
// drift. It is pure/deterministic (no React, no Leaflet) and unit-tested.
// ---------------------------------------------------------------------------

export type ImpactLevel = "Direct impact" | "Possible impact" | "Monitor only";

export const IMPACT_ORDER: ImpactLevel[] = ["Direct impact", "Possible impact", "Monitor only"];

// Brand-safe impact-level palette. Midnight Blue and Electric Blue are the two
// brand accents; "Monitor only" uses a neutral mid-grey. The reserved tiers
// (petrol #1B6B7A = Insignificant, subdued red #A33232 = Extreme) are NEVER
// reused here, so an impact level can never be confused with a severity chip.
export const IMPACT_COLOR: Record<ImpactLevel, string> = {
  "Direct impact": "#0B0B3D",
  "Possible impact": "#4655FF",
  "Monitor only": "#6B7280",
};

export const SEV_RANK: Record<string, number> = {
  extreme: 5,
  high: 4,
  moderate: 3,
  low: 2,
  insignificant: 1,
};

// Highest severity present in a set of incidents, as a lower-case key ("" when
// the set is empty). Mirrors the zone/dot aggregation so the impact level reads
// the same worst-severity signal everywhere.
export function worstSeverityKey(incidents: Array<{ severity?: string }>): string {
  let key = "";
  let rank = 0;
  for (const i of incidents) {
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > rank) {
      rank = r;
      key = k;
    }
  }
  return key;
}

// Numeric ordering of the three impact levels (Direct highest). Used to pick the
// level that DRIVES a mapped area — the highest-impact reported event there wins,
// so the card's headline, business relevance and impact level all describe the
// same event.
export const IMPACT_RANK: Record<ImpactLevel, number> = {
  "Direct impact": 3,
  "Possible impact": 2,
  "Monitor only": 1,
};

// ---------------------------------------------------------------------------
// CONTENT-DRIVEN impact classification (the owner's rule).
//
// Impact level is read from the reporting's OWN WORDS — the actual operational
// or commercial effect described — NOT from record count or severity. A murder,
// arrest, drug raid, shooting or isolated crime is NEVER "Direct impact" unless
// the reporting states a concrete operational effect on business activity.
//
//  - DIRECT IMPACT  : reporting shows a current operational effect — road/access
//                     closure, protest blocking access, port/airport/warehouse/
//                     factory/site disruption, utility outage, fire/explosion at
//                     a commercial/industrial/logistics site, labour action
//                     halting production/transport, regulatory enforcement
//                     hitting operations, or a security incident directly hitting
//                     a business site, staff, delivery route or transport
//                     corridor. Confirmed disruption to logistics/production/
//                     warehousing/delivery/staff movement.
//  - POSSIBLE IMPACT: relevant but INDIRECT — protest/unrest/clash/security
//                     activity near an operating area with no confirmed
//                     disruption, or a hazard that could affect a site if
//                     operating nearby. Crime or security activity with no
//                     business interruption reported.
//  - MONITOR ONLY   : isolated crime, policing or political activity with no
//                     clear business consequence and no confirmed movement,
//                     access, site, logistics, utility or continuity impact.
// ---------------------------------------------------------------------------
interface RelevanceInput {
  topic?: string;
  title?: string;
  displayTitle?: string | null;
}

function normText(i: RelevanceInput): string {
  return `${(i.displayTitle ?? "").trim()} ${i.title ?? ""}`.toLowerCase().replace(/\s+/g, " ");
}

// Confirmed operational effect — the ONLY route to "Direct impact". Each pattern
// binds a disruption verb to a route, site, utility or transport noun so a bare
// crime headline can never reach Direct.
const DIRECT_SIGNALS: RegExp[] = [
  // Road / route / access closed, blocked, sealed, gridlocked.
  /\b(road|roads|highway|highways|toll|expressway|street|streets|bridge|route|lane|junction|access|border crossing|checkpoint)\b[^.]{0,45}\b(clos|block|shut|seal|barricad|cordon|cut off|gridlock|standstill|paralys)/,
  /\b(clos|block|shut|seal|barricad|cordon|occupy|occupied)\w*\b[^.]{0,20}\b(road|roads|highway|toll|street|bridge|route|access|gate|entrance|port|airport|terminal|railway|border)\b/,
  // Transport / operations halted, suspended, cancelled, grounded, delayed.
  /\b(halt|suspend|cancel|ground|disrupt|paralys|cripple|stopp|stall|delay)\w*\b[^.]{0,30}\b(flight|flights|train|trains|rail|railway|operation|operations|production|output|shipping|service|services|transport|port|ports|ferry|logistic|traffic|export|import)/,
  /\b(flight|flights|train|trains|rail|railway|operation|operations|production|output|shipping|service|services|transport|port|ports|ferry|logistic|traffic)\b[^.]{0,30}\b(halt|suspend|cancel|ground|disrupt|paralys|cripple|stopp|standstill|gridlock|stall|shut|grind)/,
  // Named site disrupted / shut / attacked / evacuated / on fire.
  /\b(port|ports|airport|terminal|warehouse|factory|factories|refiner|plant|smelter|mine|mines|depot|pipeline|dock|facility|facilities|complex|estate|mill)\w*\b[^.]{0,45}\b(clos|shut|halt|suspend|disrupt|evacuat|damag|attack|paralys|offline|stoppage|blockad|seiz|blaze|fire|explos|blast|razed|gutted|stormed)/,
  // Utility outage affecting operations.
  /\b(power\s*(cut|outage|failure|blackout)|blackout|electricity\s*(cut|outage|down)|grid\s*(fail|down|collaps)|water\s*(supply\s*)?(cut|disrupt|shortage|crisis)|fuel\s*shortage)\w*/,
  // Fire / explosion at a commercial, industrial or logistics site.
  /\b(fire|blaze|wildfire|explos|blast|detonat)\w*\b[^.]{0,45}\b(factory|factories|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)/,
  /\b(factory|factories|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)\b[^.]{0,25}\b(fire|blaze|caught fire|on fire|explos|blast|razed|gutted|burn)/,
  // Labour action disrupting production / transport / a site.
  /\b(strike|strikes|striking|walkout|walk-?out|work stoppage|industrial action|mogok|downed tools)\b[^.]{0,45}\b(halt|disrupt|paralys|cripple|shut|stopp|suspend|hit|ground|stall|output|production|port|transport|factory|operation)/,
  // Protest / blockade explicitly blocking a road, port, access or traffic.
  /\b(protest|demonstrat|rally|blockad|barricad|picket|occup|sit-?in)\w*\b[^.]{0,45}\b(block|clos|shut|barricad|seal|paralys|gridlock|halt|occup|storm)\w*\b[^.]{0,20}\b(road|roads|highway|toll|street|port|airport|access|gate|entrance|traffic|route|railway|office|building)/,
  // Evacuation, curfew, lockdown, emergency restricting movement/operations.
  /\b(evacuat|curfew|lockdown|state of emergency)\w*/,
  // Explicit disruption to business, logistics, movement, supply or trade.
  /\b(disrupt|paralys|cripple|stoppage|standstill|shut down|shutdown)\w*\b[^.]{0,30}\b(operation|business|logistic|suppl|transport|movement|traffic|production|commerce|trade|deliver|distribution|econom)/,
];

// Unrest / collective action — relevant to movement and access → Possible.
const UNREST_SIGNALS =
  /\b(protest|demonstrat|rally|rallies|riot|unrest|clash|blockad|barricad|mob|brawl|melee|communal|sectarian|walkout|strike|mogok|picket|uprising|turmoil|standoff|stand-?off|occupation|occupy)\b/;

// Broader security activity (armed groups, militancy, military/security forces,
// bombs) — relevant to staff safety/movement → Possible. Deliberately excludes
// bare "shoot/shooting" so an "arrested shooting suspect" reads as isolated crime.
const SECURITY_SIGNALS =
  /\b(militant|insurgent|separatist|rebel|terrorist|terrorism|extremis|guerrilla|armed group|armed men|gunmen|gunman|ambush|militia|jihad|bomb|bombing|ied|grenade|explos|blast|firefight|shoot-?out|gun\s?battle|opened fire|troops|soldier|military operation|security operation|security forces|armed forces|counter-?terror|air\s?strike|airstrike|air raid|drone strike|missile|kkb|opm|tpnpb)\b/;

// Isolated crime / policing — no business consequence on its own → Monitor.
const CRIME_SIGNALS =
  /\b(murder|homicide|manslaughter|slain|slay|stab|slash|body found|found dead|corpse|dismember|beheaded|shoot|shot|gunned|gunfire|firing|drug|narcotic|meth|cannabis|marijuana|cocaine|heroin|ganja|sabu|smuggl|traffick|robber|robbed|theft|thief|thieves|steal|stole|stolen|burglar|looting|pickpocket|fraud|scam|embezzl|corrupt|bribe|graft|launder|rape|rapist|molest|assault|kidnap|abduct|extort|ransom|arrest|detain|nab|apprehend|suspect|manhunt|fugitive|raid|bust|seiz|gambl|poach|domestic violence|human traffick|paedophile|pedophile)\b/;

// Natural hazards — real but indirect operational relevance → Possible.
const HAZARD_SIGNALS =
  /\b(flood|banjir|earthquake|quake|gempa|tremor|tsunami|storm|typhoon|cyclone|hurricane|landslide|longsor|volcan|erupt|lahar|drought|wildfire|bushfire|heat\s?wave|disaster|bencana|haze)\b/;

// Classify ONE reported event's impact level from its own words.
export function impactForIncident(i: RelevanceInput): ImpactLevel {
  const text = normText(i);
  if (DIRECT_SIGNALS.some((re) => re.test(text))) return "Direct impact";
  const unrestOrSecurity = UNREST_SIGNALS.test(text) || SECURITY_SIGNALS.test(text);
  // Isolated crime/policing with no unrest or security dimension → Monitor only.
  if (!unrestOrSecurity && CRIME_SIGNALS.test(text)) return "Monitor only";
  if (unrestOrSecurity) return "Possible impact";
  if (HAZARD_SIGNALS.test(text)) return "Possible impact";
  // Relevant but neither disruptive, unrest/security, crime nor hazard:
  // conservative default — never inflate into a business impact.
  return "Monitor only";
}

// The impact level for a mapped AREA is the level of its highest-impact reported
// event (the one that leads the card).
export function impactLevelForSet(incidents: RelevanceInput[]): ImpactLevel {
  let best: ImpactLevel = "Monitor only";
  for (const i of incidents) {
    const lvl = impactForIncident(i);
    if (lvl === "Direct impact") return "Direct impact";
    if (IMPACT_RANK[lvl] > IMPACT_RANK[best]) best = lvl;
  }
  return best;
}

// Practical, non-inflated "business relevance" wording that MATCHES the reported
// event and its classified impact. It never labels a crime a business impact and
// never asserts regulatory/compliance exposure unless the effect is regulatory.
const REL_UTILITY = /\b(power|blackout|electricity|grid|water supply|outage|fuel shortage)\b/;
const REL_SITE_FIRE =
  /\b(fire|blaze|explos|blast|detonat)\w*\b[^.]{0,45}\b(factory|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)|\b(factory|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)\b[^.]{0,25}\b(fire|blaze|explos|blast|burn|razed|gutted)/;
const REL_LABOUR = /\b(strike|strikes|striking|walkout|walk-?out|mogok|industrial action|work stoppage)\b/;
const REL_TRANSPORT =
  /\b(flight|flights|train|trains|rail|railway|port|ports|airport|shipping|ferry|logistic|freight|cargo|terminal|export|import)\b/;
const REL_MOVEMENT =
  /\b(road|roads|highway|toll|street|bridge|traffic|route|access|blockad|barricad|curfew|lockdown|evacuat)\b/;
const REL_PROTEST = /\b(protest|demonstrat|rally|rallies|blockad|barricad|picket|strike|walkout|mogok)\b/;
const REL_VIOLENT =
  /\b(shoot|shot|gunned|gunfire|armed|violent|clash|assault|attack|murder|kill|stab|slash|bomb)\w*/;

export function businessRelevance(i: RelevanceInput, impact: ImpactLevel): string {
  const text = normText(i);
  if (impact === "Direct impact") {
    if (REL_UTILITY.test(text)) return "Confirmed utility outage affecting operations";
    if (REL_SITE_FIRE.test(text)) return "Site, asset and business-continuity disruption";
    if (REL_LABOUR.test(text)) return "Confirmed disruption to production or operations";
    if (REL_TRANSPORT.test(text)) return "Confirmed transport and logistics disruption";
    if (REL_MOVEMENT.test(text)) return "Confirmed movement and access disruption";
    return "Confirmed operational disruption";
  }
  if (impact === "Possible impact") {
    if (REL_PROTEST.test(text)) return "Possible movement disruption near protest area";
    if (UNREST_SIGNALS.test(text) || SECURITY_SIGNALS.test(text))
      return "Possible staff movement concern if operating nearby";
    if (HAZARD_SIGNALS.test(text)) return "Possible site or utility disruption if operating nearby";
    return "Monitor for escalation or repeat activity";
  }
  // Monitor only — isolated crime/policing. Security-flavoured crime warrants a
  // security-awareness note; property/financial crime has no commercial impact.
  if (REL_VIOLENT.test(text)) return "Local security awareness only";
  return "No reported commercial impact";
}

// Fixed map wording (owner brief, verbatim). Any "risk map" language is
// replaced by these across every country report.
export const OPERATIONAL_MAP_HEADING = "Operational Map";
export const OPERATIONAL_MAP_SUBTITLE = "Reported operational issues this period";
export const OPERATIONAL_MAP_READ =
  "This map shows reported operationally relevant issues for the current reporting period. " +
  "Not every security or crime incident creates commercial impact. " +
  "Direct impact is used only where reporting indicates a current effect on movement, access, sites, logistics, utilities, production or business continuity. " +
  "Isolated crime and policing incidents are normally Monitor only unless they affect operations directly.";
