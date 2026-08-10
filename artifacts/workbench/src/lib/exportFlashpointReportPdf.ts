import { format, parseISO } from "date-fns";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  drawSubtitle,
  renderProse,
  drawSectionWithProse,
  drawSectionKeepTogether,
  setRoboto,
  ensureRobotoLoaded,
  drawFastFactsKpiCards,
  drawBulletSection,
  drawDisclaimer,
  drawFooters,
  drawPolestarCover,
  beginBodyPages,
  prepareCoverImage,
  COVER_TOP_BAND_H,
  COVER_BOTTOM_BLOCK_H,
  setFill,
  setStroke,
  setText,
  sanitize,
  NAVY,
  ELECTRIC,
  POLAR,
  DUSK,
  WHITE,
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  type Ctx,
} from "./pdfChrome";
import { TOPIC_COVER_URLS } from "./coverImages";
import { resolveReportWindow } from "./reportWindow";
import { canonicalTopic, resolveReportTitle } from "./reportNaming";
import {
  makeSectionGate,
  applyFastFactOverrides,
  type TopicSectionOverrides,
} from "./topicSectionOverrides";
import { aiOr, type TopicAiProse } from "./topicProseResolution";
import {
  buildFlashpointReportDataset,
  isGenericFlashpointProse,
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
//   Related Incidents -> Disclaimer.
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
  activismRead?: string | null;
  civilUnrestRead?: string | null;
  forecastRead?: string | null;
  regionalCountryRead?: string | null;
}

// Data-driven reads are full sections, not analyst notes: a saved override
// REPLACES the generated read; a blank value falls back to the dataset read so
// nothing is fabricated and the in-app PDF == the on-screen preview.
function pickRead(editor: string | null | undefined, auto: string): string {
  const t = (editor ?? "").trim();
  return t ? t : auto;
}

export type { FlashpointReportIncident };

// --- Subtle bar styling helpers (kept local; identical math to shipping) ----
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}
function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - amount;
  return toHex(r * f, g * f, b * f);
}

