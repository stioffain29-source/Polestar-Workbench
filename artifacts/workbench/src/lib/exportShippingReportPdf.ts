import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse, drawSectionWithProse,
  setRoboto, ensureRobotoLoaded,
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

// Shipping report PDF. Section order (per final spec):
//   Cover -> Executive Summary -> Fast Facts ->
//   Chokepoint / Route Read (prose + chokepoint table) ->
//   Vessel Threat and Piracy Read (prose + vessel table + piracy table) ->
//   Commercial Impact on Shipping (prose + commercial table) ->
//   Regional and Country View (prose + region bar + country bar) ->
//   What Matters -> Implications for Business ->
//   Watch Next -> Polestar View ->
//   Related Incidents ->
//   Source Notes / Data Notes -> Disclaimer.
// Drops (vs. previous draft): Issue Type Breakdown, Daily Intelligence
// Summary, Incident Timeline, Severity Distribution, the standalone
// "Incidents by Country" heading. Everything in the body comes from
// shippingReportDataset so the preview and the PDF cannot drift.

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
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("CHOKEPOINT", MX + 6, ctx.y + 12);
    pdf.text("RECORDS", MX + colNameW + 6, ctx.y + 12);
    pdf.text("HIGHEST SEV", MX + colNameW + colCountW + 6, ctx.y + 12);
    pdf.text("LATEST", MX + colNameW + colCountW + colSevW + 6, ctx.y + 12);
    pdf.text("OPERATIONAL READ", MX + colNameW + colCountW + colSevW + colDateW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text(sanitize(row.name), MX + 6, ctx.y + 12);
    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.text(String(row.count), MX + colNameW + 6, ctx.y + 12);

    if (row.highestSeverityKey) {
      setFill(pdf, SEV_COLOR[row.highestSeverityKey] ?? "#999999");
      pdf.rect(MX + colNameW + colCountW + 6, ctx.y + 5, 56, 10, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(7);
      pdf.text(sanitize(row.highestSeverityLabel.toUpperCase()), MX + colNameW + colCountW + 6 + 28, ctx.y + 12, { align: "center" });
      setRoboto(pdf, "regular");
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
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage), MX, ctx.y + 10);
    setRoboto(pdf, "regular");
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
    setRoboto(pdf, "bold");
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
    setRoboto(pdf, "regular");
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase()), chipX + 28, ctx.y + 12, { align: "center" });
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

    ctx.y += rh;
  }

  // Client-facing reports intentionally omit the "Showing N latest of M"
  // notice. The table cap is internal Workbench logic.
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
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(opts.emptyMessage ?? "No data in window."), MX, ctx.y + 10);
    setRoboto(pdf, "regular");
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
    setRoboto(pdf, "bold");
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
    setRoboto(pdf, "bold");
    pdf.setFontSize(9);
    pdf.text(String(r.value), trackX + trackW + 6, y + rowH - 7);
    setRoboto(pdf, "regular");

    ctx.y += rowH + gap;
  }

  // Axis tick row with numeric scale.
  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.6);
  pdf.line(trackX, ctx.y + 2, trackX + trackW, ctx.y + 2);
  setText(pdf, DUSK);
  setRoboto(pdf, "regular");
  pdf.setFontSize(7);
  for (let v = 0; v <= max; v += step) {
    const gx = trackX + (v / max) * trackW;
    pdf.line(gx, ctx.y + 2, gx, ctx.y + 5);
    pdf.text(String(v), gx, ctx.y + 12, { align: "center" });
  }
  ctx.y += axisH;
  ctx.y += 6;
}

// Related Incidents ---------------------------------------------------------

