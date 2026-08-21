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
import { isSocialPostTitle } from "./fuelReportFacts";
import { capFuelMarketSeverity, buildFuelAnalyticalSections } from "./fuelNarratives";

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
  /** Event-led narrative distinct from `situation` — the two sections must
   *  never render identical (verbatim-duplicated) text. */
  whatHappened: string;
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
function effectiveSeverityFor(i: TopicFastFactsIncident): FuelSeverity {
  return canonicalSeverity(
    capFuelMarketSeverity(i.severity, i.title, i.summary ?? "") || i.severity,
  );
}
function fuelContinuityBoost(i: TopicFastFactsIncident): number {
  const hay = `${i.title ?? ""} ${i.summary ?? ""}`.toLowerCase();
  if (/\b(ration|rationing|shortage|allocation|curfew|queues?|forecourt|pump price|fuel crisis)\b/.test(hay)) return 20;
  if (/\b(diesel|petrol|gasoline|gasoil|kerosene|lpg|jet fuel)\b/.test(hay)
      && /\b(shortage|ration|cut|disrupt|crisis|offline)\b/.test(hay)) return 12;
  return 0;
}
/** Collapse syndicated Red Sea / Yemen / Bab-el-Mandeb corridor copies to one record. */
function fuelStoryFamilyKey(i: TopicFastFactsIncident): string | null {
  const hay = `${i.title ?? ""} ${i.summary ?? ""}`.toLowerCase();
  if (!/\b(red sea|bab[- ]el[- ]mandeb|bab al[- ]mandab|houthi|yemen)\b/.test(hay)) return null;
  if (!/\b(vessel|tanker|ship|attack|strike|missile|shipping|maritime|crew)\b/.test(hay)) return null;
  if (/\bbab[- ]el|bab al[- ]mandab/.test(hay)) return "corridor:bab-el-mandeb";
  return "corridor:red-sea-yemen";
}
function dedupeFuelSyndication(incidents: TopicFastFactsIncident[]): TopicFastFactsIncident[] {
  const unkeyed: TopicFastFactsIncident[] = [];
  const families = new Map<string, TopicFastFactsIncident>();
  for (const raw of incidents) {
    const key = fuelStoryFamilyKey(raw);
    if (!key) {
      unkeyed.push(raw);
      continue;
    }
    const prev = families.get(key);
    if (!prev || SEVERITY_RANK[effectiveSeverityFor(raw)] > SEVERITY_RANK[effectiveSeverityFor(prev)]) {
      families.set(key, raw);
    }
  }
  return [...unkeyed, ...families.values()];
}
function severityWord(value: FuelSeverity): string { return value.toLowerCase(); }
// A quoted incident headline can carry its own percentage ("Jet fuel price
// raised by 21%"). The consistency gate reads any "NN%" in a sentence that
// also names an indicator (jet fuel, Brent...) as a MARKET claim and demands
// it match a calculated indicator change — so quoted headlines must never
// contribute bare "%" figures. Rewriting to "per cent" keeps the wording
// honest while staying invisible to the gate's percentage scanner.
function proseSafeTitle(t: string): string {
  return t.replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 per cent");
}