// --- Incident table --------------------------------------------------------
function drawIncidentTable(
  ctx: Ctx,
  heading: string | null,
  rows: EnrichedIncident[],
  emptyMessage: string,
  rowLimit = 12,
) {
  if (heading) drawSubtitle(ctx, heading);
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
  const colSevW = 75;
  const colTitleW = CW - colDateW - colIssueW - colSevW - 6;
  const rowH = 20;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + rowH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rowH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("ISSUE", MX + colDateW + 6, ctx.y + 13);
    pdf.text("TITLE", MX + colDateW + colIssueW + 6, ctx.y + 13);
    pdf.text("SEVERITY", MX + colDateW + colIssueW + colTitleW + 6, ctx.y + 13);
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  const limited = rows.slice(0, rowLimit);
  for (const i of limited) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(i.title),
      colTitleW - 8,
    );
    const issueLines: string[] = pdf.splitTextToSize(
      sanitize(i.issue),
      colIssueW - 8,
    );
    const rh = Math.max(
      rowH,
      Math.max(titleLines.length, issueLines.length) * 12 + 10,
    );
    // Prevent row from splitting across pages - ensure space for the entire row
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 14, textOpts);
    pdf.text(issueLines, MX + colDateW + 6, ctx.y + 14, textOpts);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colIssueW + 6, ctx.y + 14, textOpts);

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colIssueW + colTitleW + 6;
    const sevText = sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase());
    const isSmallText = sevText === "HIGH" || sevText === "LOW";
    const chipW = isSmallText ? 40 : 50;
    pdf.rect(chipX, ctx.y + 4, chipW, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(sevText, chipX + chipW / 2, ctx.y + 12.5, { align: "center" });

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
  opts: { labelW?: number; barColor?: string; emptyMessage?: string; caption?: string } = {},
) {
  const labelW = opts.labelW ?? 160;
  const valueW = 34;
  const rowH = 20;
  const gap = 5;
  const axisH = 14;
  const headingH = 22;
  const captionH = opts.caption && rows.length > 0 ? 14 : 0;
  const projectedH =
    rows.length === 0 ? 30 : rows.length * (rowH + gap) + axisH + 6;
  // Reserve room for heading + caption + chart body together so the
  // heading cannot strand at the bottom of a page above an orphaned chart.
  ensureSpace(ctx, headingH + captionH + projectedH);
  drawSubtitle(ctx, heading);
  const { pdf, MX, CW } = ctx;
  if (rows.length === 0) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(opts.emptyMessage ?? "No data reported this week."),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }
  if (opts.caption) {
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(8);
    pdf.text(sanitize(opts.caption), MX, ctx.y + 6);
    setRoboto(pdf, "regular");
    ctx.y += captionH;
  }
  const trackX = MX + labelW + 6;
  const trackW = CW - labelW - 6 - valueW - 6;

  const rawMax = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const { max, step } = niceScale(rawMax);

  for (const r of rows) {
    const y = ctx.y;
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(9.5);
    const labelLines: string[] = pdf.splitTextToSize(
      sanitize(r.label),
      labelW - 4,
    );
    pdf.text(labelLines.slice(0, 1), MX, y + rowH - 7);

    // Track background.
    setFill(pdf, "#F3F4F8");
    pdf.rect(trackX, y + 4, trackW, rowH - 8, "F");

    // Grid lines inside the track.
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.4);
    for (let v = 0; v <= max; v += step) {
      const gx = trackX + (v / max) * trackW;
      pdf.line(gx, y + 4, gx, y + 4 + rowH - 8);
    }

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
    pdf.setFontSize(9.5);
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
  const rowH = 20;
  const colDateW = 60;
  const colCountryW = 90;
  const colSignalW = 150;
  const colMeaningW = CW - colDateW - colCountryW - colSignalW;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + rowH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rowH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("COUNTRY", MX + colDateW + 6, ctx.y + 13);
    pdf.text("SIGNAL", MX + colDateW + colCountryW + 6, ctx.y + 13);
    pdf.text(
      "OPERATIONAL MEANING",
      MX + colDateW + colCountryW + colSignalW + 6,
      ctx.y + 13,
    );
    ctx.y += rowH;
  };

  ensureSpace(ctx, rowH * 2);
  drawHeader();

  for (const r of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const signalLines: string[] = pdf.splitTextToSize(
      sanitize(r.signal),
      colSignalW - 8,
    );
    const meaningLines: string[] = pdf.splitTextToSize(
      sanitize(r.meaning),
      colMeaningW - 8,
    );
    const countryLines: string[] = pdf.splitTextToSize(
      sanitize(r.country),
      colCountryW - 8,
    );
    const dateLines: string[] = pdf.splitTextToSize(
      sanitize(r.date ?? "\u2014"),
      colDateW - 8,
    );
    const lines = Math.max(
      dateLines.length,
      countryLines.length,
      signalLines.length,
      meaningLines.length,
    );
    const rh = Math.max(rowH, lines * 12 + 10);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    const textOpts = { lineHeightFactor: 1.4 };
    setText(pdf, NAVY);
    setRoboto(pdf, "regular");
    pdf.text(dateLines, MX + 6, ctx.y + 14, textOpts);

    setRoboto(pdf, "bold");
    pdf.text(countryLines, MX + colDateW + 6, ctx.y + 14, textOpts);

    setRoboto(pdf, "regular");
    setText(pdf, NAVY);
    pdf.text(signalLines, MX + colDateW + colCountryW + 6, ctx.y + 14, textOpts);

    setText(pdf, DUSK);
    pdf.text(
      meaningLines,
      MX + colDateW + colCountryW + colSignalW + 6,
      ctx.y + 14,
      textOpts,
    );
    ctx.y += rh;
  }
  ctx.y += 10;
}

