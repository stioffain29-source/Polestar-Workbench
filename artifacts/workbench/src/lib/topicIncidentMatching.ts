// Shared precision-first matching for report sub-watches.
//
// A topic word is not enough: a budget, salary or price article may name a
// chokepoint while describing only an economic consequence. This module keeps
// those articles out unless the text also describes the actual event.

export interface TopicIncidentMatchInput {
  title?: string | null;
  summary?: string | null;
  topic?: string | null;
}

const GULF_PLACE_RE =
  /\b(?:strait of hormuz|hormuz|persian gulf|arabian gulf|bab[- ]?el[- ]?mandeb|red sea)\b/i;
const GULF_EVENT_RE =
  /\b(?:attack\w*|struck|strike\w*|missile\w*|drone\w*|explosion|blast\w*|hit|closure|closed|shut|blockad\w*|disrupt\w*|sabotag\w*|seiz\w*|board\w*|tanker\w*|vessel\w*|ship\w*|transit\w*|rerout\w*|divert\w*|crisis|flows?\s+(?:cut|halt\w*))\b/i;
const FISCAL_CONSEQUENCE_RE =
  /\b(?:salary|wages?|payroll|budget|fiscal|tax\s+(?:take|revenue)|subsid(?:y|ies)|pension|allowance|economic\s+(?:cost|impact|loss)|inflation|consumer prices?|oil prices?|fuel prices?|market forecast|gdp|trade deficit)\b/i;
const CONCRETE_MARITIME_EVENT_RE =
  /\b(?:attack\w*|struck|strike\w*|missile\w*|drone\w*|explosion|blast\w*|closure|closed|shut|blockad\w*|sabotag\w*|seiz\w*|board\w*|tanker\w*|vessel\w*|rerout\w*|divert\w*)\b|\bhit\s+(?:a|an|the|by|near|on|oil|tanker|vessel|ship)\b/i;
const ECONOMIC_HEADLINE_RE =
  /\b(?:oil|crude|fuel|petrol|diesel|energy)\s+prices?\b|\b(?:prices?|costs?|markets?|inflation|revenue|earnings?)\s+(?:jump\w*|surge\w*|rise\w*|fall\w*|drop\w*|lift\w*|spike\w*)\b/i;

export function isGulfChokepointIncident(input: TopicIncidentMatchInput): boolean {
  const title = input.title ?? "";
  const summary = input.summary ?? "";
  const full = `${title} ${summary}`;
  if (!GULF_PLACE_RE.test(full)) return false;
  const titleEvent = GULF_PLACE_RE.test(title) && GULF_EVENT_RE.test(title);
  const bodyEvent = GULF_EVENT_RE.test(summary);
  if (!titleEvent && !bodyEvent) return false;
  // A fiscal/economic article is excluded unless its title names a concrete
  // maritime/security event. "Crisis" or "disruption" alone are consequences,
  // not proof that the article reports the underlying incident.
  if (
    FISCAL_CONSEQUENCE_RE.test(full) &&
    (!CONCRETE_MARITIME_EVENT_RE.test(title) || ECONOMIC_HEADLINE_RE.test(title))
  ) return false;
  return true;
}

export function matchesTopicIncident(
  topic: "gulf-chokepoint",
  input: TopicIncidentMatchInput,
): boolean {
  return topic === "gulf-chokepoint" && isGulfChokepointIncident(input);
}
