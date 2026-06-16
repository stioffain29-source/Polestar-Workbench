import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow } from "./reportWindow";
import {
  filterTopicReportIncidents,
  type TopicFastFactCard,
} from "./topicFastFacts";
import {
  classifyConflictCategory,
  CATEGORY_CARD_LABEL,
  detectOperationalImpacts,
} from "./conflictAnalysis";
import { splitAttributedCountries } from "./topicRelevance";
import { selectRelatedIncidents } from "./relatedIncidents";

// Single source of truth for the Conflict Watch report's analysed dataset.
// Mirrors the flashpointReportDataset pattern so the on-screen preview
// (ConflictReportPreview) and the PDF (exportConflictReportPdf) render the
// SAME sections, in the SAME order, from the SAME numbers and prose — the
// preview/PDF parity guarantee.
//
// Conflict Watch is the kinetic, casualty-grade theatre (war, insurgency,
// bombings/airstrikes, abduction & armed crime). The report is LOCATION-LED:
// it ranks the watched theatres dynamically and leads with where the fighting
// is and who is exposed, rather than a fixed executive-summary template.
//
// Ranking (highest first): worst severity -> casualty signal -> incident
// count -> operational relevance (breadth of operational-impact tags) ->
// movement / sites / infrastructure / evacuation signal -> latest date ->
// theatre name.

export interface ConflictReportIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  displayTitle?: string | null;
}

export interface ConflictEnrichedIncident extends ConflictReportIncident {
  date: Date;
  /** Conflict category card label, e.g. "Armed Clashes". */
  issue: string;
}

export interface ConflictActivityArea {
  theatre: string;
  incidents: ConflictEnrichedIncident[];
  worstSeverity: string;
  worstSeverityLabel: string;
  casualtySignalCount: number;
  incidentCount: number;
  operationalScore: number;
  siteMovementScore: number;
  topCategories: string[];
  topImpacts: string[];
  latestDate: Date;
  paragraph: string;
}

export interface ConflictReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  windowIncidents: ConflictEnrichedIncident[];
  fastFacts: TopicFastFactCard[];
  topActivityAreas: ConflictActivityArea[];
  otherWatchedTheatres: ConflictActivityArea[];
  relatedIncidents: ConflictEnrichedIncident[];
  worstSeverity: string;
  worstSeverityLabel: string;
  autoSituation: string;
  autoOtherWatched: string;
  autoWhatMatters: string;
  autoWatchNext: string;
  autoPolestarView: string;
}

// ---------------------------------------------------------------------------
// Severity scaffolding (kept local so this module stays pure and test-friendly
// — it must not pull jsPDF in via pdfChrome).
// ---------------------------------------------------------------------------
const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};
function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function toDate(s: string): Date {
  try {
    const d = parseISO(s);
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch {
    return new Date(0);
  }
}

function textOf(i: ConflictReportIncident) {
  return {
    title: i.title,
    summary: i.summary ?? null,
    displayTitle: i.displayTitle ?? null,
  };
}

// Operational-impact labels that count toward the "movement / sites /
// infrastructure / evacuation" tiebreaker. "Casualties reported" is handled
// separately as the casualty signal, so it is deliberately excluded here.
const SITE_MOVEMENT_IMPACTS = new Set<string>([
  "Civilian harm or displacement",
  "Transport or checkpoint disruption",
  "Energy or utility disruption",
  "Aviation or maritime risk",
  "Security-force or government targeting",
]);

// Map an operational-impact label to a plain operational-exposure phrase used
// in the location paragraphs and the What Matters section.
const IMPACT_EXPOSURE: Record<string, string> = {
  "Civilian harm or displacement": "civilian harm and displacement",
  "Transport or checkpoint disruption": "road, checkpoint and convoy movement",
  "Energy or utility disruption": "power and fuel infrastructure",
  "Aviation or maritime risk": "airports, airspace and port access",
  "Security-force or government targeting": "military and government sites",
};

// Lowercase a category card label for use mid-sentence ("Bombings &
// Airstrikes" -> "bombings and airstrikes").
function categoryPhrase(label: string): string {
  return label.toLowerCase().replace(/\s*&\s*/g, " and ");
}

// A cautious "who" clause derived only from the category mix present — no
// actor names are invented, just the broad nature of the armed activity.
function actorClause(topCategories: string[]): string {
  const set = new Set(topCategories);
  if (set.has("Insurgency")) return "insurgent and militant groups are active";
  if (set.has("Abduction & Crime"))
    return "armed criminal groups are operating";
  if (set.has("Bombings & Airstrikes"))
    return "the activity points to organised armed forces";
  return "armed fighters are engaged";
}

function exposurePhrases(impacts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of impacts) {
    if (l === "Casualties reported") continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => IMPACT_EXPOSURE[l])
    .filter(Boolean);
  return Array.from(new Set(ordered));
}

