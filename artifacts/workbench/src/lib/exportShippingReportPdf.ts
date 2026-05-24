import { format, parseISO, max as dateMax, startOfDay } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages,
  setFill, setStroke, setText, sanitize,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  classifyVesselIncident, type VesselIncidentType,
  classifyIssue, ISSUE_PALETTE,
  classifyRegion, REGION_COLOR, type Region,
  TRANSIT_ISSUES, COMMERCIAL_ISSUES,
  type ChokepointKey,
} from "./shippingAnalysis";
import { deriveIncidentCountry, LOCATION_NOT_IDENTIFIED } from "./shippingCountry";

// Shipping report. Mirrors the Shipping dashboard analysed dataset and
// visual section list. Uses the same classifiers (region / issue / vessel)
// as the dashboard so the two views never drift.
//
// Section order (per spec):
//   Cover → Executive Summary → Fast Facts → Key Metrics →
//   Chokepoint Watch → Vessel Attacks → Piracy and Armed Robbery →
//   Issue Type Breakdown → Daily Intelligence Summary →
//   Regional and Country View → Incident Timeline → Severity Distribution →
//   Commercial Impact → Watch Next → Polestar View →
//   Source Notes / Data Notes → Disclaimer.

export interface ShippingReportData {
  title: string;
  topic: string; // expected to be "shipping"
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

type Enriched = ShippingReportIncident & {
  date: Date;
  incidentCountry: string | null;
  region: Region;
  issue: string;
};

function enrich(rows: ShippingReportIncident[]): Enriched[] {
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

function highestSeverity(rows: ShippingReportIncident[]): { key: string; label: string } {
  let key = "";
  let rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = SEV_RANK[k] ?? 0;
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

// Fast Facts ----------------------------------------------------------------

function computeFastFacts(
  data: ShippingReportData,
  rows: Enriched[],
): KpiCardData[] {
  const reportingPeriod = resolveReportWindow(data.topic, data.issueDate).shortLabel;
  const hs = highestSeverity(rows);

  // Main affected chokepoint by count.
  const cpCounts = new Map<ChokepointKey, number>();
  for (const r of rows) {
    for (const cp of detectChokepoints(r)) cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);
  }
  let topCp: ChokepointKey | "" = "";
  let topCpN = 0;
  for (const [k, v] of cpCounts) if (v > topCpN) { topCpN = v; topCp = k; }

  const vCount = rows.filter((r) => {
    const v = classifyVesselIncident(r);
    return v === "Attack" || v === "Seized";
  }).length;
  const pCount = rows.filter((r) => classifyPiracy(r) !== null).length;

  let latest = "—";
  const dates = rows.map((r) => r.date);
  if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");

  return [
    { label: "Reporting Period", value: reportingPeriod },
    { label: "Records In Window", value: String(rows.length) },
    { label: "Highest Severity", value: hs.label, severity: hs.key || undefined },
    {
      label: "Main Affected Chokepoint",
      value: topCp || "—",
      note: topCpN > 0 ? `${topCpN} record${topCpN === 1 ? "" : "s"}` : "No chokepoint mention in window",
    },
    { label: "Vessel Attacks / Seizures", value: String(vCount) },
    { label: "Piracy / Armed Robbery", value: String(pCount), note: `Latest record: ${latest}` },
  ];
}

// Key Metrics ---------------------------------------------------------------

function computeKeyMetrics(rows: Enriched[]): KpiCardData[] {
  const hs = highestSeverity(rows);

  const cpCounts = new Map<ChokepointKey, number>();
  for (const r of rows) for (const cp of detectChokepoints(r)) cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);
  let topCp: ChokepointKey | "" = "";
  let topCpN = 0;
  for (const [k, v] of cpCounts) if (v > topCpN) { topCpN = v; topCp = k; }

  const regionCounts = new Map<Region, number>();
  for (const r of rows) regionCounts.set(r.region, (regionCounts.get(r.region) ?? 0) + 1);
  let topRegion: Region | "" = "";
  let topRegionN = 0;
  for (const [k, v] of regionCounts) {
    if (k === "Country not identified") continue;
    if (v > topRegionN) { topRegionN = v; topRegion = k; }
  }

  const vAttackSeize = rows.filter((r) => {
    const v = classifyVesselIncident(r);
    return v === "Attack" || v === "Seized";
  }).length;
  const piracy = rows.filter((r) => classifyPiracy(r) !== null).length;
  const latestSig = sortByDateDesc(rows).find((r) => r.severity === "extreme" || r.severity === "high") ?? sortByDateDesc(rows)[0] ?? null;

  return [
    { label: "Records In Window", value: String(rows.length) },
    { label: "Highest Severity", value: hs.label, severity: hs.key || undefined },
    {
      label: "Main Affected Chokepoint",
      value: topCp || (topRegion || "—"),
      note: topCpN > 0 ? `${topCpN} record${topCpN === 1 ? "" : "s"}` : (topRegion ? `Fallback to region: ${topRegionN} record${topRegionN === 1 ? "" : "s"}` : "No chokepoint or region data"),
    },
    { label: "Vessel Attacks / Seizures", value: String(vAttackSeize) },
    { label: "Piracy / Armed Robbery", value: String(piracy) },
    {
      label: "Latest Significant Incident",
      value: latestSig ? format(latestSig.date, "dd MMM yyyy") : "—",
      severity: latestSig ? sevKey(latestSig.severity) : undefined,
      note: latestSig ? latestSig.title : undefined,
    },
  ];
}

// Chokepoint Watch table ----------------------------------------------------

function drawChokepointWatch(ctx: Ctx, rows: Enriched[]) {
  drawSectionHeading(ctx, "Chokepoint Watch");
  const { pdf, MX, CW } = ctx;
  const colNameW = 130;
  const colCountW = 50;
  const colSevW = 70;
  const colDateW = 70;
  const colReadW = CW - colNameW - colCountW - colSevW - colDateW;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("CHOKEPOINT", MX + 6, ctx.y + 12);
    pdf.text("RECORDS", MX + colNameW + 6, ctx.y + 12);
    pdf.text("HIGHEST SEV", MX + colNameW + colCountW + 6, ctx.y + 12);
    pdf.text("LATEST", MX + colNameW + colCountW + colSevW + 6, ctx.y + 12);
    pdf.text("OPERATIONAL READ", MX + colNameW + colCountW + colSevW + colDateW + 6, ctx.y + 12);
    ctx.y += rowH;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  for (const cp of CHOKEPOINTS) {
    const records = rows.filter((r) => detectChokepoints(r).includes(cp));
    const count = records.length;
    const hs = highestSeverity(records);
    const latest = sortByDateDesc(records)[0] ?? null;
    const readText = count === 0
      ? "No current records in selected window."
      : `${count} record${count === 1 ? "" : "s"} on file. Most recent: ${latest!.title}.`;
    const readLines: string[] = pdf.splitTextToSize(sanitize(readText), colReadW - 8);
    const rh = Math.max(rowH, readLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) { newPage(ctx); drawHeader(); }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(sanitize(cp), MX + 6, ctx.y + 12);
    pdf.setFont("helvetica", "normal");
    setText(pdf, DUSK);
    pdf.text(String(count), MX + colNameW + 6, ctx.y + 12);

    if (hs.key) {
      setFill(pdf, SEV_COLOR[hs.key] ?? "#999999");
      pdf.rect(MX + colNameW + colCountW + 6, ctx.y + 5, 56, 10, "F");
      setText(pdf, WHITE);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(sanitize(hs.label.toUpperCase()), MX + colNameW + colCountW + 6 + 28, ctx.y + 12, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
    } else {
      setText(pdf, DUSK);
      pdf.text("-", MX + colNameW + colCountW + 6, ctx.y + 12);
    }

    setText(pdf, DUSK);
    const latestText = latest ? format(latest.date, "dd MMM yyyy") : "-";
    pdf.text(latestText, MX + colNameW + colCountW + colSevW + 6, ctx.y + 12);

    pdf.text(readLines, MX + colNameW + colCountW + colSevW + colDateW + 6, ctx.y + 12);

    ctx.y += rh;
  }
  ctx.y += 8;
}

// Generic incident table ----------------------------------------------------

interface IncidentRowOpts {
  showActColumn?: boolean;
  actFor?: (i: Enriched) => string;
  emptyMessage: string;
  rowLimit?: number;
}

function drawIncidentTable(ctx: Ctx, heading: string, rows: Enriched[], opts: IncidentRowOpts) {
  drawSectionHeading(ctx, heading);
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage), MX, ctx.y + 10);
    pdf.setFont("helvetica", "normal");
    ctx.y += 22;
    return;
  }
  const { pdf, MX, CW } = ctx;
  const colDateW = 80;
  const colActW = opts.showActColumn ? 110 : 0;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colActW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    let cursor = MX + colDateW + 6;
    if (opts.showActColumn) {
      pdf.text("ACT", cursor, ctx.y + 12);
      cursor += colActW;
    }
    pdf.text("TITLE", cursor, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colActW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  const limited = rows.slice(0, opts.rowLimit ?? 15);
  for (const i of limited) {
    const titleLines: string[] = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
    const rh = Math.max(rowH, titleLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) { newPage(ctx); drawHeader(); }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 12);

    let cursor = MX + colDateW + 6;
    if (opts.showActColumn && opts.actFor) {
      const actLines: string[] = pdf.splitTextToSize(sanitize(opts.actFor(i)), colActW - 8);
      pdf.text(actLines, cursor, ctx.y + 12);
      cursor += colActW;
    }
    setText(pdf, NAVY);
    pdf.text(titleLines, cursor, ctx.y + 12);

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colActW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase()), chipX + 28, ctx.y + 12, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);

    ctx.y += rh;
  }

  if (rows.length > limited.length) {
    ensureSpace(ctx, 16);
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8);
    pdf.text(sanitize(`Showing ${limited.length} most recent of ${rows.length} records in window. Older records remain available in the Workbench.`), MX, ctx.y + 12);
    pdf.setFont("helvetica", "normal");
    ctx.y += 16;
  }
  ctx.y += 8;
}

