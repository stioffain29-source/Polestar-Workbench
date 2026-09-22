/**
 * Fuel Watch's single source of truth.
 *
 * This module is deliberately free of renderer and AI dependencies. It filters
 * once, computes every report-level finding once, creates the five analytical
 * sections from those facts, and validates a proposed rendered report against
 * the same facts before publication.
 */
import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";
import {
  deriveFuelIncidentCountry,
  isConcreteFuelSiteEventText,
  isGenericFuelScopeText,
} from "./fuelCountry";
import { isSocialPostTitle } from "./fuelReportFacts";
import { capFuelMarketSeverity, buildFuelAnalyticalSections } from "./fuelNarratives";
import {
  deriveFuelMarketIndicator,
  type FuelMarketComparisonScope,
  type FuelMarketDirection,
  type FuelMarketTemporalStatus,
} from "./fuelMarketIndicators";
import { filterIncidentsToWindow, resolveReportWindow } from "./reportWindow";
import { format } from "date-fns";

export interface FuelAnalyticalProvenance {
  supportingIncidentIds: string[];
  supportingEvidenceFamilyIds: string[];
  supportingClaim?: string;
  verifiedText?: string;
}

export interface FuelSectionsProvenance {
  whatHappened?: FuelAnalyticalProvenance[];
  watchNext?: FuelAnalyticalProvenance[];
}

export const FUEL_SEVERITIES = ["Insignificant", "Low", "Moderate", "High", "Extreme"] as const;
export type FuelSeverity = (typeof FUEL_SEVERITIES)[number];
export type FuelDirection = FuelMarketDirection;
export type EvidenceStatus = "Observed" | "Reported" | "Assessed" | "Potential";

const SEVERITY_RANK: Record<FuelSeverity, number> = {
  Insignificant: 1, Low: 2, Moderate: 3, High: 4, Extreme: 5,
};
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
  supportedClaims: string[];
  evidenceFamilyId: string;
  evidenceWeight: number;
  raw: TopicFastFactsIncident;
}

export type FuelEvidenceCoverageKind = "canonical" | "syndicated" | "follow-on" | "commentary";
export interface FuelEvidenceFamilyMember {
  record: TopicFastFactsIncident;
  kind: FuelEvidenceCoverageKind;
  weight: number;
}
export interface FuelEvidenceFamily {
  id: string;
  canonicalRecord: TopicFastFactsIncident;
  members: FuelEvidenceFamilyMember[];
  /** Bounded corroboration weight. Coverage volume can never become a count of
   * independent developments. */
  weight: number;
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
  referenceValue: number | null;
  previousValue: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  direction: FuelDirection | null;
  unit: string | null;
  asOf: string | null;
  currentDate: string | null;
  referenceDate: string | null;
  temporalStatus: FuelMarketTemporalStatus;
  comparisonScope: FuelMarketComparisonScope;
  source: string | null;
}

export interface FuelCanonicalFacts {
  reportingPeriod: { issueDate: string; start: string; end: string; incidentStart: string | null; incidentEnd: string | null };
  evidenceFamilies: FuelEvidenceFamily[];
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
  judgement: FuelJudgement;
  /** Identity of the exact selected current-period evidence basis. */
  generationBasisFingerprint?: string;
}

