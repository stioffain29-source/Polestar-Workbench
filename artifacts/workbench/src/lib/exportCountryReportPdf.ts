import { jsPDF } from "jspdf";
import { format, parseISO, min as dateMin, max as dateMax } from "date-fns";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

const NAVY = "#0B0B3D";
const ELECTRIC = "#4655FF";
const POLAR = "#E2E2E2";
const DUSK = "#303030";
const WHITE = "#FFFFFF";

const SEV_RANK: Record<string, number> = {
  Insignificant: 1, Low: 2, Moderate: 3, High: 4, Extreme: 5,
};
const SEV_COLOR: Record<string, string> = {
  Extreme: "#800000",
  High: "#C0392B",
  Moderate: "#E67E22",
  Low: "#6FB872",
  Insignificant: "#B8C2CC",
};

export interface PdfIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PdfCountry {
  name: string;
  region: string;
  overview?: string | null;
  trendSummary?: string | null;
  implications?: string | null;
  keyNumbers?: { label: string; value: string; context?: string | null }[] | null;
}

interface FastFacts {
  reportingPeriod: string;
  totalIncidents: number;
  confirmedStrikes: number;
  highestSeverity: string;
  mostCommonType: string;
  mainAffectedArea: string;
  currentAssessment: string;
}

function computeFastFacts(
  country: PdfCountry,
  incidents: PdfIncident[],
  topicLabels: Record<string, string>,
): FastFacts {
  let period = "No incidents in window";
  if (incidents.length > 0) {
    const dates = incidents
      .map((i) => {
        try { return parseISO(i.occurredAt); } catch { return null; }
      })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) {
      period = `${format(dateMin(dates), "dd MMM yyyy")} – ${format(dateMax(dates), "dd MMM yyyy")}`;
    }
  }

  const confirmedStrikes = incidents.filter((i) =>
    i.topic === "missile_strike" || i.topic === "drone_strike" || i.topic === "strikes",
  ).length;

  let highest = "Insignificant";
  let highestRank = 0;
  for (const i of incidents) {
    const r = SEV_RANK[i.severity] ?? 0;
    if (r > highestRank) { highestRank = r; highest = i.severity; }
  }
  if (incidents.length === 0) highest = "—";

  const topicCount = new Map<string, number>();
  for (const i of incidents) {
    topicCount.set(i.topic, (topicCount.get(i.topic) ?? 0) + 1);
  }
  let mostCommon = "—";
  let mostCommonN = 0;
  for (const [t, n] of topicCount) {
    if (n > mostCommonN) { mostCommonN = n; mostCommon = topicLabels[t] ?? t; }
  }

  // Main affected area: derive from keyNumbers context if present, else from country.region
  let mainArea = country.region || "—";
  if (country.keyNumbers && country.keyNumbers.length > 0) {
    const withCtx = country.keyNumbers.find((k) => !!k.context && k.context.trim().length > 0);
    if (withCtx?.context) mainArea = withCtx.context;
  }

  // Current assessment: derive from highest severity
  const assessmentMap: Record<string, string> = {
    Extreme: "Extreme — sustained, life-threatening risk to operations",
    High: "High — material disruption likely without mitigation",
    Moderate: "Moderate — operationally manageable with planning",
    Low: "Low — routine vigilance",
    Insignificant: "Insignificant — background noise",
  };
  const currentAssessment = assessmentMap[highest] ?? "Limited reporting in window";

  return {
    reportingPeriod: period,
    totalIncidents: incidents.length,
    confirmedStrikes,
    highestSeverity: highest,
    mostCommonType: mostCommon === "—" ? "—" : `${mostCommon} (${mostCommonN})`,
    mainAffectedArea: mainArea,
    currentAssessment,
  };
}

// ---------- Drawing primitives ----------

interface Ctx {
  pdf: jsPDF;
  W: number;
  H: number;
  MX: number;
  TOP: number;
  BOTTOM: number;
  CW: number;
  y: number;
}

function newPage(ctx: Ctx) {
  ctx.pdf.addPage();
  ctx.y = ctx.TOP;
}

function ensureSpace(ctx: Ctx, h: number) {
  if (ctx.y + h > ctx.H - ctx.BOTTOM) newPage(ctx);
}

function setFill(pdf: jsPDF, hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  pdf.setFillColor(r, g, b);
}
function setStroke(pdf: jsPDF, hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  pdf.setDrawColor(r, g, b);
}
function setText(pdf: jsPDF, hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  pdf.setTextColor(r, g, b);
}