// Hand-drawn horizontal bar chart ------------------------------------------
// Hand-drawn because pdfChrome does not ship chart primitives. Bars share the
// shipping page's brand palette so the printed view reads like the dashboard.

interface BarRow { label: string; value: number; color?: string }

function drawHorizontalBarChart(
  ctx: Ctx,
  heading: string,
  rows: BarRow[],
  opts: { labelW?: number; barColor?: string; emptyMessage?: string } = {},
) {
  drawSectionHeading(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage ?? "No data in window."), MX, ctx.y + 10);
    pdf.setFont("helvetica", "normal");
    ctx.y += 22;
    return;
  }
  const labelW = opts.labelW ?? 160;
  const valueW = 30;
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;
  const rowH = 16;
  const gap = 4;
  const totalH = rows.length * (rowH + gap);
  ensureSpace(ctx, totalH + 6);

  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;

  for (const r of rows) {
    const y = ctx.y;

    // Label
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const labelLines: string[] = pdf.splitTextToSize(sanitize(r.label), labelW - 4);
    pdf.text(labelLines.slice(0, 1), MX, y + rowH - 5);

    // Track
    setFill(pdf, POLAR);
    pdf.rect(trackX, y + 3, trackW, rowH - 6, "F");

    // Bar
    const w = (r.value / max) * trackW;
    setFill(pdf, r.color ?? opts.barColor ?? ELECTRIC);
    if (w > 0) pdf.rect(trackX, y + 3, w, rowH - 6, "F");

    // Value
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(String(r.value), trackX + trackW + 6, y + rowH - 5);
    pdf.setFont("helvetica", "normal");

    ctx.y += rowH + gap;
  }
  ctx.y += 6;
}

