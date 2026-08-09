/**
 * Fuel Watch's single source of truth.
 *
 * This module is deliberately free of renderer and AI dependencies. It filters
 * once, computes every report-level finding once, creates the five analytical
 * sections from those facts, and validates a proposed rendered report against
 * the same facts before publication.
 */
import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";
import { deriveIncidentCountry } from "./shippingCountry";

export const FUEL_SEVERITIES = ["Insignificant", "Low", "Moderate", "High", "Extreme"] as const;
export type FuelSeverity = (typeof FUEL_SEVERITIES)[number];
export type FuelDirection = "rising" | "falling" | "unchanged" | "broadly stable";
export type EvidenceStatus = "Observed" | "Reported" | "Assessed" | "Potential";

const SEVERITY_RANK: Record<FuelSeverity, number> = {
  Insignificant: 1, Low: 2, Moderate: 3, High: 4, Extreme: 5,
};
const NEUTRAL_CHANGE_PCT = 0.5;
const UNKNOWN = "not identified";

export interface FuelEntityFields {
  actor: string | null;
  claimant: string | null;
  vesselFlag: string | null;
  vesselOwner: string | null;
  vesselOperator: string | null;
  infrastructureOperator: string | null;
}

export interface CanonicalFuelIncident {
  id: string;
  title: string;
  occurredAt: string;
  date: string;
  topic: string;
  severity: FuelSeverity;
  physicalLocation: string | null;
  country: string | null;
  routeOrChokepoint: string | null;
  widerRegionalRelevance: string | null;
  entities: FuelEntityFields;
  evidenceStatus: EvidenceStatus;
  sourceUrl: string | null;
  source: string | null;
  raw: TopicFastFactsIncident;
}

export interface FuelRankedPressurePoint {
  kind: "country" | "route" | "distributed";
  label: string;
  score: number;
  incidentIds: string[];
}

export interface FuelMarketIndicatorFact {
  label: string;
  currentValue: number | string;
  previousValue: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  direction: FuelDirection;
  unit: string | null;
  asOf: string | null;
  source: string | null;
}

export interface FuelCanonicalFacts {
  reportingPeriod: { issueDate: string; incidentStart: string | null; incidentEnd: string | null };
  qualifyingIncidents: CanonicalFuelIncident[];
  incidentCount: number;
  distinctIncidentDates: string[];
  countries: Array<{ label: string; count: number; severityScore: number; incidentIds: string[] }>;
  routes: Array<{ label: string; count: number; severityScore: number; incidentIds: string[] }>;
  incidentLocations: string[];
  severityDistribution: Record<FuelSeverity, number>;
  highestPriorityIncident: CanonicalFuelIncident | null;
  primaryPressurePoint: FuelRankedPressurePoint;
  secondaryPressurePoints: FuelRankedPressurePoint[];
  marketIndicators: FuelMarketIndicatorFact[];
  overallSeverity: FuelSeverity;
  evidenceConfidence: "High" | "Moderate" | "Low";
  analystReviewRequired: boolean;
  currentConditions: CanonicalFuelIncident[];
  watchIndicators: string[];
}

export interface FuelCanonicalSections {
  executiveSummary: string;
  situation: string;
  regionalHighlights: string;
  whatMatters: string;
  polestarView: string;
  marketRead: string;
  operationalRead: string;
  implications: string;
  watchNext: string;
}

/** Renderer-ready Fuel Watch prose, including the bespoke Chokepoint Watch. */
export type FuelCanonicalRenderableSections = Partial<FuelCanonicalSections> & {
  gulfAndHormuzChokepointWatch?: string | null;
};

