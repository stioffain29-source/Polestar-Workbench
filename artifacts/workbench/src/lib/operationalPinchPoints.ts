// ---------------------------------------------------------------------------
// Operational-map posture model (GLOBAL country-report standard).
//
// Country-report maps are REPORTING-DRIVEN, not standing: a location is only
// mapped when the current reporting window carries a specific operationally
// relevant event there. This module is the single source of truth for the
// posture rating, its colours, the deterministic "business relevance" label and
// the fixed map wording, shared by BOTH render paths in CountryReportMap.tsx
// (the configured-zone mode and the per-coordinate dot mode) so the two never
// drift. It is pure/deterministic (no React, no Leaflet) and unit-tested.
// ---------------------------------------------------------------------------

export type Posture = "Primary" | "Secondary" | "Watch";

export const POSTURE_ORDER: Posture[] = ["Primary", "Secondary", "Watch"];

// Brand-safe posture palette. Midnight Blue and Electric Blue are the two
// brand accents; Watch uses a neutral mid-grey. The reserved tiers
// (petrol #1B6B7A = Insignificant, subdued red #A33232 = Extreme) are NEVER
// reused here, so posture can never be confused with a severity chip.
export const POSTURE_COLOR: Record<Posture, string> = {
  Primary: "#0B0B3D",
  Secondary: "#4655FF",
  Watch: "#6B7280",
};

export const SEV_RANK: Record<string, number> = {
  extreme: 5,
  high: 4,
  moderate: 3,
  low: 2,
  insignificant: 1,
};

// Highest severity present in a set of incidents, as a lower-case key ("" when
// the set is empty). Mirrors the zone/dot aggregation so posture reads the same
// worst-severity signal everywhere.
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

// Posture from FREQUENCY + BUSINESS IMPACT (the owner's global rule):
//  - PRIMARY  : multiple relevant reports in one area (count >= 2), OR a single
//               event with clear direct business impact (worst severity
//               high/extreme).
//  - SECONDARY: a single report with plausible but limited impact (moderate).
//  - WATCH    : low-frequency, limited current impact (single low/insignificant),
//               mapped only because it is operationally relevant.
// count === 0 must never reach here (unmapped locations are dropped upstream);
// it is treated as Watch defensively.
export function postureFor(count: number, worstKey: string): Posture {
  const rank = SEV_RANK[(worstKey ?? "").toLowerCase()] ?? 0;
  if (count >= 2 || rank >= 4) return "Primary";
  if (rank === 3) return "Secondary";
  return "Watch";
}

// Deterministic OPERATIONAL read of a reported event — never a prediction and
// never a standing characterisation of the place. It answers "why does this
// reporting matter to business operations?" from the reported event's own words
// (headline first, topic as fallback). The owner's brief defines impact in
// exactly these operational terms (movement, site access, staff safety,
// logistics, utilities, regulatory compliance, continuity), so this is an
// interpretation of the reported item, not fabricated risk.
interface RelevanceInput {
  topic?: string;
  title?: string;
  displayTitle?: string | null;
}

const RELEVANCE_RULES: Array<{ re: RegExp; label: string }> = [
  {
    re: /\b(fire|blaze|wildfire|explos|blast|detonat)/i,
    label: "Site, asset and business-continuity exposure",
  },
  {
    re: /\b(flood|earthquake|quake|tsunami|storm|typhoon|cyclone|landslide|volcan|erupt|drought|hazard|disaster)/i,
    label: "Utilities and site-continuity disruption",
  },
  {
    re: /\b(attack|armed|clash|militant|insurgent|gunmen|gunman|shoot|bomb|ied|ambush|troops|soldier|air ?strike|drone|missile|offensive|firefight)/i,
    label: "Security and personnel-safety exposure",
  },
  {
    re: /\b(theft|thief|robber|kidnap|abduct|extortion|hijack|piracy|pirate|looting|burglar|carjack|smuggl)/i,
    label: "Staff-safety and security exposure",
  },
  {
    re: /\b(protest|demonstrat|rally|riot|unrest|blockade|barricade|walkout|strike action|workers strike|labour|union)/i,
    label: "Movement and site-access disruption",
  },
  {
    re: /\b(airport|flight|aviation|runway|rail|railway|train|port|harbour|harbor|shipping|vessel|cargo|freight|logistic|highway|road closure|traffic|toll)/i,
    label: "Logistics and movement disruption",
  },
  {
    re: /\b(outage|blackout|power cut|grid|refiner|pipeline|plant|smelter|shutdown)/i,
    label: "Operational continuity and supply disruption",
  },
  {
    re: /\b(regulat|police|court|arrest|\bban\b|permit|licen[cs]e|customs|\btax\b|crackdown|raid|investigat)/i,
    label: "Regulatory and compliance exposure",
  },
];

const TOPIC_RELEVANCE: Record<string, string> = {
  shipping: "Logistics and movement disruption",
  cargo_watch: "Cargo and logistics-security exposure",
  conflict: "Security and personnel-safety exposure",
  strikes: "Security and personnel-safety exposure",
  flashpoint: "Movement and site-access disruption",
  protests: "Movement and site-access disruption",
  energy: "Energy-supply continuity relevance",
  fuel: "Fuel-supply continuity relevance",
  fertiliser: "Supply-chain continuity relevance",
};

export function businessRelevance(i: RelevanceInput): string {
  const text = `${(i.displayTitle ?? "").trim()} ${i.title ?? ""}`;
  for (const rule of RELEVANCE_RULES) {
    if (rule.re.test(text)) return rule.label;
  }
  const t = (i.topic ?? "").toLowerCase();
  return TOPIC_RELEVANCE[t] ?? "Operational monitoring relevance";
}

// Fixed map wording (owner brief, verbatim). Any "risk map" language is
// replaced by these across every country report.
export const OPERATIONAL_MAP_HEADING = "Operational Map";
export const OPERATIONAL_MAP_SUBTITLE = "Reported operational pinch points for this period";
export const OPERATIONAL_MAP_READ =
  "This map shows reported operational pinch points for the current reporting period. " +
  "Locations are included only where reporting indicates a relevant event, issue or disruption. " +
  "Posture is based on likely business impact combined with reporting frequency, not standing background risk.";
