// Shared incident-significance ranking for every report surface.
//
// A source severity label alone is not sufficient to decide which event leads
// a report: a confirmed fatality must outrank a later low-impact fire, while an
// unresolved direct disruption should outrank a resolved side-effect.  This
// module deliberately accepts a small structural input so the country engine,
// topic reports and country datasets use the same ordering.

export interface IncidentSignificanceInput {
  severity?: string | null;
  title?: string | null;
  summary?: string | null;
  casualties?: number | null;
  fatalities?: number | null;
  injuries?: number | null;
  eventStatus?: string | null;
  status?: string | null;
  impactLevel?: string | null;
  confirmedOperationalEffect?: string | null;
  eventDate?: string | null;
  occurredAt?: string | null;
}

const SEVERITY_SCORE: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

const FATALITY_RE =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple)\s+(?:people|workers?|staff|officers?|persons?|civilians?|passengers?)?\s*(?:were\s+)?(?:killed|dead|died|slain|fatally\s+\w+)|\b(?:killed|deaths?|fatalities|slain|died|fatal)\b/i;
const INJURY_RE =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple)\s+(?:people|workers?|staff|officers?|persons?|civilians?|passengers?)?\s*(?:were\s+)?(?:injured|wounded|hurt|hospitali[sz]ed)|\b(?:injured|injuries|wounded|hospitali[sz]ed)\b/i;
const RESOLVED_RE =
  /\b(?:contained|extinguish\w*|resolved|restored|reopened?|resumed?|lifted|ended|normalised|back\s+(?:online|in\s+operation))\b|\b(?:is|was|are|were)\s+over\b|\bover\s+(?:after|following|now)\b/i;
const ONGOING_RE =
  /\b(?:ongoing|continues?|still\s+(?:closed|blocked|burning|disrupted)|under\s+way|active|unresolved|at\s+large|search\s+continues?)\b/i;
const SIDE_EFFECT_RE =
  /\b(?:concerns?|risk|could|may|might|expected|forecast|prices?|salary|wages?|budget|fiscal|economic\s+impact|knock[- ]on|spillover|response\s+to)\b/i;
// A story may name a price, salary or other consequence while still reporting
// the actual event. These concrete event terms therefore override the
// side-effect heuristic: a protest over fuel prices is a direct incident, not
// price commentary.
const DIRECT_EVENT_RE =
  /\b(?:attack\w*|assault\w*|armed|killed|dead|injur\w*|wound\w*|explosion|blast\w*|fire|blaze|protest\w*|demonstrat\w*|rally|march|strike|walkout|riot|clash\w*|curfew|arrest\w*|blockad\w*|road(?:s)?\s+(?:closed|blocked)|closure|closed|evacuat\w*|flood\w*|landslide|disrupt\w*)\b/i;

export function incidentSeverityRank(value: string | null | undefined): number {
  return SEVERITY_SCORE[(value ?? "").trim().toLowerCase()] ?? 0;
}

export function incidentHasFatalities(input: IncidentSignificanceInput): boolean {
  if ((input.fatalities ?? input.casualties ?? 0) > 0) return true;
  return FATALITY_RE.test(`${input.title ?? ""} ${input.summary ?? ""}`);
}

export function incidentHasInjuries(input: IncidentSignificanceInput): boolean {
  if ((input.injuries ?? 0) > 0) return true;
  return INJURY_RE.test(`${input.title ?? ""} ${input.summary ?? ""}`);
}

/** Higher is more serious. The bands encode the reporting policy in order. */
export function incidentSignificanceScore(input: IncidentSignificanceInput): number {
  const text = `${input.title ?? ""} ${input.summary ?? ""}`;
  const status = `${input.eventStatus ?? input.status ?? ""}`.toLowerCase();
  const impact = `${input.impactLevel ?? ""}`.toLowerCase();
  const fatalities = incidentHasFatalities(input);
  const injuries = incidentHasInjuries(input);
  const ongoing = status === "ongoing" || ONGOING_RE.test(text);
  const resolved =
    status === "ended" ||
    status === "cancelled" ||
    RESOLVED_RE.test(text);
  const direct =
    impact === "direct" ||
    Boolean(input.confirmedOperationalEffect) ||
    DIRECT_EVENT_RE.test(text) ||
    (!SIDE_EFFECT_RE.test(text) && !/^commentary|background|not an incident$/i.test(status));

  // A single confirmed fatality outranks any non-fatal incident. Injuries then
  // outrank unresolved disruption; status outranks directness; the severity
  // label provides a stable, low-weight tie-breaker inside those bands.
  let score = incidentSeverityRank(input.severity) * 10;
  if (fatalities) score += 100_000 + Math.min((input.fatalities ?? input.casualties ?? 1), 99) * 100;
  else if (injuries) score += 10_000 + Math.min(input.injuries ?? 1, 99) * 10;
  if (ongoing) score += 2_000;
  if (resolved) score -= 300;
  if (direct) score += 300;
  else score -= 100;
  return score;
}

function dateValue(input: IncidentSignificanceInput): number {
  const raw = input.eventDate ?? input.occurredAt ?? "";
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Sort highest-significance first, with the newest event as deterministic tie-break. */
export function compareIncidentSignificance<T extends IncidentSignificanceInput>(
  a: T,
  b: T,
): number {
  const score = incidentSignificanceScore(b) - incidentSignificanceScore(a);
  if (score !== 0) return score;
  return dateValue(b) - dateValue(a);
}

/** Country/area ranking score: significant incidents dominate raw volume. */
export function aggregateIncidentSignificance(
  incidents: IncidentSignificanceInput[],
): number {
  return incidents.reduce((total, incident) => total + incidentSignificanceScore(incident), 0);
}
