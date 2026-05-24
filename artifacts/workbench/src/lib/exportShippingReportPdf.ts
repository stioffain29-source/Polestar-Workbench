import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages,
  setFill, setStroke, setText, sanitize,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_LABEL, sevKey,
  type Ctx,
} from "./pdfChrome";
import { resolveReportWindow } from "./reportWindow";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import { LOCATION_NOT_IDENTIFIED as _LOCATION_NOT_IDENTIFIED } from "./shippingCountry";
import {
  buildShippingReportDataset,
  type ShippingReportIncident,
  type BarRow,
  type TimelinePoint,
  type ChokepointRow,
  type EnrichedIncident,
  type VesselRow,
  type PiracyRow,
} from "./shippingReportDataset";

void _LOCATION_NOT_IDENTIFIED;

// Shipping report PDF. Section order (per spec):
//   Cover -> Executive Summary -> Fast Facts -> Key Metrics ->
//   Chokepoint Watch -> Vessel Attacks -> Piracy and Armed Robbery ->
//   Issue Type Breakdown -> Daily Intelligence Summary ->
//   Regional and Country View -> Incident Timeline -> Severity Distribution ->
//   Commercial Impact -> Watch Next -> Polestar View ->
//   Source Notes / Data Notes -> Disclaimer.
// All analysed data comes from shippingReportDataset so the editor preview
// and the PDF stay in lockstep.

export interface ShippingReportData {
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

export type { ShippingReportIncident };

// Chokepoint Watch -----------------------------------------------------------

function drawChokepointWatch(ctx: Ctx, rows: ChokepointRow[]) {
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

  for (const row of rows) {
    const readLines: string[] = pdf.splitTextToSize(sanitize(row.readText), colReadW - 8);
    const rh = Math.max(rowH, readLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) { newPage(ctx); drawHeader(); }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(sanitize(row.name), MX + 6, ctx.y + 12);
    pdf.setFont("helvetica", "normal");
    setText(pdf, DUSK);
    pdf.text(String(row.count), MX + colNameW + 6, ctx.y + 12);

    if (row.highestSeverityKey) {
      setFill(pdf, SEV_COLOR[row.highestSeverityKey] ?? "#999999");
      pdf.rect(MX + colNameW + colCountW + 6, ctx.y + 5, 56, 10, "F");
      setText(pdf, WHITE);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(sanitize(row.highestSeverityLabel.toUpperCase()), MX + colNameW + colCountW + 6 + 28, ctx.y + 12, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
    } else {
      setText(pdf, DUSK);
      pdf.text("-", MX + colNameW + colCountW + 6, ctx.y + 12);
    }

    setText(pdf, DUSK);
    pdf.text(row.latestDate ? format(row.latestDate, "dd MMM yyyy") : "-", MX + colNameW + colCountW + colSevW + 6, ctx.y + 12);
    pdf.text(readLines, MX + colNameW + colCountW + colSevW + colDateW + 6, ctx.y + 12);

    ctx.y += rh;
  }
  ctx.y += 8;
}

// Generic incident table -----------------------------------------------------

interface IncidentRowOpts<T extends EnrichedIncident> {
  showActColumn?: boolean;
  actFor?: (i: T) => string;
  emptyMessage: string;
  rowLimit?: number;
}

function drawIncidentTable<T extends EnrichedIncident>(ctx: Ctx, heading: string, rows: T[], opts: IncidentRowOpts<T>) {
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

// Hand-drawn horizontal bar chart -------------------------------------------

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
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const labelLines: string[] = pdf.splitTextToSize(sanitize(r.label), labelW - 4);
    pdf.text(labelLines.slice(0, 1), MX, y + rowH - 5);

    setFill(pdf, POLAR);
    pdf.rect(trackX, y + 3, trackW, rowH - 6, "F");

    const w = (r.value / max) * trackW;
    setFill(pdf, r.color ?? opts.barColor ?? ELECTRIC);
    if (w > 0) pdf.rect(trackX, y + 3, w, rowH - 6, "F");

    setText(pdf, DUSK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(String(r.value), trackX + trackW + 6, y + rowH - 5);
    pdf.setFont("helvetica", "normal");

    ctx.y += rowH + gap;
  }
  ctx.y += 6;
}

// Hand-drawn timeline bars --------------------------------------------------

function drawTimelineChart(ctx: Ctx, heading: string, series: TimelinePoint[], peak: TimelinePoint | null) {
  drawSectionHeading(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (series.length === 0) {
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.text("No timeline data available.", MX, ctx.y + 10);
    pdf.setFont("helvetica", "normal");
    ctx.y += 22;
    return;
  }
  const chartH = 110;
  const labelStripH = 12;
  const valueStripH = 10;
  const totalH = chartH + labelStripH + valueStripH + 12;
  ensureSpace(ctx, totalH);

  const x0 = MX + 6;
  const w = CW - 12;
  const y0 = ctx.y;
  const y1 = y0 + chartH;

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

  if (peak) {
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(sanitize(`Peak: ${peak.count} on ${peak.label}`), x0, y1 + labelStripH + valueStripH + 6);
    pdf.setFont("helvetica", "normal");
  }

  ctx.y += totalH;
}

// Exporter ------------------------------------------------------------------

export async function exportShippingReportPdf(
  data: ShippingReportData,
  incidents: ShippingReportIncident[],
  filename: string,
): Promise<void> {
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({ kind: resolvedTitle, issueDate: headerDate });
  const win = resolveReportWindow(data.topic, data.issueDate);
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: `${canon.topicLine} · ${cadence}`,
    reportingPeriod: win.label,
    eyebrow: `POLESTAR INSIGHTS · ${canon.topicLine.toUpperCase()}`,
  });
  beginBodyPages(ctx);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const ds = buildShippingReportDataset(incidents, data.topic, data.issueDate);

  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, ds.fastFacts);

