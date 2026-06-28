// Analyst-value scoring for Top-3 Developments selection (spec §11).
//
// The old selection ranked clusters by severity-then-recency, which surfaced the
// single worst-rated headline even when it carried little operational meaning and
// pushed genuinely consequential developments (mass evacuation, a closed airport,
// a regulatory shutdown) down the list. This scores each cluster by ANALYST
// VALUE — the operational signals a client actually acts on — and the dataset
// builder sorts on that, falling back to severity-then-recency only to break ties.
//
// Pure and dependency-free (bar the sibling fire classifier, also pure) so it can
// be unit-tested directly and never pulls in the ingest barrel. Count-free: it
// returns numeric scores and named signals only — never any prose.

import { classifyFireCause } from "./countryFireCause";

export interface ValueScorable {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  severityRank?: number | null;
}

// The value signals a development can carry, with their weights. Higher = more
// operationally consequential to a client operating in-country.
export type ValueSignal =
  | "fatalities"
  | "injuries"
  | "evacuation"
  | "major-fire"
  | "transport-impact"
  | "road-closure"
  | "security-deployment"
  | "protest-disruption"
  | "regulatory-business"
  | "commercial-proximity";

const SIGNAL_WEIGHT: Record<ValueSignal, number> = {
  fatalities: 6,
  injuries: 3,
  evacuation: 4,
  "major-fire": 4,
  "transport-impact": 4,
  "road-closure": 3,
  "security-deployment": 3,
  "protest-disruption": 3,
  "regulatory-business": 3,
  "commercial-proximity": 2,
};

const FATALITIES_RE = /\b(killed|dead|deaths?|fatalit\w*|died|loss\s+of\s+life|perished|bodies)\b/i;
const INJURIES_RE = /\b(injured|injur\w*|wounded|hurt|hospitalis\w*|casualt\w*)\b/i;
const EVACUATION_RE = /\b(evacuat\w*|displaced|fled|flee\w*|residents\s+moved|forced\s+out)\b/i;
const FIRE_SCALE_RE =
  /\b(gutted|razed|destroyed|engulf\w*|massive|huge|major|spread\w*|reduced\s+to\s+ashes|multiple\s+(?:shops|homes|houses|buildings|units))\b/i;
const TRANSPORT_RE =
  /\b(airport\w*|flights?\s+(?:cancel\w*|suspend\w*|ground\w*|divert\w*)|port\s+(?:closed|shut\w*|suspend\w*)|rail\w*\s+(?:halt\w*|suspend\w*)|train\w*\s+(?:cancel\w*|suspend\w*)|terminal\s+closed|sailings?\s+(?:cancel\w*|suspend\w*))\b/i;
const ROAD_RE =
  /\b(road[s]?\s+(?:closed|blocked|shut)|highway\s+(?:closed|blocked)|blockad\w*|cut\s+off|impassable|diversion\w*|gridlock)\b/i;
const SECURITY_RE =
  /\b(curfew\w*|martial\s+law|state\s+of\s+emergency|lockdown\w*|(?:troops|soldiers|police|security\s+forces|military)\s+(?:deployed|deployment|reinforce\w*|sent\s+in)|reinforcements?\s+sent)\b/i;
const PROTEST_DISRUPTION_RE =
  /\b(shut[\s-]?down\w*|general\s+strike|blockad\w*|brought\s+to\s+a\s+standstill|paralys\w*|stranded|grounded|disrupt\w*\s+(?:traffic|operations|services))\b/i;
const REGULATORY_RE =
  /\b(banned?|bans\b|suspend\w*|suspension|revok\w*|licen[cs]e\w*|permit\w*|export\s+halt|import\s+halt|ordered\s+to\s+close|shutter\w*|sanction\w*|embargo\w*)\b/i;
const COMMERCIAL_RE =
  /\b(factory|factories|warehouse\w*|market\w*|mall\w*|shop\w*|store\w*|office\w*|industrial|business\s+district|commercial|plant\b|refiner\w*|depot\w*|port\b)\b/i;

export interface IncidentValue {
  /** Total analyst-value score, severity-inclusive. */
  score: number;
  /** Which value signals fired (severity excluded). Test-visible metadata. */
  signals: ValueSignal[];
}

// Score a single incident's analyst value from its text + severity rank. Pure.
export function scoreIncidentValue(it: ValueScorable): IncidentValue {
  const hay = `${it.title ?? ""} ${it.summary ?? ""} ${it.category ?? ""}`;
  const signals: ValueSignal[] = [];
  if (FATALITIES_RE.test(hay)) signals.push("fatalities");
  if (INJURIES_RE.test(hay)) signals.push("injuries");
  if (EVACUATION_RE.test(hay)) signals.push("evacuation");
  if (classifyFireCause(it).isFire && FIRE_SCALE_RE.test(hay)) signals.push("major-fire");
  if (TRANSPORT_RE.test(hay)) signals.push("transport-impact");
  if (ROAD_RE.test(hay)) signals.push("road-closure");
  if (SECURITY_RE.test(hay)) signals.push("security-deployment");
  if (PROTEST_DISRUPTION_RE.test(hay)) signals.push("protest-disruption");
  if (REGULATORY_RE.test(hay)) signals.push("regulatory-business");
  if (COMMERCIAL_RE.test(hay)) signals.push("commercial-proximity");

  const signalScore = signals.reduce((sum, s) => sum + SIGNAL_WEIGHT[s], 0);
  const sevRank = typeof it.severityRank === "number" ? it.severityRank : 0;
  return { score: signalScore + sevRank * 1.5, signals };
}

// Score a same-story CLUSTER: the best (highest-value) member, plus a small
// corroboration bonus — a story carried by several reports is a bigger story —
// capped so corroboration never outweighs a genuinely consequential single event.
export function scoreClusterValue(cluster: ValueScorable[]): number {
  if (cluster.length === 0) return 0;
  const best = Math.max(...cluster.map((it) => scoreIncidentValue(it).score));
  const corroboration = Math.min(cluster.length - 1, 3) * 0.5;
  return best + corroboration;
}