export interface FuelConsistencyError {
  section: string;
  conflictingStatement: string;
  canonicalValue: string;
  sourceField: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function get(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  return text((obj as Record<string, unknown>)[key]);
}
function day(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : value;
}
function canonicalSeverity(value: string | null | undefined): FuelSeverity {
  const key = (value ?? "").trim().toLowerCase();
  return key === "extreme" ? "Extreme" : key === "high" ? "High" : key === "moderate" ? "Moderate" : key === "low" ? "Low" : "Insignificant";
}
function severityWord(value: FuelSeverity): string { return value.toLowerCase(); }
function title(value: string): string {
  return value.replace(/\b\w/g, (m) => m.toUpperCase());
}
function stableSort<T extends { label: string; severityScore: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.severityScore - a.severityScore || a.label.localeCompare(b.label));
}
function routeFor(i: TopicFastFactsIncident): string | null {
  const value = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`.toLowerCase();
  if (/strait of hormuz|\bhormuz\b/.test(value)) return "Strait of Hormuz";
  if (/bab[- ]el[- ]mandeb/.test(value)) return "Bab-el-Mandeb";
  if (/\bred sea\b/.test(value)) return "Red Sea";
  if (/\bsuez\b/.test(value)) return "Suez Canal";
  if (/\bmalacca\b/.test(value)) return "Strait of Malacca";
  if (/\bpersian gulf\b|\barabian gulf\b/.test(value)) return "Persian Gulf";
  return null;
}
function relevanceFor(route: string | null): string | null {
  if (!route) return null;
  return `${route} routing and fuel-delivery exposure`;
}
function evidenceStatusFor(i: TopicFastFactsIncident): EvidenceStatus {
  const value = `${i.title ?? ""} ${i.summary ?? ""}`.toLowerCase();
  return /\b(may|might|could|potential|possible|expected|forecast|risk of|watch for)\b/.test(value) ? "Potential" : "Reported";
}
function entitiesFor(i: TopicFastFactsIncident): FuelEntityFields {
  // Field names are read independently. A missing operator remains missing; it
  // is never populated from claimant, nationality, flag, country or location.
  const raw = i as unknown as Record<string, unknown>;
  return {
    actor: get(raw, "actor"),
    claimant: get(raw, "claimant"),
    vesselFlag: get(raw, "vesselFlag") ?? get(raw, "flagState"),
    vesselOwner: get(raw, "vesselOwner"),
    vesselOperator: get(raw, "vesselOperator"),
    infrastructureOperator: get(raw, "infrastructureOperator"),
  };
}
function parsePercentageChange(change: unknown): number | null {
  if (typeof change === "number" && Number.isFinite(change)) return change;
  if (typeof change !== "string") return null;
  const match = change.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}
function marketFact(card: { label: string; value: number | string; change?: string; unit?: string; asOf?: string; source?: string }): FuelMarketIndicatorFact {
  const current = typeof card.value === "number" ? card.value : Number(card.value);
  const numeric = Number.isFinite(current);
  const percentageChange = parsePercentageChange(card.change);
  const previousValue = numeric && percentageChange !== null && percentageChange !== -100
    ? current / (1 + percentageChange / 100) : null;
  const absoluteChange = numeric && previousValue !== null ? current - previousValue : null;
  const direction: FuelDirection = percentageChange === null
    ? "unchanged"
    : Math.abs(percentageChange) <= NEUTRAL_CHANGE_PCT
      ? (percentageChange === 0 ? "unchanged" : "broadly stable")
      : percentageChange > 0 ? "rising" : "falling";
  return { label: card.label, currentValue: card.value, previousValue, absoluteChange, percentageChange, direction, unit: card.unit ?? null, asOf: card.asOf ?? null, source: card.source ?? null };
}

export function buildFuelCanonicalFacts(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** Pass the already filtered report record set to avoid any second filtering. */
  qualifyingIncidents?: TopicFastFactsIncident[];
  marketCards: Array<{ label: string; value: number | string; change?: string; unit?: string; asOf?: string; source?: string }>;
  watchIndicators?: string[];
}): FuelCanonicalFacts {
  const filtered = opts.qualifyingIncidents ?? filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  const qualifyingIncidents = filtered.map((raw, index): CanonicalFuelIncident => {
    const country = deriveIncidentCountry(raw);
    const physicalLocation = text(raw.location) ?? null;
    return {
      id: String(raw.id ?? `${day(raw.occurredAt)}:${index}:${raw.title}`), title: raw.title, occurredAt: raw.occurredAt,
      date: day(raw.occurredAt), topic: raw.topic, severity: canonicalSeverity(raw.severity), physicalLocation,
      country, routeOrChokepoint: routeFor(raw), widerRegionalRelevance: relevanceFor(routeFor(raw)), entities: entitiesFor(raw),
      evidenceStatus: evidenceStatusFor(raw), sourceUrl: raw.sourceUrl ?? null, source: raw.source ?? null, raw,
    };
  });
  const groups = (pick: (i: CanonicalFuelIncident) => string | null) => {
    const map = new Map<string, CanonicalFuelIncident[]>();
    for (const i of qualifyingIncidents) {
      const key = pick(i); if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return stableSort([...map.entries()].map(([label, rows]) => ({ label, count: rows.length, severityScore: rows.reduce((n, i) => n + SEVERITY_RANK[i.severity], 0), incidentIds: rows.map((i) => i.id) })));
  };
  const countries = groups((i) => i.country);
  const routes = groups((i) => i.routeOrChokepoint);
  // Geography and route are two valid but non-additive lenses over the same
  // incident. Rank countries first when country attribution exists; only use
  // route ranking when no country is evidenced. This avoids falsely calling a
  // single event "distributed" merely because it has both a country and route.
  const countryCandidates = countries.map((r) => ({ kind: "country" as const, ...r }));
  const routeCandidates = routes.map((r) => ({ kind: "route" as const, ...r }));
  const primaryCandidates = (countryCandidates.length ? countryCandidates : routeCandidates)
    .slice().sort((a, b) => b.severityScore - a.severityScore || b.count - a.count || a.label.localeCompare(b.label));
  const candidate = [...countryCandidates, ...routeCandidates]
    .sort((a, b) => b.severityScore - a.severityScore || b.count - a.count || a.label.localeCompare(b.label));
  const topScore = primaryCandidates[0]?.severityScore ?? 0;
  const leaders = primaryCandidates.filter((point) => point.severityScore === topScore && point.count === (primaryCandidates[0]?.count ?? 0));
  const primaryPressurePoint: FuelRankedPressurePoint = leaders.length === 1
    ? { kind: leaders[0].kind, label: leaders[0].label, score: leaders[0].severityScore, incidentIds: leaders[0].incidentIds }
    : { kind: "distributed", label: "Distributed pressure", score: topScore, incidentIds: leaders.flatMap((p) => p.incidentIds).sort() };
  const secondaryPressurePoints = candidate
    .filter((point) => primaryPressurePoint.kind === "distributed" ? point.severityScore < topScore : !(point.kind === primaryPressurePoint.kind && point.label === primaryPressurePoint.label))
    .slice(0, 3).map((point) => ({ kind: point.kind, label: point.label, score: point.severityScore, incidentIds: point.incidentIds }));
  const severityDistribution = FUEL_SEVERITIES.reduce((out, severity) => ({ ...out, [severity]: 0 }), {} as Record<FuelSeverity, number>);
  for (const i of qualifyingIncidents) severityDistribution[i.severity]++;
  const highestPriorityIncident = qualifyingIncidents.slice().sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.date.localeCompare(a.date) || a.title.localeCompare(b.title))[0] ?? null;
  const overallSeverity = highestPriorityIncident?.severity ?? "Insignificant";
  const sourceCoverage = qualifyingIncidents.length === 0 ? 1 : qualifyingIncidents.filter((i) => Boolean(i.sourceUrl || i.source)).length / qualifyingIncidents.length;
  const evidenceConfidence = sourceCoverage >= 0.8 ? "High" : sourceCoverage >= 0.5 ? "Moderate" : "Low";
  return {
    reportingPeriod: { issueDate: opts.issueDate, incidentStart: qualifyingIncidents.map((i) => i.date).sort()[0] ?? null, incidentEnd: qualifyingIncidents.map((i) => i.date).sort().at(-1) ?? null },
    qualifyingIncidents, incidentCount: qualifyingIncidents.length, distinctIncidentDates: [...new Set(qualifyingIncidents.map((i) => i.date))].sort(), countries, routes,
    incidentLocations: [...new Set(qualifyingIncidents.map((i) => i.physicalLocation).filter((x): x is string => Boolean(x)))].sort(), severityDistribution,
    highestPriorityIncident, primaryPressurePoint, secondaryPressurePoints, marketIndicators: opts.marketCards.map(marketFact), overallSeverity,
    evidenceConfidence, analystReviewRequired: evidenceConfidence === "Low" && overallSeverity !== "Insignificant", currentConditions: qualifyingIncidents.filter((i) => i.evidenceStatus !== "Potential"),
    watchIndicators: [...new Set((opts.watchIndicators ?? []).map((x) => x.trim()).filter(Boolean))],
  };
}

function pressureSentence(facts: FuelCanonicalFacts): string {
  return facts.primaryPressurePoint.kind === "distributed" ? "Distributed pressure is the primary pressure point; the evidence does not support a unique leader." : `${facts.primaryPressurePoint.label} is the primary pressure point.`;
}
function marketSentence(facts: FuelCanonicalFacts): string {
  const indicators = facts.marketIndicators.slice(0, 3);
  if (!indicators.length) return "No market indicators were supplied for this period.";
  return indicators.map((i) => `${i.label} is ${i.direction}`).join("; ") + ".";
}
function list(values: string[]): string {
  if (!values.length) return "none";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function buildFuelCanonicalSections(facts: FuelCanonicalFacts): FuelCanonicalSections {
  const count = facts.incidentCount;
  const days = facts.distinctIncidentDates.length;
  const severity = facts.overallSeverity;
  const top = facts.highestPriorityIncident;
  const pressure = pressureSentence(facts);
  const observed = facts.currentConditions.length;
  const secondary = facts.secondaryPressurePoints.map((p) => p.label);
  const executiveSummary = `Fuel Watch records ${count} qualifying incident${count === 1 ? "" : "s"} across ${days} distinct reporting day${days === 1 ? "" : "s"}. Overall severity: ${severity}. ${pressure} ${marketSentence(facts)}`;
  const situation = `Current, non-potential evidence covers ${observed} of the reporting period's ${count} qualifying incident${count === 1 ? "" : "s"}. ${pressure} The highest-priority incident is ${top ? `“${top.title}” at ${top.physicalLocation ?? UNKNOWN}` : "not identified"}. Overall severity: ${severity}.`;
  const regionalHighlights = facts.primaryPressurePoint.kind === "distributed"
    ? `Regional Highlights: pressure is distributed across ${list([...facts.countries.slice(0, 3).map((c) => c.label), ...facts.routes.slice(0, 3).map((r) => r.label)])}. Overall severity: ${severity}.`
    : `Regional Highlights: ${facts.primaryPressurePoint.label} is the primary pressure point; secondary pressure points are ${list(secondary)}. Overall severity: ${severity}.`;
  const whatMatters = `What Matters: ${pressure} The report contains ${count} qualifying incident${count === 1 ? "" : "s"}; route and country totals are derived from the same record set. ${marketSentence(facts)} Overall severity: ${severity}.`;
  const polestarView = `Polestar View: ${pressure} Overall severity: ${severity}. Evidence confidence: ${facts.evidenceConfidence}. ${facts.analystReviewRequired ? "Analyst review is required before publication." : "The assessed position is based on the qualifying evidence in this reporting period."}`;
  const marketRead = marketSentence(facts);
  const operationalRead = `Operational Read: ${count} qualifying incident${count === 1 ? "" : "s"} across ${days} distinct day${days === 1 ? "" : "s"}. ${pressure} Overall severity: ${severity}.`;
  const implications = [
    `- Observed: align fuel-continuity actions to ${facts.primaryPressurePoint.label}.`,
    `- Assessed: plan against overall severity ${severity}.`,
    `- Reported: verify supplier, route and stock exposure against the ${count} qualifying incident${count === 1 ? "" : "s"}.`,
  ].join("\n");
  const watchNext = facts.watchIndicators.length
    ? facts.watchIndicators.map((x) => `- Potential: ${x}`).join("\n")
    : "- Potential: monitor for new evidence before classifying a condition as current.";
  return { executiveSummary, situation, regionalHighlights, whatMatters, polestarView, marketRead, operationalRead, implications, watchNext };
}

