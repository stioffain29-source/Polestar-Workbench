import { format } from "date-fns";
import { TOPIC_LABELS } from "@/lib/topics";

type KpiCard = { label: string; value: string; accent?: string; context?: string };

export interface ReportPreviewData {
  title?: string;
  topic?: string;
  issueDate?: string;
  situation?: string | null;
  whatHappened?: string | null;
  hardNumbers?: KpiCard[] | null;
  whatMatters?: string | null;
  implications?: string | null;
  polestarView?: string | null;
  watchNext?: string | null;
  author?: string | null;
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

export default function ReportPreview({ report }: { report: ReportPreviewData }) {
  const issueDateText = report.issueDate
    ? (() => {
        try { return format(new Date(report.issueDate), "d MMMM yyyy"); }
        catch { return report.issueDate; }
      })()
    : "";
  const topicLabel = report.topic ? TOPIC_LABELS[report.topic] ?? report.topic : "";

  return (
    <div className="print-report bg-white" style={{ color: "#0B0B3D", fontFamily: "Roboto, sans-serif" }}>
      <div
        className="report-hero px-10 py-12"
        style={{
          background: "linear-gradient(-130deg, #0B0B3D, #4655FF)",
          color: "#fff",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <div
          className="uppercase mb-3"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: "0.3em",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          Polestar Insights
        </div>
        <h1
          className="mb-4"
          style={{
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 36,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
          }}
        >
          {report.title || "Untitled report"}
        </h1>
        <div className="flex items-center gap-6 uppercase" style={{
          fontFamily: "'Roboto Condensed', sans-serif",
          fontWeight: 500,
          fontSize: 12,
          letterSpacing: "0.15em",
          color: "rgba(255,255,255,0.9)",
        }}>
          <span>{topicLabel}</span>
          {issueDateText && <span>·</span>}
          {issueDateText && <span>{issueDateText}</span>}
          {report.author && <span>·</span>}
          {report.author && <span>{report.author}</span>}
        </div>
      </div>

      <div className="px-10 py-10">
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
          <span>Page 1</span>
        </div>
      </div>
    </div>
  );
}
