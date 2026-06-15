import type {
  CardContent,
  CountryReport,
  Incident,
  Report,
  SpotReport,
} from "@workspace/api-client-react";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import { CARD_RATINGS } from "./cardTemplates";
import { clampIssueDateToLatestRecord, filterIncidentsToWindow } from "./reportWindow";

// Sources an analyst can pull card content from.
export type CardSourceKind = "country" | "incident" | "spot" | "report";

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Time-of-day for the header clock row. Only emitted when the source timestamp
// carries a non-midnight time, so date-only records don't show a fake "00:00".
function formatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

// First non-empty country from a semicolon-separated tag, ignoring "Unknown".
function primaryCountry(raw?: string | null): string {
  if (!raw) return "";
  for (const part of raw.split(/[;,]/)) {
    const t = part.trim();
    if (t && t.toLowerCase() !== "unknown") return t;
  }
  return "";
}

function normaliseRating(severity?: string | null): string | undefined {
  if (!severity) return undefined;
  const s = severity.toLowerCase();
  return (CARD_RATINGS as readonly string[]).includes(s) ? s : undefined;
}

// Reports carry no explicit severity field, so infer the card rating from the
// five-tier risk vocabulary used in the prose, taking the highest tier present.
const RATING_TIERS: readonly string[] = [
  "extreme",
  "high",
  "moderate",
  "low",
  "insignificant",
];

function inferRatingFromProse(...parts: Array<string | null | undefined>): string | undefined {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return undefined;
  for (const tier of RATING_TIERS) {
    if (new RegExp(`\\b${tier}\\b`).test(text)) return tier;
  }
  return undefined;
}

// CARD_RATINGS ordered weakest→strongest, so a tier's index is its rank.
const RATING_RANK: Record<string, number> = Object.fromEntries(
  CARD_RATINGS.map((r, i) => [r, i]),
);

// A flashpoint/protests report draws from BOTH data buckets (live `flashpoint`
// scraper + legacy `protests` import); every other report matches its topic
// exactly. Mirrors the scoping used by the report builders.
function reportDataTopics(topic: string): Set<string> {
  if (topic === "flashpoint" || topic === "protests") {
    return new Set(["flashpoint", "protests"]);
  }
  return new Set([topic]);
}

// Canonical report risk rating, derived from the incidents inside the report's
// reporting window. Reports have no stored severity, so the report's own risk
// level is the worst credible tier among the events it covers — the standard
// "peak threat in period" posture, with `extreme` reserved for casualty/
// emergency signals by the upstream classifier. Scoping mirrors the report
// builders: restrict to the report's data bucket(s), clamp the issue date down
// to the latest available record (Option A honest dating), then take the window.
// Returns undefined when no scoped incident carries a usable rating, so callers
// can fall back to the prose heuristic.
export function ratingFromScopedIncidents(
  rep: Report,
  incidents: Incident[],
): string | undefined {
  if (!incidents.length) return undefined;
  const topics = reportDataTopics(rep.topic);
  const scoped = incidents.filter((i) => i.topic != null && topics.has(i.topic));
  if (!scoped.length) return undefined;
  const issueDate = clampIssueDateToLatestRecord(rep.issueDate, scoped);
  const windowed = filterIncidentsToWindow(scoped, rep.topic, issueDate);
  let bestRank = -1;
  for (const inc of windowed) {
    const tier = inc.severity?.toLowerCase();
    if (!tier) continue;
    const rank = RATING_RANK[tier];
    if (rank !== undefined && rank > bestRank) bestRank = rank;
  }
  return bestRank >= 0 ? CARD_RATINGS[bestRank] : undefined;
}

// The auto-derived report rating: the worst credible tier among the report's
// scoped incidents, falling back to the five-tier vocabulary inferred from the
// prose when no scoped incident carries a usable rating. This is the value the
// stored `riskRating` defaults to when an analyst leaves the override blank.
export function autoReportRating(
  rep: Report,
  incidents: Incident[] = [],
): string | undefined {
  return (
    ratingFromScopedIncidents(rep, incidents) ??
    inferRatingFromProse(
      rep.situation,
      rep.whatMatters,
      rep.implications,
      rep.whatHappened,
    )
  );
}

// Split prose into clean sentences for key-point derivation.
function sentences(text?: string | null): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

// Pad/trim to exactly three key points (card contract).
function threeKeyPoints(points: string[]): string[] {
  const kp = points.filter(Boolean).slice(0, 3);
  while (kp.length < 3) kp.push("");
  return kp;
}