// --- Related Incidents -----------------------------------------------------
function drawRelatedIncidents(ctx: Ctx, rows: EnrichedIncident[]) {
  ensureSpace(ctx, 24 + 18 + 40);
  // Must match FlashpointReportPreview's "Related Incidents" heading — the
  // in-app PDF rasterises the preview, so the headless heading must agree.
  drawSectionHeading(ctx, "Related Incidents");
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(
        "No related incidents reported this week. Treat the quiet week as a gap in reporting rather than a sustained easing.",
      ),
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
  const colSevW = 75;
  const colTitleW = CW - colDateW - colIssueW - colSevW - 6;
  const rowH = 20;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y, MX + CW, ctx.y);
    pdf.line(MX, ctx.y, MX, ctx.y + rowH);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rowH);
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("DATE", MX + 6, ctx.y + 13);
    pdf.text("ISSUE", MX + colDateW + 6, ctx.y + 13);
    pdf.text("TITLE", MX + colDateW + colIssueW + 6, ctx.y + 13);
    pdf.text("SEVERITY", MX + colDateW + colIssueW + colTitleW + 6, ctx.y + 13);
    ctx.y += rowH;
  };
  drawHeader();

  for (const i of rows) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(8.5);

    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(i.title),
      colTitleW - 8,
    );
    const issueLines: string[] = pdf.splitTextToSize(
      sanitize(i.issue),
      colIssueW - 8,
    );
    const rh = Math.max(
      rowH,
      Math.max(titleLines.length, issueLines.length) * 12 + 10,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
      setRoboto(pdf, "regular");
      pdf.setFontSize(8.5);
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.6);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);
    pdf.line(MX, ctx.y, MX, ctx.y + rh);
    pdf.line(MX + CW, ctx.y, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    const textOpts = { lineHeightFactor: 1.4 };
    pdf.text(format(i.date, "dd MMM yyyy"), MX + 6, ctx.y + 14, textOpts);
    pdf.text(issueLines, MX + colDateW + 6, ctx.y + 14, textOpts);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colIssueW + 6, ctx.y + 14, textOpts);

    const sk = sevKey(i.severity);
    setFill(pdf, SEV_COLOR[sk] ?? "#999999");
    const chipX = MX + colDateW + colIssueW + colTitleW + 6;
    const sevText = sanitize((SEV_LABEL[sk] ?? i.severity ?? "").toUpperCase());
    const isSmallText = sevText === "HIGH" || sevText === "LOW";
    const chipW = isSmallText ? 40 : 50;
    pdf.rect(chipX, ctx.y + 4, chipW, 12, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(6.5);
    pdf.text(sevText, chipX + chipW / 2, ctx.y + 12.5, { align: "center" });

    ctx.y += rh;
  }
  ctx.y += 8;
}

