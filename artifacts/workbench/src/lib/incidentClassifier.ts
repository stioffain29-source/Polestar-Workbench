// Shared incident-type classifier used by every report builder.
//
// Reports must describe WHAT HAPPENED, not which product bucket the record
// came from. Topic/product names (Cargo Watch, Flashpoint, Shipping, Fuel,
// Fertiliser, Energy, Protests) are for filtering, routing and report family
// selection only — never as incident-type labels.
//
// Inputs are derived from the title, summary, source text, location and the
// existing topic (used only as a routing hint, never as a label).

import { classifyConflictCategory } from "./conflictAnalysis";
import { classifyCargoCategory, CARGO_FLOOR_LABEL, CARGO_NOT_RELEVANT } from "./cargoAnalysis";

export interface ClassifiableIncident {
  topic: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

function blob(i: ClassifiableIncident): string {
  return [
    i.title ?? "",
    i.summary ?? "",
    i.source ?? "",
    (i.sourceUrl ?? "").replace(/[-_/]/g, " "),
    i.location ?? "",
  ].join(" ").toLowerCase();
}

const FALLBACK = "Other operational incident";

// Cargo bucket --------------------------------------------------------------
// Delegates to the single 30-category Cargo Watch taxonomy authority
// (classifyCargoCategory) so reports, the monitor and country views all read
// IDENTICAL brand-safe labels. Title + summary only — never the source /
// masthead, which would leak feed words into the label. The "Not relevant"
// sentinel (no cargo signal at all) folds into the cargo floor here.
function classifyCargo(i: ClassifiableIncident): string {
  const c = classifyCargoCategory({ title: i.title, summary: i.summary });
  return c === CARGO_NOT_RELEVANT ? CARGO_FLOOR_LABEL : c;
}

// Shipping bucket -----------------------------------------------------------
// Vocabulary mirrors the Shipping page issue chart so reports and the
// dashboard never disagree. "Unclassified maritime record" is reserved for
// records where no other rule fits.
//
// Order matters. Piracy / armed robbery is evaluated BEFORE seizure and
// attack so a Somali-pirate boarding does not get mislabelled as a state
// seizure. Near-miss records fold into Vessel attack so the issue chart
// stays at the ten-label vocabulary the dashboard now publishes.
function classifyShipping(t: string): string {
  if (/\b(piracy|pirat(e|es)|armed robbery (against|at sea|on board|in port|at anchorage)|robbery (against|at sea) (a |the )?(ship|vessel|tanker)|robbery on board|attempted boarding|boarded by (pirates|robbers|armed (men|gang|gunmen))|pirates? boarded|robbers? boarded|armed (men|gang|gunmen) boarded|suspicious approach|small craft approach|approached by (a )?skiffs?|skiff (sighted|approach)|crew (kidnap|abduct|held hostage|taken hostage)|theft from vessel|petty theft .{0,15}(anchorage|vessel|ship)|theft .{0,15}anchorage)\b/.test(t)) return "Piracy / armed robbery";
  if (/\b(vessel seiz|ship seiz|tanker seiz|seized .{0,30}(ship|tanker|vessel|dhow|carrier|cargo)|seizure of .{0,20}(ship|tanker|vessel|dhow|carrier)|hijack(ed)?|commandeered|detained .{0,20}(vessel|tanker|ship|crew|cargo)|stopped in iranian waters|bulk carrier stopped|us[- ]seized vessels?|iran seized|seized two .{0,20}ships?|seized .{0,5}foreign|forced (sale|transfer))\b/.test(t)) return "Vessel seizure";
  if (/\b(vessel attack|tanker attack|ship attack|attack(ed|s)? .{0,30}(ship|tanker|vessel|carrier|dhow|cargo|bulk carrier|container ship)|attack(ed)? by (multiple )?(small (craft|boats?)|skiffs?|iranian)|attack on (a |the )?(ship|tanker|vessel|carrier|dhow|cargo|hmm)|missile .{0,20}(ship|tanker|vessel|carrier|hmm|cargo)|drone .{0,20}(ship|tanker|vessel|carrier|cargo)|fired (upon|at|on)|fired on by|tanker (fired upon|hit|struck|set ablaze|ablaze|on fire)|(ship|vessel|carrier|cargo ship|bulk carrier|container ship|tanker) .{0,20}(hit|struck|set ablaze|ablaze|on fire|catches fire|caught fire|attacked|ablaze)|hit by (gunfire|projectile|projectiles|unknown projectile|unknown projectiles|small craft)|three (vessels|ships|container ships) (hit|targeted|attacked)|gunfire (hit|near|in|in strait)|fire (aboard|on board|aboard a|aboard the|breaks out on|happened at|extinguished on)|fire breaks out on .{0,20}vessels?|external strike|came under fire|comes under fire|targeted by .{0,30}(vessel|ship|iranian|missile|drone)|skiff attack|houthi attack|iranian (attack|strike|vessel)|repel(led)? drone|targeted .{0,20}iranian|ship attack debris|attack debris|near miss|warning shot|narrowly (missed|avoided)|missile (fell|landed) near|drone (fell|landed) near|intercepted near|missile alert)\b/.test(t)) return "Vessel attack";
  if (/\b(ukmto (reports?|warns?|warning|advisory|alert|issues warning|says)|ukmto:|naval (advisory|patrol|escort|operation|protection)|coast guard advisory|imo advisory|maritime (warning|advisory|alert|security (crisis|threat))|nav warning|notice to mariners|navy (assists|monitors)|under (u\.s\.|us|american) (military )?(protection|escort)|project freedom|operation freedom|us warship escort|escort (foreign|mission)|escorted to|escorted by|pentagon statement|force protection)\b/.test(t)) return "Maritime advisory";
  if (/\b(chokepoint|strait of hormuz|hormuz strait|bab[- ]el[- ]mandeb|suez canal|panama canal|malacca|lombok strait|singapore strait|gibraltar|transit risk|transit volume|tanker traffic|patrol zones?|red sea (route|risk|transit)|gulf of oman|persian gulf|arabian gulf|hormuz (closure|transit|risk|exit|won't go back|shut)|clears strait)\b/.test(t)) return "Chokepoint risk";
  if (/\b(diversion|reroute|re-route|reroutes|diverted|cape of good hope|avoiding (hormuz|red sea|gulf|strait)|vessel delay|transit delay|schedule disruption|shipping delay|delivery delay|adrift|collision|grounded|crew (repatriated|safe|evacuated|stranded)|vessel (stranded|passed through|relocate|repositioning)|first .{0,30}transits?|traffic shifts? away|ghost tanker|bypassed .{0,20}sanctions|slipped past|moving .{0,20}barrels|ship-to-ship transfers?|sanctions enforcement|sanctions dragnet|sanctions threats?|breaks through sanctions)\b/.test(t)) return "Route diversion";
  if (/\b(port (strike|congestion|disruption|closure|shutdown|halted|suspended)|berth (congestion|closure|delay)|terminal (closed|shut|congestion)|dock(workers?| strike)|stevedore strike|harbou?r (closure|disruption)|canal congestion|maintenance work .{0,20}(canal|port)|port of darwin|port incident|incident at .{0,20}port)\b/.test(t)) return "Port disruption";
  if (/\b(war risk (premium|insurance|zone)|insurance (premium|surcharge|cost)|freight rate|bunker surcharge|p&i club|hull premium|baltic (dry|exchange) index|world container index|new contex|container ship time charter|spot rate(s)?|charter rate|charter assessment|aframax prices|tanker prices|vlcc (market|prices?|freight)|vlgc (freight )?rates?|tankers?: vlcc|freight (rates? (rising|recovery|up|down|surge|soaring)|recovery|soaring)|rates soaring|shipping rates (have )?(shot up|rose|rising|surge)|cheap spot rates|peak season|ws[0-9]+|tce down|tce up|mediterranean\/east index)\b/.test(t)) return "Insurance / freight pressure";
  if (/\b(cargo (delay|disruption|halt|backlog|movement|flows?)|container (backlog|delay|handling)|supply chain disruption|liner service (suspension|cancell)|service suspension|sailing cancelled|blank sailing|export (halt|suspension)|import (halt|disruption)|market share|orderbook|newbuild|newbuilding|new entrant|charter (acquisition|deal|purchase|locks?|fix(ed|es)?)|locks first|fleet (acquisition|renewal|deal|strategy|exposure)|m&a|merger|joint venture|company of the year|banned from (australia|port)|unpaid crew wages|earnings|quarterly|annual report|first[- ]quarter|q1 (results?|performance)|volume growth|cooperation deal|logistics push|legal action|relocate headquarters|biomethanol|long[- ]term charter|long[- ]term deal|product tanker|crude carrier|vlcc (newbuild|owner|charter|trading|sanctions|supertanker))\b/.test(t)) return "Commercial shipping disruption";
  return "Unclassified maritime record";
}

// Strike trackers -----------------------------------------------------------
function classifyStrike(t: string): string {
  const onVessel = /\b(vessel|tanker|ship|maritime)\b/.test(t);
  if (/\bdrone\b/.test(t)) return "Drone attack";
  if (/\b(ballistic|cruise missile|missile strike|missile attack)\b/.test(t)) return "Missile attack";
  if (/\b(rocket|projectile|mortar)\b/.test(t)) return "Rocket / projectile attack";
  if (/\bintercept/.test(t)) return "Interception";
  if (onVessel) return "Vessel strike";
  if (/\b(refinery|airport|substation|oilfield|infrastructure|depot)\b/.test(t)) return "Land strike";
  if (/\bnear miss\b/.test(t)) return "Near miss";
  if (/\bseiz/.test(t)) return "Seizure";
  return "Other strike incident";
}

// Fuel ---------------------------------------------------------------------
function classifyFuel(t: string): string {
  if (/\bshortage|stockout|run(s|ning) out\b/.test(t)) return "Fuel shortage";
  if (/\bprice (increase|hike|rise|rises|jump|surge)/.test(t)) return "Fuel price increase";
  if (/\bdepot\b/.test(t)) return "Depot disruption";
  if (/\brefinery\b/.test(t)) return "Refinery disruption";
  if (/\b(transport|trucker|tanker truck|haulier)\b/.test(t)) return "Transport disruption";
  if (/\b(protest|demonstration|blockade)s?\b/.test(t)) return "Fuel protest";
  if (/\bsupply (interruption|disruption|cut|cuts|halt)\b/.test(t)) return "Supply interruption";
  return "Other fuel incident";
}

// Fertiliser ---------------------------------------------------------------
function classifyFertiliser(t: string): string {
  // Farmer-led action over inputs reads as the event itself, ahead of the
  // underlying shortage or price driver that triggered it.
  if (/\bfarmers?.{0,25}(protest|agitation|rally|march|blockade|stir|demonstrat)|protest.{0,25}(urea|fertili[sz]er|dap)/.test(t)) return "Farmer protest";
  if (/\bexport (restrict|ban|curb|quota|control)/.test(t)) return "Export restriction";
  if (/\b(shortage|stockout|scarcity|run(s|ning) out|unavailab|not available|deficit|crunch)\b/.test(t)) return "Fertiliser shortage";
  if (/\bsubsid/.test(t)) return "Subsidy pressure";
  if (/\bprices?\b.{0,15}(drop|fall|falls|fell|crash|crashes|ease|easing|decline|cool|cooling|lower|slump|tumble|down)\b|\b(relief|cheaper).{0,25}(urea|fertili[sz]er|farmer|price|import)/.test(t)) return "Price relief";
  if (/\bprices?\b.{0,15}(increase|hike|rise|rises|rising|jump|surge|soar|climb|higher|spike|up)\b|\b(cost|costs)\b.{0,15}(rise|rising|higher|surge|climb|jump|up|%)/.test(t)) return "Price increase";
  if (/\b(production|output)\b.{0,20}(disrupt|halt|cut|outage|hit|hits|reduce|shut|stoppage|squeeze)|\b(ammonia|urea|dap)\b.{0,15}(plant|unit|production)/.test(t)) return "Production disruption";
  if (/\bgas supply|feedstock|raw material/.test(t)) return "Feedstock supply";
  if (/\b(imports?|importing|procure|procurement|tender|secure .{0,20}supply|sourcing|deal for)\b/.test(t)) return "Fertiliser imports";
  if (/\bsupply (interruption|disruption|cut|halt|squeeze|chain|security)|logistics|distribution\b/.test(t)) return "Supply chain disruption";
  if (/\b(food (security|shortage|price)|crop|harvest|sowing|planting|yield|kharif|paddy)\b/.test(t)) return "Food security pressure";
  return "Other fertiliser incident";
}

// Energy / Grid ------------------------------------------------------------
// Plurals matter: "power cuts" / "power outages" are the common headline form,
// so every outage/cut token allows a trailing "s" — a missing one dumps real
// outage stories into the residual bucket and trips the "Data quality issue"
// Fast Fact. Power-outage and load-shedding lead because they are the dominant
// grid event; load shedding stays below outage so a story that reports an
// outage with a "load shedding reprieve" reads as the outage it is.
function classifyEnergy(t: string): string {
  if (/\b(blackouts?|power outages?|outages?|power cuts?|electricity (cut|cuts|outage|outages))\b/.test(t)) return "Power outage";
  if (/\bload[ -]shedd|(power|electricity|energy) rationing\b/.test(t)) return "Load shedding";
  if (/\bgrid (failures?|disruptions?|collapses?|trips?|faults?|overloads?|instabilities?)\b/.test(t)) return "Grid disruption";
  if (/\bsubstations?\b/.test(t)) return "Substation incident";
  if (/\b(generation shortfall|capacity shortfall|under[ -]capacity|supply shortfall|power shortage|electricity shortage)\b/.test(t)) return "Generation shortfall";
  if (/\b(transmission|pipeline|energy infrastructure|power (plants?|stations?|lines?))\b/.test(t)) return "Energy infrastructure incident";
  if (/\b(fuel.*power|gas.*power|diesel.*power|fuel supply|gas supply)\b/.test(t)) return "Fuel-to-power disruption";
  if (/\b(tariff|electricity price|power price|fixed charge|power bill|surcharge|levy)\b/.test(t)) return "Power tariff / pricing";
  return "Other energy incident";
}

// Data Centres --------------------------------------------------------------
function classifyDataCentre(t: string): string {
  if (/\b(outages?|down(?:time)?|offline|power (?:failure|cut|outage|loss)|blackouts?|shutdowns?|evacuat\w*)\b[^.]{0,40}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation|colo facilities?|cloud regions?)\b/.test(t)) return "DC outage / downtime";
  if (/\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation|colo facilities?|cloud regions?)\b[^.]{0,40}\b(outages?|down(?:time)?|offline|power (?:failure|cut|outage|loss)|blackouts?|shutdowns?|evacuat\w*)\b/.test(t)) return "DC outage / downtime";
  if (/\b(cooling (?:failures?|loss|issues?)|overheat(?:ing|ed)?|chiller)\b[^.]{0,30}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b/.test(t)) return "Cooling / power failure";
  if (/\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b[^.]{0,30}\b(cooling (?:failures?|loss|issues?)|overheat(?:ing|ed)?)\b/.test(t)) return "Cooling / power failure";
  if (/\b(cyberattacks?|ransomware|breaches?|hack(?:ed|ers?)?|sabotage)\b[^.]{0,30}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation|cloud regions?)\b/.test(t)) return "Cyber / security incident";
  if (/\b(planning (?:refused|rejected|denied|pending)|moratoriums?|permits? (?:refused|denied)|legal challenges?|scrapped?|halted|paused|suspended)\b[^.]{0,40}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b/.test(t)) return "Planning / permit risk";
  if (/\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b[^.]{0,40}\b(planning (?:refused|rejected|denied|pending)|moratoriums?|permits? (?:refused|denied)|legal challenges?|scrapped?|halted|paused|suspended)\b/.test(t)) return "Planning / permit risk";
  if (/\b(grid (?:connections?|access)|water (?:constraints?|shortages?|scarcity)|power constraints?)\b[^.]{0,40}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b/.test(t)) return "Grid / water constraint";
  if (/\b(community (?:opposition|objections?)|environmental (?:reviews?|objections?)|public protests?)\b[^.]{0,40}\b(data cent(?:re|er)s?|server farms?|hyperscale|colocation)\b/.test(t)) return "Community opposition";
  return "Other data centre incident";
}

// Protests / unrest / flashpoint / PNG country -----------------------------
// Order matters. Explicit political-protest markers (PTI, Imran Khan,
// Section 144, named rallies) pre-empt every other bucket so a story
// about a PTI rally in a tribal region is classified as Protest rather
// than Tribal violence because the summary happens to mention a tribal
// area. Sectoral and student-led actions are recognised explicitly so
// chemists / pharmacists / lawyers walkouts and university-led protests
// don't fall through to the generic strike or fallback bucket.
function classifyUnrest(t: string): string {
  // Kinetic armed-conflict short-circuit. "Drone strike", "missile strike",
  // "air strike", militant/insurgent attacks etc. must NEVER be routed
  // into a labour, protest or generic clash bucket on the strength of a
  // shared keyword. Only an explicit protest / public-order cue in the
  // same headline can override this.
  const kineticHit = /\b(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|airborne attack|artillery (strike|shelling|fire)|\bshelling\b|\bambush\b|\bied\b|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|fire|raid|strike)|insurgents? (kill|attack|target|ambush)|jihadist|terror(ist)? attack|armed group (attack|kill|raid))\b/.test(t);
  const protestCue = /\b(protest(?:s|ers?|ing)?|demonstrat(?:ion|ions|ors?)|rall(?:y|ies)|march(?:es)?|sit[- ]?ins?|riots?|public disorder|crackdowns?|curfews?|tear[- ]?gas|water cannon|rubber bullet|baton charge|student union|opposition (call|rally|march)|\bpti\b|imran khan|section\s*144|assembly ban|detention of (protesters|activists|students))\b/.test(t);
  if (kineticHit && !protestCue) return "Armed group activity";

