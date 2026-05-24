import { format, parseISO, max as dateMax } from "date-fns";
import {
  createCtx, newPage, ensureSpace, drawSectionHeading, renderProse,
  drawFastFactsKpiCards, drawSourceNotes, drawDisclaimer, drawFooters,
  drawPolestarCover, beginBodyPages,
  setFill, setStroke, setText, sanitize,
  NAVY, POLAR, DUSK, WHITE, SEV_COLOR, SEV_RANK, SEV_LABEL, sevKey,
  type Ctx, type KpiCardData,
} from "./pdfChrome";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { classifyIncidentType } from "./incidentClassifier";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  type ChokepointKey,
} from "./shippingAnalysis";

// Shipping report data ------------------------------------------------------
// Cover / Fast Facts / Chokepoint Watch / Vessel Attacks / Piracy /
// Port-Route Disruption / Commercial Impact / Watch Next / Polestar View /
// Source Notes. Strictly shipping — no Missile Strike Tracker content.

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

type Enriched = ShippingReportIncident & { date: Date };

function enrich(rows: ShippingReportIncident[]): Enriched[] {
  return rows
    .map((r) => {
      let date: Date;
      try { date = parseISO(r.occurredAt); } catch { date = new Date(NaN); }
      return { ...r, date };
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

// Vessel Attacks subset — hostile vessel incidents only. Commercial / market
// / finance / regulatory noise is excluded even if a stray attack token
// appears in the headline. Mirrors the Shipping page rule set.
const COMMERCIAL_RE =
  /\b(orderbook|newbuild|newbuilds|charter (rate|assessment|index)|time charter|freight rate|spot rate|baltic dry|world container index|earnings|profit|results|acquisition|fleet renewal|partnership|deal|merger|joint venture|sold|sale of|orders?\b|quarterly|annual report|lng (application|approval|terminal application)|payment dispute|invoice|tariff dispute|port congestion|berth congestion|container backlog|shipping finance|bond issu|equity raise|ipo)\b/i;

type VesselType = "Attack" | "Near miss" | "Seized" | "Threat";

const VESSEL_RULES: Array<{ type: VesselType; pattern: RegExp }> = [
  { type: "Seized", pattern: /\b(seized|seizure|boarded by|hijack(ed)?|detained .*(vessel|ship|tanker|crew)|commandeered|vessel (taken|captured))\b/i },
  { type: "Near miss", pattern: /\b(near miss|narrowly (missed|avoided)|warning shot|missile (fell|landed) near|drone (fell|landed) near|missed (a |the )?(vessel|tanker|ship)|intercepted near|shot down near (a |the )?(vessel|tanker|ship))\b/i },
  { type: "Attack", pattern: /\b(attack(ed)? (on |by )?(a |the )?(ship|tanker|vessel|carrier|dhow)|vessel attack|tanker attack|missile (hit|struck|targeted) (a |the )?(ship|tanker|vessel|carrier)|drone (hit|struck|targeted) (a |the )?(ship|tanker|vessel|carrier)|ship hit|tanker hit|vessel (hit|on fire|ablaze|struck)|small craft attack|skiff attack|houthi attack|terrorist attack on (a |the )?(vessel|ship|tanker)|fired (upon|at) (a |the )?(vessel|ship|tanker))\b/i },
  { type: "Threat", pattern: /\b(ukmto (advisory|warning|alert|incident)|maritime (advisory|warning|threat) (to|against) shipping|threat to (shipping|vessel|tanker|ship)|hostile (act|activity) (toward|against) (a |the )?(vessel|ship|tanker)|suspicious approach (to|by) (vessel|ship|tanker)|approached by (small craft|skiffs?))\b/i },
];

function classifyVessel(i: ShippingReportIncident): VesselType | null {
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  if (COMMERCIAL_RE.test(text)) return null;
  for (const r of VESSEL_RULES) if (r.pattern.test(text)) return r.type;
  return null;
}

const PORT_ROUTE_TYPES = new Set(["Port disruption", "Route diversion", "Maritime advisory", "Chokepoint risk"]);
const COMMERCIAL_TYPES = new Set(["Commercial shipping disruption", "Insurance / freight pressure"]);

// Fast facts -----------------------------------------------------------------
function computeFastFacts(
  data: ShippingReportData,
  rows: ShippingReportIncident[],
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

  // Vessel attack/seizure count + piracy count.
  const vesselClassified = rows.map((r) => classifyVessel(r));
  const vCount = vesselClassified.filter((v) => v === "Attack" || v === "Seized").length;
  const pCount = rows.filter((r) => classifyPiracy(r) !== null).length;

  // Latest record.
  let latest = "—";
  const dates = rows
    .map((r) => { try { return parseISO(r.occurredAt); } catch { return null; } })
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
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

// Chokepoint Watch table -----------------------------------------------------
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

// Generic incident table for the topical sub-sections ----------------------
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

// Exporter -----------------------------------------------------------------
export async function exportShippingReportPdf(
  data: ShippingReportData,
  incidents: ShippingReportIncident[],
  filename: string,
): Promise<void> {
  const cadence = "Weekly Briefing";
  let headerDate = data.issueDate;
  try { headerDate = format(parseISO(data.issueDate), "yyyy-MM-dd"); } catch { /* keep */ }

  const ctx = createCtx({
    kind: data.title || `Shipping ${cadence}`,
    issueDate: headerDate,
  });

  const win = resolveReportWindow(data.topic, data.issueDate);
  drawPolestarCover(ctx, {
    title: data.title || `Shipping ${cadence}`,
    subtitle: `Shipping · ${cadence}`,
    reportingPeriod: win.label,
    eyebrow: "POLESTAR INSIGHTS · SHIPPING",
  });
  beginBodyPages(ctx);

  // Executive Summary (optional, from form).
  if (data.executiveSummary && data.executiveSummary.trim()) {
    drawSectionHeading(ctx, "Executive Summary");
    renderProse(ctx, data.executiveSummary);
  }

  // Scope window: shipping topic only, then strip off-topic noise.
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
  const enriched = sortByDateDesc(enrich(windowIncidents));

  // Fast Facts.
  drawSectionHeading(ctx, "Fast Facts");
  drawFastFactsKpiCards(ctx, computeFastFacts(data, windowIncidents));

  // Chokepoint Watch.
  drawChokepointWatch(ctx, enriched);

  // Vessel Attacks — hostile vessel incidents only.
  const vesselRows = enriched
    .map((r) => ({ ...r, vesselType: classifyVessel(r) }))
    .filter((r): r is Enriched & { vesselType: VesselType } => r.vesselType !== null);
  drawIncidentTable(ctx, "Vessel Attacks", vesselRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { vesselType: VesselType }).vesselType,
    emptyMessage: "No hostile vessel incidents on file in the selected window.",
  });

  // Piracy and Armed Robbery.
  const piracyRows = enriched
    .map((r) => ({ ...r, act: classifyPiracy(r) }))
    .filter((r): r is Enriched & { act: NonNullable<ReturnType<typeof classifyPiracy>> } => r.act !== null);
  drawIncidentTable(ctx, "Piracy and Armed Robbery", piracyRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { act: string }).act,
    emptyMessage: "No current piracy or armed-robbery records in the selected window.",
  });

  // Port and Route Disruption — derive issue type via shared classifier.
  const typed = enriched.map((r) => ({ row: r, type: classifyIncidentType(r) }));
  const portRouteRows = typed.filter((t) => PORT_ROUTE_TYPES.has(t.type)).map((t) => ({ ...t.row, _type: t.type }));
  drawIncidentTable(ctx, "Port and Route Disruption", portRouteRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { _type: string })._type,
    emptyMessage: "No port closures, route diversions or maritime advisories in the selected window.",
  });

  // Commercial Impact.
  const commercialRows = typed.filter((t) => COMMERCIAL_TYPES.has(t.type)).map((t) => ({ ...t.row, _type: t.type }));
  drawIncidentTable(ctx, "Commercial Impact", commercialRows, {
    showActColumn: true,
    actFor: (r) => (r as Enriched & { _type: string })._type,
    emptyMessage: "No commercial shipping or freight/insurance records in the selected window.",
  });

  // Watch Next + Polestar View, taken from the editor form so analyst voice
  // is preserved. Only rendered when the analyst has written something.
  if (data.watchNext && data.watchNext.trim()) {
    drawSectionHeading(ctx, "Watch Next");
    renderProse(ctx, data.watchNext);
  }
  if (data.polestarView && data.polestarView.trim()) {
    drawSectionHeading(ctx, "Polestar View");
    renderProse(ctx, data.polestarView);
  }

  drawSourceNotes(ctx);
  drawDisclaimer(ctx);

  drawFooters(ctx.pdf);
  ctx.pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