// ---------------------------------------------------------------------------
// Per-theatre paragraph (what / where / who / why-operationally / exposure).
// No parenthetical record counts — counts live only on the Fast Facts cards.
// ---------------------------------------------------------------------------
function buildAreaParagraph(area: ConflictActivityArea): string {
  const cats = area.topCategories.slice(0, 2).map(categoryPhrase);
  const what = cats.length ? joinList(cats) : "armed activity";
  const casualtyClause =
    area.casualtySignalCount > 0 ? ", with casualties reported" : "";
  const exposure = exposurePhrases(area.topImpacts).slice(0, 3);
  const exposureSentence =
    exposure.length > 0
      ? `For operations the exposure runs to ${joinList(exposure)}, so staff movement and fixed-site security are the live concerns.`
      : `For operations the main exposure is to staff moving through or working near the affected areas, so movement control and site security are the live concerns.`;
  return [
    `${area.theatre} recorded ${what} over the reporting period.`,
    `The most serious activity reached ${area.worstSeverityLabel}${casualtyClause}, and ${actorClause(area.topCategories)}.`,
    exposureSentence,
  ].join(" ");
}

function buildArea(
  theatre: string,
  rows: ConflictEnrichedIncident[],
): ConflictActivityArea {
  let worstKey = "";
  let worstRank = 0;
  let casualty = 0;
  let opScore = 0;
  let siteScore = 0;
  const impactCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const i of rows) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > worstRank) {
      worstRank = r;
      worstKey = k;
    }
    const impacts = detectOperationalImpacts(textOf(i));
    if (impacts.includes("Casualties reported")) casualty += 1;
    opScore += impacts.length;
    for (const l of impacts) {
      impactCounts.set(l, (impactCounts.get(l) ?? 0) + 1);
      if (SITE_MOVEMENT_IMPACTS.has(l)) siteScore += 1;
    }
    catCounts.set(i.issue, (catCounts.get(i.issue) ?? 0) + 1);
  }
  const topCategories = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  const topImpacts = Array.from(impactCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
  const latestDate = rows.reduce(
    (m, i) => (i.date > m ? i.date : m),
    rows[0]?.date ?? new Date(0),
  );
  const area: ConflictActivityArea = {
    theatre,
    incidents: rows,
    worstSeverity: worstKey,
    worstSeverityLabel: worstKey ? SEV_LABEL[worstKey] : "—",
    casualtySignalCount: casualty,
    incidentCount: rows.length,
    operationalScore: opScore,
    siteMovementScore: siteScore,
    topCategories,
    topImpacts,
    latestDate,
    paragraph: "",
  };
  area.paragraph = buildAreaParagraph(area);
  return area;
}

