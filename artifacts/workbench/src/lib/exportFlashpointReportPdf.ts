import { format, parseISO } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse, drawSectionWithProse,
  setRoboto, ensureRobotoLoaded,
  drawFastFactsKpiCards, drawBulletSection, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages, prepareCoverImage,
  COVER_TOP_BAND_H, COVER_BOTTOM_BLOCK_H,
  setFill, setStroke, setText, sanitize,
  NAVY, ELECTRIC, POLAR, DUSK, WHITE, SEV_COLOR, SEV_LABEL, sevKey,
  type Ctx,
} from "./pdfChrome";
import { TOPIC_COVER_URLS } from "./coverImages";
import { resolveReportWindow } from "./reportWindow";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import {
  buildFlashpointReportDataset,
  type FlashpointReportIncident,
  type EnrichedIncident,
  type BarRow,
  type ForecastFutureRow,
} from "./flashpointReportDataset";

// Flashpoint PDF. Section order (per final spec):
//   Cover -> Executive Summary -> Fast Facts ->
//   Activism and Protest Read (prose + activism table) ->
//   Civil Unrest and Public Order Read (prose + unrest table) ->
//   Forecast 7-14 Days (prose) ->
//   Regional and Country View (prose + country bar) ->
//   What Matters -> Implications -> Watch Next -> Polestar View ->
//   Related Incidents -> Source Notes -> Disclaimer.
// Data and prose come from flashpointReportDataset so the preview and
// exporter cannot drift.

export interface FlashpointReportData {
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

export type { FlashpointReportIncident };

// --- Subtle bar styling helpers (kept local; identical math to shipping) ----
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

// --- Incident table --------------------------------------------------------
function drawIncidentTable(
  ctx: Ctx,
  heading: string,
  rows: EnrichedIncident[],
  emptyMessage: string,
  rowLimit = 12,
) {
  drawSectionHeading(ctx, heading);
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(sanitize(emptyMessage), MX, ctx.y + 10);
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }
  const { pdf, MX, CW } = ctx;
  const colDateW = 80;
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

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  const limited = rows.slice(0, rowLimit);
  for (const i of limited) {
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

// --- Country bar chart -----------------------------------------------------
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
  const labelW = opts.labelW ?? 160;
  const valueW = 34;
  const rowH = 20;
  const gap = 5;
  const axisH = 14;
  const headingH = 32;
  const projectedH = rows.length === 0 ? 30 : rows.length * (rowH + gap) + axisH + 6;
  // Reserve room for heading + chart body together so the heading
  // cannot strand at the bottom of a page above an orphaned chart.
  ensureSpace(ctx, headingH + projectedH);
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
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;

  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);

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

// --- Forecast: Country / Signal / Operational meaning table ----------------
function drawForecastFutureTable(ctx: Ctx, rows: ForecastFutureRow[]) {
  if (rows.length === 0) return;
  const { pdf, MX, CW } = ctx;
  const rowH = 18;
  const colCountryW = 100;
  const colSignalW = 160;
  const colMeaningW = CW - colCountryW - colSignalW;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("COUNTRY", MX + 6, ctx.y + 12);
    pdf.text("SIGNAL", MX + colCountryW + 6, ctx.y + 12);
    pdf.text("OPERATIONAL MEANING", MX + colCountryW + colSignalW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  for (const r of rows) {
    const signalLines: string[] = pdf.splitTextToSize(sanitize(r.signal), colSignalW - 8);
    const meaningLines: string[] = pdf.splitTextToSize(sanitize(r.meaning), colMeaningW - 8);
    const countryLines: string[] = pdf.splitTextToSize(sanitize(r.country), colCountryW - 8);
    const lines = Math.max(countryLines.length, signalLines.length, meaningLines.length);
    const rh = Math.max(rowH, lines * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) { newPage(ctx); drawHeader(); }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8.5);
    pdf.text(countryLines, MX + 6, ctx.y + 12);
    setRoboto(pdf, "regular");
    setText(pdf, NAVY);
    pdf.text(signalLines, MX + colCountryW + 6, ctx.y + 12);
    setText(pdf, DUSK);
    pdf.text(meaningLines, MX + colCountryW + colSignalW + 6, ctx.y + 12);
    ctx.y += rh;
  }
  ctx.y += 10;
}

// --- Related Incidents -----------------------------------------------------
function drawRelatedIncidents(ctx: Ctx, rows: EnrichedIncident[]) {
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize("No qualifying related incidents in the briefing window. Treat the quiet cycle as a reporting gap rather than a sustained easing."),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }

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

// --- Exporter --------------------------------------------------------------
export async function exportFlashpointReportPdf(
  data: FlashpointReportData,
  incidents: FlashpointReportIncident[],
  filename: string,
): Promise<void> {
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({ kind: resolvedTitle, issueDate: headerDate });
  await ensureRobotoLoaded(ctx.pdf);

  const win = resolveReportWindow(data.topic, data.issueDate);
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const coverUrl = TOPIC_COVER_URLS[data.topic];
  if (coverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(coverUrl, ctx.W, heroH);
    } catch (err) {
      console.warn("[exportFlashpointReportPdf] cover image load failed, falling back to gradient hero", err);
    }
  }
  drawPolestarCover(ctx, {
    title: resolvedTitle,
    subtitle: "POLESTAR INSIGHTS",
    reportingPeriod: `REPORTING PERIOD: ${win.label.toUpperCase()}`,
    coverImage,
  });
  void cadence;
  beginBodyPages(ctx);

