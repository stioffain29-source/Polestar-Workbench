import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { jsPDF } from "jspdf";
import type {
  DbPortsEvidence,
  DbPortsExportPayload,
  DbPortsItem,
} from "@workspace/api-client-react";
import {
  buildDbPortsQuality,
  DB_PORTS_DISCLAIMER,
  DB_PORTS_MAX_SELECTED,
  DB_PORTS_MAX_WATCH,
} from "@workspace/db-ports";
import {
  DUSK,
  ELECTRIC,
  NAVY,
  POLAR,
  ensureRobotoLoaded,
  sanitize,
  setRoboto,
} from "./pdfChrome";

export type DbPortsDocumentLine = {
  label?: string;
  text: string;
  url?: string;
};

export type DbPortsDocumentEntry = {
  heading: string;
  lines: DbPortsDocumentLine[];
};

export type DbPortsDocumentSection = {
  heading: string;
  introduction?: string;
  entries: DbPortsDocumentEntry[];
};

export type DbPortsDocumentModel = {
  title: string;
  kicker: string;
  notice: string;
  metadata: DbPortsDocumentLine[];
  sections: DbPortsDocumentSection[];
  disclaimer: string;
};

const INTERNAL_NOTICE = "INTERNAL — UNPUBLISHED DB PORTS PILOT";
const NOT_RECORDED = "Not recorded.";

function present(value: string | null | undefined): string {
  return value?.trim() || NOT_RECORDED;
}

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
    : value;
}

function shortExtract(value: string): string {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length <= 400 ? clean : `${clean.slice(0, 397).trimEnd()}…`;
}

function gatePayload(payload: DbPortsExportPayload): void {
  if (!payload?.edition) throw new Error("DB Ports export requires a saved edition snapshot.");
  if (payload.mode !== "working" && payload.mode !== "reviewed") {
    throw new Error("DB Ports export mode must be working or reviewed.");
  }
  if (payload.mode === "reviewed") {
    if (payload.edition.status !== "approved") {
      throw new Error("Reviewed DB Ports export requires an approved edition.");
    }
    const freshQuality = buildDbPortsQuality(payload.edition);
    if (!freshQuality.readyForReview) {
      throw new Error(
        `Reviewed DB Ports export failed the current quality gate: ${freshQuality.blockers.join(" | ")}`,
      );
    }
  }
}

function evidenceLines(evidence: DbPortsEvidence): DbPortsDocumentLine[] {
  const checked = evidence.verified ? "checked" : "not checked";
  const lines: DbPortsDocumentLine[] = [
    {
      label: "Source",
      text: `${present(evidence.sourceName)} — publication date: ${evidence.publishedDate ?? "not recorded"}; source date: ${evidence.sourceDate ?? "not recorded"}; ${checked}`,
    },
    { label: "URL", text: evidence.sourceUrl, url: evidence.sourceUrl },
  ];
  if (evidence.originalTitle.trim()) {
    lines.push({ label: "Source title", text: evidence.originalTitle.trim() });
  }
  lines.push({
    label: "Supporting extract",
    text: shortExtract(evidence.excerpt) || "No supporting extract saved.",
  });
  return lines;
}

function itemEntry(item: DbPortsItem, mode: DbPortsExportPayload["mode"]): DbPortsDocumentEntry {
  const evidence = item.evidence.flatMap(evidenceLines);
  const reviewLabel =
    mode === "reviewed" && item.reviewed
      ? `Analyst-confirmed; reviewed by ${present(item.reviewer)}`
      : item.reviewed
        ? `Reviewed in working snapshot by ${present(item.reviewer)}; edition remains unapproved`
        : "Unverified working item; analyst review not recorded";
  return {
    heading: present(item.headline),
    lines: [
      { label: "Geography / asset", text: `${present(item.country)} — ${present(item.location)}; assets: ${item.assets.length ? item.assets.join(", ") : "none recorded"}` },
      { label: "Event date", text: item.eventDate ?? "not recorded" },
      { label: "Severity", text: item.severity ?? "not assessed" },
      { label: "Confidence", text: item.confidence.replaceAll("_", " ") },
      { label: "Review state", text: reviewLabel },
      {
        label: item.reviewed ? "Confirmed facts" : "Source-reported statements awaiting analyst verification",
        text: present(item.confirmedFacts),
      },
      { label: "Unverified claims", text: item.unverifiedClaims.trim() || "None recorded." },
      { label: "Operating implications", text: present(item.operationalImplications) },
      { label: "Outlook", text: present(item.outlook) },
      { label: "Missing information", text: item.missingInfo.trim() || "None recorded." },
      ...evidence,
    ],
  };
}

/**
 * Single content authority used by Word, PDF and the read-only React preview.
 * It intentionally derives quality afresh and never trusts the saved quality object.
 */