  drawSectionHeading(ctx, "Key Metrics");
  drawFastFactsKpiCards(ctx, ds.keyMetrics);

  drawChokepointWatch(ctx, ds.chokepointRows);

  drawIncidentTable<VesselRow>(ctx, "Vessel Attacks", ds.vesselRows, {
    showActColumn: true,
    actFor: (r) => r.vesselType,
    emptyMessage: "No hostile vessel incidents on file in the selected window.",
  });

  drawIncidentTable<PiracyRow>(ctx, "Piracy and Armed Robbery", ds.piracyRows, {
    showActColumn: true,
    actFor: (r) => r.act,
    emptyMessage: "No current piracy or armed-robbery records in the selected window.",
  });

  drawHorizontalBarChart(ctx, "Issue Type Breakdown", ds.issueRows, {
    labelW: 180,
    emptyMessage: "No issue-type classifications in window.",
  });

  drawSectionHeading(ctx, "Daily Intelligence Summary");
  renderProse(ctx, ds.dailyIntelLines.join("\n\n"));

  drawHorizontalBarChart(ctx, "Regional and Country View", ds.regionRows, {
    labelW: 160,
    emptyMessage: "No regional classifications in window.",
  });
  drawHorizontalBarChart(ctx, "Incidents by Country (Top 12)", ds.countryRows, {
    labelW: 160,
    emptyMessage: "No identified incident countries in window.",
  });

  drawTimelineChart(ctx, "Incident Timeline", ds.timelineSeries, ds.timelinePeak);

  drawHorizontalBarChart(ctx, "Severity Distribution", ds.severityRows, { labelW: 120 });

  drawIncidentTable<EnrichedIncident>(ctx, "Commercial Impact", ds.commercialRows, {
    showActColumn: true,
    actFor: (r) => r.issue,
    emptyMessage: "No commercial shipping or freight/insurance records in the selected window.",
  });

  if (data.watchNext && data.watchNext.trim()) {
    drawSectionHeading(ctx, "Watch Next");
    renderProse(ctx, data.watchNext);
  }
  if (data.polestarView && data.polestarView.trim()) {
    drawSectionHeading(ctx, "Polestar View");
    renderProse(ctx, data.polestarView);
  }

  drawSourceNotes(ctx, ds.dataNote);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
