import { format } from "date-fns";
import polestarLogo from "@assets/Polestar_navy_logo_hor.png";
import type { Incident, SpotReport } from "@workspace/api-client-react";
import IncidentMap from "@/components/IncidentMap";
import {
  NAVY,
  ELECTRIC,
  DUSK,
  POLAR,
  SPOT_SEV_COLOR,
  SPOT_SEV_LABEL,
  spotSevKey,
  spotLocationLabel,
  spotReportSections,
  buildSpotMapPoints,
  toBullets,
  DISCLAIMER_TEXT,
} from "@/lib/spotReport";

const ROBOTO = "Roboto, sans-serif";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
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
  const k = spotSevKey(severity);
  if (!k) return null;
  const bg = SPOT_SEV_COLOR[k] ?? "#999";
  return (
    <span
      className="uppercase inline-flex items-center justify-center"
      style={{
        background: bg,
        color: "#fff",
        fontFamily: ROBOTO,
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.08em",
        padding: "4px 11px",
        lineHeight: 1,
        borderRadius: 2,
      }}
    >
      {SPOT_SEV_LABEL[k] ?? severity}
    </span>
  );
}

export interface SpotReportPreviewProps {
  report: SpotReport;
  incidents: Incident[];
}

/**
 * On-screen preview for a Spot Report. Renders the SAME ordered sections as the
 * Word/text exports (via spotReportSections) and the same map (IncidentMap), so
 * the in-app "Download PDF" — which rasterises this DOM — and the other exports
 * never disagree. Internal source notes appear only when showSourcesInExport is
 * on.
 */
export default function SpotReportPreview({ report, incidents }: SpotReportPreviewProps) {
  const sections = spotReportSections(report);
  const mapPoints = buildSpotMapPoints(report, incidents);
  const location = spotLocationLabel(report);
  const reportDate = report.reportDate ? new Date(report.reportDate) : null;
  const incidentDate = report.incidentDate ? new Date(report.incidentDate) : null;
  // Incident Map renders at position 4 — immediately after Bottom Line Up Front
  // and before Incident Details — so split BLUF from the remaining sections.
  const blufSection = sections.find((s) => s.heading === "Bottom Line Up Front");
  const otherSections = sections.filter((s) => s !== blufSection);

  return (
    <div className="print-report bg-white" style={{ color: DUSK, fontFamily: ROBOTO, fontWeight: 300 }}>
      {/* Header band */}
      <div style={{ background: POLAR, color: DUSK, padding: "24px 28px" }}>
        <div className="flex items-start justify-between gap-6">
          <div>
            <div
              className="uppercase"
              style={{ fontSize: 11, letterSpacing: "0.22em", color: DUSK, opacity: 0.65, fontWeight: 700 }}
            >
              Polestar Advisory · Spot Report
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
              {report.title || "Untitled Spot Report"}
            </h1>
          </div>
          <img src={polestarLogo} alt="Polestar Advisory" style={{ width: 150, height: "auto" }} />
        </div>

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

      {/* Body */}
      <div style={{ padding: "28px" }}>
        {blufSection && (
          <Section title={blufSection.heading}>
            {blufSection.bullets ? (
              <Bullets text={blufSection.body} />
            ) : (
              <Paragraphs text={blufSection.body} />
            )}
          </Section>
        )}

        {report.mapEnabled && (
          <Section title="Incident Map">
            <IncidentMap
              domId="spot-report-map"
              points={mapPoints}
              affectedRadiusKm={report.affectedRadiusKm}
              showLabels
              locationLabel={location}
            />
          </Section>
        )}

        {otherSections.map((s) => (
          <Section key={s.heading} title={s.heading}>
            {s.bullets ? <Bullets text={s.body} /> : <Paragraphs text={s.body} />}
          </Section>
        ))}

        {incidents.length > 0 && (
          <Section title="Reference Incidents">
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
          </Section>
        )}

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