  if (/\b(pti|imran khan|tehreek[- ]?e[- ]?insaf|section\s*144)\b/.test(t)) return "Protest";
  // "Tribhuvan University Teaching Hospital" is a hospital, not a campus —
  // neutralise institution-hospital compounds before testing the student cue
  // so a health-sector protest is not mislabelled Student activism.
  const tStudent = t.replace(/\b(university|college|campus)\s+(teaching\s+)?hospital\b/g, "hospital");
  if (/\b(university|college|campus|student union|student federation|students? (rally|march|protest|gather|stage|boycott))\b/.test(tStudent)) return "Student activism";
  if (/\b(sit[- ]?in|encampment|occupation of)\b/.test(t)) return "Sit-in";
  if (/\b(chemist|pharmacist|doctor|nurse|teacher|lawyer|trader|hauliers?|transporters?)s? (strike|walkout|stoppage|shutdown|boycott|protest|demonstrat|rally|march|sit[- ]?in)|sector(al)? (strike|shutdown|walkout|protest|demonstration)|shutter[- ]down|(chemists?|pharmacists?|lawyers?|traders?|transporters?|hauliers?) (associations?|councils?|federations?|unions?|chambers?) (call|announce|stage|hold|begin|launch)\b/.test(t)) return "Strike / labour action";
  if (/\b(strike|labour action|labor action|industrial action|walkout|stoppage|shutdown call)\b/.test(t)) return "Strike / labour action";
  // Plural and agent forms MUST match — "Deadly protests…" and "Protesters
  // gather…" were falling through to "Other operational incident", which
  // stranded High-severity rows outside every report section (owner-flagged
  // defect: Pakistan Kashmir protests missing from the protests report).
  if (/\b(protest(?:s|ers?|ing)?|demonstrat(?:ion|ions|ors?)|rall(?:y|ies)|march(?:es)?)\b/.test(t)) return "Protest";
  if (/\b(curfew|state of emergency|martial law|lockdown imposed)\b/.test(t)) return "Curfew / emergency order";
  if (/\b(crackdown|baton charge|tear[- ]?gas|water cannon|rubber bullet|mass arrest|detention of (protesters|activists|students))\b/.test(t)) return "Crackdown";
  if (/\b(clash|skirmish|brawl)\b/.test(t)) return "Clash";
  if (/\briot|public disorder|looting\b/.test(t)) return "Riot / public disorder";
  if (/\b(tribal|tribesmen|clan (fight|clash))\b/.test(t)) return "Tribal violence";
  if (/\barmed robbery|armed gang|hold[- ]?up|robbery at gunpoint/.test(t)) return "Armed robbery";
  if (/\b(police operation|security force|military operation|raid)\b/.test(t)) return "Security force operation";
  if (/\b(roadblock|road block|highway block|access (block|denied|disrupt))\b/.test(t)) return "Roadblock / access disruption";
  if (/\b(airport (clos|disrupt|access)|port access|terminal closure)\b/.test(t)) return "Airport / port access issue";
  if (/\bmining (disruption|halt|protest)|contractor (attacked|disruption)/.test(t)) return "Mining / contractor disruption";
  if (/\b(election|political (unrest|violence)|coup)\b/.test(t)) return "Political unrest";
  if (/\b(militant|insurgent|armed group|rebel)\b/.test(t)) return "Armed group activity";
  if (/\b(crime|theft|violence|assault|stabb|shoot)\b/.test(t)) return "Crime / public safety";
  return "Other operational incident";
}