export function incidentToCard(inc: Incident): Partial<CardContent> {
  const summarySentences = sentences(inc.summary);
  const keyPoints = threeKeyPoints(
    summarySentences.length > 1 ? summarySentences.slice(0, 3) : summarySentences,
  );
  return {
    topic: canonicalTopic(inc.topic).topicLine,
    country: primaryCountry(inc.country),
    rating: normaliseRating(inc.severity) ?? "moderate",
    headline: inc.displayTitle?.trim() || inc.title,
    bluf: summarySentences.slice(0, 2).join(" ") || inc.summary,
    keyPoints,
    eventDate: formatDate(inc.occurredAt),
    eventTime: formatTime(inc.occurredAt),
    mapLocation: inc.location?.trim() || primaryCountry(inc.country),
    sourceNote: inc.source?.trim() || "",
  };
}

export function spotReportToCard(rep: SpotReport): Partial<CardContent> {
  const keyPoints = threeKeyPoints([
    ...sentences(rep.operationalImpact).slice(0, 1),
    ...sentences(rep.assessment).slice(0, 1),
    ...sentences(rep.currentSituation).slice(0, 1),
    ...sentences(rep.recommendedActions).slice(0, 2),
  ]);
  const place = [rep.city, rep.province, rep.country]
    .map((p) => p?.trim())
    .filter(Boolean)[0];
  return {
    topic: rep.category?.trim() || "Spot Report",
    country: primaryCountry(rep.country),
    rating: normaliseRating(rep.severity) ?? "moderate",
    headline: rep.title,
    bluf: rep.bluf?.trim() || sentences(rep.incidentDetails).slice(0, 2).join(" "),
    keyPoints,
    outlook: rep.outlook?.trim() || "",
    eventDate: formatDate(rep.incidentDate || rep.reportDate),
    eventTime: formatTime(rep.incidentDate),
    mapLocation: place || primaryCountry(rep.country),
  };
}

export function countryReportToCard(rep: CountryReport): Partial<CardContent> {
  const trend = sentences(rep.trendSummary);
  const implications = sentences(rep.implications);
  // Prefer prose-derived key points; fall back to the KPI tiles (label: value)
  // so countries whose narrative is unwritten still pull useful figures.
  const kpiPoints = (rep.keyNumbers ?? [])
    .map((k) => [k.label, k.value].filter(Boolean).join(": "))
    .filter(Boolean);
  const prosePoints = [...trend.slice(0, 2), ...implications.slice(0, 1)].filter(Boolean);
  const keyPoints = threeKeyPoints(prosePoints.length ? prosePoints : kpiPoints);
  return {
    topic: "Country Risk",
    country: rep.name,
    headline: `${rep.name} — Country Risk Snapshot`,
    bluf:
      sentences(rep.overview).slice(0, 2).join(" ") ||
      rep.overview ||
      trend.slice(0, 1).join(" ") ||
      "",
    keyPoints,
    outlook: implications.slice(0, 2).join(" ") || "",
    mapLocation: rep.name,
  };
}

// Pull from a published topic/country briefing. `countryName` resolves the
// report's countrySlug to a display name when the caller has it; otherwise the
// country field is left blank for topic reports that aren't country-scoped.
export function reportToCard(
  rep: Report,
  countryName?: string,
  incidents: Incident[] = [],
): Partial<CardContent> {
  const situation = sentences(rep.situation);
  const whatMatters = sentences(rep.whatMatters);
  const implications = sentences(rep.implications);
  const whatHappened = sentences(rep.whatHappened);
  // Prefer the analyst's "What Matters" / "Implications" findings; fall back to
  // "What Happened" so a report without those sections still pulls usefully.
  const findings = [
    ...whatMatters.slice(0, 2),
    ...implications.slice(0, 1),
    ...whatHappened.slice(0, 2),
  ].filter(Boolean);
  const keyPoints = threeKeyPoints(findings);
  const country = (countryName ?? "").trim() || primaryCountry(rep.countrySlug);
  return {
    topic: canonicalTopic(rep.topic).topicLine,
    country,
    // Prefer the analyst's stored override, then the rating computed from the
    // report's scoped incidents, then the prose heuristic, then a safe default.
    rating:
      normaliseRating(rep.riskRating) ??
      autoReportRating(rep, incidents) ??
      "moderate",
    headline: resolveReportTitle(rep.topic, rep.title),
    bluf:
      situation.slice(0, 2).join(" ") ||
      rep.situation?.trim() ||
      whatHappened.slice(0, 2).join(" ") ||
      "",
    keyPoints,
    outlook: sentences(rep.watchNext).slice(0, 2).join(" ") || "",
    mapLocation: country,
  };
}
