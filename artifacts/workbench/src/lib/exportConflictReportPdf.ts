import { format, parseISO } from "date-fns";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  drawSubtitle,
  renderProse,
  drawSectionWithProse,
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
  buildConflictReportDataset,
  isGenericConflictProse,
  type ConflictReportIncident,
  type ConflictEnrichedIncident,
  type ConflictActivityArea,
} from "./conflictReportDataset";
import { buildSituationalContext } from "./situationalContext";
import { drawSituationalContextPdf } from "./situationalContextPdf";
import type { ReliefWebReport } from "@workspace/api-client-react";

// Conflict Watch PDF. Section order (LOCATION-LED, no Executive Summary):
//   Cover -> Situation -> Fast Facts -> Top Activity Areas ->
//   Other Watched Theatres -> What Matters for Business -> Watch Next ->
//   Polestar View -> Related Incidents -> Disclaimer -> Data as of.
// Data and prose come from buildConflictReportDataset so the preview
// (ConflictReportPreview) and this exporter cannot drift.

export interface ConflictReportData {
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

export type { ConflictReportIncident };

// Editor text wins only when it carries substance (>= 240 chars) AND is not a
// recognised legacy CONFLICT-pack seed. Identical to ConflictReportPreview's
// pickProse so preview and PDF can never disagree.
function pickProse(editor: string | null | undefined, auto: string): string {
  const t = (editor ?? "").trim();
  if (!t || isGenericConflictProse(t)) return auto;
  if (t.length >= 240) return t;
  return `${t}\n\n${auto}`;
}

// --- Top Activity Areas (country heading + paragraph each) ------------------
function drawTopActivityAreas(ctx: Ctx, areas: ConflictActivityArea[]) {
  const { pdf, MX, CW } = ctx;
  if (areas.length === 0) {
    drawSectionHeading(ctx, "Top Activity Areas");
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(
        "No theatre carried notable armed activity this period. Treat the quiet stretch as a gap in reporting rather than a sustained calm.",
      ),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 22;
    return;
  }

  // Keep the section heading with the first theatre block so the heading
  // cannot strand at the foot of a page above an orphaned theatre.
  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  const firstLines: string[] = pdf.splitTextToSize(
    sanitize(areas[0].paragraph),
    CW,
  );
  const headingBlockH = 14 + 14 + 8 + 16;
  const firstNeed = headingBlockH + 16 + firstLines.length * 17 + 14;
  if (ctx.y + firstNeed > ctx.H - ctx.BOTTOM) newPage(ctx);
  drawSectionHeading(ctx, "Top Activity Areas");

  areas.forEach((area, idx) => {
    if (idx > 0) {
      setRoboto(pdf, "light");
      pdf.setFontSize(11);
      const lines: string[] = pdf.splitTextToSize(sanitize(area.paragraph), CW);
      const need = 16 + Math.min(lines.length, 3) * 17 + 10;
      if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
    }
    drawSubtitle(ctx, area.theatre);
    renderProse(ctx, area.paragraph);
  });
}

// --- Related Incidents -----------------------------------------------------
function drawRelatedIncidents(ctx: Ctx, rows: ConflictEnrichedIncident[]) {
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");
  if (rows.length === 0) {
    const { pdf, MX } = ctx;
    setText(pdf, DUSK);
    setRoboto(pdf, "italic");
    pdf.setFontSize(9);
    pdf.text(
      sanitize(
        "Little related activity was reported this period. Treat the quiet stretch as a gap in reporting rather than a lasting calm.",
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
      sanitize(i.displayTitle ?? i.title),
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
export async function exportConflictReportPdf(
  data: ConflictReportData,
  incidents: ConflictReportIncident[],
  filename: string,
  situationalReports?: ReliefWebReport[] | null,
): Promise<void> {
  const resolvedTitle = resolveReportTitle(data.topic, data.title);
  const canon = canonicalTopic(data.topic);
  void canon;
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
        "[exportConflictReportPdf] cover image load failed, falling back to gradient hero",
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
  beginBodyPages(ctx);

  const ds = buildConflictReportDataset(incidents, data.topic, data.issueDate);

  // 1. Situation (leads — Executive Summary dropped).
  drawSectionWithProse(
    ctx,
    "Situation",
    pickProse(data.situation, ds.autoSituation),
  );

  // 2. Fast Facts.
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, ds.fastFacts);

  // 3. Top Activity Areas (dynamic top-3 theatres, country heading + para).
  drawTopActivityAreas(ctx, ds.topActivityAreas);

  // 4. Other Watched Theatres.
  drawSectionWithProse(
    ctx,
    "Other Watched Theatres",
    ds.autoOtherWatched,
  );

  // 5. What Matters for Business.
  drawSectionWithProse(
    ctx,
    "What Matters for Business",
    pickProse(data.whatMatters, ds.autoWhatMatters),
  );

  // 6. Watch Next.
  drawBulletSection(
    ctx,
    "Watch Next",
    pickProse(data.watchNext, ds.autoWatchNext),
    8,
  );

  // 7. Polestar View.
  drawSectionWithProse(
    ctx,
    "Polestar View",
    pickProse(data.polestarView, ds.autoPolestarView),
  );

  drawSituationalContextPdf(ctx, buildSituationalContext(situationalReports, { max: 6 }));

  drawRelatedIncidents(ctx, ds.relatedIncidents);

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
