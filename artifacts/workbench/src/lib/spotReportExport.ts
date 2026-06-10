import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { format } from "date-fns";
import type { Incident, SpotReport } from "@workspace/api-client-react";
import {
  SPOT_SEV_LABEL,
  spotSevKey,
  spotLocationLabel,
  spotReportSections,
  toBullets,
  DISCLAIMER_TEXT,
} from "@/lib/spotReport";

function metaLines(report: SpotReport): string[] {
  const lines: string[] = [];
  const sev = spotSevKey(report.severity);
  if (sev) lines.push(`Severity: ${SPOT_SEV_LABEL[sev] ?? report.severity}`);
  const location = spotLocationLabel(report);
  if (location) lines.push(`Location: ${location}`);
  if (report.reportDate) {
    lines.push(`Report Date: ${format(new Date(report.reportDate), "dd MMM yyyy HH:mm")}`);
  }
  if (report.incidentDate) {
    lines.push(`Incident Date: ${format(new Date(report.incidentDate), "dd MMM yyyy HH:mm")}`);
  }
  if (report.category) lines.push(`Category: ${report.category}`);
  if (report.createdBy) lines.push(`Prepared By: ${report.createdBy}`);
  return lines;
}

function sourceLines(report: SpotReport): string[] {
  if (!report.showSourcesInExport) return [];
  const lines: string[] = [];
  if (report.confidenceLevel) {
    lines.push(
      `Confidence: ${report.confidenceLevel.charAt(0).toUpperCase()}${report.confidenceLevel.slice(1)}`,
    );
  }
  if (report.internalSourceNotes?.trim()) lines.push(report.internalSourceNotes.trim());
  return lines;
}

function referenceLines(incidents: Incident[]): string[] {
  return incidents.map((i) => {
    const title = (i.displayTitle?.trim() || i.title || "Incident").trim();
    const date = format(new Date(i.occurredAt), "dd MMM yyyy");
    const loc = [i.location, i.country].filter(Boolean).join(", ");
    const sev = SPOT_SEV_LABEL[spotSevKey(i.severity)] ?? i.severity;
    return `${title} — ${date}${loc ? ` — ${loc}` : ""} — ${sev}`;
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Plain-text rendering — same sections, same order as the preview/PDF. */
export function buildSpotReportText(report: SpotReport, incidents: Incident[]): string {
  const out: string[] = [];
  out.push("POLESTAR ADVISORY — SPOT REPORT");
  out.push(report.title || "Untitled Spot Report");
  out.push("");
  for (const l of metaLines(report)) out.push(l);
  out.push("");

  for (const s of spotReportSections(report)) {
    out.push(s.heading.toUpperCase());
    if (s.bullets) {
      for (const b of toBullets(s.body)) out.push(`- ${b}`);
    } else {
      out.push(s.body);
    }
    out.push("");
  }

  if (incidents.length > 0) {
    out.push("REFERENCE INCIDENTS");
    for (const l of referenceLines(incidents)) out.push(`- ${l}`);
    out.push("");
  }

  const src = sourceLines(report);
  if (src.length > 0) {
    out.push("SOURCES & CONFIDENCE");
    for (const l of src) out.push(l);
    out.push("");
  }

  out.push("---");
  out.push(DISCLAIMER_TEXT);
  return out.join("\n");
}

export function downloadSpotReportText(
  report: SpotReport,
  incidents: Incident[],
  filename: string,
): void {
  const text = buildSpotReportText(report, incidents);
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

const NAVY_HEX = "0B0A3D";
const DUSK_HEX = "363636";

function bodyParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map(
      (p) =>
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: p, font: "Roboto", size: 22, color: DUSK_HEX })],
        }),
    );
}

function headingParagraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, font: "Roboto", color: NAVY_HEX, size: 26 })],
  });
}

/** Word (.docx) rendering — same sections, same order as the preview/PDF. */
export async function downloadSpotReportDocx(
  report: SpotReport,
  incidents: Incident[],
  filename: string,
): Promise<void> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: "POLESTAR ADVISORY — SPOT REPORT",
          bold: true,
          font: "Roboto",
          color: NAVY_HEX,
          size: 20,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: report.title || "Untitled Spot Report",
          bold: true,
          font: "Roboto",
          color: NAVY_HEX,
          size: 34,
        }),
      ],
    }),
  );
  for (const l of metaLines(report)) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: l, font: "Roboto", size: 20, color: DUSK_HEX })],
      }),
    );
  }

  for (const s of spotReportSections(report)) {
    children.push(headingParagraph(s.heading));
    if (s.bullets) {
      for (const b of toBullets(s.body)) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: [new TextRun({ text: b, font: "Roboto", size: 22, color: DUSK_HEX })],
          }),
        );
      }
    } else {
      children.push(...bodyParagraphs(s.body));
    }
  }

  if (incidents.length > 0) {
    children.push(headingParagraph("Reference Incidents"));
    for (const l of referenceLines(incidents)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: l, font: "Roboto", size: 22, color: DUSK_HEX })],
        }),
      );
    }
  }

  const src = sourceLines(report);
  if (src.length > 0) {
    children.push(headingParagraph("Sources & Confidence"));
    for (const l of src) children.push(...bodyParagraphs(l));
  }

  children.push(
    new Paragraph({
      spacing: { before: 240 },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: DISCLAIMER_TEXT, italics: true, font: "Roboto", size: 16, color: DUSK_HEX })],
    }),
  );

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename);
}