// --- Exporter --------------------------------------------------------------
export async function exportFlashpointReportPdf(
  data: FlashpointReportData,
  incidents: FlashpointReportIncident[],
  filename: string,
  aiProse?: TopicAiProse | null,
  hiddenSections?: string[],
  sectionOverrides?: TopicSectionOverrides | null,
): Promise<void> {
  const show = makeSectionGate(hiddenSections);
  const canon = canonicalTopic(data.topic);
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const cadence = `${canon.cadence} Briefing`;
  let headerDate = data.issueDate;
  try {
    headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd");
  } catch {
    /* keep */
  }

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
      console.warn(
        "[exportFlashpointReportPdf] cover image load failed, falling back to gradient hero",
        err,
      );
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

  const ds = buildFlashpointReportDataset(
    incidents,
    data.topic,
    data.issueDate,
  );

  if (show("executive-summary")) {
    drawSectionHeading(ctx, "Executive Summary");
    const execText = (data.executiveSummary ?? "").trim();
    renderProse(
      ctx,
      execText || aiOr(aiProse?.executiveSummary, ds.autoExecutiveSummary),
    );
  }

  if (show("fast-facts")) {
    drawSectionHeading(ctx, "Fast Facts");
    drawFastFactsKpiCards(
      ctx,
      applyFastFactOverrides(ds.fastFacts, sectionOverrides?.fastFactOverrides),
    );
  }

  // Activism and Protest Read — prose leads the activism table.
  if (show("activism")) {
    drawSectionWithProse(
      ctx,
      "Activism and Protest Read",
      pickRead(data.activismRead, ds.activismRead),
    );
    drawIncidentTable(
      ctx,
      null,
      ds.activismRows,
      "No activism reporting this week.",
    );
  }

  // Civil Unrest and Public Order Read — prose leads the unrest table.
  if (show("civil-unrest")) {
    drawSectionWithProse(
      ctx,
      "Civil Unrest and Public Order Read",
      pickRead(data.civilUnrestRead, ds.civilUnrestRead),
    );
    drawIncidentTable(
      ctx,
      null,
      ds.unrestRows,
      "No civil-unrest reporting this week.",
    );
  }

  // Forecast — structured Country / Signal / Operational meaning table
  // (when future-dated items are present) followed by analyst
  // trajectory prose with cautious vocabulary.
  if (show("forecast")) {
    drawSectionHeading(ctx, "Forecast: Next 7\u201314 Days");
    if (ds.forecastFuture.length > 0) {
      drawForecastFutureTable(ctx, ds.forecastFuture);
    }
    renderProse(ctx, pickRead(data.forecastRead, ds.forecastRead));
  }

  // Regional and Country View — prose leads the country bar chart.
  if (show("regional")) {
    drawSectionWithProse(
      ctx,
      "Regional and Country View",
      pickRead(data.regionalCountryRead, ds.regionalCountryRead),
    );
    drawHorizontalBarChart(
      ctx,
      ds.countryRows.length >= 12
        ? "Incidents by Country (Top 12)"
        : "Incidents by Country",
      ds.countryRows,
      {
        labelW: 160,
        emptyMessage: "No identified incident countries reported this week.",
        caption:
          "Bar length shows incident count; colour shows the highest severity reported in each country.",
      },
    );
  }

  // Editor-authored analyst sections. Editor text wins only when it
  // carries substance; thin stubs get the auto-prose appended.
  // Mirror FlashpointReportPreview.pickProse exactly: recognised generic
  // seed text is always replaced by the data-driven auto-prose so the PDF
  // can never show boilerplate the preview suppresses.
  const pickProse = (
    editor: string | null | undefined,
    auto: string,
  ): string => {
    const t = (editor ?? "").trim();
    if (!t || isGenericFlashpointProse(t)) return auto;
    if (t.length >= 240) return t;
    return `${t}\n\n${auto}`;
  };
  if (show("what-matters")) {
    // "What Matters" is a short, self-contained judgement section, so keep the
    // whole section on one page rather than allowing it to split at a break.
    drawSectionKeepTogether(
      ctx,
      "What Matters",
      pickProse(data.whatMatters, aiOr(aiProse?.whatMatters, ds.autoWhatMatters)),
    );
  }
  if (show("implications")) {
    drawBulletSection(
      ctx,
      "Implications for Business",
      pickProse(data.implications, aiOr(aiProse?.implications, ds.autoImplications)),
    );
  }
  if (show("watch-next")) {
    drawBulletSection(
      ctx,
      "Watch Next",
      pickProse(data.watchNext, aiOr(aiProse?.watchNext, ds.autoWatchNext)),
      8,
    );
  }
  if (show("polestar-view")) {
    drawSectionWithProse(
      ctx,
      "Polestar View",
      pickProse(data.polestarView, aiOr(aiProse?.polestarView, ds.autoPolestarView)),
    );
  }

  if (show("related-incidents")) {
    drawRelatedIncidents(ctx, ds.relatedIncidents);
  }

  // Source Notes / Data Notes removed per editorial direction — internal
  // methodology must not appear in client-facing Flashpoint exports.
  // Disclaimer follows Related Incidents directly.

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
