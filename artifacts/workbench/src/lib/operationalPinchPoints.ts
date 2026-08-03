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

export type ImpactLevel = "Direct impact" | "Indirect impact" | "Monitor only";

export const IMPACT_ORDER: ImpactLevel[] = ["Direct impact", "Indirect impact", "Monitor only"];

// Brand-safe impact-level palette. Midnight Blue and Electric Blue are the two
// brand accents; "Monitor only" uses a neutral mid-grey. The reserved tiers
// (petrol #1B6B7A = Insignificant, subdued red #A33232 = Extreme) are NEVER
// reused here, so an impact level can never be confused with a severity chip.
export const IMPACT_COLOR: Record<ImpactLevel, string> = {
  "Direct impact": "#0b0a3d",
  "Indirect impact": "#465bff",
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
  "Indirect impact": 2,
  "Monitor only": 1,
};

// ---------------------------------------------------------------------------
// CONTENT-DRIVEN impact classification (the owner's rule).
//
// Impact level is read from the reporting's OWN WORDS — the actual operational
// or commercial effect described — NOT from record count or severity, and NEVER
// merely because an event happened in a region where clients may operate. There
// must be a STATED operational consequence to reach Direct.
//
//  - DIRECT IMPACT   : reporting shows a current or confirmed effect on client
//                      operations, movement, access, site security, utilities,
//                      production, logistics, workforce safety or business
//                      continuity — a closed road/access, halted transport or
//                      production, a site shut/attacked/evacuated, an outage
//                      confirmed to hit operations, labour action stopping a
//                      site, or a protest/blockade physically closing a route.
//  - INDIRECT IMPACT : relevant to the operating environment but with NO
//                      confirmed effect on a client site, route, workforce,
//                      movement, production, access, utilities or logistics — a
//                      site fire or utility outage reported on its own,
//                      protest/unrest/security activity with no confirmed
//                      disruption, or a natural hazard.
//  - MONITOR ONLY    : background incidents, preparedness meetings, isolated
//                      local crime, political/legal developments, corruption
//                      investigations or general policing — unless a clear
//                      operational effect is reported.
// ---------------------------------------------------------------------------
interface RelevanceInput {
  topic?: string;
  title?: string;
  displayTitle?: string | null;
}

function normText(i: RelevanceInput): string {
  return `${(i.displayTitle ?? "").trim()} ${i.title ?? ""}`.toLowerCase().replace(/\s+/g, " ");
}

