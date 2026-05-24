import { format, parseISO, max as dateMax, startOfDay, subDays } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  classifyVesselIncident, type VesselIncidentType,
  classifyIssue, ISSUE_PALETTE,
  classifyRegion, REGION_COLOR, type Region,
  TRANSIT_ISSUES, COMMERCIAL_ISSUES,
  type ChokepointKey,
} from "./shippingAnalysis";
import { deriveIncidentCountry, LOCATION_NOT_IDENTIFIED } from "./shippingCountry";

// Single source of truth for the Shipping report's analysed dataset.
// Both the PDF exporter (exportShippingReportPdf) and the on-screen
// editor preview (ShippingReportPreview) consume this so they cannot drift.

export interface ShippingReportIncident {
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
}

export interface EnrichedIncident extends ShippingReportIncident {
  date: Date;
  incidentCountry: string | null;
  region: Region;
  issue: string;
}

export interface VesselRow extends EnrichedIncident { vesselType: VesselIncidentType }
export interface PiracyRow extends EnrichedIncident { act: NonNullable<ReturnType<typeof classifyPiracy>> }

export interface KpiCard {
  label: string;
  value: string;
  note?: string;
  /** Lowercase severity key — used to pick the accent colour. */
  severity?: string;
}

export interface ChokepointRow {
  name: ChokepointKey;
  count: number;
  highestSeverityKey: string; // "" when empty
  highestSeverityLabel: string;
  latestDate: Date | null;
  latestTitle: string | null;
  readText: string;
}

export interface BarRow { label: string; value: number; color?: string }
export interface TimelinePoint { date: string; label: string; count: number }

