import type {
  CardContent,
  CountryReport,
  Incident,
  Report,
  SpotReport,
} from "@workspace/api-client-react";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import { CARD_RATINGS } from "./cardTemplates";

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
export function reportToCard(rep: Report, countryName?: string): Partial<CardContent> {
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
    rating:
      inferRatingFromProse(
        rep.situation,
        rep.whatMatters,
        rep.implications,
        rep.whatHappened,
      ) ?? "moderate",
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
