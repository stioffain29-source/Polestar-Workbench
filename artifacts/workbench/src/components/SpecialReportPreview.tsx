import { format } from "date-fns";
import type {
  Incident,
  SpecialReport,
  SpecialReportBlock,
} from "@workspace/api-client-react";
import IncidentMap from "@/components/IncidentMap";
import { resolveCoverUrl } from "@/lib/coverImages";
import {
  NAVY,
  ELECTRIC,
  DUSK,
  POLAR,
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  specialLocationLabel,
  resolveSpecialReportBlocks,
  buildSpecialMapPoints,
  toBullets,
  DISCLAIMER_TEXT,
} from "@/lib/specialReport";

const ROBOTO = "Roboto, sans-serif";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section mb-6">
      <h2
        className="uppercase pb-2 mb-3 tracking-wide"
        style={{
          color: NAVY,
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 18,
          borderBottom: `2px solid ${ELECTRIC}`,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p
          key={i}
          data-pdf-flow="true"
          className="text-[14px] leading-[1.7] mb-3 font-light"
          style={{ color: DUSK, fontFamily: ROBOTO }}
        >
          {p}
        </p>
      ))}
    </>
  );
}

function Bullets({ text }: { text: string }) {
  const items = toBullets(text);
  if (items.length === 0) return null;
  return (
    <ul className="list-disc pl-5 space-y-1.5" style={{ color: DUSK, fontFamily: ROBOTO }}>
      {items.map((it, i) => (
        <li key={i} className="text-[14px] leading-[1.6] font-light">
          {it}
        </li>
      ))}
    </ul>
  );
}

function SeverityChip({ severity }: { severity?: string | null }) {
  const k = sevKey(severity);
  if (!k) return null;
  const bg = SEV_COLOR[k] ?? "#999";
  return (
    <span
      data-sev-chip="true"
      data-sev-label={SEV_LABEL[k] ?? severity ?? ""}
      data-sev-color={bg}
      className="uppercase inline-block text-center"
      style={{
        background: bg,
        color: "#fff",
        fontFamily: ROBOTO,
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.08em",
        padding: "4px 11px",
        borderRadius: 2,
      }}
    >
      {SEV_LABEL[k] ?? severity}
    </span>
  );
}

/**
 * A single manually-entered chart rendered as self-contained HTML/div bars — a
 * label column, a proportional bar track, and the numeric value. Deliberately
 * NOT recharts/SVG: html2canvas (which rasterises this DOM into the PDF) mangles
 * SVG, so the in-app "Download PDF" and the on-screen preview stay identical.
 */