// A STATED current operational consequence — the ONLY route to "Direct impact".
// Each pattern binds a disruption verb to a route, site, utility or transport
// noun so a bare crime, a bare site fire or a bare outage can never reach Direct.
const HARD_DISRUPTION: RegExp[] = [
  // Road / route / access closed, blocked, sealed, gridlocked.
  /\b(road|roads|highway|highways|toll|expressway|street|streets|bridge|route|lane|junction|access|border crossing|checkpoint)\b[^.]{0,45}\b(clos|block|shut|seal|barricad|cordon|cut off|gridlock|standstill|paralys)/,
  /\b(clos|block|shut|seal|barricad|cordon|occupy|occupied)\w*\b[^.]{0,20}\b(road|roads|highway|toll|street|bridge|route|access|gate|entrance|port|airport|terminal|railway|border)\b/,
  // Transport / operations halted, suspended, cancelled, grounded, delayed.
  /\b(halt|suspend|cancel|ground|disrupt|paralys|cripple|stopp|stall|delay)\w*\b[^.]{0,30}\b(flight|flights|train|trains|rail|railway|operation|operations|production|output|shipping|service|services|transport|port|ports|ferry|logistic|traffic|export|import)/,
  /\b(flight|flights|train|trains|rail|railway|operation|operations|production|output|shipping|service|services|transport|port|ports|ferry|logistic|traffic)\b[^.]{0,30}\b(halt|suspend|cancel|ground|disrupt|paralys|cripple|stopp|standstill|gridlock|stall|shut|grind)/,
  // Named site shut / halted / disrupted / attacked / evacuated / seized. A bare
  // fire/explosion at the site is NOT here — that is SITE_HAZARD_SIGNALS (Indirect).
  /\b(port|ports|airport|terminal|warehouse|factory|factories|refiner|plant|smelter|mine|mines|depot|pipeline|dock|facility|facilities|complex|estate|mill)\w*\b[^.]{0,45}\b(clos|shut|halt|suspend|disrupt|evacuat|attack|paralys|offline|stoppage|blockad|seiz|stormed)/,
  // Labour action disrupting production / transport / a site.
  /\b(strike|strikes|striking|walkout|walk-?out|work stoppage|industrial action|mogok|downed tools)\b[^.]{0,45}\b(halt|disrupt|paralys|cripple|shut|stopp|suspend|hit|ground|stall|output|production|port|transport|factory|operation)/,
  // Protest / blockade explicitly blocking a road, port, access or traffic.
  /\b(protest|demonstrat|rally|blockad|barricad|picket|occup|sit-?in)\w*\b[^.]{0,45}\b(block|clos|shut|barricad|seal|paralys|gridlock|halt|occup|storm)\w*\b[^.]{0,20}\b(road|roads|highway|toll|street|port|airport|access|gate|entrance|traffic|route|railway|office|building)/,
  // Curfew, lockdown, emergency restricting movement/operations. A BARE
  // "evacuat" is deliberately NOT here: a named-site or route evacuation is
  // already caught by the site/route/transport patterns above (L106/L110/L114),
  // so a mass civilian evacuation carrying no site or route noun correctly
  // falls to Indirect under the stated-consequence rule and must not force
  // Direct on its own (it was over-escalating crime/meeting/medical rows).
  /\b(curfew|lockdown|state of emergency)\w*/,
  // Explicit disruption to business, logistics, movement, supply or trade.
  /\b(disrupt|paralys|cripple|stoppage|standstill|shut down|shutdown)\w*\b[^.]{0,30}\b(operation|business|logistic|suppl|transport|movement|traffic|production|commerce|trade|deliver|distribution|econom)/,
];

// Utility outage STATED to hit operations → Direct. A bare outage (no stated
// operational effect) is only Indirect (SITE_HAZARD_SIGNALS below).
const DIRECT_UTILITY_EFFECT: RegExp[] = [
  /\b(power\s*(cut|outage|failure|blackout)|blackout|electricity\s*(cut|outage|down|failure)|grid\s*(fail|down|collaps)|water\s*(supply\s*)?(cut|disrupt|shortage|crisis)|fuel\s*shortage)\w*\b[^.]{0,60}\b(crippl|paralys|halt|hit|forc|disrupt|shut|stopp|ground|operation|operations|production|output|factor|factories|plant|plants|industr|business|manufactur|port|ports|airport|refiner|hospital|logistic|mine|smelter)/,
  /\b(operation|operations|production|output|factor|factories|plant|plants|industr|business|manufactur|port|ports|airport|refiner|hospital|logistic|mine|smelter)\w*\b[^.]{0,40}\b(power\s*(cut|outage|failure|blackout)|blackout|grid\s*(fail|down|collaps)|electricity\s*(cut|outage|down))/,
];

// Site fire/explosion or utility outage reported as a bare event, with NO stated
// operational consequence → Indirect. It could affect operations if it is a
// client site or hits a route, but the reporting confirms no such effect.
const SITE_HAZARD_SIGNALS: RegExp[] = [
  /\b(fire|blaze|wildfire|explos|blast|detonat)\w*\b[^.]{0,45}\b(factory|factories|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)\b/,
  /\b(factory|factories|warehouse|plant|refiner|market|mall|terminal|port|depot|industrial|commercial|office|complex|building|store|shop|hotel|station|facility|estate|mill|godown)\b[^.]{0,25}\b(fire|blaze|caught fire|on fire|explos|blast|razed|gutted|burn)/,
  /\b(power\s*(cut|outage|failure|blackout)|blackout|\boutage\b|electricity\s*(cut|outage|down|failure)|grid\s*(fail|down|collaps)|water\s*(supply\s*)?(cut|disrupt|shortage|crisis)|fuel\s*shortage)\w*/,
];