function title(value: string): string {
  return value.replace(/\b\w/g, (m) => m.toUpperCase());
}
function stableSort<T extends { label: string; severityScore: number; maxSeverity: number }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      b.maxSeverity - a.maxSeverity
      || b.severityScore - a.severityScore
      || a.label.localeCompare(b.label),
  );
}
function maxSeverityRank(rows: CanonicalFuelIncident[]): number {
  return rows.reduce((peak, i) => Math.max(peak, SEVERITY_RANK[i.severity]), 0);
}
function incidentSetKey(ids: string[]): string {
  return [...ids].sort().join(",");
}
function dedupeSharedIncidentGroups<T extends { kind: "country" | "route"; label: string; incidentIds: string[] }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = incidentSetKey(row.incidentIds);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    // Same underlying records: keep the route label when it names the chokepoint.
    if (row.kind === "route" && prev.kind === "country") map.set(key, row);
  }
  return [...map.values()];
}
function pickPrimaryPool(
  countryCandidates: Array<{ kind: "country"; maxSeverity: number; severityScore: number; continuityBoost: number; count: number; label: string; incidentIds: string[] }>,
  routeCandidates: Array<{ kind: "route"; maxSeverity: number; severityScore: number; continuityBoost: number; count: number; label: string; incidentIds: string[] }>,
): Array<{ kind: "country" | "route"; maxSeverity: number; severityScore: number; continuityBoost: number; count: number; label: string; incidentIds: string[] }> {
  const sortedCountries = stableSort(countryCandidates);
  const sortedRoutes = stableSort(routeCandidates);
  const bestCountry = sortedCountries[0];
  const bestRoute = sortedRoutes[0];
  if (bestRoute && bestCountry && bestRoute.maxSeverity > bestCountry.maxSeverity) {
    // Acute fuel continuity (rationing, shortage) outranks corridor maritime
    // strikes when the combined score is competitive — Orenburg rationing must
    // not lose to a fatal Red Sea strike on peak severity alone. High-volume
    // moderate country noise must not drown out an extreme chokepoint event.
    if (bestCountry.continuityBoost > 0 && bestCountry.severityScore >= bestRoute.severityScore) {
      return dedupeSharedIncidentGroups(sortedCountries);
    }
    return dedupeSharedIncidentGroups(sortedRoutes);
  }
  if (sortedCountries.length) return dedupeSharedIncidentGroups(sortedCountries);
  return dedupeSharedIncidentGroups(sortedRoutes);
}
export function routeFor(i: TopicFastFactsIncident): string | null {
  const value = `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`.toLowerCase();
  if (/strait of hormuz|\bhormuz\b/.test(value)) return "Strait of Hormuz";
  if (/gulf of oman/.test(value)) return "Gulf of Oman";
  if (/bab[- ]el[- ]mandeb|bab al[- ]mandab|bab el[- ]mandab/.test(value)) return "Bab-el-Mandeb";
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
  const deduped = dedupeFuelSyndication(filtered);
  const qualifyingIncidents = deduped.map((raw, index): CanonicalFuelIncident => {
    const country = deriveIncidentCountry(raw);
    const physicalLocation = text(raw.location) ?? null;
    const severity = effectiveSeverityFor(raw);
    return {
      id: String(raw.id ?? `${day(raw.occurredAt)}:${index}:${raw.title}`), title: raw.title, occurredAt: raw.occurredAt,
      date: day(raw.occurredAt), topic: raw.topic, severity, physicalLocation,
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
    return stableSort([...map.entries()].map(([label, rows]) => {
      const continuityBoost = rows.reduce((n, i) => n + fuelContinuityBoost(i.raw), 0);
      return {
        label,
        count: rows.length,
        continuityBoost,
        severityScore: rows.reduce((n, i) => n + SEVERITY_RANK[i.severity], 0) + continuityBoost,
        maxSeverity: maxSeverityRank(rows),
        incidentIds: rows.map((i) => i.id),
      };
    }));
  };
  const countries = groups((i) => i.country);
  const routes = groups((i) => i.routeOrChokepoint);
  // Geography and route are two valid but non-additive lenses over the same
  // incident set. Rank both together by peak severity first so a single
  // extreme chokepoint event is not drowned out by higher article volume
  // elsewhere.
  const countryCandidates = countries.map((r) => ({ kind: "country" as const, ...r }));
  const routeCandidates = routes.map((r) => ({ kind: "route" as const, ...r }));
  const primaryCandidates = stableSort(pickPrimaryPool(countryCandidates, routeCandidates));
  const candidate = [...countryCandidates, ...routeCandidates]
    .slice()
    .sort((a, b) => b.maxSeverity - a.maxSeverity || b.severityScore - a.severityScore || b.count - a.count || a.label.localeCompare(b.label));
  const topScore = primaryCandidates[0]?.severityScore ?? 0;
  const topMax = primaryCandidates[0]?.maxSeverity ?? 0;
  const leaders = primaryCandidates.filter(
    (point) => point.severityScore === topScore && point.maxSeverity === topMax && point.count === (primaryCandidates[0]?.count ?? 0),
  );
  const primaryPressurePoint: FuelRankedPressurePoint = leaders.length === 1
    ? { kind: leaders[0].kind, label: leaders[0].label, score: leaders[0].severityScore, incidentIds: leaders[0].incidentIds }
    : { kind: "distributed", label: "Distributed pressure", score: topScore, incidentIds: leaders.flatMap((p) => p.incidentIds).sort() };
  const secondaryPressurePoints = candidate
    .filter((point) => primaryPressurePoint.kind === "distributed" ? point.severityScore < topScore : !(point.kind === primaryPressurePoint.kind && point.label === primaryPressurePoint.label))
    .slice(0, 3).map((point) => ({ kind: point.kind, label: point.label, score: point.severityScore, incidentIds: point.incidentIds }));
  const severityDistribution = FUEL_SEVERITIES.reduce((out, severity) => ({ ...out, [severity]: 0 }), {} as Record<FuelSeverity, number>);
  for (const i of qualifyingIncidents) severityDistribution[i.severity]++;
  // Raw social-media captures (handle-prefixed X/Instagram post titles) are
  // deprioritised below every news-titled record regardless of severity —
  // a raw post must never headline as the highest-priority incident. The
  // social-only fallback keeps the field populated when the window carries
  // nothing else.
  const byPriority = (a: CanonicalFuelIncident, b: CanonicalFuelIncident) => {
    const score = (i: CanonicalFuelIncident) => {
      const hay = `${i.title} ${i.raw.summary ?? ""}`.toLowerCase();
      let s = SEVERITY_RANK[i.severity] * 1000 + fuelContinuityBoost(i.raw) * 10;
      if (
        /\b(vessel|tanker|ship|landing ship|warship|naval|military ship|ballistic missile)\b/.test(hay) &&
        !/\b(refinery|pipeline|terminal|depot|ration|shortage|fuel|forecourt|pump)\b/.test(hay)
      ) {
        s -= 500;
      }
      return s;
    };
    return score(b) - score(a) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
  };
  const newsTitled = qualifyingIncidents.filter((i) => !isSocialPostTitle(i.title));
  const highestPriorityIncident = (newsTitled.length ? newsTitled : qualifyingIncidents).slice().sort(byPriority)[0] ?? null;
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

function evidenceCoverageSentence(observed: number, count: number): string {
  if (count === 0) return "No incidents were logged in the reporting window.";
  if (observed === count) return "All logged incidents carry confirmed reporting rather than speculative framing.";
  if (observed === 0) return "Nothing in the window is confirmed yet — treat operational claims as watch items until sourcing firms up.";
  return `${observed} of ${count} incidents are confirmed; the remainder remain potential-only and belong in Watch Next rather than the live picture.`;
}

export function buildFuelCanonicalSections(facts: FuelCanonicalFacts): FuelCanonicalSections {
  const analytical = buildFuelAnalyticalSections(facts);
  const marketRead = marketSentence(facts);
  return {
    ...analytical,
    marketRead,
  };
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
  const primary = facts.primaryPressurePoint.label;
  const mentionsPrimary = (body: string): boolean =>
    body.toLowerCase().includes(primary.toLowerCase()) ||
    (facts.primaryPressurePoint.kind === "distributed" && /\bdistributed\b/i.test(body));
  const directions = facts.marketIndicators;
  const VOLUME_PROSE_RE =
    /\b\d+\s+(?:qualifying\s+|fuel[- ]related\s+|distinct\s+|confirmed\s+)?(?:incidents?|records?|events?|reports?|days?)\b|\b(?:incidents?|records?)\s+(?:were\s+)?(?:logged|recorded|carried)\b|\b(?:reporting|qualifying)\s+(?:record|incident)\b|\b(?:led by|leads with)\s+[“"]/i;
  for (const [section, body] of Object.entries(sections)) {
    if (!body) continue;
    if (VOLUME_PROSE_RE.test(body)) {
      errors.push(err(section, statementSnippet(body, VOLUME_PROSE_RE), "none in analytical prose", "incidentCount"));
    }
    if (/overall severity:/i.test(body)) {
      errors.push(err(section, statementSnippet(body, /overall severity:.{0,30}/i), "omit rating boilerplate from prose", "overallSeverity"));
    }
    if (/qualifying record set/i.test(body)) {
      errors.push(err(section, statementSnippet(body, /qualifying record set/i), "omit source-volume phrasing", "incidentCount"));
    }
    if (/primary pressure point/i.test(body) && !mentionsPrimary(body)) {
      errors.push(err(section, statementSnippet(body, /[^.]*primary pressure point[^.]*/i), primary, "primaryPressurePoint.label"));
    }
    for (const indicator of directions) {
      const name = indicator.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nearby = new RegExp(`${name}[^.;]{0,80}`, "i").exec(body)?.[0] ?? "";
      if (indicator.direction === "falling" && /\b(rising|firming|not retreating)\b/i.test(nearby)) {
        errors.push(err(section, nearby, "falling", `marketIndicators.${indicator.label}.direction`));
      }
      if (indicator.direction === "rising" && /\b(falling|easing|retreating)\b/i.test(nearby)) {
        errors.push(err(section, nearby, "rising", `marketIndicators.${indicator.label}.direction`));
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
