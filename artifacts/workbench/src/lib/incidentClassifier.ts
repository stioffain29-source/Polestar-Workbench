// Shared incident-type classifier used by every report builder.
//
// Reports must describe WHAT HAPPENED, not which product bucket the record
// came from. Topic/product names (Cargo Watch, Flashpoint, Shipping, Fuel,
// Fertiliser, Energy, Protests) are for filtering, routing and report family
// selection only — never as incident-type labels.
//
// Inputs are derived from the title, summary, source text, location and the
// existing topic (used only as a routing hint, never as a label).

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
function classifyCargo(t: string): string {
  if (/\btruck.*hijack|hijack.*truck|convoy hijack|lorry hijack\b/.test(t)) return "Truck hijack";
  if (/\bhijack\b/.test(t)) return "Truck hijack";
  if (/\bwarehouse (theft|raid|break)/.test(t)) return "Warehouse theft";
  if (/\bdepot (theft|raid|break)/.test(t)) return "Depot theft";
  if (/\bcontainer (theft|stolen|raid)/.test(t)) return "Container theft";
  if (/\bpilferage|pilfer\b/.test(t)) return "Cargo pilferage";
  if (/\bseal tamper|broken seal|seal break/.test(t)) return "Seal tampering";
  if (/\binsider/.test(t)) return "Insider-enabled theft";
  if (/\bcargo theft|stolen cargo|cargo (loss|stolen)/.test(t)) return "Cargo theft / loss";
  if (/\blogistics crime\b/.test(t)) return "Logistics crime";
  return "Other cargo incident";
}

// Shipping bucket -----------------------------------------------------------
function classifyShipping(t: string): string {
  if (/\bvessel seiz|seizure of (a |the )?(vessel|tanker|ship)|seized (vessel|tanker|ship)/.test(t)) return "Vessel seizure";
  if (/\bvessel attack|attack on (a |the )?(vessel|tanker|ship)|missile.*(vessel|tanker|ship)|drone.*(vessel|tanker|ship)|boarding/.test(t)) return "Vessel attack";
  if (/\bnear miss\b/.test(t)) return "Near miss";
  if (/\bport (strike|congestion|disruption|closure|shutdown)|berth congestion/.test(t)) return "Port disruption";
  if (/\bchokepoint|strait of hormuz|bab[- ]el[- ]mandeb|suez/.test(t)) return "Chokepoint risk";
  if (/\b(diversion|reroute|re-route|reroutes)\b/.test(t)) return "Route diversion";
  if (/\b(advisory|warning|alert|notice to mariners)\b/.test(t)) return "Naval / maritime advisory";
  if (/\b(insurance|freight rate|war risk|premium)\b/.test(t)) return "Insurance / freight pressure";
  return "Other maritime incident";
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
  if (/\b(protest|demonstration|blockade)\b/.test(t)) return "Fuel protest";
  if (/\bsupply (interruption|disruption|cut|halt)\b/.test(t)) return "Supply interruption";
  return "Other fuel incident";
}

// Fertiliser ---------------------------------------------------------------
function classifyFertiliser(t: string): string {
  if (/\bshortage|stockout\b/.test(t)) return "Fertiliser shortage";
  if (/\bprice (increase|hike|rise|rises|jump|surge)/.test(t)) return "Price increase";
  if (/\bexport (restrict|ban|curb|quota)/.test(t)) return "Export restriction";
  if (/\bimport (disruption|delay|block)/.test(t)) return "Import disruption";
  if (/\bproduction (disruption|halt|cut|outage)/.test(t)) return "Production disruption";
  if (/\bfarmer.{0,15}protest|farmers protest/.test(t)) return "Farmer protest";
  if (/\bsupply chain|logistics/.test(t)) return "Supply chain disruption";
  return "Other fertiliser incident";
}

// Energy / Grid ------------------------------------------------------------
function classifyEnergy(t: string): string {
  if (/\b(blackout|power outage|outage|power cut)\b/.test(t)) return "Power outage";
  if (/\bload[ -]shedd/.test(t)) return "Load shedding";
  if (/\bgrid (failure|disruption|collapse|trip|fault)\b/.test(t)) return "Grid disruption";
  if (/\bsubstation\b/.test(t)) return "Substation incident";
  if (/\b(generation shortfall|capacity shortfall|under[ -]capacity)\b/.test(t)) return "Generation shortfall";
  if (/\b(transmission|pipeline|energy infrastructure)\b/.test(t)) return "Energy infrastructure incident";
  if (/\b(fuel.*power|gas.*power|diesel.*power)\b/.test(t)) return "Fuel-to-power disruption";
  return "Other energy incident";
}

// Protests / unrest / flashpoint / PNG country -----------------------------
function classifyUnrest(t: string): string {
  if (/\b(tribal|tribesmen|clan (fight|clash))/.test(t)) return "Tribal violence";
  if (/\barmed robbery|armed gang|hold[- ]?up|robbery at gunpoint/.test(t)) return "Armed robbery";
  if (/\briot|public disorder|looting\b/.test(t)) return "Riot / public disorder";
  if (/\b(strike|labour action|industrial action|walkout|stoppage)\b/.test(t)) return "Strike / labour action";
  if (/\b(protest|demonstration|rally|march)\b/.test(t)) return "Protest";
  if (/\b(militant|insurgent|armed group|rebel)\b/.test(t)) return "Armed group activity";
  if (/\b(police operation|security force|military operation|raid|crackdown)\b/.test(t)) return "Security force operation";
  if (/\b(roadblock|road block|highway block|access (block|denied|disrupt))\b/.test(t)) return "Roadblock / access disruption";
  if (/\b(airport (clos|disrupt|access)|port access|terminal closure)\b/.test(t)) return "Airport / port access issue";
  if (/\bmining (disruption|halt|protest)|contractor (attacked|disruption)/.test(t)) return "Mining / contractor disruption";
  if (/\b(election|political (unrest|violence)|government|coup)\b/.test(t)) return "Political unrest";
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
      return classifyCargo(t);
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
    case "protests":
    case "flashpoint":
      return classifyUnrest(t);
    default:
      // Country reports and any other view: dispatch by keyword.
      if (/\b(missile|drone|rocket|projectile|interception)\b/.test(t)) return classifyStrike(t);
      if (/\b(vessel|tanker|maritime|chokepoint|port )\b/.test(t)) return classifyShipping(t);
      if (/\b(hijack|warehouse|depot|container|pilferage|cargo)\b/.test(t)) return classifyCargo(t);
      if (/\bfuel|petrol|diesel|refinery\b/.test(t)) return classifyFuel(t);
      if (/\bfertili[sz]er|urea|potash|dap\b/.test(t)) return classifyFertiliser(t);
      if (/\b(power|grid|blackout|load shedd|substation)\b/.test(t)) return classifyEnergy(t);
      if (/\b(protest|riot|strike|militant|tribal|robbery|roadblock|election|unrest)\b/.test(t)) return classifyUnrest(t);
      return FALLBACK;
  }
}

export const INCIDENT_TYPE_FALLBACK = FALLBACK;