  drawSectionHeading(ctx, "Executive Summary");
  const execText = (data.executiveSummary ?? "").trim();
  renderProse(
    ctx,
    execText ||
      `This briefing covers the activism, protest and civil-unrest picture across ${win.label}. The detailed operational read, country breakdown, forecast and analyst sections follow below.`,
  );

  const ds = buildFlashpointReportDataset(incidents, data.topic, data.issueDate);

  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, ds.fastFacts);

  // Activism and Protest Read — prose leads the activism table.
  drawSectionWithProse(ctx, "Activism and Protest Read", ds.activismRead);
  drawIncidentTable(
    ctx,
    "Activism Records",
    ds.activismRows,
    "No qualifying activism records in the briefing window.",
  );

  // Civil Unrest and Public Order Read — prose leads the unrest table.
  drawSectionWithProse(ctx, "Civil Unrest and Public Order Read", ds.civilUnrestRead);
  drawIncidentTable(
    ctx,
    "Civil Unrest Records",
    ds.unrestRows,
    "No qualifying civil-unrest records in the briefing window.",
  );

  // Forecast — structured Country / Signal / Operational meaning table
  // (when future-dated items are present) followed by analyst
  // trajectory prose with cautious vocabulary.
  drawSectionHeading(ctx, "Forecast: Next 7\u201314 Days");
  if (ds.forecastFuture.length > 0) {
    drawForecastFutureTable(ctx, ds.forecastFuture);
  }
  renderProse(ctx, ds.forecastRead);

  // Regional and Country View — prose leads the country bar chart.
  drawSectionWithProse(ctx, "Regional and Country View", ds.regionalCountryRead);
  drawHorizontalBarChart(
    ctx,
    ds.countryRows.length >= 12 ? "Records by Country (Top 12)" : "Records by Country",
    ds.countryRows,
    {
      labelW: 160,
      emptyMessage: "No identified incident countries in window.",
    },
  );

  // Editor-authored analyst sections. Editor text wins only when it
  // carries substance; thin stubs get the auto-prose appended.
  const pickProse = (editor: string | null | undefined, auto: string): string => {
    const t = (editor ?? "").trim();
    if (t.length >= 240) return t;
    if (t.length === 0) return auto;
    return `${t}\n\n${auto}`;
  };
  drawSectionWithProse(ctx, "What Matters", pickProse(data.whatMatters, ds.autoWhatMatters));
  drawBulletSection(ctx, "Implications for Business", pickProse(data.implications, ds.autoImplications));
  drawBulletSection(ctx, "Watch Next", pickProse(data.watchNext, ds.autoWatchNext), 8);
  drawSectionWithProse(ctx, "Polestar View", pickProse(data.polestarView, ds.autoPolestarView));

  drawRelatedIncidents(ctx, ds.relatedIncidents);

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
