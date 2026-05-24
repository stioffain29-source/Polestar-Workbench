import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages, prepareCoverImage,
  COVER_TOP_BAND_H, COVER_BOTTOM_BLOCK_H,
  setFill, setStroke, setText, sanitize,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_LABEL, sevKey,
  type Ctx,
} from "./pdfChrome";
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
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

// Subtle bar styling helpers. jspdf does not expose CSS rgba directly, so we
// approximate translucency by lightening the fill toward white (the bars sit
// on a near-white track) and pair it with a slightly darker stroke in the
// same hue. Keeps the look premium and restrained, no gradients or shadows.
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - amount;
  return toHex(r * f, g * f, b * f);
}

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

function drawChokepointWatch(ctx: Ctx, rows: ChokepointRow[], windowLabel: string) {
  drawSectionHeading(ctx, `Chokepoint Watch, last 30 days (${windowLabel})`);
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

// Pick a "nice" rounded scale max + tick step (1/2/5 * 10^k) so the
// gridlines land on round numbers (e.g. 0, 5, 10 rather than 0, 4.5).
function niceScale(rawMax: number): { max: number; step: number } {
  if (rawMax <= 1) return { max: 1, step: 1 };
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / pow10;
  let niceNorm: number;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  const max = niceNorm * pow10;
  const step = (niceNorm <= 2 ? niceNorm / 2 : niceNorm / 5) * pow10;
  return { max, step: Math.max(step, 1) };
}

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
  const valueW = 34;
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;
  const rowH = 20;
  const gap = 5;
  const axisH = 14;
  const totalH = rows.length * (rowH + gap) + axisH;
  ensureSpace(ctx, totalH + 6);

  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);

  // Faint vertical gridlines at every step on the track, behind the bars.
  const gridTop = ctx.y + 2;
  const gridBottom = ctx.y + rows.length * (rowH + gap) - gap + 2;
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.4);
  for (let v = 0; v <= max; v += step) {
    const gx = trackX + (v / max) * trackW;
    pdf.line(gx, gridTop, gx, gridBottom);
  }

  for (const r of rows) {
    const y = ctx.y;
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    const labelLines: string[] = pdf.splitTextToSize(sanitize(r.label), labelW - 4);
    pdf.text(labelLines.slice(0, 1), MX, y + rowH - 7);

    // Track background.
    setFill(pdf, "#F3F4F8");
    pdf.rect(trackX, y + 4, trackW, rowH - 8, "F");

    const w = (r.value / max) * trackW;
    const baseColor = r.color ?? opts.barColor ?? ELECTRIC;
    if (w > 0) {
      setFill(pdf, lightenHex(baseColor, 0.12));
      setStroke(pdf, darkenHex(baseColor, 0.22));
      pdf.setLineWidth(0.5);
      pdf.rect(trackX, y + 4, w, rowH - 8, "FD");
    }

    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(String(r.value), trackX + trackW + 6, y + rowH - 7);
    pdf.setFont("helvetica", "normal");

    ctx.y += rowH + gap;
  }

  // Axis tick row with numeric scale.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.6);
  pdf.line(trackX, ctx.y + 2, trackX + trackW, ctx.y + 2);
  setText(pdf, DUSK);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  for (let v = 0; v <= max; v += step) {
    const gx = trackX + (v / max) * trackW;
    pdf.line(gx, ctx.y + 2, gx, ctx.y + 5);
    pdf.text(String(v), gx, ctx.y + 12, { align: "center" });
  }
  ctx.y += axisH;
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
  const chartH = 130;
  const labelStripH = 14;
  const footerH = 16;
  const yAxisW = 22;
  const totalH = chartH + labelStripH + footerH + 6;
  ensureSpace(ctx, totalH);

  const x0 = MX + yAxisW;
  const w = CW - yAxisW - 6;
  const y0 = ctx.y;
  const y1 = y0 + chartH;

  const rawMax = series.reduce((mx, s) => Math.max(mx, s.count), 0) || 1;
  const { max, step } = niceScale(rawMax);

  // Horizontal gridlines + y-axis numeric ticks.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.4);
  setText(pdf, DUSK);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  for (let v = 0; v <= max; v += step) {
    const gy = y1 - (v / max) * (chartH - 8);
    pdf.line(x0, gy, x0 + w, gy);
    pdf.text(String(v), x0 - 4, gy + 2, { align: "right" });
  }

  // Baseline.
  setStroke(pdf, DUSK);
  pdf.setLineWidth(0.6);
  pdf.line(x0, y1, x0 + w, y1);

  // Bars + peak highlight.
  const barW = Math.max(2, Math.min(14, (w - (series.length - 1) * 2) / Math.max(series.length, 1)));
  const stride = series.length > 1 ? (w - barW) / (series.length - 1) : 0;
  const peakIdx = peak ? series.findIndex((s) => s.date === peak.date) : -1;
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const bx = x0 + i * stride;
    const bh = (s.count / max) * (chartH - 8);
    const base = i === peakIdx ? ELECTRIC : NAVY;
    if (bh > 0) {
      setFill(pdf, lightenHex(base, 0.12));
      setStroke(pdf, darkenHex(base, 0.22));
      pdf.setLineWidth(0.4);
      pdf.rect(bx, y1 - bh, barW, bh, "FD");
    }
  }

  // Date axis labels (first, middle, last).
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

  // Peak readout.
  if (peak) {
    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(sanitize(`Peak: ${peak.count} on ${peak.label}`), x0, y1 + labelStripH + footerH);
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
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  try {
    const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
    coverImage = await prepareCoverImage(shippingCoverUrl, ctx.W, heroH);
  } catch (err) {
    console.warn("[exportShippingReportPdf] cover image load failed, falling back to gradient hero", err);
  }
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: "POLESTAR INSIGHTS",
    // win.label is already "Reporting period: ..." — upper-case it and
    // pass it through verbatim. Do NOT prefix another "REPORTING PERIOD:"
    // here or the cover will read it twice.
    reportingPeriod: win.label.toUpperCase(),
    coverImage,
  });
  void cadence;
  beginBodyPages(ctx);

  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  const ds = buildShippingReportDataset(incidents, data.topic, data.issueDate);

  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, ds.fastFacts);

  drawChokepointWatch(ctx, ds.chokepointRows, ds.thirtyDayShortLabel);

  drawIncidentTable<VesselRow>(ctx, `Vessel Attacks, last 30 days (${ds.thirtyDayShortLabel})`, ds.vesselRows, {
    showActColumn: true,
    actFor: (r) => r.vesselType,
    emptyMessage: "No hostile vessel incidents on file in the last 30 days.",
  });

  drawIncidentTable<PiracyRow>(ctx, `Piracy and Armed Robbery, last 30 days (${ds.thirtyDayShortLabel})`, ds.piracyRows, {
    showActColumn: true,
    actFor: (r) => r.act,
    emptyMessage: "No piracy or armed-robbery records in the last 30 days.",
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
  drawHorizontalBarChart(
    ctx,
    ds.countryRows.length >= 12 ? "Incidents by Country (Top 12)" : "Incidents by Country",
    ds.countryRows,
    {
      labelW: 160,
      emptyMessage: "No identified incident countries in window.",
    },
  );

  drawTimelineChart(ctx, "Incident Timeline", ds.timelineSeries, ds.timelinePeak);

  drawHorizontalBarChart(ctx, "Severity Distribution", ds.severityRows, { labelW: 120 });

  drawSectionHeading(ctx, "Commercial Impact on Shipping");
  {
    const { pdf, MX, CW } = ctx;
    setText(pdf, DUSK);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    const intro = "Scope here is shipping-side commercial pressure: port disruption, freight or insurance movement, and commercial shipping disruption with a direct vessel or cargo linkage. Pure market commentary without an operational shipping connection is excluded.";
    const lines: string[] = pdf.splitTextToSize(sanitize(intro), CW);
    pdf.text(lines, MX, ctx.y + 10);
    ctx.y += lines.length * 11 + 8;
    pdf.setFont("helvetica", "normal");
  }
  drawIncidentTable<EnrichedIncident>(ctx, "Records", ds.commercialRows, {
    showActColumn: true,
    actFor: (r) => r.issue,
    emptyMessage: "No port, freight, insurance or commercial-shipping disruption records in the weekly window.",
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
