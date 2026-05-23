import { format, parseISO, subDays, isWithinInterval, max as dateMax } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import {
  createCtx, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  setFill, setText, sanitize,
  NAVY, ELECTRIC, WHITE, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";

export interface TopicReportData {
  title: string;
  topic: string;
  issueDate: string;
  author?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

export interface TopicReportIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
}

function topicWindowIncidents(
  incidents: TopicReportIncident[],
  topic: string,
  issueDate: string,
): TopicReportIncident[] {
  let endDate: Date;
  try { endDate = parseISO(issueDate); } catch { endDate = new Date(); }
  if (isNaN(endDate.getTime())) endDate = new Date();
  const startDate = subDays(endDate, 30);
  return incidents.filter((i) => {
    if (i.topic !== topic) return false;
    try {
      const d = parseISO(i.occurredAt);
      if (isNaN(d.getTime())) return false;
      return isWithinInterval(d, { start: startDate, end: endDate });
    } catch { return false; }
  });
}

function computeFastFacts(
  data: TopicReportData,
  windowIncidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
): KpiCardData[] {
  let reportingPeriod = "Last 30 days";
  try {
    const end = parseISO(data.issueDate);
    if (!isNaN(end.getTime())) {
      const start = subDays(end, 30);
      reportingPeriod = `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")}`;
    }
  } catch { /* fallback */ }

  let highestKey = "";
  let highestRank = 0;
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  const highestLabel = highestKey ? (SEV_LABEL[highestKey] ?? highestKey) : "—";

  const countryCount = new Map<string, number>();
  for (const i of windowIncidents) {
    const c = (i.country ?? "").trim();
    if (!c) continue;
    countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
  }
  let topCountry = "—";
  let topCountryN = 0;
  for (const [c, n] of countryCount) {
    if (n > topCountryN) { topCountryN = n; topCountry = c; }
  }

  let latest = "—";
  if (windowIncidents.length > 0) {
    const dates = windowIncidents
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");
  }

  const topicLabel = topicLabels[data.topic] ?? data.topic;

  return [
    { label: "Reporting Period", value: reportingPeriod },
    { label: "Total Records", value: String(windowIncidents.length), note: `${topicLabel} in window` },
    { label: "Highest Severity", value: highestLabel, severity: highestKey || undefined, note: highestKey ? "Worst rating in window" : undefined },
    { label: "Most Affected Country", value: topCountry, note: topCountryN > 0 ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}` : undefined },
    { label: "Latest Incident", value: latest },
    { label: "Topic Coverage", value: topicLabel },
  ];
}

function drawCover(ctx: Ctx, data: TopicReportData, topicLabel: string) {
  const { pdf, MX, CW } = ctx;
  const heroH = 110;
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, heroH, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX + CW - 5, ctx.y, 5, heroH, "F");
  try {
    pdf.addImage(polestarLogo, "PNG", MX + 22, ctx.y + 22, 140, 21, undefined, "FAST");
  } catch { /* ignore */ }

  setText(pdf, WHITE);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(sanitize(`POLESTAR INSIGHTS  ·  ${topicLabel.toUpperCase()}`), MX + 22, ctx.y + 60);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  const titleLines: string[] = pdf.splitTextToSize(sanitize(data.title || "Untitled report"), CW - 44);
  pdf.text(titleLines.slice(0, 2), MX + 22, ctx.y + 82);

  let metaY = ctx.y + heroH - 14;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  let issueDateText = data.issueDate;
  try { issueDateText = format(parseISO(data.issueDate), "d MMMM yyyy"); } catch { /* keep raw */ }
  const meta = [issueDateText, data.author].filter(Boolean).join("  ·  ");
  pdf.text(sanitize(meta), MX + 22, metaY);

  ctx.y += heroH + 20;
}

export async function exportTopicReportPdf(
  data: TopicReportData,
  incidents: TopicReportIncident[],
  topicLabels: Record<string, string>,
  filename: string,
): Promise<void> {
  const topicLabel = topicLabels[data.topic] ?? data.topic;
  const cadence = data.topic === "cargo_watch" ? "Monthly Briefing" : "Weekly Briefing";
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({
    kind: `${topicLabel} · ${cadence}`,
    issueDate: headerDate,
  });

  drawCover(ctx, data, topicLabel);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const windowIncidents = topicWindowIncidents(incidents, data.topic, data.issueDate);
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, computeFastFacts(data, windowIncidents, topicLabels));

  const sections: [string, string | null | undefined][] = [
    ["Situation", data.situation],
    ["What Happened", data.whatHappened],
    ["What Matters", data.whatMatters],
    ["Implications for Business", data.implications],
    ["Watch Next", data.watchNext],
    ["Polestar View", data.polestarView],
  ];
  for (const [label, body] of sections) {
    if (body && body.trim()) {
      drawSectionHeading(ctx, label);
      renderProse(ctx, body);
    }
  }

  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  const reportDate = (() => {
    try { return format(parseISO(data.issueDate), "dd MMM yyyy"); } catch { return data.issueDate; }
  })();
  drawFooters(ctx.pdf, reportDate);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