// Hand-drawn vertical timeline bars ----------------------------------------

function drawTimelineChart(
  ctx: Ctx,
  heading: string,
  rows: Enriched[],
) {
  drawSectionHeading(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.text("No timeline data available.", MX, ctx.y + 10);
    pdf.setFont("helvetica", "normal");
    ctx.y += 22;
    return;
  }
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = format(startOfDay(r.date), "yyyy-MM-dd");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const series = Array.from(m.entries())
    .map(([d, c]) => ({ date: d, label: format(parseISO(d), "dd MMM"), count: c }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const chartH = 110;
  const labelStripH = 12;
  const valueStripH = 10;
  const totalH = chartH + labelStripH + valueStripH + 12;
  ensureSpace(ctx, totalH);

  const x0 = MX + 6;
  const w = CW - 12;
  const y0 = ctx.y;
  const y1 = y0 + chartH;

  // Axis
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  pdf.line(x0, y1, x0 + w, y1);

  const max = series.reduce((mx, s) => Math.max(mx, s.count), 0) || 1;
  const barW = Math.max(2, Math.min(14, (w - (series.length - 1) * 2) / Math.max(series.length, 1)));
  const stride = series.length > 1 ? (w - barW) / (series.length - 1) : 0;

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const bx = x0 + i * stride;
    const bh = (s.count / max) * (chartH - 8);
    setFill(pdf, NAVY);
    pdf.rect(bx, y1 - bh, barW, bh, "F");
  }

  // Sparse X labels (first, middle, last)
  setText(pdf, DUSK);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  const tickIdx = [0, Math.floor(series.length / 2), series.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  for (const idx of tickIdx) {
    const s = series[idx];
    const bx = x0 + idx * stride + barW / 2;
    pdf.text(sanitize(s.label), bx, y1 + 10, { align: "center" });
  }

  // Peak callout (max value)
  const peak = series.reduce((p, s) => (s.count > p.count ? s : p), series[0]);
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text(
    sanitize(`Peak: ${peak.count} on ${peak.label}`),
    x0,
    y1 + labelStripH + valueStripH + 6,
  );
  pdf.setFont("helvetica", "normal");

  ctx.y += totalH;
}

// Exporter ------------------------------------------------------------------

export async function exportShippingReportPdf(
  data: ShippingReportData,
  incidents: ShippingReportIncident[],
  filename: string,
): Promise<void> {
  // Canonical naming: the default Shipping title is "Shipping Watch".
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({
    kind: resolvedTitle,
    issueDate: headerDate,
  });

  const win = resolveReportWindow(data.topic, data.issueDate);
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: `${canon.topicLine} · ${cadence}`,
    reportingPeriod: win.label,
    eyebrow: `POLESTAR INSIGHTS · ${canon.topicLine.toUpperCase()}`,
  });
  beginBodyPages(ctx);

  // Executive Summary (optional, from form).
  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  // Scope: same as the Shipping page — shipping topic only, strip off-topic
  // noise, then drop records that classify to a country outside APAC + ME.
  const rawWindow = filterIncidentsToWindow(incidents, data.topic, data.issueDate, { byTopic: true });
  const windowIncidents = rawWindow.filter((i) =>
    isTopicRelevant(data.topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
  const enrichedAll = sortByDateDesc(enrich(windowIncidents));
  const enriched = enrichedAll.filter((r) => r.region !== "Out of scope");
  const outOfScopeCount = enrichedAll.length - enriched.length;

  // Fast Facts
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, computeFastFacts(data, enriched));

  // Key Metrics
  drawSectionHeading(ctx, "Key Metrics");
  drawFastFactsKpiCards(ctx, computeKeyMetrics(enriched));

  // Chokepoint Watch
  drawChokepointWatch(ctx, enriched);

  // Vessel Attacks — strict hostile classifier, mirrors dashboard carousel.
  const vesselRows = enriched
    .map((r) => ({ ...r, vesselType: classifyVesselIncident(r) }))
    .filter((r): r is Enriched & { vesselType: VesselIncidentType } => r.vesselType !== null);
  drawIncidentTable(ctx, "Vessel Attacks", vesselRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { vesselType: VesselIncidentType }).vesselType,
    emptyMessage: "No hostile vessel incidents on file in the selected window.",
  });

  // Piracy and Armed Robbery
  const piracyRows = enriched
    .map((r) => ({ ...r, act: classifyPiracy(r) }))
    .filter((r): r is Enriched & { act: NonNullable<ReturnType<typeof classifyPiracy>> } => r.act !== null);
  drawIncidentTable(ctx, "Piracy and Armed Robbery", piracyRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { act: string }).act,
    emptyMessage: "No current piracy or armed-robbery records in the selected window.",
  });

  // Issue Type Breakdown
  const issueMap = new Map<string, number>();
  for (const r of enriched) issueMap.set(r.issue, (issueMap.get(r.issue) ?? 0) + 1);
  const issueRows = Array.from(issueMap.entries())
    .map(([label, value], idx) => ({ label, value, color: ISSUE_PALETTE[idx % ISSUE_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);
  drawHorizontalBarChart(ctx, "Issue Type Breakdown", issueRows, {
    labelW: 180,
    emptyMessage: "No issue-type classifications in window.",
  });

  // Daily Intelligence Summary — mirrors the dashboard's three intel cards.
  drawSectionHeading(ctx, "Daily Intelligence Summary");
  {
    const transitRecords = enriched.filter(
      (r) => TRANSIT_ISSUES.has(r.issue) || detectChokepoints(r).length > 0,
    );
    const vesselCount = vesselRows.length;
    const vAttackSeizeCount = vesselRows.filter((v) => v.vesselType === "Attack" || v.vesselType === "Seized").length;
    const piracyCount = piracyRows.length;
    const commercialRecords = enriched.filter((r) => COMMERCIAL_ISSUES.has(r.issue));

    const lines: string[] = [];
    if (transitRecords.length > 0) {
      lines.push(
        `Chokepoint and Route Activity: ${transitRecords.length} record${transitRecords.length === 1 ? "" : "s"} on file covering chokepoint risk, route diversion and maritime advisories. Most recent: ${transitRecords[0].title}.`,
      );
    } else {
      lines.push("Chokepoint and Route Activity: no matching records in the current window.");
    }
    if (vesselCount + piracyCount > 0) {
      const latestVessel = vesselRows[0]?.title ?? piracyRows[0]?.title ?? "no recent title on file";
      lines.push(
        `Vessel Threat and Piracy: ${vAttackSeizeCount} vessel attack/seizure record${vAttackSeizeCount === 1 ? "" : "s"} and ${piracyCount} piracy or armed-robbery record${piracyCount === 1 ? "" : "s"} on file. Most recent vessel item: ${latestVessel}.`,
      );
    } else {
      lines.push("Vessel Threat and Piracy: no hostile vessel or piracy records in the current window.");
    }
    if (commercialRecords.length > 0) {
      lines.push(
        `Commercial Impact: ${commercialRecords.length} record${commercialRecords.length === 1 ? "" : "s"} on port disruption, freight or insurance pressure and commercial shipping disruption. Most recent: ${commercialRecords[0].title}.`,
      );
    } else {
      lines.push("Commercial Impact: no matching records in the current window.");
    }
    renderProse(ctx, lines.join("\n\n"));
  }

  // Regional and Country View
  const regionMap = new Map<Region, number>([
    ["Middle East", 0],
    ["APAC", 0],
    ["Country not identified", 0],
  ]);
  for (const r of enriched) regionMap.set(r.region, (regionMap.get(r.region) ?? 0) + 1);
  const regionRows: BarRow[] = Array.from(regionMap.entries()).map(([region, value]) => ({
    label: region,
    value,
    color: REGION_COLOR[region],
  }));
  drawHorizontalBarChart(ctx, "Regional and Country View", regionRows, {
    labelW: 160,
    emptyMessage: "No regional classifications in window.",
  });

  const countryMap = new Map<string, number>();
  for (const r of enriched) {
    if (r.incidentCountry === null) continue;
    countryMap.set(r.incidentCountry, (countryMap.get(r.incidentCountry) ?? 0) + 1);
  }
  const countryRows = Array.from(countryMap.entries())
    .map(([label, value]) => ({ label, value, color: ELECTRIC }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  drawHorizontalBarChart(ctx, "Incidents by Country (Top 12)", countryRows, {
    labelW: 160,
    emptyMessage: "No identified incident countries in window.",
  });

  // Incident Timeline
  drawTimelineChart(ctx, "Incident Timeline", enriched);

  // Severity Distribution — 5 brand tiers in fixed order.
  const sevOrder = ["insignificant", "low", "moderate", "high", "extreme"];
  const sevRows: BarRow[] = sevOrder.map((key) => ({
    label: SEV_LABEL[key] ?? key,
    value: enriched.filter((r) => sevKey(r.severity) === key).length,
    color: SEV_COLOR[key] ?? POLAR,
  }));
  drawHorizontalBarChart(ctx, "Severity Distribution", sevRows, { labelW: 120 });

  // Commercial Impact (table)
  const commercialRows = enriched.filter((r) => COMMERCIAL_ISSUES.has(r.issue));
  drawIncidentTable(ctx, "Commercial Impact", commercialRows, {
    showActColumn: true,
    actFor: (r) => r.issue,
    emptyMessage: "No commercial shipping or freight/insurance records in the selected window.",
  });

  // Watch Next + Polestar View, from the editor form.
  if (data.watchNext && data.watchNext.trim()) {
    drawSectionHeading(ctx, "Watch Next");
    renderProse(ctx, data.watchNext);
  }
  if (data.polestarView && data.polestarView.trim()) {
    drawSectionHeading(ctx, "Polestar View");
    renderProse(ctx, data.polestarView);
  }

  const dataNote = outOfScopeCount > 0
    ? `${outOfScopeCount} shipping record${outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East were excluded from this view, matching the Shipping dashboard scope. Records with no identifiable incident location are kept in totals and surfaced as "${LOCATION_NOT_IDENTIFIED}". Vessel flag state is never counted in country charts.`
    : `Records with no identifiable incident location are kept in totals and surfaced as "${LOCATION_NOT_IDENTIFIED}". Vessel flag state is never counted in country charts.`;
  drawSourceNotes(ctx, dataNote);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
