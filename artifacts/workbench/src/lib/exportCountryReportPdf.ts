import { format, parseISO } from "date-fns";
import {
  createCtx,
  newPage,
  ensureSpace,
  drawSectionHeading,
  renderProse,
  drawSectionWithProse,
  drawFastFactsKpiCards,
  drawDisclaimer,
  drawFooters,
  drawPolestarCover,
  beginBodyPages,
  drawDataAsOf,
  prepareCoverImage,
  COVER_TOP_BAND_H,
  COVER_BOTTOM_BLOCK_H,
  setFill,
  setStroke,
  setText,
  sanitize,
  todayLabel,
  setRoboto,
  ensureRobotoLoaded,
  NAVY,
  ELECTRIC,
  POLAR,
  DUSK,
  WHITE,
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  type Ctx,
  type KpiCardData,
} from "./pdfChrome";
import { computeDataAsOf, formatDataAsOfLine } from "./reportDataStatus";
import { COUNTRY_COVER_URLS } from "./coverImages";
import { relatedIncidentsLimit } from "./reportWindow";
import { classifyIncidentType } from "./incidentClassifier";
import {
  computeCountryFastFacts,
  COUNTRY_WINDOW_TOPIC,
  type CountryFastFactsIncident,
  type CountryFactsBreakdown,
} from "./countryFastFacts";
import type { CountryBaseline } from "./countryBaselines";
import {
  buildCountryLayers,
  resolveActiveCountryWindow,
  type WatchlistRow,
} from "./countryReportLayers";

export interface PdfIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}

export interface PdfCountry {
  name: string;
  region: string;
  overview?: string | null;
  trendSummary?: string | null;
  implications?: string | null;
  keyNumbers?:
    | { label: string; value: string; context?: string | null }[]
    | null;
}

export interface CountryPdfExtras {
  /** Auto-derived executive summary prose (natural, no banned openers). */
  executiveSummary?: string;
  /** Auto-derived "What Matters" prose. */
  whatMatters?: string;
  /** Optional "Watch Next" prose; rendered only if provided and non-empty. */
  watchNext?: string;
  /** Optional "Polestar View" prose; rendered only if provided and non-empty. */
  polestarView?: string;
  /** PNG data-URL of the rendered preview map. Optional. */
  mapImage?: string;
  /** Curated country baseline (operating environment, security context,
   *  risk areas, key cities, infrastructure, medical / evac, resource
   *  exposure). When absent the baseline section is skipped. */
  baseline?: CountryBaseline | null;
  /** Watchlist breakdown — per-location 7d / 30d / 90d counts plus the
   *  worst severity observed across the 90-day lookback. Empty when
   *  no baseline is curated. */
  watchlist?: WatchlistRow[];
  /** Client-safe 30-day and 90-day context paragraphs. */
  lookback?: { thirtyDay: string; ninetyDay: string };
  /** Bucket sizes so the PDF can word the map caption honestly. */
  layerCounts?: { current: number; thirtyDay: number; ninetyDay: number };
}

const SEV_ORDER = [
  "extreme",
  "high",
  "moderate",
  "low",
  "insignificant",
] as const;

function drawSeverityChart(ctx: Ctx, facts: CountryFactsBreakdown) {
  const total = SEV_ORDER.reduce((s, k) => s + facts.severityCounts[k], 0);
  const rowH = 18;
  const chartH = SEV_ORDER.length * rowH + 10;
  ensureSpace(ctx, 32 + (total === 0 ? 34 : chartH));
  drawSectionHeading(ctx, "Severity Distribution");
  if (total === 0) {
    renderProse(ctx, "No incidents in the weekly window to chart.");
    return;
  }
  const { pdf, MX, CW } = ctx;
  const labelW = 110;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;

  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  SEV_ORDER.forEach((k, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(SEV_LABEL[k] ?? k), MX, ry + 12);
    const n = facts.severityCounts[k];
    const w = total === 0 ? 0 : (n / total) * barAreaW;
    setFill(pdf, SEV_COLOR[k] ?? POLAR);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(String(n), barAreaX + barAreaW + 6, ry + 12);
    setRoboto(pdf, "regular");
  });
  ctx.y += chartH + 18;
}