function drawCover(ctx: Ctx, country: PdfCountry) {
  const { pdf, MX, CW } = ctx;
  const heroH = 110;
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, heroH, "F");
  setFill(pdf, ELECTRIC);
  pdf.rect(MX + CW - 6, ctx.y, 6, heroH, "F");
  try {
    pdf.addImage(polestarLogo, "PNG", MX + 24, ctx.y + 34, 150, 22, undefined, "FAST");
  } catch {
    /* ignore */
  }
  setText(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(country.name.toUpperCase(), MX + CW - 22, ctx.y + 62, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(`${country.region.toUpperCase()}  ·  COUNTRY REPORT`,
    MX + CW - 22, ctx.y + 82, { align: "right" });
  ctx.y += heroH + 22;
}

function drawSectionHeading(ctx: Ctx, title: string) {
  ensureSpace(ctx, 30);
  const { pdf, MX, CW } = ctx;
  setText(pdf, NAVY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(title.toUpperCase(), MX, ctx.y);
  ctx.y += 6;
  setStroke(pdf, ELECTRIC);
  pdf.setLineWidth(0.7);
  pdf.line(MX, ctx.y, MX + CW, ctx.y);
  ctx.y += 12;
}

function drawFastFacts(ctx: Ctx, f: FastFacts) {
  const { pdf, MX, CW } = ctx;
  const rows: [string, string][] = [
    ["Reporting Period", f.reportingPeriod],
    ["Total Incidents", String(f.totalIncidents)],
    ["Confirmed Strikes", String(f.confirmedStrikes)],
    ["Highest Severity", f.highestSeverity],
    ["Most Common Incident Type", f.mostCommonType],
    ["Main Affected Area", f.mainAffectedArea],
    ["Current Assessment", f.currentAssessment],
  ];
  const rowH = 22;
  const labelW = 170;
  const boxH = rows.length * rowH + 12;
  ensureSpace(ctx, boxH);

  setStroke(pdf, POLAR);
  pdf.setLineWidth(0.5);
  setFill(pdf, "#FAFAFC");
  pdf.rect(MX, ctx.y, CW, boxH, "FD");

  // electric accent strip
  setFill(pdf, ELECTRIC);
  pdf.rect(MX, ctx.y, 3, boxH, "F");

  let ry = ctx.y + 6;
  rows.forEach(([label, value], idx) => {
    if (idx > 0) {
      setStroke(pdf, POLAR);
      pdf.setLineWidth(0.3);
      pdf.line(MX + 14, ry, MX + CW - 10, ry);
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    setText(pdf, DUSK);
    pdf.text(label.toUpperCase(), MX + 16, ry + 14);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    setText(pdf, NAVY);
    if (label === "Highest Severity" && SEV_COLOR[value]) {
      // small color chip
      setFill(pdf, SEV_COLOR[value]);
      pdf.rect(MX + labelW, ry + 6, 10, 10, "F");
      pdf.text(value, MX + labelW + 16, ry + 14);
    } else {
      const lines = pdf.splitTextToSize(value, CW - labelW - 24);
      pdf.text(lines.slice(0, 1), MX + labelW, ry + 14);
    }
    ry += rowH;
  });

  ctx.y += boxH + 18;
}

function renderProse(ctx: Ctx, body: string) {
  const { pdf, MX, CW } = ctx;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  setText(pdf, DUSK);
  const lineH = 13;
  const paragraphs = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    const lines: string[] = pdf.splitTextToSize(p, CW);
    const paraH = lines.length * lineH + 6;
    const available = ctx.H - ctx.BOTTOM - ctx.y;
    const fitsOnNewPage = paraH <= ctx.H - ctx.TOP - ctx.BOTTOM;

    if (paraH > available && fitsOnNewPage) {
      // keep paragraph together
      newPage(ctx);
    }

    // If paragraph is longer than a full page, flow line by line
    if (!fitsOnNewPage) {
      for (const ln of lines) {
        ensureSpace(ctx, lineH);
        pdf.text(ln, MX, ctx.y + 10);
        ctx.y += lineH;
      }
    } else {
      for (const ln of lines) {
        pdf.text(ln, MX, ctx.y + 10);
        ctx.y += lineH;
      }
    }
    ctx.y += 6;
  }
  ctx.y += 6;
}

function drawTopicChart(ctx: Ctx, incidents: PdfIncident[], topicLabels: Record<string, string>) {
  if (incidents.length === 0) return;
  const counts = new Map<string, number>();
  for (const i of incidents) counts.set(i.topic, (counts.get(i.topic) ?? 0) + 1);
  const data = Array.from(counts.entries())
    .map(([topic, n]) => ({ label: topicLabels[topic] ?? topic, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  if (data.length === 0) return;
  const max = Math.max(...data.map((d) => d.n));

  drawSectionHeading(ctx, "Incident Breakdown by Type");
  const { pdf, MX, CW } = ctx;
  const rowH = 18;
  const labelW = 150;
  const barAreaX = MX + labelW;
  const barAreaW = CW - labelW - 40;
  const chartH = data.length * rowH + 10;
  ensureSpace(ctx, chartH);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  data.forEach((d, idx) => {
    const ry = ctx.y + idx * rowH;
    setText(pdf, DUSK);
    pdf.text(d.label, MX, ry + 12);

    const w = max === 0 ? 0 : (d.n / max) * barAreaW;
    setFill(pdf, ELECTRIC);
    pdf.rect(barAreaX, ry + 4, w, 10, "F");

    setText(pdf, NAVY);
    pdf.setFont("helvetica", "bold");
    pdf.text(String(d.n), barAreaX + w + 6, ry + 12);
    pdf.setFont("helvetica", "normal");
  });
  ctx.y += chartH + 18;
}

function drawIncidentTable(ctx: Ctx, incidents: PdfIncident[], topicLabels: Record<string, string>) {
  if (incidents.length === 0) return;
  drawSectionHeading(ctx, "Related Incidents");
  const { pdf, MX, CW } = ctx;
  const colDateW = 86;
  const colTopicW = 92;
  const colSevW = 64;
  const colTitleW = CW - colDateW - colTopicW - colSevW - 6;
  const rowH = 18;

  // header
  ensureSpace(ctx, rowH + 4);
  setFill(pdf, NAVY);
  pdf.rect(MX, ctx.y, CW, rowH, "F");
  setText(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("DATE", MX + 6, ctx.y + 12);
  pdf.text("TOPIC", MX + colDateW + 6, ctx.y + 12);
  pdf.text("TITLE", MX + colDateW + colTopicW + 6, ctx.y + 12);
  pdf.text("SEVERITY", MX + colDateW + colTopicW + colTitleW + 6, ctx.y + 12);
  ctx.y += rowH;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);

  const sorted = [...incidents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  for (const i of sorted) {
    const titleLines: string[] = pdf.splitTextToSize(i.title, colTitleW - 8);
    const rh = Math.max(rowH, titleLines.length * 11 + 8);
    if (ctx.y + rh > ctx.H - ctx.BOTTOM) {
      newPage(ctx);
      // repeat header on new page
      setFill(pdf, NAVY);
      pdf.rect(MX, ctx.y, CW, rowH, "F");
      setText(pdf, WHITE);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text("DATE", MX + 6, ctx.y + 12);
      pdf.text("TOPIC", MX + colDateW + 6, ctx.y + 12);
      pdf.text("TITLE", MX + colDateW + colTopicW + 6, ctx.y + 12);
      pdf.text("SEVERITY", MX + colDateW + colTopicW + colTitleW + 6, ctx.y + 12);
      ctx.y += rowH;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
    }
    // row divider
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.3);
    pdf.line(MX, ctx.y + rh, MX + CW, ctx.y + rh);

    setText(pdf, DUSK);
    let dateStr = "";
    try { dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy"); } catch { dateStr = i.occurredAt; }
    pdf.text(dateStr, MX + 6, ctx.y + 12);
    pdf.text(topicLabels[i.topic] ?? i.topic, MX + colDateW + 6, ctx.y + 12);
    setText(pdf, NAVY);
    pdf.text(titleLines, MX + colDateW + colTopicW + 6, ctx.y + 12);

    // severity chip
    const sevColor = SEV_COLOR[i.severity] ?? "#999999";
    setFill(pdf, sevColor);
    const chipX = MX + colDateW + colTopicW + colTitleW + 6;
    pdf.rect(chipX, ctx.y + 5, 56, 10, "F");
    setText(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(i.severity.toUpperCase(), chipX + 28, ctx.y + 12, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);

    ctx.y += rh;
  }
  ctx.y += 10;
}

function drawFooters(pdf: jsPDF, reportDate: string) {
  const pageCount = pdf.getNumberOfPages();
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    setStroke(pdf, POLAR);
    pdf.setLineWidth(0.5);
    pdf.line(48, H - 38, W - 48, H - 38);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    setText(pdf, DUSK);
    pdf.text("Polestar Advisory  ·  Confidential", 48, H - 22);
    pdf.text(reportDate, W / 2, H - 22, { align: "center" });
    pdf.text(`Page ${p} of ${pageCount}`, W - 48, H - 22, { align: "right" });
  }
}

// ---------- Public entrypoint ----------

export async function exportCountryReportPdf(
  country: PdfCountry,
  incidents: PdfIncident[],
  topicLabels: Record<string, string>,
  filename: string,
): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const ctx: Ctx = {
    pdf,
    W: pdf.internal.pageSize.getWidth(),
    H: pdf.internal.pageSize.getHeight(),
    MX: 48,
    TOP: 48,
    BOTTOM: 56,
    CW: pdf.internal.pageSize.getWidth() - 96,
    y: 48,
  };

  drawCover(ctx, country);

  const facts = computeFastFacts(country, incidents, topicLabels);
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFacts(ctx, facts);

  if (country.overview) {
    drawSectionHeading(ctx, "Situation");
    renderProse(ctx, country.overview);
  }
  if (country.trendSummary) {
    drawSectionHeading(ctx, "What Happened");
    renderProse(ctx, country.trendSummary);
  }
  if (country.implications) {
    drawSectionHeading(ctx, "Implications for Business");
    renderProse(ctx, country.implications);
  }

  // Visual (chart) — useful from available data
  drawTopicChart(ctx, incidents, topicLabels);

  // Related incidents table
  drawIncidentTable(ctx, incidents, topicLabels);

  // Source / data note
  drawSectionHeading(ctx, "Source Notes / Data Notes");
  renderProse(
    ctx,
    "Based on records held in the Polestar Workbench at time of export. Records without coordinates may appear in tables and counts but not maps.",
  );

  // Footers (page X of Y) — added last so page count is final
  const reportDate = format(new Date(), "dd MMM yyyy");
  drawFooters(pdf, reportDate);

  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
