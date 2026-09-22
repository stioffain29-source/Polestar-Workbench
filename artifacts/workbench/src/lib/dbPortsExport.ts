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
  DbPortsParameters,
} from "@workspace/api-client-react";
import {
  DB_PORTS_DISCLAIMER,
  DB_PORTS_MAX_SELECTED,
  DB_PORTS_MAX_WATCH,
  dbPortsThemeLabel,
  findDbPortsBannedWording,
  normaliseParameters,
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
  metadata: DbPortsDocumentLine[];
  sections: DbPortsDocumentSection[];
  disclaimer: string;
};

const NOT_RECORDED = "Not recorded.";

function present(value: string | null | undefined): string {
  return value?.trim() || NOT_RECORDED;
}

function dateOnly(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value;
}

function sourceLines(item: DbPortsItem, parameters: DbPortsParameters): DbPortsDocumentLine[] {
  if (!item.evidence.length) return [{ label: "Source", text: NOT_RECORDED }];
  const lines: DbPortsDocumentLine[] = [];
  item.evidence.forEach((entry: DbPortsEvidence, index: number) => {
    const label = index === 0 ? "Source" : "Corroborating source";
    // Only a real publication date may be presented as one. The collected
    // record also carries an event date, and printing that as "published"
    // would put a date on the page that the publisher never gave.
    const published = entry.publishedDate;
    lines.push({
      label,
      text: `${present(entry.sourceName)}${published ? ` — published ${published}` : " — publication date not recorded"}`,
    });
    if (parameters.includeSourceLinks && entry.sourceUrl) {
      lines.push({ label: "Link", text: entry.sourceUrl, url: entry.sourceUrl });
    }
  });
  return lines;
}

/** Customer-facing item block. Editor-only warnings are never read here, so no
 * warning can reach an export by accident. */
function itemEntry(item: DbPortsItem, index: number, parameters: DbPortsParameters): DbPortsDocumentEntry {
  return {
    heading: `${index + 1}. ${present(item.headline)}`,
    lines: [
      { label: "Location", text: `${present(item.location)}${item.country ? `, ${item.country}` : ""}` },
      { label: "Port, terminal or corridor", text: item.assets.length ? item.assets.join("; ") : "Not specified in reporting." },
      { label: "Event date", text: item.eventDate ?? "Not stated in reporting." },
      { label: "Theme", text: dbPortsThemeLabel(item.theme) },
      { label: "Current severity", text: item.severity ?? "Not assessed" },
      { label: "Summary", text: present(item.summary) },
      { label: "Operational Impact", text: present(item.operationalImpact) },
      { label: "Polestar View", text: present(item.polestarView) },
      { label: "Outlook and indicators", text: present(item.outlook) },
      ...sourceLines(item, parameters),
    ],
  };
}

function watchEntry(item: DbPortsItem, index: number): DbPortsDocumentEntry {
  return {
    heading: `${index + 1}. ${present(item.headline)}`,
    lines: [
      { label: "Location", text: `${present(item.location)}${item.country ? `, ${item.country}` : ""}` },
      { label: "Reason for monitoring", text: present(item.materialityReason) },
      { label: "Trigger or indicator", text: present(item.outlook) },
      { label: "Verification status", text: item.confidence.replaceAll("_", " ") },
    ],
  };
}

/**
 * Single content authority for Word, PDF and the on-screen preview, so the
 * three can never drift apart.
 */
export function buildDbPortsDocument(payload: DbPortsExportPayload): DbPortsDocumentModel {
  if (!payload?.edition) throw new Error("The ports report export requires a saved report.");
  const { edition } = payload;
  const parameters = normaliseParameters(edition.parameters);
  const selected = edition.items
    .filter((item) => item.disposition === "selected" && !item.mergedInto)
    .slice(0, DB_PORTS_MAX_SELECTED);
  const watch = parameters.includeWatchlist
    ? edition.items.filter((item) => item.disposition === "watch" && !item.mergedInto).slice(0, DB_PORTS_MAX_WATCH)
    : [];

  const sections: DbPortsDocumentSection[] = [
    {
      heading: "Regional Overview",
      introduction: edition.overview.trim() || "The Regional Overview has not been drafted.",
      entries: [],
    },
    {
      heading: "Priority Intelligence Items",
      introduction: selected.length
        ? undefined
        : "No development in this period met the inclusion criteria for a priority item.",
      entries: selected.map((item, index) => itemEntry(item, index, parameters)),
    },
  ];

  if (parameters.includeWatchlist) {
    sections.push({
      heading: "Watchlist",
      introduction: watch.length
        ? "Developing issues that may become material but do not yet justify a full item."
        : "No developing issues met the Watchlist threshold for this period.",
      entries: watch.map(watchEntry),
    });
  }

  return {
    title: edition.title.trim() || parameters.reportTitle,
    kicker: parameters.reportTitle,
    metadata: [
      { label: "Customer", text: present(parameters.customerName) },
      { label: "Reporting period", text: `${edition.startDate} to ${edition.endDate}` },
      { label: "Publication date", text: parameters.publicationDate ?? dateOnly(payload.generatedAt) },
      { label: "Items included", text: `${selected.length} priority ${selected.length === 1 ? "item" : "items"}${parameters.includeWatchlist ? `; ${watch.length} watchlist ${watch.length === 1 ? "entry" : "entries"}` : ""}` },
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

/** Last gate before a customer file is written. The preview still renders the
 * offending text so the analyst can find and rewrite it; only the export stops. */
export function assertDbPortsExportWording(model: DbPortsDocumentModel): void {
  // Every string the exporters render, not only the body: a report title or a
  // customer name can carry the forbidden wording just as easily as an item.
  const text = [
    model.title,
    model.kicker,
    ...model.metadata.flatMap((entry) => [entry.label, entry.text]),
    ...model.sections.flatMap((section) => [
      section.heading,
      section.introduction ?? "",
      ...section.entries.flatMap((entry) => [entry.heading, ...entry.lines.map((line) => line.text)]),
    ]),
    model.disclaimer,
  ].join(" ");
  const banned = findDbPortsBannedWording(text);
  if (banned) {
    throw new Error(`The report text uses wording the report standard forbids ("${banned}"). Rewrite it before exporting.`);
  }
}

export function buildDbPortsDocxDocument(payload: DbPortsExportPayload): Document {
  const model = buildDbPortsDocument(payload);
  assertDbPortsExportWording(model);
  const children: Array<Paragraph | Table> = [
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
              new TextRun({ text: `${model.kicker}  |  Page `, font: "Roboto", size: 16 }),
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

function exportName(payload: DbPortsExportPayload): string {
  return `ports-and-logistics-intelligence-${payload.edition.endDate}`;
}

export async function downloadDbPortsDocx(payload: DbPortsExportPayload): Promise<void> {
  const blob = await Packer.toBlob(buildDbPortsDocxDocument(payload));
  triggerDownload(blob, `${exportName(payload)}.docx`);
}

export async function buildDbPortsPdf(payload: DbPortsExportPayload): Promise<jsPDF> {
  const model = buildDbPortsDocument(payload);
  assertDbPortsExportWording(model);
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
    pdf.text(model.kicker, margin, height - 12);
    pdf.text(`Page ${page} of ${pages}`, width - margin, height - 12, { align: "right" });
  }
  return pdf;
}

export async function downloadDbPortsPdf(payload: DbPortsExportPayload): Promise<void> {
  const pdf = await buildDbPortsPdf(payload);
  pdf.save(`${exportName(payload)}.pdf`);
}