function drawTypeChart(ctx: Ctx, facts: CountryFactsBreakdown) {
  const data = Array.from(facts.typeCounts.entries())
    .map(([type, n]) => ({ label: type, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const rowH = 18;
  const chartH = data.length * rowH + 10;
  ensureSpace(ctx, 32 + (data.length === 0 ? 34 : chartH));
  drawSectionHeading(ctx, "Incident Breakdown by Type");
  if (data.length === 0) {
    renderProse(ctx, "No classifiable incident types in the weekly window.");
    return;
  }
  const max = Math.max(...data.map((d) => d.n));
  const { pdf, MX, CW } = ctx;
  const labelW = 160;
  const countW = 36;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - countW - 8;

  setRoboto(pdf, "regular");
  pdf.setFontSize(9);
  data.forEach((d, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(sanitize(d.label), MX, ry + 12);
    const w = max === 0 ? 0 : (d.n / max) * barAreaW;
    setFill(pdf, ELECTRIC);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");
    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(String(d.n), barAreaX + barAreaW + 6, ry + 12);
    setRoboto(pdf, "regular");
  });
  ctx.y += chartH + 18;
}

function drawMapSection(
  ctx: Ctx,
  opts: { mapImage?: string; plottedCount: number; totalInWindow: number; basisShort: string },
) {
  ensureSpace(ctx, opts.mapImage ? 192 : 88);
  drawSectionHeading(ctx, "Map");
  const { pdf, MX, CW } = ctx;
  if (opts.mapImage) {
    try {
      const targetW = CW;
      // Estimate the image's aspect ratio from the dataURL by drawing into
      // a probe image element is not available in jsPDF here, so we fall
      // back to the on-screen ratio used in the preview (1400×360 area).
      const aspect = 360 / 1400;
      const imgH = Math.min(targetW * aspect, 280);
      ensureSpace(ctx, imgH + 12);
      pdf.addImage(
        opts.mapImage,
        "PNG",
        MX,
        ctx.y,
        targetW,
        imgH,
        undefined,
        "FAST",
      );
      ctx.y += imgH + 6;
    } catch (err) {
      console.warn("[exportCountryReportPdf] embedding map image failed", err);
    }
  } else {
    renderProse(
      ctx,
      "The interactive incident map is available in the Workbench preview. Records without coordinates are included in totals and tables but cannot be plotted.",
    );
  }
  ensureSpace(ctx, 16);
  setRoboto(pdf, "italic");
  pdf.setFontSize(8);
  setText(pdf, DUSK);
  const note =
    opts.totalInWindow === 0
      ? `No records in the ${opts.basisShort} window to plot.`
      : opts.plottedCount === opts.totalInWindow
        ? `All ${opts.plottedCount} record${opts.plottedCount === 1 ? "" : "s"} in the ${opts.basisShort} window are plotted.`
        : `${opts.plottedCount} of ${opts.totalInWindow} record${opts.totalInWindow === 1 ? "" : "s"} plotted; records without coordinates are excluded from the map.`;
  pdf.text(sanitize(note), MX, ctx.y + 10);
  setRoboto(pdf, "regular");
  ctx.y += 18;
}

function drawIncidentTable(ctx: Ctx, incidents: PdfIncident[]) {
  if (incidents.length === 0) return;
  ensureSpace(ctx, 24 + 18 + 40);
  drawSectionHeading(ctx, "Related Incidents");
  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTypeW = 120;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTypeW - colSevW - 6;
  const rowH = 18;

  const drawHeader = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text("DATE", MX + 6, ctx.y + 12);
    pdf.text("TYPE", MX + colDateW + 6, ctx.y + 12);
    pdf.text("TITLE", MX + colDateW + colTypeW + 6, ctx.y + 12);
    pdf.text("SEVERITY", MX + colDateW + colTypeW + colTitleW + 6, ctx.y + 12);
    ctx.y += rowH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  const sorted = [...incidents].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const { max: ROW_MAX } = relatedIncidentsLimit(COUNTRY_WINDOW_TOPIC);
  const rows = sorted.slice(0, ROW_MAX);
  const truncated = sorted.length - rows.length;

  drawHeader();

  for (const i of rows) {
    const titleLines: string[] = pdf.splitTextToSize(
      sanitize(i.title),
      colTitleW - 8,
    );
    const rh = Math.max(rowH, titleLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    let dateStr = "";
    try {
      dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy");
    } catch {
      dateStr = i.occurredAt;
    }
    pdf.text(dateStr, MX + 6, ctx.y + 12);
    const incidentType = classifyIncidentType(i);
    const typeLines: string[] = pdf.splitTextToSize(
      sanitize(incidentType),
      colTypeW - 8,
    );
    pdf.text(typeLines, MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colTypeW + 6, ctx.y + 12);

    const sk = sevKey(i.severity);
    const sevColor = SEV_COLOR[sk] ?? "#999999";
    setFill(pdf, sevColor);
    const chipX = MX + colDateW + colTypeW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    const sevDisplay = SEV_LABEL[sk] ?? i.severity ?? "";
    pdf.text(sanitize(sevDisplay.toUpperCase()), chipX + 28, ctx.y + 12, {
      align: "center",
    });
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 8;

  // Client-facing reports intentionally omit the "Showing N latest of M"
  // notice. The table cap is internal Workbench logic.
  void truncated;
  void sorted;
}

function drawBaselineSection(ctx: Ctx, baseline: CountryBaseline) {
  drawSectionHeading(ctx, "Country Baseline");
  const labelled = (label: string, text: string) => {
    ensureSpace(ctx, 28);
    const { pdf, MX, CW } = ctx;
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    setText(pdf, NAVY);
    pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 9);
    ctx.y += 12;
    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    setText(pdf, DUSK);
    const lines: string[] = pdf.splitTextToSize(sanitize(text), CW);
    for (const line of lines) {
      ensureSpace(ctx, 13);
      pdf.text(line, ctx.MX, ctx.y + 10);
      ctx.y += 13;
    }
    ctx.y += 6;
  };
  const bullets = (label: string, items: string[]) => {
    ensureSpace(ctx, 28);
    const { pdf, MX, CW } = ctx;
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    setText(pdf, NAVY);
    pdf.text(sanitize(label.toUpperCase()), MX, ctx.y + 9);
    ctx.y += 12;
    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    setText(pdf, DUSK);
    for (const item of items) {
      const lines: string[] = pdf.splitTextToSize(
        sanitize(`• ${item}`),
        CW - 6,
      );
      for (const line of lines) {
        ensureSpace(ctx, 13);
        pdf.text(line, MX + 6, ctx.y + 10);
        ctx.y += 13;
      }
    }
    ctx.y += 6;
  };

  labelled("Operating Environment", baseline.operatingEnvironment);
  labelled("Security Context", baseline.securityContext);
  bullets("Known Risk Areas", baseline.knownRiskAreas);
  bullets("Key Cities / Provinces", baseline.keyCitiesProvinces);
  labelled("Movement Constraints", baseline.movementConstraints);
  labelled("Infrastructure Limits", baseline.infrastructureLimits);
  labelled("Medical / Evacuation", baseline.medicalEvac);
  labelled("Resource-Sector Exposure", baseline.resourceSectorExposure);
}

function drawWatchlistTable(ctx: Ctx, rows: WatchlistRow[]) {
  if (rows.length === 0) return;
  drawSectionHeading(ctx, "Location Watchlist");
  const { pdf, MX, CW } = ctx;
  const colLabelW = 130;
  const col7W = 32;
  const col30W = 32;
  const col90W = 32;
  const colSevW = 70;
  const colNoteW = CW - colLabelW - col7W - col30W - col90W - colSevW - 6;
  const rowH = 18;

  const header = () => {
    setFill(pdf, NAVY);
    pdf.rect(MX, ctx.y, CW, rowH, "F");
    setText(pdf, WHITE);
    setRoboto(pdf, "bold");
    pdf.setFontSize(7);
    pdf.text("LOCATION", MX + 6, ctx.y + 12);
    pdf.text("NOTE", MX + colLabelW + 6, ctx.y + 12);
    pdf.text("7D", MX + colLabelW + colNoteW + col7W - 4, ctx.y + 12, {
      align: "right",
    });
    pdf.text(
      "30D",
      MX + colLabelW + colNoteW + col7W + col30W - 4,
      ctx.y + 12,
      { align: "right" },
    );
    pdf.text(
      "90D",
      MX + colLabelW + colNoteW + col7W + col30W + col90W - 4,
      ctx.y + 12,
      { align: "right" },
    );
    pdf.text(
      "WORST (90D)",
      MX + colLabelW + colNoteW + col7W + col30W + col90W + 6,
      ctx.y + 12,
    );
    ctx.y += rowH;
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
  };

  ensureSpace(ctx, rowH * 3);
  header();

  for (const r of rows) {
    const labelLines: string[] = pdf.splitTextToSize(
      sanitize(r.label),
      colLabelW - 8,
    );
    const noteLines: string[] = pdf.splitTextToSize(
      sanitize(r.note),
      colNoteW - 8,
    );
    const rh = Math.max(
      rowH,
      labelLines.length * 11 + 8,
      noteLines.length * 10 + 8,
    );
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      header();
    }
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.setFontSize(8);
    pdf.text(labelLines, MX + 6, ctx.y + 12);
    setRoboto(pdf, "regular");
    setText(pdf, DUSK);
    pdf.setFontSize(8);
    pdf.text(noteLines, MX + colLabelW + 6, ctx.y + 12);

    setText(pdf, NAVY);
    setRoboto(pdf, "bold");
    pdf.text(
      String(r.currentCount),
      MX + colLabelW + colNoteW + col7W - 4,
      ctx.y + 12,
      { align: "right" },
    );
    pdf.text(
      String(r.thirtyDayCount),
      MX + colLabelW + colNoteW + col7W + col30W - 4,
      ctx.y + 12,
      { align: "right" },
    );
    pdf.text(
      String(r.ninetyDayCount),
      MX + colLabelW + colNoteW + col7W + col30W + col90W - 4,
      ctx.y + 12,
      { align: "right" },
    );
    setRoboto(pdf, "regular");

    const sk = sevKey(r.worstSeverity);
    if (r.worstSeverity) {
      const sevColor = SEV_COLOR[sk] ?? "#999999";
      setFill(pdf, sevColor);
      const chipX = MX + colLabelW + colNoteW + col7W + col30W + col90W + 6;
      pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
      setText(pdf, WHITE);
      setRoboto(pdf, "bold");
      pdf.setFontSize(7);
      pdf.text(
        sanitize((SEV_LABEL[sk] ?? r.worstSeverity).toUpperCase()),
        chipX + 28,
        ctx.y + 12,
        { align: "center" },
      );
      setRoboto(pdf, "regular");
      pdf.setFontSize(8);
    } else {
      setText(pdf, DUSK);
      setRoboto(pdf, "italic");
      pdf.setFontSize(8);
      pdf.text(
        "No records",
        MX + colLabelW + colNoteW + col7W + col30W + col90W + 6,
        ctx.y + 12,
      );
      setRoboto(pdf, "regular");
    }

    ctx.y += rh;
  }
  ctx.y += 8;
}

function drawNarrative(
  ctx: Ctx,
  heading: string,
  body: string | null | undefined,
  fallback?: string,
) {
  const trimmed = (body ?? "").trim();
  const text = trimmed || (fallback ?? "");
  // Keep the heading with its first paragraph so country sections never
  // orphan at the bottom of a PDF page.
  drawSectionWithProse(ctx, heading, text || "Not populated for this cycle.");
}

function buildKpiCards(facts: CountryFactsBreakdown): KpiCardData[] {
  return facts.cards.map((c) => ({
    label: c.label,
    value: c.value,
    note: c.note,
    severity: c.severity,
  }));
}

export async function exportCountryReportPdf(
  country: PdfCountry,
  incidents: PdfIncident[],
  _topicLabels: Record<string, string>,
  filename: string,
  extras: CountryPdfExtras = {},
): Promise<void> {
  const issueDate = todayLabel();
  const ctx = createCtx({
    kind: `${country.name} Country Report`,
    issueDate,
  });
  await ensureRobotoLoaded(ctx.pdf);

  const todayIso = new Date().toISOString().slice(0, 10);
  const layers = buildCountryLayers(incidents as CountryFastFactsIncident[], todayIso);
  const active = resolveActiveCountryWindow(layers, todayIso);
  const facts = computeCountryFastFacts({
    issueDate: todayIso,
    incidents: incidents as CountryFastFactsIncident[],
    windowIncidents: active.incidents,
    periodLabel: active.periodShortLabel,
  });
  const windowIncidents = facts.windowIncidents as PdfIncident[];
  const plottedCount = windowIncidents.filter(
    (i) =>
      typeof i.latitude === "number" &&
      typeof i.longitude === "number" &&
      !Number.isNaN(i.latitude) &&
      !Number.isNaN(i.longitude),
  ).length;

  // Polestar cover (page 1)
  let coverImage: Awaited<ReturnType<typeof prepareCoverImage>> | undefined;
  const countryCoverUrl = COUNTRY_COVER_URLS[country.name.trim().toLowerCase()];
  if (countryCoverUrl) {
    try {
      const heroH = ctx.H - COVER_TOP_BAND_H - COVER_BOTTOM_BLOCK_H;
      coverImage = await prepareCoverImage(countryCoverUrl, ctx.W, heroH);
    } catch (err) {
      console.warn(
        `[exportCountryReportPdf] cover image load failed for country ${country.name}`,
        err,
      );
    }
  }
  drawPolestarCover(ctx, {
    title: country.name,
    subtitle: "POLESTAR INSIGHTS",
    reportingPeriod: `REPORTING PERIOD: ${active.periodLabel.toUpperCase()}`,
    coverImage,
  });
  beginBodyPages(ctx);
  drawDataAsOf(
    ctx,
    formatDataAsOfLine({
      ...computeDataAsOf({ topic: "country", incidents, filterByTopic: false }),
      modeLabel: "Mixed sources (live, manual & static)",
    }),
  );

  // 1. Executive Summary
  drawNarrative(
    ctx,
    "Executive Summary",
    extras.executiveSummary,
    `Brief for ${country.name} covering the ${active.basisShort} reporting window. See the sections below for the operating picture, what changed, why it matters, implications and what to watch next.`,
  );

  // 2. Fast Facts
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, buildKpiCards(facts));

  // 3. Situation (overview)
  drawNarrative(ctx, "Situation", country.overview);

  // 4. What Happened (trendSummary)
  drawNarrative(ctx, "What Happened", country.trendSummary);

  // 5. What Matters (auto)
  drawNarrative(ctx, "What Matters", extras.whatMatters);

  // 6. Implications for Business (implications)
  drawNarrative(ctx, "Implications for Business", country.implications);

  // 6a. Country Baseline (only if curated)
  if (extras.baseline) {
    drawBaselineSection(ctx, extras.baseline);
  }

  // 6b. Location Watchlist (only if curated baseline carries one)
  if (extras.watchlist && extras.watchlist.length > 0) {
    drawWatchlistTable(ctx, extras.watchlist);
  }

  // 6c. 30-Day Context
  drawNarrative(
    ctx,
    "30-Day Context",
    extras.lookback?.thirtyDay,
    `No 30-day lookback computed for ${country.name}.`,
  );

  // 6d. Background Operating Picture (90-day)
  drawNarrative(
    ctx,
    "Background Operating Picture",
    extras.lookback?.ninetyDay,
    `No 90-day lookback computed for ${country.name}.`,
  );

  // 7. Map
  drawMapSection(ctx, {
    mapImage: extras.mapImage,
    plottedCount,
    totalInWindow: windowIncidents.length,
    basisShort: active.basisShort,
  });
  // Honest caption so the map is never read as the full risk picture.
  {
    const { pdf, MX } = ctx;
    ensureSpace(ctx, 14);
    setRoboto(pdf, "italic");
    pdf.setFontSize(8);
    setText(pdf, DUSK);
    pdf.text(
      sanitize(
        `The map reflects ${active.basisShort} window records only. The Country Baseline, Location Watchlist and 30 / 90-day context sections above carry the standing operating picture.`,
      ),
      MX,
      ctx.y + 10,
    );
    setRoboto(pdf, "regular");
    ctx.y += 16;
  }

  // 8. Severity Distribution
  drawSeverityChart(ctx, facts);

  // 9. Incident Breakdown by Type
  drawTypeChart(ctx, facts);

  // 9a / 9b. Watch Next + Polestar View — rendered before Related
  // Incidents to mirror the preview's section order exactly.
  drawNarrative(ctx, "Watch Next", extras.watchNext);
  drawNarrative(ctx, "Polestar View", extras.polestarView);

  // 10. Related Incidents
  drawIncidentTable(ctx, windowIncidents);

  // 12. Disclaimer
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