function drawRelatedIncidents(ctx: Ctx, rows: EnrichedIncident[]) {
  if (rows.length === 0) return;
  // Guard against a stranded heading at the foot of a page: pre-allocate
  // heading + header row + a couple of body rows.
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");

  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colIssueW = 120;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colIssueW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("ISSUE", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colIssueW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colIssueW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };
  drawHeader();

  for (const i of rows) {
    const titleLines: string[] = pdf.splitTextToSize(sanitize(i.title), colTitleW - 8);
    const issueLines: string[] = pdf.splitTextToSize(sanitize(i.issue), colIssueW - 8);
    const rh = Math.max(rowH, Math.max(titleLines.length, issueLines.length) * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) { newPage(ctx); drawHeader(); }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 12);
    pdf.text(issueLines, MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colIssueW + 6, ctx.y + 12);

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colIssueW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text(sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase()), chipX + 28, ctx.y + 12, { align: "center" });
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 8;
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
  // Embed Roboto on this pdf instance before drawing any text. Without this,
  // jsPDF silently falls back to Helvetica, which the brand spec forbids.
  await ensureRobotoLoaded(ctx.pdf);
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
    // win.label is just the date range. The cover renderer expects the
    // full "REPORTING PERIOD: ..." string — every caller prepends its own
    // prefix so the label never reads twice.
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
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

  // Chokepoint / Route Read — prose leads the chokepoint table.
  drawSectionWithProse(ctx, "Chokepoint / Route Read", ds.chokepointRouteRead);
  drawChokepointWatch(ctx, ds.chokepointRows, ds.thirtyDayShortLabel);

  // Vessel Threat and Piracy Read — prose leads both 30-day tables.
  drawSectionWithProse(ctx, "Vessel Threat and Piracy Read", ds.vesselPiracyRead);
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

  // Commercial Impact on Shipping — prose leads the operational
  // commercial-pressure table; pure market commentary is filtered out
  // upstream in the dataset.
  drawSectionWithProse(ctx, "Commercial Impact on Shipping", ds.commercialImpactRead);
  drawIncidentTable<EnrichedIncident>(ctx, "Records", ds.commercialRows, {
    showActColumn: true,
    actFor: (r) => r.issue,
    emptyMessage: "No port, freight, insurance or commercial-shipping disruption records in the weekly window.",
  });

  // Regional and Country View — prose leads the region and country bars.
  drawSectionWithProse(ctx, "Regional and Country View", ds.regionalCountryRead);
  drawHorizontalBarChart(ctx, "Records by Region", ds.regionRows, {
    labelW: 160,
    emptyMessage: "No regional classifications in window.",
  });
  drawHorizontalBarChart(
    ctx,
    ds.countryRows.length >= 12 ? "Records by Country (Top 12)" : "Records by Country",
    ds.countryRows,
    {
      labelW: 160,
      emptyMessage: "No identified incident countries in window.",
    },
  );

  // Editor-authored analyst sections. Editor text wins when supplied;
  // otherwise the dataset's auto-prose fills in so the report reads at
  // Fuel-Watch substance even before the analyst has written the form.
  // Editor text wins only when it carries substance. Short stub text
  // (legacy single-line entries, placeholders, " - " etc.) falls through
  // to the dataset's auto-prose so the report reads at Fuel-Watch
  // substance rather than printing a one-line section.
  const pickProse = (editor: string | null | undefined, auto: string): string => {
    const t = (editor ?? "").trim();
    if (t.length >= 240) return t;
    if (t.length === 0) return auto;
    // Treat a thin editor stub as a lead paragraph above the auto-prose
    // rather than discarding either side. This keeps any analyst note
    // visible while still delivering the full operational read below.
    return `${t}\n\n${auto}`;
  };
  drawSectionWithProse(ctx, "What Matters", pickProse(data.whatMatters, ds.autoWhatMatters));
  drawSectionWithProse(ctx, "Implications for Business", pickProse(data.implications, ds.autoImplications));
  drawSectionWithProse(ctx, "Watch Next", pickProse(data.watchNext, ds.autoWatchNext));
  drawSectionWithProse(ctx, "Polestar View", pickProse(data.polestarView, ds.autoPolestarView));

  drawRelatedIncidents(ctx, ds.relatedIncidents);

  drawSourceNotes(ctx, ds.dataNote);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
