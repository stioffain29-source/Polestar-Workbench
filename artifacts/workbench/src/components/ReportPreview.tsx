import { format, parseISO } from "date-fns";
import { TOPIC_LABELS } from "@/lib/topics";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

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
  if (!text) return <p className="text-sm italic" style={{ color: "#888" }}>No content yet.</p>;
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className="text-[14px] leading-[1.7] mb-3 font-light" style={{ color: "#222", fontFamily: "Roboto, sans-serif" }}>
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
          color: "#0B0B3D",
          fontFamily: "'Roboto Condensed', sans-serif",
          fontWeight: 700,
          fontSize: 18,
          borderBottom: "2px solid #4655FF",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
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
        const accent = c.severity && SEV_COLOR[c.severity] ? SEV_COLOR[c.severity] : "#4655FF";
        return (
          <div
            key={i}
            className="bg-white border rounded-sm p-3 relative"
            style={{ borderColor: "#E2E2E2" }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
            <div
              className="uppercase tracking-widest"
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 9, color: "#303030", marginTop: 4 }}
            >
              {c.label}
            </div>
            <div
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: "#0B0B3D", marginTop: 4, lineHeight: 1.1 }}
            >
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, color: "#303030", marginTop: 6 }}>
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
  const topicLabel = report.topic ? TOPIC_LABELS[report.topic] ?? report.topic : "—";
  let period = "Last 30 days";
  try {
    if (report.issueDate) {
      const end = parseISO(report.issueDate);
      if (!isNaN(end.getTime())) {
        const start = new Date(end);
        start.setDate(start.getDate() - 30);
        period = `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")}`;
      }
    }
  } catch { /* fallback */ }
  return [
    { label: "Reporting Period", value: period },
    { label: "Total Records", value: "—", note: "Computed at export from incidents on file" },
    { label: "Highest Severity", value: "—", note: "Computed at export" },
    { label: "Most Affected Country", value: "—", note: "Computed at export" },
    { label: "Latest Incident", value: "—", note: "Computed at export" },
    { label: "Topic Coverage", value: topicLabel },
  ];
}

export default function ReportPreview({ report }: { report: ReportPreviewData }) {
  const issueDateText = report.issueDate
    ? (() => {
        try { return format(parseISO(report.issueDate!), "d MMMM yyyy"); }
        catch { return report.issueDate; }
      })()
    : "";
  const topicLabel = report.topic ? TOPIC_LABELS[report.topic] ?? report.topic : "";
  const subhead = report.topic === "protests" ? "Flashpoint" : topicLabel;
  const tertiary = report.topic === "protests" ? "Activism, Protests & Civil Unrest" : "";
  const cadence = report.topic === "cargo_watch" ? "Monthly Briefing" : "Weekly Briefing";
  const fastFacts = computePreviewFastFacts(report);

  return (
    <div className="print-report bg-white" style={{ color: "#0B0B3D", fontFamily: "Roboto, sans-serif" }}>
      <div
        className="report-hero px-10 py-10"
        style={{
          background: "linear-gradient(to right, #0B0B3D 0%, #0B0B3D 38%, #4655FF 100%)",
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          style={{ height: 36, width: "auto", maxWidth: 240, marginBottom: 16, display: "block" }}
        />
        <div
          className="uppercase mb-2"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: "0.3em",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          Polestar Insights · {subhead} · {cadence}
        </div>
        {tertiary && (
          <div
            className="uppercase mb-2"
            style={{
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 400,
              fontSize: 9,
              letterSpacing: "0.25em",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {tertiary}
          </div>
        )}
        <h1
          className="mb-3"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 30,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
          }}
        >
          {report.title || "Untitled report"}
        </h1>
        <div className="flex items-center gap-4 uppercase" style={{
          fontFamily: "'Roboto Condensed', sans-serif",
          fontWeight: 500,
          fontSize: 11,
          letterSpacing: "0.15em",
          color: "rgba(255,255,255,0.9)",
        }}>
          {issueDateText && <span>{issueDateText}</span>}
          {report.author && <span>·</span>}
          {report.author && <span>{report.author}</span>}
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
            style={{ fontSize: 10, color: "#888", fontFamily: "Roboto, sans-serif" }}
          >
            Live values are calculated against incidents on file when the PDF is generated.
          </p>
        </Section>

        <Section title="Situation">
          <Paragraphs text={report.situation} />
        </Section>

        <Section title="What Happened">
          <Paragraphs text={report.whatHappened} />
        </Section>

        <Section title="What Matters">
          <Paragraphs text={report.whatMatters} />
        </Section>

        <Section title="Implications for Business">
          <Paragraphs text={report.implications} />
        </Section>

        <Section title="Watch Next">
          <Paragraphs text={report.watchNext} />
        </Section>

        <Section title="Polestar View">
          <Paragraphs text={report.polestarView} />
        </Section>

        <div
          className="flex items-center justify-between border-t pt-6 mt-12 uppercase"
          style={{
            borderColor: "#E2E2E2",
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: "0.25em",
            color: "#303030",
          }}
        >
          <span>Polestar Advisory · Confidential</span>
          <span>Preview — page numbers added at export</span>
        </div>
      </div>
    </div>
  );
}