export interface FuelJudgement {
  mainRisk: string;
  exposure: { geography: string | null; sector: string };
  direction: "upward" | "downward" | "stable" | "uncertain";
  trigger: string;
  evidenceFamilyIds: string[];
  /** Stable selected evidence ids used by deterministic watch items. */
  evidenceIds?: string[];
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
  /** Internal traceability for deterministic prose; never rendered. */
  whatHappenedEvidenceIds?: string[][];
  watchNextEvidenceIds?: string[][];
  provenance?: FuelSectionsProvenance;
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
  level: "ERROR";
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
const FAMILY_STOP = new Set("after about amid says said report reports update latest analysis opinion commentary market fuel oil gas new".split(" "));
function normalizeFamilyToken(word: string): string {
  if (/^shipp(?:ing)?$/.test(word)) return "ship";
  if (/^refin(?:er|ers|ery|eries|ing)$/.test(word)) return "refin";
  return word;
}
function familyTokens(i: TopicFastFactsIncident): Set<string> {
  return new Set((`${i.title} ${i.summary ?? ""}`.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])
    .filter((w) => !FAMILY_STOP.has(w))
    .map(normalizeFamilyToken));
}
function normalizedUrl(i: TopicFastFactsIncident): string | null {
  if (!i.sourceUrl) return null;
  try {
    const u = new URL(i.sourceUrl);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch { return i.sourceUrl.split(/[?#]/)[0].toLowerCase(); }
}
function sameEvidenceFamily(a: TopicFastFactsIncident, b: TopicFastFactsIncident): boolean {
  const ad = day(a.occurredAt);
  const bd = day(b.occurredAt);
  const gap = Math.abs(Date.parse(`${ad}T00:00:00Z`) - Date.parse(`${bd}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(gap) || gap > 3) return false;
  const au = normalizedUrl(a); const bu = normalizedUrl(b);
  if (au && bu && au === bu) return true;
  const at = familyTokens(a); const bt = familyTokens(b);
  const overlap = [...at].filter((t) => bt.has(t)).length;
  const union = new Set([...at, ...bt]).size;
  const titleA = new Set(familyTokens({ ...a, summary: "" }));
  const titleB = new Set(familyTokens({ ...b, summary: "" }));
  const titleOverlap = [...titleA].filter((token) => titleB.has(token)).length;
  const smallerTitle = Math.min(titleA.size, titleB.size);
  const titleSimilarity = smallerTitle > 0 ? titleOverlap / smallerTitle : 0;
  const geographyA = (deriveFuelIncidentCountry(a) ?? a.location ?? "").toLowerCase();
  const geographyB = (deriveFuelIncidentCountry(b) ?? b.location ?? "").toLowerCase();
  const geographyCompatible = !geographyA || !geographyB || geographyA === geographyB;
  const locationA = (a.location ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const locationB = (b.location ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const locationCompatible = !locationA || !locationB || locationA === locationB;
  const textSimilarity =
    titleOverlap >= 3 &&
    titleSimilarity >= 0.5 &&
    overlap >= 3 &&
    union > 0 &&
    overlap / union >= 0.35;
  // Global/regional market stories can acquire a different country from
  // publication or ingest metadata. When their same-day titles are strongly
  // alike, that polluted field must not split one development into several
  // evidence families. The lexical bar remains deliberately high so two
  // unrelated local incidents are not merged merely because they share
  // "fuel" vocabulary.
  const genericMarketStory =
    isGenericFuelScopeText(`${a.title ?? ""} ${a.summary ?? ""}`) ||
    isGenericFuelScopeText(`${b.title ?? ""} ${b.summary ?? ""}`);
  const sameDayGlobalNearDuplicate =
    gap <= 1 &&
    genericMarketStory &&
    titleOverlap >= 4 &&
    titleSimilarity >= 0.5;
  if (sameDayGlobalNearDuplicate) return true;
  return geographyCompatible &&
    locationCompatible &&
    titleOverlap >= 2 &&
    overlap >= 3 &&
    union > 0 &&
    overlap / union >= 0.42;
}
function coverageKind(record: TopicFastFactsIncident, canonical: TopicFastFactsIncident): FuelEvidenceCoverageKind {
  if (record === canonical) return "canonical";
  const raw = record as unknown as Record<string, unknown>;
  const explicit = `${raw.coverageType ?? raw.reportingType ?? ""}`.toLowerCase();
  const hay = `${record.title} ${record.summary ?? ""}`.toLowerCase();
  if (/comment|analysis|opinion|explainer/.test(explicit) || /\b(analysis|opinion|commentary|explainer)\b/.test(hay)) return "commentary";
  if (/follow|update/.test(explicit) || /\b(update|aftermath|reopen|resume|investigation|follow-up)\b/.test(hay)) return "follow-on";
  return "syndicated";
}
function canonicalScore(i: TopicFastFactsIncident): number {
  return SEVERITY_RANK[effectiveSeverityFor(i)] * 100
    + (i.sourceUrl ? 10 : 0) + (i.summary?.trim() ? 5 : 0)
    - (isSocialPostTitle(i.title) ? 50 : 0);
}

function stableDigest(value: string): string {
  // Small deterministic digest suitable for browser/server provenance keys.
  // It is not used as a security primitive.
  let h = 2166136261;
  for (let n = 0; n < value.length; n++) {
    h ^= value.charCodeAt(n);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function evidenceIdFor(i: TopicFastFactsIncident): string {
  const explicit = i.id;
  if (explicit !== undefined && explicit !== null && String(explicit) !== "0" && String(explicit).trim()) {
    return String(explicit);
  }
  return `fuel-evidence-${stableDigest([
    day(i.occurredAt),
    i.topic,
    i.title,
    i.summary ?? "",
    i.location ?? "",
  ].join("|"))}`;
}

/** Stable identity shared by Fuel AI generation, cache comparison and renderers. */
export function computeFuelGenerationBasisFingerprint(
  facts: Pick<FuelCanonicalFacts, "qualifyingIncidents" | "reportingPeriod">,
): string {
  const evidence = facts.qualifyingIncidents
    .map((i) => ({
      id: i.id,
      familyId: i.evidenceFamilyId,
      status: i.evidenceStatus,
      title: i.title,
      summary: i.raw.summary ?? "",
      occurredAt: i.occurredAt,
      country: i.country,
      location: i.physicalLocation,
      supportedClaims: [...i.supportedClaims].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return `fuel-basis-${stableDigest(JSON.stringify({
    period: facts.reportingPeriod,
    evidence,
  }))}`;
}
/** General event-family ledger. It uses record similarity, time and geography;
 * never country, headline, route or commodity exceptions. */
export function buildFuelEvidenceLedger(records: TopicFastFactsIncident[]): FuelEvidenceFamily[] {
  const groups: TopicFastFactsIncident[][] = [];
  for (const record of records.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const matches = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) =>
        group.some((member) => sameEvidenceFamily(member, record)),
      );
    if (matches.length === 0) {
      groups.push([record]);
      continue;
    }
    const primary = matches[0].group;
    primary.push(record);
    // A later rewrite can bridge two partial source families. Merge every
    // strongly linked group now so input order and unrelated earlier rows
    // cannot leave one underlying development split across the report.
    for (const { group, index } of matches.slice(1).sort((a, b) => b.index - a.index)) {
      primary.push(...group);
      groups.splice(index, 1);
    }
  }
  return groups.map((group) => {
    const canonicalRecord = group.slice().sort((a, b) =>
      (evidenceStatusFor(b) === "Potential" ? 0 : 1) -
        (evidenceStatusFor(a) === "Potential" ? 0 : 1) ||
      canonicalScore(b) - canonicalScore(a) ||
      b.occurredAt.localeCompare(a.occurredAt) ||
      a.title.localeCompare(b.title),
    )[0];
    const members = group.map((record) => {
      const kind = coverageKind(record, canonicalRecord);
      const weight = kind === "canonical" ? 1 : kind === "follow-on" ? 0.3 : kind === "syndicated" ? 0.15 : 0.1;
      return { record, kind, weight };
    });
    return {
      // The family id is derived from its member identities rather than the
      // input array position. Adding a newer family must not silently rename
      // every family below it and invalidate otherwise-current prose.
      id: `fuel-family-${stableDigest(
        group.map((record) => evidenceIdFor(record)).sort().join("|"),
      )}`,
      canonicalRecord,
      members,
      weight: Math.min(1.75, members.reduce((sum, member) => sum + member.weight, 0)),
    };
  });
}
function severityWord(value: FuelSeverity): string { return value.toLowerCase(); }
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
  const explicit = (i as unknown as Record<string, unknown>).evidenceStatus;
  if (
    explicit === "Observed" ||
    explicit === "Reported" ||
    explicit === "Assessed" ||
    explicit === "Potential"
  ) {
    return explicit;
  }
  const value = `${i.title ?? ""} ${i.summary ?? ""}`.toLowerCase();
  return /\b(may|might|could|potential|possible|expected|forecast|risk of|watch for)\b/.test(value) ? "Potential" : "Reported";
}

// A canonical judgement must describe the fuel risk, not repeat the source
// headline. Headlines are evidence inputs and can contain source packaging,
// speculation or market colour that is unsuitable for a client-facing risk
// label. Keep this deliberately cue-based so the label remains truthful even
// when a new event shape is not yet covered by the narrative rules.
function canonicalFuelRisk(i: CanonicalFuelIncident): string {
  const value = `${i.title} ${i.raw.summary ?? ""}`.toLowerCase();
  if (/\b(shortage|ration|rationing|forecourt|allocation|queue|queues|depot)\b/.test(value)) {
    return "physical fuel availability and distribution";
  }
  if (i.routeOrChokepoint || /\b(route|routing|transit|corridor|strait|red sea|hormuz|suez)\b/.test(value)) {
    return "fuel-route disruption and higher delivered cost";
  }
  if (/\b(refinery|refining|terminal|pipeline|production|output|maintenance|outage)\b/.test(value)) {
    return "refined-product supply tightness";
  }
  if (/\b(subsidy|levy|duty|excise|tax|price control|price cap|export ban|import ban)\b/.test(value)) {
    return "fuel-price and contract pass-through exposure";
  }
  if (/\b(price|pricing|cost|margin|crude|oil|jet fuel|surcharge)\b/.test(value)) {
    return "fuel-cost volatility";
  }
  return "fuel availability, routing and cost exposure";
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
function marketFact(
  card: { label: string; value: number | string; change?: string; unit?: string; asOf?: string; source?: string; referenceDate?: string; referenceValue?: number },
  issueDate: string,
  jetTrajectory?: { date: string; value: number }[],
  window?: { start: string; end: string },
): FuelMarketIndicatorFact {
  const derived = deriveFuelMarketIndicator({
    card,
    issueDate,
    trajectory: /\bjet\b|kerosene/i.test(card.label) ? jetTrajectory : undefined,
    window,
  });
  return {
    ...derived,
    previousValue: derived.referenceValue,
    asOf: derived.currentDate,
  };
}

export function buildFuelCanonicalFacts(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** Pass the already filtered report record set to avoid any second filtering. */
  qualifyingIncidents?: TopicFastFactsIncident[];
  marketCards: Array<{ label: string; value: number | string; change?: string; unit?: string; asOf?: string; source?: string; referenceDate?: string; referenceValue?: number }>;
  /** Jet trajectory points — when present, jet-fuel pct in prose matches the gate. */
  jetTrajectory?: { date: string; value: number }[];
  watchIndicators?: string[];
  window?: { start: string; end: string };
}): FuelCanonicalFacts {
  const fallbackWindow = resolveReportWindow("fuel", opts.issueDate);
  const window = opts.window ?? { start: format(fallbackWindow.start, "yyyy-MM-dd"), end: format(fallbackWindow.end, "yyyy-MM-dd") };
  const filtered = opts.qualifyingIncidents
    ? opts.qualifyingIncidents.filter((incident) => {
        const date = day(incident.occurredAt);
        return date >= window.start && date <= window.end;
      })
    : filterTopicReportIncidents(
        filterIncidentsToWindow(opts.incidents, "fuel", window.end),
        "fuel",
        window.end,
      );
  const evidenceFamilies = buildFuelEvidenceLedger(filtered);
  const qualifyingIncidents = evidenceFamilies.map((family): CanonicalFuelIncident => {
    const raw = family.canonicalRecord;
    const familyIsGenericMarketDevelopment =
      family.members.some(({ record }) =>
        isGenericFuelScopeText(`${record.title ?? ""} ${record.summary ?? ""}`),
      ) &&
      !family.members.some(({ record }) =>
        isConcreteFuelSiteEventText(`${record.title ?? ""} ${record.summary ?? ""}`),
      );
    const country = familyIsGenericMarketDevelopment
      ? null
      : deriveFuelIncidentCountry(raw);
    const physicalLocation = text(raw.location) ?? null;
    const severity = effectiveSeverityFor(raw);
    return {
      id: evidenceIdFor(raw), title: raw.title, occurredAt: raw.occurredAt,
      date: day(raw.occurredAt), topic: raw.topic, severity, physicalLocation,
      country, routeOrChokepoint: routeFor(raw), widerRegionalRelevance: relevanceFor(routeFor(raw)), entities: entitiesFor(raw),
      evidenceStatus: evidenceStatusFor(raw), sourceUrl: raw.sourceUrl ?? null, source: raw.source ?? null,
      supportedClaims: Array.isArray((raw as unknown as Record<string, unknown>).supportedClaims)
        ? ((raw as unknown as Record<string, unknown>).supportedClaims as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      evidenceFamilyId: family.id, evidenceWeight: family.weight, raw,
    };
  });
  // Potential/unconfirmed records remain in the selected evidence ledger for
  // traceability and Watch Next, but cannot establish a factual current theme.
  const currentQualifyingIncidents = qualifyingIncidents.filter(
    (incident) => incident.evidenceStatus !== "Potential",
  );
  const groups = (pick: (i: CanonicalFuelIncident) => string | null) => {
    const map = new Map<string, CanonicalFuelIncident[]>();
    for (const i of currentQualifyingIncidents) {
      const key = pick(i); if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return stableSort([...map.entries()].map(([label, rows]) => {
      const continuityBoost = rows.reduce((n, i) => n + fuelContinuityBoost(i.raw), 0);
      return {
        label,
        count: rows.length,
        continuityBoost,
        severityScore: rows.reduce((n, i) => n + SEVERITY_RANK[i.severity] * i.evidenceWeight, 0) + continuityBoost,
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
  for (const i of currentQualifyingIncidents) severityDistribution[i.severity]++;
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
  const newsTitled = currentQualifyingIncidents.filter((i) => !isSocialPostTitle(i.title));
  const highestPriorityIncident = (newsTitled.length ? newsTitled : currentQualifyingIncidents).slice().sort(byPriority)[0] ?? null;
  const overallSeverity = highestPriorityIncident?.severity ?? "Insignificant";
  const sourceCoverage = currentQualifyingIncidents.length === 0 ? 1 : currentQualifyingIncidents.filter((i) => Boolean(i.sourceUrl || i.source)).length / currentQualifyingIncidents.length;
  const evidenceConfidence = sourceCoverage >= 0.8 ? "High" : sourceCoverage >= 0.5 ? "Moderate" : "Low";
  const periodIndicators = opts.marketCards.map((c) => marketFact(c, opts.issueDate, opts.jetTrajectory, window));
  const up = periodIndicators.filter((i) => i.comparisonScope === "reporting-period" && i.direction === "rising").length;
  const down = periodIndicators.filter((i) => i.comparisonScope === "reporting-period" && i.direction === "falling").length;
  const judgement: FuelJudgement = {
     mainRisk: highestPriorityIncident
       ? canonicalFuelRisk(highestPriorityIncident)
       : "No material current-period operational development",
    exposure: {
      geography: primaryPressurePoint.kind === "distributed" ? null : primaryPressurePoint.label,
      sector: currentQualifyingIncidents.some((i) => /\b(shortage|ration|forecourt|depot)\b/i.test(`${i.title} ${i.raw.summary ?? ""}`))
        ? "road fuel distribution" : currentQualifyingIncidents.some((i) => i.routeOrChokepoint)
          ? "routing and fuel delivery" : "fuel procurement",
    },
    direction: up > down ? "upward" : down > up ? "downward" : periodIndicators.some((i) => i.comparisonScope === "reporting-period") ? "stable" : "uncertain",
    trigger: currentQualifyingIncidents.some((i) => i.routeOrChokepoint)
      ? "a confirmed change in transit availability"
      : currentQualifyingIncidents.length ? "confirmed escalation or resolution of the lead development" : "new current-period operational evidence",
    evidenceFamilyIds: highestPriorityIncident ? [highestPriorityIncident.evidenceFamilyId] : [],
      evidenceIds: highestPriorityIncident ? [highestPriorityIncident.id] : [],
  };
  const result: FuelCanonicalFacts = {
    reportingPeriod: { issueDate: opts.issueDate, start: window.start, end: window.end, incidentStart: qualifyingIncidents.map((i) => i.date).sort()[0] ?? null, incidentEnd: qualifyingIncidents.map((i) => i.date).sort().at(-1) ?? null },
    evidenceFamilies,
    qualifyingIncidents, incidentCount: qualifyingIncidents.length, distinctIncidentDates: [...new Set(qualifyingIncidents.map((i) => i.date))].sort(), countries, routes,
    incidentLocations: [...new Set(qualifyingIncidents.map((i) => i.physicalLocation).filter((x): x is string => Boolean(x)))].sort(), severityDistribution,
    highestPriorityIncident, primaryPressurePoint, secondaryPressurePoints, marketIndicators: periodIndicators, overallSeverity,
    evidenceConfidence, analystReviewRequired: evidenceConfidence === "Low" && overallSeverity !== "Insignificant", currentConditions: qualifyingIncidents.filter((i) => i.evidenceStatus !== "Potential"),
    watchIndicators: [...new Set([
      ...(opts.watchIndicators ?? []).map((x) => x.trim()).filter(Boolean),
      judgement.trigger,
    ])],
    judgement,
  };
  result.generationBasisFingerprint = computeFuelGenerationBasisFingerprint(result);
  return result;
}

function pressureSentence(facts: FuelCanonicalFacts): string {
  return facts.primaryPressurePoint.kind === "distributed" ? "Distributed pressure is the primary pressure point; the evidence does not support a unique leader." : `${facts.primaryPressurePoint.label} is the primary pressure point.`;
}
function marketSentence(facts: FuelCanonicalFacts): string {
  const indicators = facts.marketIndicators.slice(0, 3);
  if (!indicators.length) return "No market indicators were supplied for this period.";
  const rendered = indicators.flatMap((i) => {
    const value = `${i.currentValue}${i.unit ? ` ${i.unit}` : ""}`;
    if (i.temporalStatus !== "current-period") {
      return i.currentDate ? [`${i.label} stood at ${value} on ${i.currentDate}.`] : [];
    }
    const movement = i.direction && i.comparisonScope === "reporting-period"
      ? ` and was ${i.direction} over the reporting period`
      : "";
    const implication = i.direction === "rising"
      ? " This increases near-term procurement and surcharge pressure."
      : i.direction === "falling"
        ? " This eases near-term procurement pressure, subject to physical supply conditions."
        : " Physical supply and route conditions remain the main business variables.";
    return [`${i.label} stood at ${value}${movement}.${implication}`];
  });
  return rendered.join(" ") || "Current benchmark levels are shown in the reporting-period dashboard.";
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
  const byId = new Map(facts.qualifyingIncidents.map((incident) => [incident.id, incident]));
  const provenanceFor = (
    groups: string[][] | undefined,
    renderedItems: string,
    separator: "\n" | "\n\n",
  ): FuelAnalyticalProvenance[] =>
    (groups ?? []).map((ids, index) => {
      const incidents = ids.map((id) => byId.get(id)).filter(
        (incident): incident is CanonicalFuelIncident => Boolean(incident),
      );
      return {
        supportingIncidentIds: [...new Set(incidents.map((incident) => incident.id))],
        supportingEvidenceFamilyIds: [
          ...new Set(incidents.map((incident) => incident.evidenceFamilyId)),
        ],
        verifiedText: renderedItems.split(separator)[index]?.trim(),
      };
    });
  return {
    ...analytical,
    marketRead,
    provenance: {
      whatHappened: provenanceFor(
        analytical.whatHappenedEvidenceIds,
        analytical.whatHappened,
        "\n\n",
      ),
      watchNext: provenanceFor(
        analytical.watchNextEvidenceIds,
        analytical.watchNext,
        "\n",
      ),
    },
  };
}

function err(section: string, conflictingStatement: string, canonicalValue: unknown, sourceField: string): FuelConsistencyError {
  return {
    section,
    conflictingStatement,
    canonicalValue: String(canonicalValue),
    sourceField,
    level: "ERROR",
  };
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
  // "7 Days", "7 Day Watch" and "over 14 days" are period labels, not record
  // totals, so a day noun only counts when a record-set qualifier precedes it.
  const VOLUME_PROSE_RE =
    /\b\d+\s+(?:qualifying\s+|fuel[- ]related\s+|distinct\s+|confirmed\s+)?(?:incidents?|records?|events?|reports?)\b|\b\d+\s+(?:qualifying|fuel[- ]related|distinct|confirmed)\s+days?\b|\b(?:incidents?|records?)\s+(?:were\s+)?(?:logged|recorded|carried)\b|\b(?:reporting|qualifying)\s+(?:record|incident)\b|\b(?:led by|leads with)\s+[“"]/i;
  for (const [section, body] of Object.entries(sections)) {
    // Internal deterministic traceability arrays are intentionally not prose
    // and must never enter the renderer-level wording checks.
    if (typeof body !== "string" || !body) continue;
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