// Background / administrative activity: preparedness meetings, drills, planning
// coordination, workshops and briefings. A MEETING about floods is not a flood,
// so these read Monitor only unless the SAME report states a current hard
// disruption. Deliberately excludes "planned/planning" so a planned protest is
// still read as unrest (Indirect), not demoted to background.
const BACKGROUND_CONTEXT =
  /\b(meeting|meetings|coordinat\w*|preparedness|readiness|contingency|drill|drills|simulation|rehearsal|workshop|seminar|forum|dialogue|deliberat\w*|socialis\w*|socializ\w*|briefing|rapat|sosialisasi|simulasi|kesiapsiagaan)\b/;

// Investigation / legal framing: corruption, graft, bribery, probes, audits and
// court process. A PROBE into power graft is not an outage, so this blocks the
// utility/effect route to Direct (a pure corruption item still falls to Monitor
// via the crime path). Does not, by itself, demote genuine unrest/security.
const INVESTIGATION_CONTEXT =
  /\b(corrupt\w*|graft|bribe\w*|embezzl\w*|kickback|probe|probes|investigat\w*|alleg\w*|audit|inquiry|inquiries|indict\w*|prosecut\w*|lawsuit|verdict|on trial|court\s+(hear|rul)|korupsi|suap|dugaan)\b/;

// Unrest / collective action — relevant to movement and access → Indirect.
const UNREST_SIGNALS =
  /\b(protest|demonstrat|rally|rallies|riot|unrest|clash|blockad|barricad|mob|brawl|melee|communal|sectarian|walkout|strike|mogok|picket|uprising|turmoil|standoff|stand-?off|occupation|occupy)\b/;

// Broader security activity (armed groups, militancy, military/security forces,
// bombs) — relevant to staff safety/movement → Indirect. Deliberately excludes
// bare "shoot/shooting" so an "arrested shooting suspect" reads as isolated crime.
const SECURITY_SIGNALS =
  /\b(militant|insurgent|separatist|rebel|terrorist|terrorism|extremis|guerrilla|armed group|armed men|gunmen|gunman|ambush|militia|jihad|bomb|bombing|ied|grenade|explos|blast|firefight|shoot-?out|gun\s?battle|opened fire|troops|soldier|military operation|security operation|security forces|armed forces|counter-?terror|air\s?strike|airstrike|air raid|drone strike|missile|kkb|opm|tpnpb)\b/;

// Isolated crime / policing — no business consequence on its own → Monitor.
const CRIME_SIGNALS =
  /\b(murder|homicide|manslaughter|slain|slay|stab|slash|body found|found dead|corpse|dismember|beheaded|shoot|shot|gunned|gunfire|firing|drug|narcotic|meth|cannabis|marijuana|cocaine|heroin|ganja|sabu|smuggl|traffick|robber|robbed|theft|thief|thieves|steal|stole|stolen|burglar|looting|pickpocket|fraud|scam|embezzl|corrupt|bribe|graft|launder|rape|rapist|molest|assault|kidnap|abduct|extort|ransom|arrest|detain|nab|apprehend|suspect|manhunt|fugitive|raid|bust|seiz|gambl|poach|domestic violence|human traffick|paedophile|pedophile)\b/;

// Natural hazards — real but indirect operational relevance → Indirect.
const HAZARD_SIGNALS =
  /\b(flood|banjir|earthquake|quake|gempa|tremor|tsunami|storm|typhoon|cyclone|hurricane|landslide|longsor|volcan|erupt|lahar|drought|wildfire|bushfire|heat\s?wave|disaster|bencana|haze)\b/;