function err(section: string, conflictingStatement: string, canonicalValue: unknown, sourceField: string): FuelConsistencyError {
  return { section, conflictingStatement, canonicalValue: String(canonicalValue), sourceField };
}
function extractSeverity(body: string): string | null {
  return body.match(/overall severity:\s*(Insignificant|Low|Moderate|High|Extreme)/i)?.[1] ?? null;
}
function statementSnippet(body: string, re: RegExp): string {
  return body.match(re)?.[0] ?? body.slice(0, 160);
}

/** Validate renderer-ready prose. Errors are intentionally structured for UI and PDF callers. */
export function validateFuelReportConsistency(facts: FuelCanonicalFacts, sections: FuelCanonicalRenderableSections): FuelConsistencyError[] {
  const errors: FuelConsistencyError[] = [];
  const canonicalSeverity = facts.overallSeverity;
  const primary = facts.primaryPressurePoint.label;
  const directions = facts.marketIndicators;
  for (const [section, body] of Object.entries(sections)) {
    if (!body) continue;
    const severity = extractSeverity(body);
    if (severity && severity.toLowerCase() !== canonicalSeverity.toLowerCase()) errors.push(err(section, statementSnippet(body, /overall severity:.{0,30}/i), canonicalSeverity, "overallSeverity"));
    if (/primary pressure point/i.test(body) && !body.toLowerCase().includes(primary.toLowerCase())) errors.push(err(section, statementSnippet(body, /[^.]*primary pressure point[^.]*/i), primary, "primaryPressurePoint.label"));
    const currentClaim = body.match(/Current,\s*non-potential evidence covers (\d+) of the reporting period's (\d+) qualifying incidents?/i);
    const countClaim = body.match(/(\d+)\s+qualifying incidents?/i)?.[1];
    if (countClaim !== undefined && currentClaim === null && Number(countClaim) !== facts.incidentCount) errors.push(err(section, statementSnippet(body, /\d+\s+qualifying incidents?/i), facts.incidentCount, "incidentCount"));
    const dayClaim = body.match(/(\d+)\s+distinct (?:reporting )?days?/i)?.[1];
    if (dayClaim !== undefined && Number(dayClaim) !== facts.distinctIncidentDates.length) errors.push(err(section, statementSnippet(body, /\d+\s+distinct (?:reporting )?days?/i), facts.distinctIncidentDates.length, "distinctIncidentDates"));
    if (currentClaim !== null) {
      if (Number(currentClaim[1]) !== facts.currentConditions.length) {
        errors.push(err(section, statementSnippet(body, /Current,\s*non-potential evidence covers \d+ of the reporting period's \d+ qualifying incidents?/i), facts.currentConditions.length, "currentConditions"));
      }
      if (Number(currentClaim[2]) !== facts.incidentCount) {
        errors.push(err(section, statementSnippet(body, /Current,\s*non-potential evidence covers \d+ of the reporting period's \d+ qualifying incidents?/i), facts.incidentCount, "incidentCount"));
      }
    }
    if (section === "gulfAndHormuzChokepointWatch") {
      const chokepointClaim = body.match(/(\d+)\s+distinct chokepoint incidents?/i)?.[1];
      if (chokepointClaim !== undefined && Number(chokepointClaim) > facts.incidentCount) {
        errors.push(err(
          "Gulf and Hormuz Chokepoint Watch",
          statementSnippet(body, /\d+\s+distinct chokepoint incidents?/i),
          `<= ${facts.incidentCount}`,
          "incidentCount",
        ));
      }
    }
    const locationClaim = body.match(/highest-priority incident is [\s\S]*? at (.+?)\. Overall severity:/i)?.[1]?.trim();
    if (locationClaim && locationClaim !== (facts.highestPriorityIncident?.physicalLocation ?? UNKNOWN)) errors.push(err(section, locationClaim, facts.highestPriorityIncident?.physicalLocation ?? UNKNOWN, "qualifyingIncidents[].physicalLocation"));
    for (const indicator of directions) {
      const name = indicator.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nearby = new RegExp(`${name}.{0,80}`, "i").exec(body)?.[0] ?? "";
      if (indicator.direction === "falling" && /\b(rising|firming|not retreating)\b/i.test(nearby)) errors.push(err(section, nearby, "falling", `marketIndicators.${indicator.label}.direction`));
      if (indicator.direction === "rising" && /\b(falling|easing|retreating)\b/i.test(nearby)) errors.push(err(section, nearby, "rising", `marketIndicators.${indicator.label}.direction`));
    }
  }
  const core: Array<[keyof FuelCanonicalSections, string]> = [["executiveSummary", "Executive Summary"], ["situation", "Situation"], ["regionalHighlights", "Regional Highlights"], ["whatMatters", "What Matters"], ["polestarView", "Polestar View"]];
  for (const [key, label] of core) {
    const body = sections[key];
    if (!body) continue;
    if (!body.includes(`Overall severity: ${canonicalSeverity}`)) errors.push(err(label, body, canonicalSeverity, "overallSeverity"));
    if (!body.includes(primary)) errors.push(err(label, body, primary, "primaryPressurePoint.label"));
  }
  return errors;
}

export function assertFuelReportConsistent(facts: FuelCanonicalFacts, sections: FuelCanonicalRenderableSections): void {
  const errors = validateFuelReportConsistency(facts, sections);
  if (errors.length) {
    const detail = errors.map((e) => `${e.section}: ${e.conflictingStatement} | canonical=${e.canonicalValue} | field=${e.sourceField}`).join("\n");
    throw new Error(`FUEL_REPORT_CONSISTENCY_FAILED\n${detail}`);
  }
}
