// Shared Fast Facts computation for the Country Report Builder.
// The on-screen preview and the PDF exporter both call this so the cards
// can never drift between preview and export.
//
// Country reports use the weekly "country" pseudo-topic window (defined in
// reportWindow.ts) and the country-relevance filter (so live news blogs
// and off-topic noise are excluded from totals, charts and the table).

import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import { isCountryRelevant } from "./topicRelevance";
import { stripWireCruft } from "./incidentTitle";

export const COUNTRY_WINDOW_TOPIC = "country";

export interface CountryFastFactsIncident {
  id?: number | string;
  topic: string;
  title: string;
  displayTitle?: string | null;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}

export interface CountryFastFactCard {
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
 * Proper-case a free-text location string. Splits on spaces and hyphens,
 * preserves trailing punctuation, leaves all-uppercase acronyms (e.g. ASEAN,
 * UAE) intact. Used to fix "jayapura" -> "Jayapura" everywhere a location
 * is shown.
 */
export function titleCaseLocation(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/(\s+|-)/);
  return tokens
    .map((tok) => {
      if (!tok || /^\s+$/.test(tok) || tok === "-") return tok;
      // Preserve all-uppercase acronyms of length >= 2.
      if (tok.length >= 2 && tok === tok.toUpperCase() && /^[A-Z]+$/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function filterCountryReportIncidents(
  incidents: CountryFastFactsIncident[],
  issueDate: string,
): CountryFastFactsIncident[] {
  const rawWindow = filterIncidentsToWindow(incidents, COUNTRY_WINDOW_TOPIC, issueDate);
  return rawWindow.filter((i) =>
    isCountryRelevant({
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
}

export interface CountryFactsBreakdown {
  cards: CountryFastFactCard[];
  windowIncidents: CountryFastFactsIncident[];
  // Booleans/values useful for prose and visualisations.
  highestKey: string;
  highestLabel: string;
  // Standing-window (90-day) highest severity. Empty when no standing
  // incidents were supplied.
  standingKey: string;
  standingLabel: string;
  topTypeLabel: string;
  topTypeCount: number;
  topAreaLabel: string;
  topAreaCount: number;
  latestDate: Date | null;
  severityCounts: Record<string, number>;
  typeCounts: Map<string, number>;
  areaCounts: Map<string, number>;
  // Whether the issue-type signal is too mixed/thin to name a top type.
  topTypeIsMixed: boolean;
  // Whether the location signal is too thin to name a most-affected area.
  topAreaIsMixed: boolean;
}

/**
 * Build the six Country Report Fast Facts cards (Reporting Period,
 * Total Records, Highest Severity, Most Affected Area, Latest Incident,
 * Main Issue Type) plus the derived facts used by the rest of the report.
 */
export function computeCountryFastFacts(opts: {
  issueDate: string;
  incidents: CountryFastFactsIncident[];
  // Pre-resolved active-window incidents (already window + relevance filtered).
  // When supplied, the caller's active window drives the cards. Country reports
  // lead with the rolling 7-day weekly window, so callers pass that here.
  windowIncidents?: CountryFastFactsIncident[];
  // Wider standing-window incidents (the relevance-filtered 90-day bucket).
  // When supplied, a "Standing Risk" card is shown ALONGSIDE the week's
  // severity so a quiet 7-day window never makes an active theatre read "Low".
  standingIncidents?: CountryFastFactsIncident[];
  // Reporting-period label for the active 7-day window (overrides win.shortLabel).
  periodLabel?: string;
}): CountryFactsBreakdown {
  const { issueDate } = opts;
  const win = resolveReportWindow(COUNTRY_WINDOW_TOPIC, issueDate);
  // Strip social/video wire cruft from the title (and English displayTitle when
  // present) on every windowed record BEFORE the cards, charts, table and the
  // headless PDF read it, so the country report never shows "Watch:" /
  // "(VIDEO)" / "VIDEO BY <credit>". Both the on-screen preview and the PDF
  // exporter call this function, so cleaning here keeps them in lockstep. Shared
  // with the other report topics via lib/incidentTitle.stripWireCruft.
  const windowIncidents = (
    opts.windowIncidents ?? filterCountryReportIncidents(opts.incidents, issueDate)
  ).map((i) => {
    const t = stripWireCruft(i.title);
    const dt = i.displayTitle;
    if (typeof dt === "string" && dt.trim()) {
      const cdt = stripWireCruft(dt);
      return t === i.title && cdt === dt ? i : { ...i, title: t, displayTitle: cdt };
    }
    return t === i.title ? i : { ...i, title: t };
  });
  const total = windowIncidents.length;

  // Highest severity
  let highestKey = "";
  let highestRank = 0;
  const severityCounts: Record<string, number> = {
    extreme: 0, high: 0, moderate: 0, low: 0, insignificant: 0,
  };
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    if (k in severityCounts) severityCounts[k] += 1;
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : "—";

  // Standing risk — highest severity across the wider standing window (the
  // relevance-filtered 90-day bucket the caller supplies). A quiet 7-day
  // window must never make an active theatre read "Low": the standing card
  // carries the persistent risk picture next to the week's severity. Omitted
  // entirely when no standing incidents are supplied (backward-compatible).
  const standingIncidents = opts.standingIncidents ?? [];
  const hasStanding = standingIncidents.length > 0;
  let standingKey = "";
  let standingRank = 0;
  for (const i of standingIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > standingRank) { standingRank = r; standingKey = k; }
  }
  const standingLabel = standingKey ? (SEV_LABEL[standingKey] ?? standingKey) : "—";

  // Top operational issue type (never the topic/product name)
  const typeCounts = new Map<string, number>();
  for (const i of windowIncidents) {
    const type = classifyIncidentType(i);
    if (!type) continue;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  let topTypeLabel = "—";
  let topTypeCount = 0;
  for (const [t, n] of typeCounts) {
    if (n > topTypeCount) { topTypeCount = n; topTypeLabel = t; }
  }

  // Most affected area — uses location field, properly cased, first token
  // before any list separator.
  const areaCounts = new Map<string, number>();
  for (const i of windowIncidents) {
    const loc = (i.location ?? "").trim();
    if (!loc) continue;
    if (/^unknown$/i.test(loc)) continue;
    const first = loc.split(/[;,/]/)[0].trim();
    if (!first) continue;
    const cased = titleCaseLocation(first);
    areaCounts.set(cased, (areaCounts.get(cased) ?? 0) + 1);
  }
  let topAreaLabel = "—";
  let topAreaCount = 0;
  for (const [a, n] of areaCounts) {
    if (n > topAreaCount) { topAreaCount = n; topAreaLabel = a; }
  }

  // Latest incident date
  let latestDate: Date | null = null;
  if (windowIncidents.length > 0) {
    const dates = windowIncidents
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) latestDate = dateMax(dates);
  }

  // Signal-quality tests. The leading type/area is treated as "mixed"
  // whenever the signal isn't meaningfully ahead of the pack:
  //   - any tie at the top (multiple entries share the max count)
  //   - the leader has only one record while the sample has >=2 records
  //     (so 1/1, 1/1/1, etc. are all flagged mixed)
  //   - the leader fails to clear at least 40% of the sample (only enforced
  //     once the sample is large enough — 4+ — to make percentages meaningful)
  const typeTopCounts = Array.from(typeCounts.values());
  const typeMaxTies = typeTopCounts.filter((n) => n === topTypeCount).length;
  const topTypeIsMixed = total === 0
    ? true
    : typeMaxTies > 1
      || (topTypeCount < 2 && total >= 2)
      || (total >= 4 && topTypeCount / total < 0.4);

  const areaTopCounts = Array.from(areaCounts.values());
  const areaMaxTies = areaTopCounts.filter((n) => n === topAreaCount).length;
  const topAreaIsMixed = total === 0
    ? true
    : areaMaxTies > 1
      || (topAreaCount < 2 && total >= 2)
      || (total >= 4 && topAreaCount / total < 0.4);

  const safeTypeValue = topTypeCount === 0
    ? "—"
    : topTypeIsMixed
      ? "Multiple issue types"
      : topTypeLabel;
  const safeAreaValue = topAreaCount === 0
    ? "—"
    : topAreaIsMixed
      ? "Multiple locations"
      : topAreaLabel;

  const reportingPeriodCard: CountryFastFactCard = {
    label: "Reporting Period",
    value: opts.periodLabel ?? win.shortLabel,
  };
  const totalRecordsCard: CountryFastFactCard = {
    label: "Total Records",
    value: String(total),
    note: total === 0
      ? "No records this week"
      : total < 3
        ? "Limited sample"
        : "Incidents this week",
  };
  // Week severity. Labelled "Highest Severity Recorded" (the highest incident
  // severity in the 7-day window) so it never reads as an overall weekly risk
  // rating; the 90-day "Standing Risk" card sits beside it for the background view.
  const weekSeverityCard: CountryFastFactCard = {
    label: "Highest Severity Recorded",
    value: highestLabel,
    severity: highestKey || undefined,
    note: highestKey
      ? (hasStanding ? "Highest rating, last 7 days" : "Highest rating this week")
      : (hasStanding ? "No records this week" : undefined),
  };
  const standingCard: CountryFastFactCard = {
    label: "Standing Risk",
    value: standingLabel,
    severity: standingKey || undefined,
    note: standingKey ? "Highest rating, last 90 days" : undefined,
  };
  const mostAffectedCard: CountryFastFactCard = {
    label: "Most Affected Area",
    value: safeAreaValue,
    note: topAreaCount > 0 && !topAreaIsMixed
      ? `${topAreaCount} record${topAreaCount === 1 ? "" : "s"}`
      : undefined,
  };
  const latestIncidentCard: CountryFastFactCard = {
    label: "Latest Incident",
    value: latestDate ? format(latestDate, "dd MMM yyyy") : "—",
  };
  const mainIssueCard: CountryFastFactCard = {
    label: "Main Issue Type",
    value: safeTypeValue,
    note: topTypeCount > 0 && !topTypeIsMixed
      ? `${topTypeCount} record${topTypeCount === 1 ? "" : "s"}`
      : undefined,
  };

  // With a standing card present, place the two severities side by side
  // (positions 4 & 5 → same grid row). Without it, keep the original order.
  const cards: CountryFastFactCard[] = hasStanding
    ? [
        reportingPeriodCard,
        totalRecordsCard,
        latestIncidentCard,
        weekSeverityCard,
        standingCard,
        mostAffectedCard,
        mainIssueCard,
      ]
    : [
        reportingPeriodCard,
        totalRecordsCard,
        weekSeverityCard,
        mostAffectedCard,
        latestIncidentCard,
        mainIssueCard,
      ];

  return {
    cards,
    windowIncidents,
    highestKey,
    highestLabel,
    standingKey,
    standingLabel,
    topTypeLabel,
    topTypeCount,
    topAreaLabel,
    topAreaCount,
    latestDate,
    severityCounts,
    typeCounts,
    areaCounts,
    topTypeIsMixed,
    topAreaIsMixed,
  };
}
