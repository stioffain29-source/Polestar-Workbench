import { format, parseISO } from "date-fns";
import { resolveIncidentSummary } from "./incidentSummary";
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
import { makeSectionGate } from "./topicSectionOverrides";
import { pickRead } from "./pickRead";
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
  // Analyst overrides for the conflict reads (blank → live generated read).
  conflictOtherWatchedRead?: string | null;
  conflictAreaReads?: Record<string, string> | null;
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
function drawTopActivityAreas(
  ctx: Ctx,
  areas: ConflictActivityArea[],
  reads?: Record<string, string> | null,
) {
  const { pdf, MX, CW } = ctx;
  const resolveRead = (area: ConflictActivityArea): string =>
    pickRead(reads?.[area.theatre], area.paragraph);
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
    sanitize(resolveRead(areas[0])),
    CW,
  );
  const headingBlockH = 14 + 14 + 8 + 16;
  const firstNeed = headingBlockH + 16 + firstLines.length * 17 + 14;
  if (ctx.y + firstNeed > ctx.H - ctx.BOTTOM) newPage(ctx);
  drawSectionHeading(ctx, "Top Activity Areas");

  areas.forEach((area, idx) => {
    const body = resolveRead(area);
    if (idx > 0) {
      setRoboto(pdf, "light");
      pdf.setFontSize(11);
      const lines: string[] = pdf.splitTextToSize(sanitize(body), CW);
      const need = 16 + Math.min(lines.length, 3) * 17 + 10;
      if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);
    }
    drawSubtitle(ctx, area.theatre);
    renderProse(ctx, body);
  });
}

// --- Related Incidents -----------------------------------------------------
function drawRelatedIncidents(
  ctx: Ctx,
  rows: ConflictEnrichedIncident[],
  summaries: Record<string, string>,
) {
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
    pdf.setFontSize(7);
    const summaryLines: string[] = pdf.splitTextToSize(
      sanitize(resolveIncidentSummary(i, summaries)),
      colTitleW - 8,
    );
    pdf.setFontSize(8.5);
    const titleBlockH = titleLines.length * 12 + summaryLines.length * 9 + 4;
    const rh = Math.max(
      rowH,
      Math.max(titleBlockH, issueLines.length * 12) + 10,
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
    const titleX = MX + colDateW + colIssueW + 6;
    pdf.text(titleLines, titleX, ctx.y + 14, textOpts);
    if (summaryLines.length > 0) {
      setText(pdf, DUSK);
      pdf.setFontSize(7);
      pdf.text(
        summaryLines,
        titleX,
        ctx.y + 14 + titleLines.length * 12 + 2,
        textOpts,
      );
      pdf.setFontSize(8.5);
    }

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
// AI-generated narrative for the four sections the conflict report renders.
// Mirrors ConflictReportPreview.ConflictAiProse so preview and PDF resolve prose
// with the identical (aiOr -> pickProse) chain and can never disagree.
export interface ConflictAiProse {
  situation?: string | null;
  whatMatters?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

export async function exportConflictReportPdf(
  data: ConflictReportData,
  incidents: ConflictReportIncident[],
  filename: string,
  situationalReports?: ReliefWebReport[] | null,
  incidentSummaries: Record<string, string> = {},
  aiProse?: ConflictAiProse | null,
  hiddenSections?: string[],
): Promise<void> {
  const show = makeSectionGate(hiddenSections);
  // AI replaces the deterministic auto-prose as the fallback layer; a genuine
  // analyst edit (via pickProse) still wins over both.
  const aiOr = (ai: string | null | undefined, det: string): string => {
    const t = (ai ?? "").trim();
    return t ? t : det;
  };
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
  if (show("situation")) {
    drawSectionWithProse(
      ctx,
      "Situation",
      pickProse(data.situation, aiOr(aiProse?.situation, ds.autoSituation)),
    );
  }

  // 2. Fast Facts.
  if (show("fast-facts")) {
    drawSectionHeading(ctx, "Fast Facts");
    drawFastFactsKpiCards(ctx, ds.fastFacts);
  }

  // 3. Top Activity Areas (dynamic top-3 theatres, country heading + para).
  if (show("top-activity-areas")) {
    drawTopActivityAreas(ctx, ds.topActivityAreas, data.conflictAreaReads);
  }

  // 4. Other Watched Theatres.
  if (show("other-watched")) {
    drawSectionWithProse(
      ctx,
      "Other Watched Theatres",
      pickRead(data.conflictOtherWatchedRead, ds.autoOtherWatched),
    );
  }

  // 5. What Matters for Business.
  if (show("what-matters")) {
    drawSectionWithProse(
      ctx,
      "What Matters for Business",
      pickProse(data.whatMatters, aiOr(aiProse?.whatMatters, ds.autoWhatMatters)),
    );
  }

  // 6. Watch Next.
  if (show("watch-next")) {
    drawBulletSection(
      ctx,
      "Watch Next",
      pickProse(data.watchNext, aiOr(aiProse?.watchNext, ds.autoWatchNext)),
      8,
    );
  }

  // 7. Polestar View.
  if (show("polestar-view")) {
    drawSectionWithProse(
      ctx,
      "Polestar View",
      pickProse(data.polestarView, aiOr(aiProse?.polestarView, ds.autoPolestarView)),
    );
  }

  drawSituationalContextPdf(ctx, buildSituationalContext(situationalReports, { max: 6 }));

  if (show("related-incidents")) {
    drawRelatedIncidents(ctx, ds.relatedIncidents, incidentSummaries);
  }

  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