export function buildDbPortsDocument(payload: DbPortsExportPayload): DbPortsDocumentModel {
  gatePayload(payload);
  const { edition } = payload;
  const selected = edition.items
    .filter((item) => item.disposition === "selected" && !item.mergedInto)
    .slice(0, DB_PORTS_MAX_SELECTED);
  const watch = edition.items
    .filter((item) => item.disposition === "watch" && !item.mergedInto)
    .slice(0, DB_PORTS_MAX_WATCH);
  const pending = edition.items.filter(
    (item) => (item.disposition === "inbox" || item.disposition === "hold") && !item.mergedInto,
  );
  const quality = buildDbPortsQuality(edition);
  const minutes = edition.worklog.reduce((sum, row) => sum + row.minutes, 0);

  const sections: DbPortsDocumentSection[] = [
    {
      heading: "Editorial overview",
      introduction: edition.overview.trim() || "Editorial overview not drafted in this saved snapshot.",
      entries: [],
    },
    {
      heading: "Priority developments",
      introduction: selected.length
        ? undefined
        : "No developments selected. The edition has not been padded to meet a quota.",
      entries: selected.map((item) => itemEntry(item, payload.mode)),
    },
    {
      heading: "Watch list",
      introduction: watch.length
        ? undefined
        : "No watch items saved. The edition has not been padded to meet a quota.",
      entries: watch.map((item) => itemEntry(item, payload.mode)),
    },
  ];

  if (pending.length) {
    sections.push({
      heading: "Pending verification appendix",
      introduction:
        "Inbox and hold items only. These are leads, not established events, and are excluded from the reviewed findings.",
      entries: pending.map((item) => itemEntry(item, "working")),
    });
  }

  sections.push(
    {
      heading: "Source checks and coverage gaps",
      introduction: edition.coverage.length
        ? "Only checks saved in this snapshot are listed. An absent roster source is not assumed to have been covered."
        : "No source checks were saved. Unchecked roster sources are not assumed to have been covered.",
      entries: edition.coverage.map((check) => ({
        heading: check.sourceId,
        lines: [
          { label: "Status", text: check.status.replaceAll("_", " ") },
          { label: "Checked at", text: dateTime(check.checkedAt) },
          { label: "Notes / gap", text: check.notes.trim() || "No note recorded." },
        ],
      })),
    },
    {
      heading: "Effort and methodology",
      introduction:
        "Counts reflect logged real minutes only. Zero means effort was not logged, not that no work occurred. Coverage is limited to saved checks and evidence and is not comprehensive.",
      entries: [
        {
          heading: "Pilot effort",
          lines: [
            { label: "Logged minutes", text: String(minutes) },
            { label: "Corrections", text: String(quality.corrections) },
            { label: "Missed signals", text: String(quality.missedSignals) },
          ],
        },
      ],
    },
  );

  return {
    title: edition.title.trim() || "DB Ports Bulletin",
    kicker: payload.mode === "reviewed" ? "REVIEWED / CONFIRMED SNAPSHOT" : "WORKING / UNVERIFIED SNAPSHOT",
    notice: INTERNAL_NOTICE,
    metadata: [
      { label: "Edition period", text: `${edition.startDate} to ${edition.endDate}` },
      { label: "Generated", text: dateTime(payload.generatedAt) },
      { label: "Edition revision", text: String(edition.revision) },
      { label: "Edition status", text: edition.status.replaceAll("_", " ") },
    ],
    sections,
    disclaimer: DB_PORTS_DISCLAIMER,
  };
}

const navy = "0B0A3D";
const dusk = "363636";

function wordLine(line: DbPortsDocumentLine): Paragraph {
  const children = [
    ...(line.label ? [new TextRun({ text: `${line.label}: `, bold: true, font: "Roboto", size: 20 })] : []),
  ];
  if (line.url) {
    children.push(
      new ExternalHyperlink({
        link: line.url,
        children: [new TextRun({ text: line.text, style: "Hyperlink", font: "Roboto", size: 20 })],
      }) as unknown as TextRun,
    );
  } else {
    children.push(new TextRun({ text: line.text, font: "Roboto", size: 20, color: dusk }));
  }
  return new Paragraph({ spacing: { after: 80 }, children });
}

export function buildDbPortsDocxDocument(payload: DbPortsExportPayload): Document {
  const model = buildDbPortsDocument(payload);
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: model.notice, bold: true, color: "A33232", font: "Roboto", size: 20 })] }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: model.title, bold: true, color: navy, font: "Roboto", size: 36 })],
    }),
    new Paragraph({ children: [new TextRun({ text: model.kicker, bold: true, color: navy, font: "Roboto", size: 20 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: model.metadata.map((line) => new TableRow({
        children: [
          new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: line.label ?? "", bold: true, font: "Roboto", size: 18 })] })] }),
          new TableCell({ width: { size: 72, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: line.text, font: "Roboto", size: 18 })] })] }),
        ],
      })),
    }),
  ];
  for (const section of model.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: false,
      keepNext: true,
      spacing: { before: 260, after: 100 },
      children: [new TextRun({ text: section.heading.toUpperCase(), bold: true, color: navy, font: "Roboto", size: 26 })],
    }));
    if (section.introduction) children.push(wordLine({ text: section.introduction }));
    for (const entry of section.entries) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        spacing: { before: 180, after: 80 },
        children: [new TextRun({ text: entry.heading, bold: true, color: navy, font: "Roboto", size: 23 })],
      }));
      children.push(...entry.lines.map(wordLine));
    }
  }
  children.push(
    new Paragraph({ keepNext: true, spacing: { before: 260, after: 80 }, children: [new TextRun({ text: "DISCLAIMER", bold: true, color: navy, font: "Roboto", size: 22 })] }),
    new Paragraph({ children: [new TextRun({ text: model.disclaimer, italics: true, font: "Roboto", size: 18, color: dusk })] }),
  );
  return new Document({
    sections: [{
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "INTERNAL — UNPUBLISHED DB PORTS PILOT  |  Page ", font: "Roboto", size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Roboto", size: 16 }),
              new TextRun({ text: " of ", font: "Roboto", size: 16 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Roboto", size: 16 }),
            ],
          })],
        }),
      },
    }],
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadDbPortsDocx(payload: DbPortsExportPayload): Promise<void> {
  const blob = await Packer.toBlob(buildDbPortsDocxDocument(payload));
  triggerDownload(blob, `db-ports-${payload.edition.endDate}-${payload.mode}.docx`);
}

