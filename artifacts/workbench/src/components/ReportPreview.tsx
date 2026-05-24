import { format, parseISO } from "date-fns";
import { TOPIC_LABELS } from "@/lib/topics";
import { resolveReportWindow } from "@/lib/reportWindow";
import { canonicalTopic, resolveReportTitle } from "@/lib/reportNaming";
import { topicCoverUrl } from "@/lib/coverImages";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

const SEV_COLOR: Record<string, string> = {
  Extreme: "#800000",
  High: "#C0392B",
  Moderate: "#E67E22",
  Low: "#6FB872",
  Insignificant: "#B8C2CC",
};

export interface ReportPreviewData {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  polestarView?: string | null;
  watchNext?: string | null;
}

function Paragraphs({ text }: { text?: string | null }) {
  if (!text) return null;
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p
          key={i}
          className="text-[14px] leading-[1.7] mb-3 font-light"
          style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
        >
          {p}
        </p>
      ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
        style={{
          color: NAVY,
          fontFamily: "'Roboto Condensed', sans-serif",
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

// Render the section only when its source field is populated — no
// placeholder text per brand spec.
function NarrativeSection({ title, text }: { title: string; text?: string | null }) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return (
    <Section title={title}>
      <Paragraphs text={trimmed} />
    </Section>
  );
}

interface KpiPreviewCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
}

function FastFactsGrid({ cards }: { cards: KpiPreviewCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const accent = c.severity && SEV_COLOR[c.severity] ? SEV_COLOR[c.severity] : ELECTRIC;
        return (
          <div
            key={i}
            className="bg-white border rounded-sm relative"
            style={{ borderColor: POLAR, paddingLeft: 14, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
          >
            {/* Vertical accent strip on the left edge — no horizontal top bar. */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: accent }} />
            <div
              className="uppercase tracking-widest"
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 9, color: DUSK }}
            >
              {c.label}
            </div>
            <div
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, marginTop: 4, lineHeight: 1.1 }}
            >
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: DUSK, marginTop: 6 }}>
                {c.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function computePreviewFastFacts(report: ReportPreviewData): KpiPreviewCard[] {
  const period = report.topic && report.issueDate
    ? resolveReportWindow(report.topic, report.issueDate).shortLabel
    : "—";
  return [
    { label: "Reporting Period", value: period },
    { label: "Total Records", value: "—", note: "Computed at export from incidents on file" },
    { label: "Highest Severity", value: "—", note: "Computed at export" },
    { label: "Top Issue Type", value: "—", note: "Derived from incidents at export" },
    { label: "Most Affected Country", value: "—", note: "Computed at export" },
    { label: "Latest Incident", value: "—", note: "Computed at export" },
  ];
}

export default function ReportPreview({ report }: { report: ReportPreviewData }) {
  void TOPIC_LABELS; void canonicalTopic; void format; void parseISO;
  const resolvedTitle = report.topic
    ? resolveReportTitle(report.topic, report.title)
    : (report.title ?? "");
  const fastFacts = computePreviewFastFacts(report);
  const periodLabel = report.topic && report.issueDate
    ? resolveReportWindow(report.topic, report.issueDate).label
    : "";
  const coverUrl = topicCoverUrl(report.topic);

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      {/* 1. Top gradient band — full width, logo left, no margins. */}
      <div
        className="flex items-center"
        style={{
          background: BRAND_GRADIENT,
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          height: 64,
          paddingLeft: 24,
          paddingRight: 24,
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }}
        />
      </div>

      {/* 2. Hero band — cover photo when registered for the topic, otherwise gradient. */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          background: BRAND_GRADIENT,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          overflow: "hidden",
        }}
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </div>

      {/* 3. Bottom gradient title block — title, subtitle, period, website. */}
      <div
        style={{
          background: BRAND_GRADIENT,
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
          paddingLeft: 32,
          paddingRight: 32,
          paddingTop: 40,
          paddingBottom: 28,
        }}
      >
        <h1
          className="mb-4"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
          }}
        >
          {resolvedTitle || "Untitled report"}
        </h1>
        <div
          className="uppercase"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.22em",
            marginBottom: 6,
          }}
        >
          POLESTAR INSIGHTS
        </div>
        {periodLabel && (
          <div
            className="uppercase"
            style={{
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 400,
              fontSize: 12,
              letterSpacing: "0.18em",
              color: "rgba(255,255,255,0.92)",
            }}
          >
            REPORTING PERIOD: {periodLabel.toUpperCase()}
          </div>
        )}
        <div
          className="uppercase"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.18em",
            marginTop: 32,
          }}
        >
          polestar-advisory.com
        </div>
      </div>

      <div className="px-10 py-10">
        {report.executiveSummary && report.executiveSummary.trim() && (
          <Section title="Executive Summary">
            <Paragraphs text={report.executiveSummary} />
          </Section>
        )}

        <Section title="Fast Facts">
          <FastFactsGrid cards={fastFacts} />
          <p
            className="mt-3"
            style={{ fontSize: 10, color: DUSK, fontFamily: "Roboto, sans-serif" }}
          >
            Live values are calculated against incidents on file when the PDF is generated.
          </p>
        </Section>

        <NarrativeSection title="Situation" text={report.situation} />
        <NarrativeSection title="What Happened" text={report.whatHappened} />
        <NarrativeSection title="What Matters" text={report.whatMatters} />
        <NarrativeSection title="Implications for Business" text={report.implications} />
        <NarrativeSection title="Watch Next" text={report.watchNext} />
        <NarrativeSection title="Polestar View" text={report.polestarView} />
      </div>

      {/* Full-bleed Polar Gray footer — website, email, page note */}
      <div
        className="px-10 flex items-center justify-between"
        style={{
          background: POLAR,
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          minHeight: 36,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
    </div>
  );
}