function compareAreas(a: ConflictActivityArea, b: ConflictActivityArea): number {
  const ra = SEV_RANK[a.worstSeverity] ?? 0;
  const rb = SEV_RANK[b.worstSeverity] ?? 0;
  if (rb !== ra) return rb - ra;
  if (b.casualtySignalCount !== a.casualtySignalCount)
    return b.casualtySignalCount - a.casualtySignalCount;
  if (b.incidentCount !== a.incidentCount)
    return b.incidentCount - a.incidentCount;
  if (b.operationalScore !== a.operationalScore)
    return b.operationalScore - a.operationalScore;
  if (b.siteMovementScore !== a.siteMovementScore)
    return b.siteMovementScore - a.siteMovementScore;
  const td = b.latestDate.getTime() - a.latestDate.getTime();
  if (td !== 0) return td;
  return a.theatre.localeCompare(b.theatre);
}

// ---------------------------------------------------------------------------
// Fast Facts — conflict vocabulary (uses the conflict category classifier for
// the event-type card rather than the generic incident classifier).
// ---------------------------------------------------------------------------
function buildFastFacts(
  windowIncidents: ConflictEnrichedIncident[],
  reportingPeriod: string,
): TopicFastFactCard[] {
  const total = windowIncidents.length;

  let highestKey = "";
  let highestRank = 0;
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) {
      highestRank = r;
      highestKey = k;
    }
  }
  const highestLabel = highestKey ? SEV_LABEL[highestKey] : "—";

  const catCounts = new Map<string, number>();
  for (const i of windowIncidents)
    catCounts.set(i.issue, (catCounts.get(i.issue) ?? 0) + 1);
  let topCat = "—";
  let topCatN = 0;
  for (const [c, n] of catCounts)
    if (n > topCatN) {
      topCatN = n;
      topCat = c;
    }

  const countryCounts = new Map<string, number>();
  for (const i of windowIncidents)
    for (const c of splitAttributedCountries(i.country))
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
  let topCountry = "—";
  let topCountryN = 0;
  for (const [c, n] of countryCounts)
    if (n > topCountryN) {
      topCountryN = n;
      topCountry = c;
    }

  let latest = "—";
  const dates = windowIncidents
    .map((i) => i.date)
    .filter((d) => !isNaN(d.getTime()) && d.getTime() > 0);
  if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");

  return [
    { label: "Reporting Period", value: reportingPeriod },
    {
      label: "Total Records",
      value: String(total),
      note: "Conflict incidents this period",
    },
    {
      label: "Highest Severity",
      value: highestLabel,
      severity: highestKey || undefined,
      note: highestKey ? "Highest rating this period" : undefined,
    },
    {
      label: "Top Event Type",
      value: topCat,
      note:
        topCatN > 0
          ? `${topCatN} record${topCatN === 1 ? "" : "s"}`
          : undefined,
    },
    {
      label: "Most Affected Country",
      value: topCountry === "—" ? "Country not identified" : topCountry,
      note:
        topCountryN > 0
          ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}`
          : "Limited reporting",
    },
    { label: "Latest Incident", value: latest },
  ];
}

// ---------------------------------------------------------------------------
// Section prose (situation / other watched / what matters / watch next /
// polestar view). All derived from the ranked theatres so the words can never
// contradict the Top Activity Areas list.
// ---------------------------------------------------------------------------
const ZERO_SITUATION =
  "No armed activity was reported across the watched theatres this period. Read the quiet stretch as a gap in reporting rather than evidence the fighting has stopped; the standing kinetic exposures remain until fresh reporting lands.";
const ZERO_OTHER =
  "No other theatres carried notable armed activity this period.";
const ZERO_WHAT_MATTERS =
  "People safety, fixed-site security and evacuation readiness stay the operational concern across the watched theatres whether or not new reporting lands.";
const ZERO_WATCH_NEXT =
  "Renewed armed activity in any of the watched theatres.\nSecurity-force operations and lockdowns that close roads, checkpoints and districts at short notice.\nSpillover toward energy, transport or maritime infrastructure that turns a security event into a continuity one.";
const ZERO_POLESTAR =
  "Nothing actionable came through on conflict this period. The standing kinetic risks in the watched theatres remain, so the protective posture — travel limits, hardened sites and rehearsed evacuation — stays in place until reporting resumes.";

function buildSituation(
  areas: ConflictActivityArea[],
  worstKey: string,
  worstLabel: string,
): string {
  if (areas.length === 0) return ZERO_SITUATION;
  const lead = areas[0].theatre;
  const second = areas[1]?.theatre ?? "";
  const leadClause = ` ${lead} is the main pressure point${second ? `, with ${second} close behind` : ""}.`;
  const sevRank = SEV_RANK[worstKey] ?? 0;
  const sevClause =
    sevRank >= 4
      ? ` The worst incidents reached ${worstLabel}, a casualty-grade level that puts people safety first.`
      : ` The most serious activity reached ${worstLabel}.`;
  return `Armed activity across the watched theatres is the standing condition this period.${leadClause}${sevClause} Kinetic risk is a people-safety problem before it is a continuity one, so this read leads with where the fighting is and who is exposed.`;
}

function buildOtherWatched(areas: ConflictActivityArea[]): string {
  if (areas.length === 0) return ZERO_OTHER;
  const named = areas.slice(0, 6).map((a) => a.theatre);
  return `Beyond the lead theatres, lower-level armed activity was also reported in ${joinList(named)}. These carry a thinner record this period but stay on watch — a single clash or bombing can move any of them up the list quickly.`;
}

function buildWhatMatters(
  areas: ConflictActivityArea[],
  allImpacts: string[],
): string {
  if (areas.length === 0) return ZERO_WHAT_MATTERS;
  const lead = areas[0].theatre;
  const exposure = joinList(exposurePhrases(allImpacts).slice(0, 3));
  const para1 = `Kinetic events land on people first: casualties, abductions and the danger to anyone moving through or working near a contested area. They land next on access — checkpoints, road closures and security operations that cut routes and sites at short notice.`;
  const exposureClause = exposure
    ? ` Across the window the clearest operational exposure is to ${exposure}.`
    : "";
  const para2 = `Exposure to ${lead} is the live pressure point for staff movement, fixed-site security and evacuation planning.${exposureClause} Where armed activity meets a depot, worksite or convoy within range, operations pause and duty-of-care obligations sharpen, and the decision shifts from managing disruption to protecting and moving people.`;
  return `${para1}\n\n${para2}`;
}

function buildWatchNext(
  areas: ConflictActivityArea[],
  categoriesPresent: Set<string>,
): string {
  if (areas.length === 0) return ZERO_WATCH_NEXT;
  const lines: string[] = [];
  const leadNames = areas.slice(0, 2).map((a) => a.theatre);
  if (leadNames.length > 0)
    lines.push(
      `Repeat or escalating armed activity in ${joinList(leadNames)} — a sign of a widening operation rather than a one-off event.`,
    );
  if (categoriesPresent.has("Bombings & Airstrikes"))
    lines.push(
      "Further bombing, airstrike or IED activity, which raises the threat to fixed sites and main routes within range.",
    );
  if (categoriesPresent.has("Abduction & Crime"))
    lines.push(
      "Abduction and armed-crime activity targeting staff, contractors or convoys.",
    );
  if (categoriesPresent.has("Insurgency"))
    lines.push(
      "Insurgent raids or ambushes that extend the contested area into new districts.",
    );
  lines.push(
    "Security-force operations and lockdowns that close roads, checkpoints and districts at short notice.",
  );
  lines.push(
    "Spillover toward energy, transport or maritime infrastructure that turns a security event into a continuity one.",
  );
  return lines.join("\n");
}

function buildPolestarView(
  areas: ConflictActivityArea[],
  worstKey: string,
): string {
  if (areas.length === 0) return ZERO_POLESTAR;
  const lead = areas[0].theatre;
  const others = areas.slice(1, 3).map((a) => a.theatre);
  const pressure = ` ${lead} is the clearest pressure point${others.length ? `, with ${joinList(others)} also worth watching` : ""}.`;
  const grade = (SEV_RANK[worstKey] ?? 0) >= 4 ? "casualty-grade" : "contained but live";
  return `Conflict Watch is flagging ${grade} kinetic risk rather than a rise in headlines. The danger is to people first and continuity second, so the operational answer is protective: hard travel limits, hardened fixed sites and rehearsed evacuation rather than headline tracking.${pressure}`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
export function buildConflictReportDataset(
  incidents: ConflictReportIncident[],
  topic: string,
  issueDate: string,
): ConflictReportDataset {
  const win = resolveReportWindow(topic, issueDate);
  const windowRaw = filterTopicReportIncidents(incidents, topic, issueDate);

  const enriched: ConflictEnrichedIncident[] = windowRaw.map((i) => ({
    ...i,
    date: toDate(i.occurredAt),
    issue: CATEGORY_CARD_LABEL[classifyConflictCategory(textOf(i))],
  }));

  // Group enriched incidents by attributed country. Compound attributions
  // ("India; Pakistan") add the incident to BOTH theatres, matching how the
  // Fast Facts "Most Affected Country" card counts countries.
  const byCountry = new Map<string, ConflictEnrichedIncident[]>();
  for (const i of enriched) {
    for (const c of splitAttributedCountries(i.country)) {
      const arr = byCountry.get(c) ?? [];
      arr.push(i);
      byCountry.set(c, arr);
    }
  }

  const areas: ConflictActivityArea[] = [];
  for (const [theatre, rows] of byCountry) areas.push(buildArea(theatre, rows));
  areas.sort(compareAreas);

  const topActivityAreas = areas.slice(0, 3);
  const otherWatchedTheatres = areas.slice(3);

  let worstKey = "";
  let worstRank = 0;
  for (const i of enriched) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > worstRank) {
      worstRank = r;
      worstKey = k;
    }
  }
  const worstLabel = worstKey ? SEV_LABEL[worstKey] : "—";

  const categoriesPresent = new Set(enriched.map((i) => i.issue));
  const allImpacts = enriched.flatMap((i) => detectOperationalImpacts(textOf(i)));

  const relatedIncidents = selectRelatedIncidents(enriched, topic);

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: `Reporting period: ${win.label}`,
    windowIncidents: enriched,
    fastFacts: buildFastFacts(enriched, win.shortLabel),
    topActivityAreas,
    otherWatchedTheatres,
    relatedIncidents,
    worstSeverity: worstKey,
    worstSeverityLabel: worstLabel,
    autoSituation: buildSituation(topActivityAreas, worstKey, worstLabel),
    autoOtherWatched: buildOtherWatched(otherWatchedTheatres),
    autoWhatMatters: buildWhatMatters(topActivityAreas, allImpacts),
    autoWatchNext: buildWatchNext(topActivityAreas, categoriesPresent),
    autoPolestarView: buildPolestarView(topActivityAreas, worstKey),
  };
}

// Phrases drawn from the legacy CONFLICT prose pack in draftReportProse.ts.
// When a saved report's editable field still carries one of these template
// seeds, the preview and PDF replace it with the data-driven auto-prose so
// already-saved Conflict reports stop showing boilerplate without a reseed.
const GENERIC_CONFLICT_PHRASES = [
  "kinetic, casualty-grade picture rather than a question of public order",
  "These are armed events",
  "protect people first, continuity second",
  "Armed activity is the standing condition across the watched theatres",
  "Conflict reporting was light this week",
  "Conflict reporting was quiet this week",
  "Kinetic events land first on people",
  "Set hard no-go limits on travel into contested districts",
  "Repeat or escalating clashes in the same area",
  "Conflict Watch is flagging kinetic, casualty-grade risk",
  "Armed activity remains the background condition",
  "People safety, site security and evacuation readiness stay the operational concern",
  "Nothing useful came through on conflict this week",
  "No notable armed activity came through",
];

export function isGenericConflictProse(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return GENERIC_CONFLICT_PHRASES.some((p) => t.includes(p));
}
