// Shared Fast Facts computation for the 5 generic topic reports
// (Fuel, Fertiliser, Cargo, Flashpoint, Energy). The on-screen
// ReportPreview and the PDF exporter both call this so the cards
// can never drift between preview and export.
//
// Shipping has its own bespoke dataset (shippingReportDataset.ts).

import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { isTopicRelevant, sanitizeFactValue, splitAttributedCountries } from "./topicRelevance";
import { isCargoInScope } from "./cargoAnalysis";

export interface TopicFastFactsIncident {
  id?: number | string;
  topic: string;
  title: string;
  displayTitle?: string | null;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

export interface TopicFastFactCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

function sevKey(s: string): string {
  return (s ?? "").toLowerCase();
}

/**
 * Apply the same window + topic-relevance filter the PDF exporter uses.
 * Exposed so callers (e.g. ReportEditor) can pass a pre-filtered list
 * straight into related-incident tables without re-filtering.
 */
export function filterTopicReportIncidents<T extends TopicFastFactsIncident>(
  incidents: T[],
  topic: string,
  issueDate: string,
): T[] {
  // Flashpoint reports span BOTH `flashpoint` (live scraper) and `protests`
  // (legacy) topic buckets — see flashpointReportDataset.ts for the same
  // alias. Mirror it here so KPI cards in the editor match the PDF.
  const isFlashpointTopic = topic === "flashpoint" || topic === "protests";
  const rawWindow = isFlashpointTopic
    ? filterIncidentsToWindow(incidents, topic, issueDate).filter(
        (i) => i.topic === "flashpoint" || i.topic === "protests",
      )
    : filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  // Cargo Watch has its own scope classifier (APAC/ME cargo crime only) — the
  // SAME predicate the cargo page and the shared true-incidents resolver use,
  // so the report's record count reconciles exactly with the page/dashboard.
  if (topic === "cargo_watch") {
    return rawWindow.filter((i) =>
      isCargoInScope({
        title: i.title,
        summary: i.summary ?? null,
        source: i.source ?? null,
        location: i.location ?? null,
        country: i.country ?? null,
      }),
    );
  }
  return rawWindow.filter((i) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
}

/**
 * Compute the six Fast Facts cards rendered at the top of every generic
 * topic report. `incidents` is the full unfiltered list — the window is
 * applied here so callers don't need to know the filter rules.
 */
export function computeTopicFastFacts(opts: {
  topic: string;
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  topicLabel: string;
}): TopicFastFactCard[] {
  const { topic, issueDate, topicLabel } = opts;
  const reportingPeriod = resolveReportWindow(topic, issueDate).shortLabel;
  const windowIncidents = filterTopicReportIncidents(opts.incidents, topic, issueDate);

  // Highest severity in window
  let highestKey = "";
  let highestRank = 0;
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : "—";

  // Most affected country — count only attributed countries via the shared
  // splitter. "Unknown" is not a country; counting it made the card read
  // "Country not identified" even when named countries clearly led. Compound
  // strings ("Indonesia; West Papua") are split so the card and the report
  // prose normalise countries the same way and can never disagree.
  const countryCount = new Map<string, number>();
  for (const i of windowIncidents) {
    for (const c of splitAttributedCountries(i.country)) {
      countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
    }
  }
  let topCountry = "—";
  let topCountryN = 0;
  for (const [c, n] of countryCount) {
    if (n > topCountryN) { topCountryN = n; topCountry = c; }
  }

  // Latest incident date
  let latest = "—";
  if (windowIncidents.length > 0) {
    const dates = windowIncidents
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");
  }

  // Top operational issue type (never the topic/product name)
  const typeCounts = new Map<string, number>();
  for (const i of windowIncidents) {
    const type = classifyIncidentType(i);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  let topTypeLabel = "—";
  let topTypeN = 0;
  for (const [t, n] of typeCounts) {
    if (n > topTypeN) { topTypeN = n; topTypeLabel = t; }
  }

  const safeType = sanitizeFactValue(topic, topTypeLabel);
  const safeCountry = topCountry === "—"
    ? "Country not identified"
    : sanitizeFactValue(topic, topCountry);

  const countNoun =
    topic === "cargo_watch"
      ? { one: "incident", many: "incidents" }
      : { one: "record", many: "records" };
  const totalLabel = topic === "cargo_watch" ? "Total Incidents" : "Total Records";

  return [
    { label: "Reporting Period", value: reportingPeriod },
    {
      label: totalLabel,
      value: String(windowIncidents.length),
      note: `${topicLabel} this period`,
    },
    {
      label: "Highest Severity",
      value: highestLabel,
      severity: highestKey || undefined,
      note: highestKey ? "Highest rating this period" : undefined,
    },
    {
      label: "Top Issue Type",
      value: safeType,
      note: topTypeN > 0 && safeType === topTypeLabel
        ? `${topTypeN} ${topTypeN === 1 ? countNoun.one : countNoun.many}`
        : "Data quality issue",
    },
    {
      label: "Most Affected Country",
      value: safeCountry,
      note: topCountryN > 0 && safeCountry === topCountry
        ? `${topCountryN} ${topCountryN === 1 ? countNoun.one : countNoun.many}`
        : "Limited reporting",
    },
    { label: "Latest Incident", value: latest },
  ];
}