// Classify ONE reported event's impact level from its own words.
export function impactForIncident(i: RelevanceInput): ImpactLevel {
  const text = normText(i);
  const hard = HARD_DISRUPTION.some((re) => re.test(text));

  // Pure background administrative activity (a meeting / drill / plan) with no
  // current hard disruption → Monitor only, even if it names a hazard or utility.
  if (!hard && BACKGROUND_CONTEXT.test(text)) return "Monitor only";

  // Confirmed current operational effect → Direct impact.
  if (hard) return "Direct impact";
  // Utility outage stated to hit operations → Direct — UNLESS it is only an
  // investigation/allegation about power (a probe is not a live outage).
  if (!INVESTIGATION_CONTEXT.test(text) && DIRECT_UTILITY_EFFECT.some((re) => re.test(text)))
    return "Direct impact";

  // Bare site fire/explosion or bare utility outage (incl. power named only in a
  // corruption probe) → Indirect: relevant environment, no confirmed client effect.
  if (SITE_HAZARD_SIGNALS.some((re) => re.test(text))) return "Indirect impact";

  const unrestOrSecurity = UNREST_SIGNALS.test(text) || SECURITY_SIGNALS.test(text);
  // Isolated crime/policing with no unrest or security dimension → Monitor only.
  if (!unrestOrSecurity && CRIME_SIGNALS.test(text)) return "Monitor only";
  if (unrestOrSecurity) return "Indirect impact";
  if (HAZARD_SIGNALS.test(text)) return "Indirect impact";
  // Relevant but neither disruptive, unrest/security, crime nor hazard:
  // conservative default — never inflate into a business impact.
  return "Monitor only";
}

/**
 * Owner rule: the operational map only shows incidents with genuine
 * monitoring value. An event qualifies when it carries any impact beyond
 * "Monitor only", or when — though Monitor-only — it is a real security /
 * crime / unrest / hazard event worth watching. A routine low-impact item
 * (e.g. a successful tugboat rescue) matches none of these and is not
 * plotted.
 */
export function hasMonitoringValue(i: RelevanceInput): boolean {
  if (impactForIncident(i) !== "Monitor only") return true;
  const text = normText(i);
  return (
    CRIME_SIGNALS.test(text) ||
    UNREST_SIGNALS.test(text) ||
    SECURITY_SIGNALS.test(text) ||
    HAZARD_SIGNALS.test(text)
  );
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
// event and its classified impact. It never labels a crime a business impact,
// never asserts regulatory/compliance exposure unless the effect is regulatory,
// and never uses alarmist language (e.g. "evacuated") the reporting does not.
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
  if (impact === "Indirect impact") {
    if (REL_PROTEST.test(text)) return "Possible movement disruption near protest area";
    if (UNREST_SIGNALS.test(text) || SECURITY_SIGNALS.test(text))
      return "Possible staff movement concern if operating nearby";
    if (REL_SITE_FIRE.test(text)) return "Possible site or asset disruption if operating nearby";
    if (REL_UTILITY.test(text)) return "Possible utility disruption if operating nearby";
    if (HAZARD_SIGNALS.test(text)) return "Possible site or utility disruption if operating nearby";
    return "Monitor for escalation or repeat activity";
  }
  // Monitor only — isolated crime/policing. Security-flavoured crime warrants a
  // security-awareness note; property/financial crime has no commercial impact.
  if (REL_VIOLENT.test(text)) return "Local security awareness only";
  return "No reported commercial impact";
}

// Fixed map wording (owner brief). Any "risk map" language is replaced by these
// across every country report.
export const OPERATIONAL_MAP_HEADING = "Operational Map";
export const OPERATIONAL_MAP_SUBTITLE = "Reported operational issues this period";
export const OPERATIONAL_MAP_READ =
  "This map shows reported operationally relevant issues for the current reporting period. " +
  "Not every security or crime incident creates commercial impact. " +
  "Direct impact is used only where reporting shows a current or confirmed effect on operations, movement, access, site security, utilities, production, logistics, workforce safety or business continuity. " +
  "Indirect impact marks issues relevant to the operating environment with no confirmed effect on a client site, route, workforce, movement, production, access, utilities or logistics. " +
  "Background incidents, preparedness meetings, isolated crime, political or legal developments, corruption investigations and general policing are Monitor only unless a clear operational effect is reported.";