/**
 * Derive the operational incident-type label for any incident.
 * Topic is used as a routing hint — never as a label.
 */
export function classifyIncidentType(i: ClassifiableIncident): string {
  const t = blob(i);
  switch (i.topic) {
    case "cargo_watch":
      return classifyCargo(i);
    case "shipping":
      return classifyShipping(t);
    case "strikes":
      return classifyStrike(t);
    case "fuel":
      return classifyFuel(t);
    case "fertiliser":
      return classifyFertiliser(t);
    case "energy":
    case "grid":
      return classifyEnergy(t);
    case "data_centres":
      return classifyDataCentre(t);
    case "conflict":
      // Conflict Watch owns its own kinetic vocabulary in conflictAnalysis —
      // the single source of truth shared with the monitor. Classify on the
      // headline + summary only (no source/url pollution) and return the
      // singular canonical category the monitor's incident table uses.
      return classifyConflictCategory({ title: i.title, summary: i.summary });
    case "protests":
    case "flashpoint":
      return classifyUnrest(t);
    default:
      // Country reports and any other view: dispatch by keyword.
      if (/\b(missile|drone|rocket|projectile|interception)\b/.test(t)) return classifyStrike(t);
      if (/\b(vessel|tanker|maritime|chokepoint|port )\b/.test(t)) return classifyShipping(t);
      if (/\b(hijack|warehouse|depot|container|pilferage|cargo)\b/.test(t)) return classifyCargo(i);
      if (/\bfuel|petrol|diesel|refinery\b/.test(t)) return classifyFuel(t);
      if (/\bfertili[sz]er|urea|potash|dap\b/.test(t)) return classifyFertiliser(t);
      if (/\b(power|grid|blackout|outages?|load shedd|substations?)\b/.test(t)) return classifyEnergy(t);
      if (/\b(data cent(?:re|er)s?|hyperscale|colocation|server farm)\b/.test(t)) return classifyDataCentre(t);
      if (/\b(protest|riot|strike|militant|tribal|robbery|roadblock|election|unrest)\b/.test(t)) return classifyUnrest(t);
      return FALLBACK;
  }
}

export const INCIDENT_TYPE_FALLBACK = FALLBACK;