export async function buildDbPortsPdf(payload: DbPortsExportPayload): Promise<jsPDF> {
  const model = buildDbPortsDocument(payload);
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  await ensureRobotoLoaded(pdf);
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = width - margin * 2;
  const top = 62;
  const bottom = 50;
  let y = top;

  const addPage = () => {
    pdf.addPage();
    y = top;
  };
  const ensure = (need: number) => {
    if (y + need > height - bottom) addPage();
  };
  const text = (value: string, size = 10, weight: "regular" | "bold" | "italic" = "regular", indent = 0, gap = 7) => {
    setRoboto(pdf, weight);
    pdf.setFontSize(size);
    pdf.setTextColor(DUSK);
    const lines: string[] = pdf.splitTextToSize(sanitize(value), contentWidth - indent);
    const lineHeight = size * 1.35;
    for (const line of lines) {
      ensure(lineHeight);
      pdf.text(line, margin + indent, y);
      y += lineHeight;
    }
    y += gap;
  };
  const heading = (value: string, level: 1 | 2) => {
    const size = level === 1 ? 14 : 11;
    setRoboto(pdf, "bold");
    pdf.setFontSize(size);
    const rendered = sanitize(level === 1 ? value.toUpperCase() : value);
    const lines: string[] = pdf.splitTextToSize(rendered, contentWidth);
    const lineHeight = size * 1.25;
    ensure(lines.length * lineHeight + (level === 1 ? 34 : 21));
    if (level === 1 && y > top + 2) y += 10;
    pdf.setTextColor(NAVY);
    for (const line of lines) {
      pdf.text(line, margin, y);
      y += lineHeight;
    }
    y += 7;
    if (level === 1) {
      pdf.setDrawColor(ELECTRIC);
      pdf.setLineWidth(1.2);
      pdf.line(margin, y, width - margin, y);
      y += 13;
    }
  };

  setRoboto(pdf, "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(163, 50, 50);
  pdf.text(model.notice, margin, y);
  y += 25;
  setRoboto(pdf, "bold");
  pdf.setFontSize(23);
  pdf.setTextColor(NAVY);
  for (const line of pdf.splitTextToSize(sanitize(model.title), contentWidth)) {
    pdf.text(line, margin, y);
    y += 27;
  }
  text(model.kicker, 10, "bold");
  for (const line of model.metadata) text(`${line.label}: ${line.text}`, 9);

  for (const section of model.sections) {
    heading(section.heading, 1);
    if (section.introduction) text(section.introduction);
    for (const entry of section.entries) {
      heading(entry.heading, 2);
      for (const line of entry.lines) {
        const value = `${line.label ? `${line.label}: ` : ""}${line.text}`;
        if (line.url) {
          setRoboto(pdf, "regular");
          pdf.setFontSize(9);
          pdf.setTextColor(DUSK);
          const linkLines: string[] = pdf.splitTextToSize(sanitize(value), contentWidth);
          for (const linkLine of linkLines) {
            ensure(12.2);
            pdf.text(linkLine, margin, y);
            pdf.link(margin, y - 9, Math.min(contentWidth, pdf.getTextWidth(linkLine)), 12, { url: line.url });
            y += 12.2;
          }
          y += 7;
        } else {
          text(value, 9);
        }
      }
    }
  }
  heading("Disclaimer", 1);
  text(model.disclaimer, 9, "italic", 0, 0);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFillColor(POLAR);
    pdf.rect(0, height - 30, width, 30, "F");
    setRoboto(pdf, "regular");
    pdf.setFontSize(8);
    pdf.setTextColor(DUSK);
    pdf.text("INTERNAL — UNPUBLISHED DB PORTS PILOT", margin, height - 12);
    pdf.text(`Page ${page} of ${pages}`, width - margin, height - 12, { align: "right" });
  }
  return pdf;
}

export async function downloadDbPortsPdf(payload: DbPortsExportPayload): Promise<void> {
  const pdf = await buildDbPortsPdf(payload);
  pdf.save(`db-ports-${payload.edition.endDate}-${payload.mode}.pdf`);
}