function ChartBlock({ chart }: { chart: SpecialReport["charts"][number] }) {
  const points = (chart.points ?? []).filter((p) => (p.label ?? "").trim());
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => (Number.isFinite(p.value) ? p.value : 0)), 0);
  const unit = (chart.unit ?? "").trim();
  return (
    <div className="mb-6" style={{ breakInside: "avoid" }}>
      {chart.title?.trim() ? (
        <div
          className="uppercase mb-3"
          style={{
            color: NAVY,
            fontFamily: ROBOTO,
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.06em",
          }}
        >
          {chart.title.trim()}
        </div>
      ) : null}
      <div className="space-y-2">
        {points.map((p, i) => {
          const value = Number.isFinite(p.value) ? p.value : 0;
          const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
          const color = (p.color ?? "").trim() || ELECTRIC;
          return (
            <div key={i} className="flex items-center gap-3">
              <div
                style={{
                  flex: "0 0 130px",
                  fontFamily: ROBOTO,
                  fontSize: 12,
                  fontWeight: 600,
                  color: DUSK,
                  textAlign: "right",
                }}
              >
                {p.label}
              </div>
              <div style={{ flex: "1 1 auto", background: POLAR, height: 18, borderRadius: 2 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    minWidth: value > 0 ? 2 : 0,
                    height: "100%",
                    background: color,
                    borderRadius: 2,
                  }}
                />
              </div>
              <div
                style={{
                  flex: "0 0 90px",
                  fontFamily: ROBOTO,
                  fontSize: 12,
                  fontWeight: 700,
                  color: NAVY,
                }}
              >
                {value.toLocaleString()}
                {unit ? ` ${unit}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A free-form heading block. Its own `.report-section` (a page-break candidate)
 * plus `data-pdf-keep-with-next` so the DOM-rasterise PDF never orphans it at
 * the foot of a page, split from the block it introduces.
 */
function BlockHeading({ text }: { text: string }) {
  return (
    <div
      className="report-section"
      data-pdf-keep-with-next="true"
      style={{ marginBottom: 12 }}
    >
      <h2
        className="uppercase pb-2 tracking-wide"
        style={{
          color: NAVY,
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 18,
          borderBottom: `2px solid ${ELECTRIC}`,
        }}
      >
        {text}
      </h2>
    </div>
  );
}

/** A single free-form image, placeable anywhere in the block list. */
function ImageBlock({ dataUrl, caption }: { dataUrl: string; caption?: string | null }) {
  return (
    <div className="report-section mb-6" style={{ breakInside: "avoid" }}>
      <figure style={{ margin: 0 }}>
        <img
          src={dataUrl}
          alt={caption || "Figure"}
          style={{
            maxWidth: "100%",
            maxHeight: 420,
            width: "auto",
            height: "auto",
            display: "block",
            margin: "0 auto",
            border: `1px solid ${POLAR}`,
          }}
        />
        {caption ? (
          <figcaption
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: 1.5,
              color: DUSK,
              fontFamily: ROBOTO,
              fontWeight: 300,
              textAlign: "center",
            }}
          >
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </div>
  );
}

/** The Reference Incidents table — a singleton block rendering the report's
 * resolved linked incidents. Renders nothing when none resolve. */
function IncidentTable({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) return null;
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr",
          background: NAVY,
          color: "#fff",
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 10,
          padding: "8px 10px",
          gap: 10,
        }}
      >
        <div>Incident</div>
        <div>Date</div>
        <div>Location</div>
        <div>Severity</div>
      </div>
      {incidents.map((i, idx) => (
        <div
          key={i.id}
          className="grid"
          style={{
            gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr",
            padding: "8px 10px",
            gap: 10,
            borderTop: idx === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: ROBOTO,
            fontSize: 12,
            color: DUSK,
            alignItems: "center",
          }}
        >
          <div style={{ color: NAVY, fontWeight: 700 }}>
            {(i.displayTitle?.trim() || i.title || "Incident").trim()}
          </div>
          <div>{format(new Date(i.occurredAt), "dd MMM yyyy")}</div>
          <div>{[i.location, i.country].filter(Boolean).join(", ") || "\u2014"}</div>
          <div>
            <SeverityChip severity={i.severity} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Whether a block produces visible content. Drives (a) skipping empty blocks and
 * (b) dropping a heading whose entire following run (up to the next heading) is
 * empty, so a lone heading never floats above nothing.
 */
function blockRenders(
  b: SpecialReportBlock,
  mapPointCount: number,
  incidentCount: number,
): boolean {
  switch (b.type) {
    case "heading":
      return (b.text ?? "").trim().length > 0;
    case "text":
      return (b.body ?? "").trim().length > 0;
    case "bullets":
      return toBullets(b.body ?? "").length > 0;
    case "chart":
      return (b.chart?.points ?? []).some((p) => (p.label ?? "").trim().length > 0);
    case "image":
      return !!(b.dataUrl ?? "").trim();
    case "map":
      // A map block is an explicit analyst choice — always render it (an empty
      // base map is preferable to silently dropping a requested map, and the
      // no-coordinates case is an export-blocking error in the quality gate).
      return true;
    case "incidents":
      return incidentCount > 0;
    default:
      return false;
  }
}

export interface SpecialReportPreviewProps {
  report: SpecialReport;
  incidents: Incident[];
}

/**
 * On-screen preview for a Special Report. Renders the SAME ordered sections as
 * the in-app "Download PDF" (which rasterises this DOM via exportElementToPdf),
 * plus a CHOSEN full-page front cover and any manually-entered HTML/div charts.
 * Preview and PDF can never disagree. Internal source notes appear only when
 * showSourcesInExport is on.
 */
export default function SpecialReportPreview({ report, incidents }: SpecialReportPreviewProps) {
  const blocks = resolveSpecialReportBlocks(report);
  const mapPoints = buildSpecialMapPoints(report, incidents);
  const location = specialLocationLabel(report);
  const reportDate = report.reportDate ? new Date(report.reportDate) : null;
  const incidentDate = report.incidentDate ? new Date(report.incidentDate) : null;
  const coverUrl = resolveCoverUrl(report);

  // Per-block visibility: drop empty blocks, and drop a heading whose whole
  // following run (up to the next heading) renders nothing — so no lone heading
  // ever floats above empty space.
  const renders = blocks.map((b) => blockRenders(b, mapPoints.length, incidents.length));
  const visible = blocks.map((b, i) => {
    if (!renders[i]) return false;
    if (b.type !== "heading") return true;
    for (let j = i + 1; j < blocks.length && blocks[j].type !== "heading"; j += 1) {
      if (renders[j]) return true;
    }
    return false;
  });

  return (
    <div
      className="print-report bg-white"
      data-masthead-label="Special Report"
      style={{ color: DUSK, fontFamily: ROBOTO, fontWeight: 300 }}
    >
      {/* CHOSEN front cover — a full A4 page. Rendered only when a cover image
          (library pick or custom upload) is set. The middle child is the image
          area; the export CSS makes it flex-fill and object-fit: cover. */}
      {coverUrl && (
        <div
          className="pdf-cover-page"
          style={{
            aspectRatio: "210 / 297",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: NAVY,
          }}
        >
          <div
            className="uppercase"
            style={{
              background: NAVY,
              color: "#fff",
              padding: "22px 32px",
              fontFamily: ROBOTO,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.22em",
            }}
          >
            Polestar Advisory · Special Report
          </div>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
            <img
              src={coverUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
          <div style={{ background: NAVY, color: "#fff", padding: "28px 32px 34px" }}>
            <h1
              style={{
                fontFamily: ROBOTO,
                fontWeight: 700,
                fontSize: 38,
                lineHeight: 1.08,
                textTransform: "uppercase",
              }}
            >
              {report.title || "Untitled Special Report"}
            </h1>
            <div
              className="uppercase"
              style={{
                marginTop: 16,
                fontFamily: ROBOTO,
                fontWeight: 400,
                fontSize: 12,
                letterSpacing: "0.18em",
                color: "rgba(255,255,255,0.92)",
              }}
            >
              {[location, reportDate ? format(reportDate, "dd MMM yyyy") : null]
                .filter(Boolean)
                .join("  ·  ") || "\u2014"}
            </div>
          </div>
        </div>
      )}

      {/* Title block */}
      <div
        style={{
          background: "#fff",
          color: DUSK,
          padding: "28px 28px 16px",
          borderBottom: `2px solid ${ELECTRIC}`,
        }}
      >
        <div
          className="uppercase"
          style={{ fontSize: 11, letterSpacing: "0.22em", color: DUSK, opacity: 0.65, fontWeight: 700 }}
        >
          Polestar Advisory · Special Report
        </div>
        <h1
          style={{
            fontFamily: ROBOTO,
            fontWeight: 700,
            fontSize: 26,
            lineHeight: 1.15,
            marginTop: 8,
            color: NAVY,
          }}
        >
          {report.title || "Untitled Special Report"}
        </h1>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mt-5">
          <div className="flex items-center gap-2">
            <SeverityChip severity={report.severity} />
          </div>
          <Meta label="Location" value={location || "\u2014"} />
          <Meta label="Report Date" value={reportDate ? format(reportDate, "dd MMM yyyy HH:mm") : "\u2014"} />
          <Meta
            label="Incident Date"
            value={incidentDate ? format(incidentDate, "dd MMM yyyy HH:mm") : "\u2014"}
          />
          {report.category && <Meta label="Category" value={report.category} />}
          {report.createdBy && <Meta label="Prepared By" value={report.createdBy} />}
        </div>
      </div>

      {/* Body — a free-form ordered list of analyst-composed blocks. Order,
          presence, and mix are entirely the analyst's; nothing is forced. */}
      <div style={{ padding: "28px" }}>
        {blocks.map((b, i) => {
          if (!visible[i]) return null;
          switch (b.type) {
            case "heading":
              return <BlockHeading key={b.id} text={(b.text ?? "").trim()} />;
            case "text":
              return (
                <div key={b.id} className="report-section mb-6">
                  <Paragraphs text={b.body ?? ""} />
                </div>
              );
            case "bullets":
              return (
                <div key={b.id} className="report-section mb-6">
                  <Bullets text={b.body ?? ""} />
                </div>
              );
            case "chart":
              return b.chart ? (
                <div key={b.id} className="report-section">
                  <ChartBlock chart={b.chart} />
                </div>
              ) : null;
            case "image":
              return b.dataUrl ? (
                <ImageBlock key={b.id} dataUrl={b.dataUrl} caption={b.caption} />
              ) : null;
            case "map":
              return (
                <div key={b.id} className="report-section mb-6">
                  <IncidentMap
                    domId="special-report-map"
                    points={mapPoints}
                    affectedRadiusKm={report.affectedRadiusKm}
                    showLabels
                    height={420}
                  />
                </div>
              );
            case "incidents":
              return (
                <div key={b.id} className="report-section mb-6">
                  <IncidentTable incidents={incidents} />
                </div>
              );
            default:
              return null;
          }
        })}

        {report.showSourcesInExport && (report.confidenceLevel || report.internalSourceNotes) && (
          <Section title="Sources & Confidence">
            {report.confidenceLevel && (
              <p
                className="text-[14px] leading-[1.7] mb-3 font-light"
                style={{ color: DUSK, fontFamily: ROBOTO }}
              >
                Confidence: {report.confidenceLevel.charAt(0).toUpperCase() + report.confidenceLevel.slice(1)}
              </p>
            )}
            {report.internalSourceNotes && <Paragraphs text={report.internalSourceNotes} />}
          </Section>
        )}

        <div
          style={{
            marginTop: 8,
            paddingTop: 12,
            borderTop: `1px solid ${POLAR}`,
            fontFamily: ROBOTO,
            fontSize: 10,
            lineHeight: 1.5,
            color: DUSK,
          }}
        >
          {DISCLAIMER_TEXT}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.16em",
          color: DUSK,
          opacity: 0.6,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: NAVY, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