export interface ShippingReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  /** Short label for the rolling 30-day window used by Chokepoint / Vessel / Piracy. */
  thirtyDayShortLabel: string;
  enriched: EnrichedIncident[];
  outOfScopeCount: number;
  fastFacts: KpiCard[];
  keyMetrics: KpiCard[];
  /** Chokepoint Watch over the last 30 days (not the weekly window). */
  chokepointRows: ChokepointRow[];
  /** Vessel attacks over the last 30 days. */
  vesselRows: VesselRow[];
  /** Piracy / armed robbery over the last 30 days. */
  piracyRows: PiracyRow[];
  issueRows: BarRow[];
  dailyIntelLines: string[];
  regionRows: BarRow[];
  countryRows: BarRow[];
  timelineSeries: TimelinePoint[];
  timelinePeak: TimelinePoint | null;
  severityRows: BarRow[];
  commercialRows: EnrichedIncident[];
  dataNote: string;
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};
const SEV_COLOR: Record<string, string> = {
  insignificant: "#B8C2CC", low: "#6FB872", moderate: "#E67E22", high: "#C0392B", extreme: "#800000",
};

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}
function highestSeverity(rows: ShippingReportIncident[]): { key: string; label: string } {
  let key = "", rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = SEV_RANK[k] ?? 0;
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

function enrich(rows: ShippingReportIncident[]): EnrichedIncident[] {
  return rows
    .map((r) => {
      let date: Date;
      try { date = parseISO(r.occurredAt); } catch { date = new Date(NaN); }
      const incidentCountry = deriveIncidentCountry(r);
      return {
        ...r,
        date,
        incidentCountry,
        region: classifyRegion(incidentCountry),
        issue: classifyIssue(r),
      };
    })
    .filter((r) => !isNaN(r.date.getTime()));
}

function sortByDateDesc<T extends { date: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function buildShippingReportDataset(
  incidents: ShippingReportIncident[],
  topic: string,
  issueDate: string,
): ShippingReportDataset {
  const win = resolveReportWindow(topic, issueDate);

  // Same scope filter as the Shipping dashboard: shipping topic only, strip
  // off-topic noise, then drop records that classify outside APAC + ME.
  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const passesShipping = (i: ShippingReportIncident) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    });
  const windowed = rawWindow.filter(passesShipping);
  const enrichedAll = sortByDateDesc(enrich(windowed));
  const enriched = enrichedAll.filter((r) => r.region !== "Out of scope");
  const outOfScopeCount = enrichedAll.length - enriched.length;

  // Rolling 30-day window for Chokepoint Watch, Vessel Attacks and
  // Piracy / Armed Robbery. These sections look back further than the
  // weekly briefing window so the reader has a fuller picture of
  // hostile maritime activity even on quiet weeks.
  let endDate: Date;
  try { endDate = parseISO(issueDate); } catch { endDate = new Date(); }
  if (isNaN(endDate.getTime())) endDate = new Date();
  const start30 = subDays(endDate, 29);
  const start30Ms = start30.getTime();
  const end30Ms = endDate.getTime();
  const raw30 = incidents.filter((i) => {
    if (i.topic !== topic) return false;
    try {
      const d = parseISO(i.occurredAt);
      if (isNaN(d.getTime())) return false;
      const ms = d.getTime();
      return ms >= start30Ms && ms <= end30Ms;
    } catch { return false; }
  });
  const windowed30 = raw30.filter(passesShipping);
  const enriched30 = sortByDateDesc(enrich(windowed30)).filter((r) => r.region !== "Out of scope");
  const thirtyDayShortLabel = `${format(start30, "d MMM")} - ${format(endDate, "d MMM yyyy")}`;

  // Chokepoint counts — derived from the 30-day window so the headline
  // "Main Affected Chokepoint" matches the Chokepoint Watch table below.
  const cpCounts = new Map<ChokepointKey, number>();
  for (const r of enriched30) for (const cp of detectChokepoints(r)) cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);
  let topCp: ChokepointKey | "" = "", topCpN = 0;
  for (const [k, v] of cpCounts) if (v > topCpN) { topCpN = v; topCp = k; }

  // Region counts (weekly window — drives Regional and Country View charts)
  const regionCounts = new Map<Region, number>();
  for (const r of enriched) regionCounts.set(r.region, (regionCounts.get(r.region) ?? 0) + 1);
  let topRegion: Region | "" = "", topRegionN = 0;
  for (const [k, v] of regionCounts) {
    if (k === "Country not identified") continue;
    if (v > topRegionN) { topRegionN = v; topRegion = k; }
  }

  // Vessel / piracy — 30-day window so the dedicated sections show a
  // meaningful operational picture even on a quiet weekly cycle.
  const vesselRows: VesselRow[] = enriched30
    .map((r) => ({ ...r, vesselType: classifyVesselIncident(r) as VesselIncidentType | null }))
    .filter((r): r is VesselRow => r.vesselType !== null);
  const vAttackSeize = vesselRows.filter((r) => r.vesselType === "Attack" || r.vesselType === "Seized").length;
  const piracyRows: PiracyRow[] = enriched30
    .map((r) => ({ ...r, act: classifyPiracy(r) }))
    .filter((r): r is PiracyRow => r.act !== null);

  // Weekly-window vessel/piracy counts (used only by the Daily Intelligence
  // Summary line, which describes the weekly briefing window itself).
  const vesselRowsWeekly = enriched
    .map((r) => ({ ...r, vesselType: classifyVesselIncident(r) as VesselIncidentType | null }))
    .filter((r): r is VesselRow => r.vesselType !== null);
  const vAttackSeizeWeekly = vesselRowsWeekly
    .filter((r) => r.vesselType === "Attack" || r.vesselType === "Seized").length;
  const piracyRowsWeekly = enriched
    .map((r) => ({ ...r, act: classifyPiracy(r) }))
    .filter((r): r is PiracyRow => r.act !== null);

  const hsAll = highestSeverity(enriched);
  const latestDate = enriched.length > 0 ? dateMax(enriched.map((r) => r.date)) : null;
  const latestSig = sortByDateDesc(enriched).find((r) => r.severity === "extreme" || r.severity === "high")
    ?? sortByDateDesc(enriched)[0]
    ?? null;

  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    { label: "Records In Window", value: String(enriched.length) },
    { label: "Highest Severity", value: hsAll.label, severity: hsAll.key || undefined },
    {
      label: "Main Affected Chokepoint",
      value: topCp || "—",
      note: topCpN > 0 ? `${topCpN} record${topCpN === 1 ? "" : "s"}` : "No chokepoint mention in window",
    },
    { label: "Vessel Attacks / Seizures (30d)", value: String(vAttackSeize) },
    {
      label: "Piracy / Armed Robbery (30d)",
      value: String(piracyRows.length),
      note: `Latest record: ${latestDate ? format(latestDate, "dd MMM yyyy") : "—"}`,
    },
  ];

  const keyMetrics: KpiCard[] = [
    { label: "Records In Window", value: String(enriched.length) },
    { label: "Highest Severity", value: hsAll.label, severity: hsAll.key || undefined },
    {
      label: "Main Affected Chokepoint (30d)",
      value: topCp || (topRegion || "—"),
      note: topCpN > 0
        ? `${topCpN} record${topCpN === 1 ? "" : "s"}`
        : (topRegion ? `Fallback to region: ${topRegionN} record${topRegionN === 1 ? "" : "s"}` : "No chokepoint or region data"),
    },
    { label: "Vessel Attacks / Seizures (30d)", value: String(vAttackSeize) },
    { label: "Piracy / Armed Robbery (30d)", value: String(piracyRows.length) },
    {
      label: "Latest Significant Incident",
      value: latestSig ? format(latestSig.date, "dd MMM yyyy") : "—",
      severity: latestSig ? sevKey(latestSig.severity) : undefined,
      note: latestSig ? latestSig.title : undefined,
    },
  ];

  // Chokepoint Watch rows — 30-day window.
  const chokepointRows: ChokepointRow[] = CHOKEPOINTS.map((cp) => {
    const records = enriched30.filter((r) => detectChokepoints(r).includes(cp));
    const hs = highestSeverity(records);
    const latest = sortByDateDesc(records)[0] ?? null;
    const readText = records.length === 0
      ? "No records in the last 30 days."
      : `${records.length} record${records.length === 1 ? "" : "s"} on file. Most recent: ${latest!.title}.`;
    return {
      name: cp,
      count: records.length,
      highestSeverityKey: hs.key,
      highestSeverityLabel: hs.label,
      latestDate: latest ? latest.date : null,
      latestTitle: latest ? latest.title : null,
      readText,
    };
  });

  // Issue rows
  const issueMap = new Map<string, number>();
  for (const r of enriched) issueMap.set(r.issue, (issueMap.get(r.issue) ?? 0) + 1);
  const issueRows: BarRow[] = Array.from(issueMap.entries())
    .map(([label, value], idx) => ({ label, value, color: ISSUE_PALETTE[idx % ISSUE_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  // Daily Intelligence Summary — same vocabularies as the dashboard cards.
  const transitRecords = enriched.filter(
    (r) => TRANSIT_ISSUES.has(r.issue) || detectChokepoints(r).length > 0,
  );
  const commercialRecords = enriched.filter((r) => COMMERCIAL_ISSUES.has(r.issue));
  const dailyIntelLines: string[] = [];
  if (transitRecords.length > 0) {
    dailyIntelLines.push(
      `Chokepoint and Route Activity: ${transitRecords.length} record${transitRecords.length === 1 ? "" : "s"} on file covering chokepoint risk, route diversion and maritime advisories. Most recent: ${transitRecords[0].title}.`,
    );
  } else {
    dailyIntelLines.push("Chokepoint and Route Activity: no matching records in the current window.");
  }
  if (vesselRowsWeekly.length + piracyRowsWeekly.length > 0) {
    const latestVessel = vesselRowsWeekly[0]?.title ?? piracyRowsWeekly[0]?.title ?? "no recent title on file";
    dailyIntelLines.push(
      `Vessel Threat and Piracy: ${vAttackSeizeWeekly} vessel attack/seizure record${vAttackSeizeWeekly === 1 ? "" : "s"} and ${piracyRowsWeekly.length} piracy or armed-robbery record${piracyRowsWeekly.length === 1 ? "" : "s"} on file in the weekly window. Most recent vessel item: ${latestVessel}.`,
    );
  } else {
    dailyIntelLines.push("Vessel Threat and Piracy: no hostile vessel or piracy records in the current weekly window.");
  }
  if (commercialRecords.length > 0) {
    dailyIntelLines.push(
      `Commercial Impact: ${commercialRecords.length} record${commercialRecords.length === 1 ? "" : "s"} on port disruption, freight or insurance pressure and commercial shipping disruption. Most recent: ${commercialRecords[0].title}.`,
    );
  } else {
    dailyIntelLines.push("Commercial Impact: no matching records in the current window.");
  }

  // Region rows in fixed order
  const regionRows: BarRow[] = (["Middle East", "APAC", "Country not identified"] as Region[]).map((region) => ({
    label: region,
    value: regionCounts.get(region) ?? 0,
    color: REGION_COLOR[region],
  }));

  // Country rows (top 12), only identified countries
  const countryMap = new Map<string, number>();
  for (const r of enriched) {
    if (r.incidentCountry === null) continue;
    countryMap.set(r.incidentCountry, (countryMap.get(r.incidentCountry) ?? 0) + 1);
  }
  const countryRows = Array.from(countryMap.entries())
    .map(([label, value]) => ({ label, value, color: "#4655FF" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // Timeline
  const tMap = new Map<string, number>();
  for (const r of enriched) {
    const k = format(startOfDay(r.date), "yyyy-MM-dd");
    tMap.set(k, (tMap.get(k) ?? 0) + 1);
  }
  const timelineSeries: TimelinePoint[] = Array.from(tMap.entries())
    .map(([d, c]) => ({ date: d, label: format(parseISO(d), "dd MMM"), count: c }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const timelinePeak = timelineSeries.length > 0
    ? timelineSeries.reduce((p, s) => (s.count > p.count ? s : p), timelineSeries[0])
    : null;

  // Severity rows in fixed brand order
  const severityRows: BarRow[] = ["insignificant", "low", "moderate", "high", "extreme"].map((key) => ({
    label: SEV_LABEL[key] ?? key,
    value: enriched.filter((r) => sevKey(r.severity) === key).length,
    color: SEV_COLOR[key],
  }));

  const dataNote = outOfScopeCount > 0
    ? `${outOfScopeCount} shipping record${outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East were excluded from this view, matching the Shipping dashboard scope. Records with no identifiable incident location are kept in totals and surfaced as "${LOCATION_NOT_IDENTIFIED}". Vessel flag state is never counted in country charts.`
    : `Records with no identifiable incident location are kept in totals and surfaced as "${LOCATION_NOT_IDENTIFIED}". Vessel flag state is never counted in country charts.`;

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: win.label,
    thirtyDayShortLabel,
    enriched,
    outOfScopeCount,
    fastFacts,
    keyMetrics,
    chokepointRows,
    vesselRows,
    piracyRows,
    issueRows,
    dailyIntelLines,
    regionRows,
    countryRows,
    timelineSeries,
    timelinePeak,
    severityRows,
    commercialRows: commercialRecords,
    dataNote,
  };
}

export const SHIPPING_SEV_LABEL = SEV_LABEL;
export const SHIPPING_SEV_COLOR = SEV_COLOR;
export { sevKey as shippingSevKey };
