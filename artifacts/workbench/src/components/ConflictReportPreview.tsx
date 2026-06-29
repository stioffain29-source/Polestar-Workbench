import { format } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { resolveReportTitle } from "@/lib/reportNaming";
import { pickRead } from "@/lib/pickRead";
import { TOPIC_COVER_URLS } from "@/lib/coverImages";
import {
  buildConflictReportDataset,
  isGenericConflictProse,
  type ConflictReportIncident,
  type ConflictEnrichedIncident,
} from "@/lib/conflictReportDataset";
import { SEV_COLOR } from "@/lib/pdfChrome";
import SituationalContextSection from "@/components/SituationalContextSection";
import type { ReliefWebReport } from "@workspace/api-client-react";
import { resolveIncidentSummary } from "@/lib/incidentSummary";

// Conflict Watch on-screen preview. Renders the same sections, in the same
// order, from the same dataset (buildConflictReportDataset) as
// exportConflictReportPdf so the editor preview and the export cannot
// disagree. Mirrors the visual language of FlashpointReportPreview but is
// LOCATION-LED: Situation -> Top Activity Areas -> Other Watched Theatres ->
// What Matters -> Watch Next -> Polestar View (no Executive Summary).

const DISCLAIMER_TEXT =
  "Polestar Advisory Pte. Ltd. is an independent company registered in Singapore. " +
  "The information in this report is based on open sources and is assessed as accurate at the time of writing. " +
  "It is provided for general informational purposes only and does not constitute advice or a comprehensive " +
  "assessment of all risks. No reliance should be placed on this information for decision making without " +
  "further independent verification.";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

const SEV_LABEL_MAP: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

// Match exportConflictReportPdf.pickProse: editor text wins only when it
// carries substance (>= 240 chars) AND is not a recognised generic seed.
// Legacy CONFLICT-pack template prose is always replaced by the dataset's
// data-driven auto-prose so already-saved reports stop showing boilerplate
// without a reseed. Genuine short analyst notes are preserved (appended
// ahead of the auto-prose).
function pickProse(editor: string | null | undefined, auto: string): string {
  const t = (editor ?? "").trim();
  if (!t || isGenericConflictProse(t)) return auto;
  if (t.length >= 240) return t;
  return `${t}\n\n${auto}`;
}

export interface ConflictPreviewReport {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null; conflictOtherWatchedRead?: string | null; conflictAreaReads?: Record<string, string> | null;
  situation?: string | null;
  whatMatters?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

// AI-generated narrative for the four sections the conflict report actually
// renders. When a field carries text it REPLACES the deterministic dataset
// auto-prose as the fallback layer beneath any genuine analyst edit; when it
// is empty/absent the deterministic auto-prose shows unchanged. Preview and
// PDF resolve prose with the identical (aiOr -> pickProse) chain so they can
// never disagree.
export interface ConflictAiProse {
  situation?: string | null;
  whatMatters?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
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

function toBullets(text?: string | null, max = 7): string[] {
  const s = (text ?? "").trim();
  if (!s) return [];
  const marked = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^([-*•])\s+/.test(l))
    .map((l) => l.replace(/^([-*•])\s+/, "").trim())
    .filter(Boolean);
  let out: string[];
  if (marked.length > 0) out = marked;
  else
    out = s
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((p) =>
        p.length <= 220
          ? p
          : (p.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? p.slice(0, 217) + "...").trim(),
      );
  return out.slice(0, max);
}

function Bullets({ text, max = 7 }: { text?: string | null; max?: number }) {
  const items = toBullets(text, max);
  if (items.length === 0) return null;
  return (
    <ul
      className="list-disc pl-5 space-y-1.5"
      style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
    >
      {items.map((it, i) => (
        <li key={i} className="text-[14px] leading-[1.6] font-light">
          {it}
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
        style={{
          color: NAVY,
          fontFamily: "Roboto, sans-serif",
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

function KpiGrid({
  cards,
}: {
  cards: { label: string; value: string; note?: string; severity?: string }[];
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const sevK = c.severity ? sevKey(c.severity) : "";
        const accent = sevK && SEV_COLOR[sevK] ? SEV_COLOR[sevK] : ELECTRIC;
        return (
          <div
            key={i}
            className="bg-white border rounded-sm relative"
            style={{
              borderColor: POLAR,
              paddingLeft: 14,
              paddingRight: 12,
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: 4,
                background: accent,
              }}
            />
            <div
              className="uppercase tracking-widest"
              style={{
                fontFamily: "Roboto, sans-serif",
                fontWeight: 700,
                fontSize: 9,
                color: DUSK,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontFamily: "Roboto, sans-serif",
                fontWeight: 700,
                fontSize: 20,
                color: NAVY,
                marginTop: 4,
                lineHeight: 1.15,
              }}
            >
              {c.value}
            </div>
            {c.note && (
              <div
                style={{
                  fontFamily: "Roboto, sans-serif",
                  fontSize: 10,
                  color: DUSK,
                  marginTop: 6,
                }}
              >
                {c.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeverityChip({ sevKey: k, label }: { sevKey: string; label: string }) {
  if (!k) return <span style={{ color: DUSK, fontSize: 11 }}>—</span>;
  const bg = SEV_COLOR[k] ?? "#999";
  return (
    <span
      className="uppercase inline-block text-center"
      style={{
        background: bg,
        color: "#fff",
        fontFamily: "Roboto, sans-serif",
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: "0.06em",
        padding: "3px 8px",
        minWidth: 64,
      }}
    >
      {label}
    </span>
  );
}

function AreaBlock({ area, read }: { area: ConflictEnrichedAreaLike; read: string }) {
  return (
    <div className="mb-5">
      <h3
        className="uppercase tracking-wide mb-1"
        style={{
          color: NAVY,
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.04em",
        }}
      >
        {area.theatre}
      </h3>
      <Paragraphs text={read} />
    </div>
  );
}

// Minimal structural shape of a ConflictActivityArea used by the preview.
interface ConflictEnrichedAreaLike {
  theatre: string;
  paragraph: string;
}

function RelatedIncidentsTable({ rows, summaries }: { rows: ConflictEnrichedIncident[]; summaries: Record<string, string> }) {
  if (rows.length === 0) {
    return (
      <p
        style={{
          fontStyle: "italic",
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 13,
        }}
      >
        Little related activity was reported this period. Treat the quiet stretch
        as a gap in reporting rather than a lasting calm.
      </p>
    );
  }
  return (
    <div className="w-full">
      {rows.length < 4 && (
        <p
          style={{
            fontStyle: "italic",
            color: DUSK,
            fontFamily: "Roboto, sans-serif",
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          Little related activity was reported this period, so the list below is
          short. It is kept deliberately brief — minor items are left out rather
          than used to fill space.
        </p>
      )}
      <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
        <div
          className="grid uppercase tracking-widest"
          style={{
            gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr",
            background: NAVY,
            color: "#fff",
            fontFamily: "Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 10,
            padding: "8px 10px",
            gap: 10,
          }}
        >
          <div>Date</div>
          <div>Issue</div>
          <div>Title</div>
          <div>Severity</div>
        </div>
        {rows.map((r, i) => (
          <div
            key={String(r.id)}
            className="grid"
            style={{
              gridTemplateColumns: "0.7fr 1.0fr 2.2fr 0.7fr",
              padding: "8px 10px",
              gap: 10,
              borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
              fontFamily: "Roboto, sans-serif",
              fontSize: 12,
              color: DUSK,
              alignItems: "flex-start",
            }}
          >
            <div>{format(r.date, "dd MMM yyyy")}</div>
            <div>{r.issue}</div>
            <div style={{ color: NAVY }}>
              {r.displayTitle ?? r.title}
              <div style={{ fontSize: 11, color: DUSK, marginTop: 4, lineHeight: 1.4 }}>
                {resolveIncidentSummary(r, summaries)}
              </div>
            </div>
            <div>
              <SeverityChip
                sevKey={sevKey(r.severity)}
                label={SEV_LABEL_MAP[sevKey(r.severity)] ?? r.severity}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConflictReportPreview({
  report,
  incidents,
  situationalReports,
  incidentSummaries = {},
  aiProse,
}: {
  report: ConflictPreviewReport;
  incidents: ConflictReportIncident[];
  situationalReports?: ReliefWebReport[] | null;
  incidentSummaries?: Record<string, string>;
  aiProse?: ConflictAiProse | null;
}) {
  const topic = report.topic ?? "conflict";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  const coverUrl = TOPIC_COVER_URLS[topic];

  // AI replaces the deterministic auto-prose as the fallback layer; a genuine
  // analyst edit (via pickProse) still wins over both.
  const aiOr = (ai: string | null | undefined, det: string) => {
    const t = (ai ?? "").trim();
    return t ? t : det;
  };
  const ds = useMemo(
    () => buildConflictReportDataset(incidents, topic, issueDate),
    [incidents, topic, issueDate],
  );

  return (
    <div
      className="print-report bg-white"
      style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}
    >
      <div className="pdf-cover-page">
        <div
          className="flex items-center"
          style={{
            background: BRAND_GRADIENT,
            color: "#fff",
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

        {coverUrl && (
          <div
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              overflow: "hidden",
              display: "block",
            }}
          >
            <img
              src={coverUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        )}

        <div
          style={{
            background: BRAND_GRADIENT,
            color: "#fff",
            paddingLeft: 32,
            paddingRight: 32,
            paddingTop: 40,
            paddingBottom: 28,
          }}
        >
          <h1
            className="mb-4"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.05,
              letterSpacing: "0",
              textTransform: "uppercase",
            }}
          >
            {resolvedTitle || "Untitled report"}
          </h1>
          <div
            className="uppercase"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.22em",
              marginBottom: 6,
            }}
          >
            POLESTAR INSIGHTS
          </div>
          <div
            className="uppercase"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 400,
              fontSize: 12,
              letterSpacing: "0.18em",
              color: "rgba(255,255,255,0.92)",
            }}
          >
            {ds.reportingPeriodLong.toUpperCase()}
          </div>
          <div
            className="uppercase"
            style={{
              fontFamily: "Roboto, sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.18em",
              marginTop: 32,
            }}
          >
            polestar-advisory.com
          </div>
        </div>
      </div>

      <div className="px-10 py-10">
        <Section title="Situation">
          <Paragraphs text={pickProse(report.situation, aiOr(aiProse?.situation, ds.autoSituation))} />
        </Section>

        <Section title="Fast Facts">
          <KpiGrid cards={ds.fastFacts} />
        </Section>

        <Section title="Top Activity Areas">
          {ds.topActivityAreas.length === 0 ? (
            <p
              style={{
                fontStyle: "italic",
                color: DUSK,
                fontFamily: "Roboto, sans-serif",
                fontSize: 13,
              }}
            >
              No theatre carried notable armed activity this period. Treat the
              quiet stretch as a gap in reporting rather than a sustained calm.
            </p>
          ) : (
            ds.topActivityAreas.map((area) => (
              <AreaBlock key={area.theatre} area={area} read={pickRead(report.conflictAreaReads?.[area.theatre], area.paragraph)} />
            ))
          )}
        </Section>

        <Section title="Other Watched Theatres">
          <Paragraphs text={pickRead(report.conflictOtherWatchedRead, ds.autoOtherWatched)} />
        </Section>

        <Section title="What Matters for Business">
          <Paragraphs text={pickProse(report.whatMatters, aiOr(aiProse?.whatMatters, ds.autoWhatMatters))} />
        </Section>

        <Section title="Watch Next">
          <Bullets text={pickProse(report.watchNext, aiOr(aiProse?.watchNext, ds.autoWatchNext))} max={8} />
        </Section>

        <Section title="Polestar View">
          <Paragraphs text={pickProse(report.polestarView, aiOr(aiProse?.polestarView, ds.autoPolestarView))} />
        </Section>

        <SituationalContextSection reports={situationalReports} max={6} />

        <Section title="Related Incidents">
          <RelatedIncidentsTable rows={ds.relatedIncidents} summaries={incidentSummaries} />
        </Section>

        <Section title="Disclaimer">
          <p
            className="text-[12px] leading-[1.7]"
            style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
          >
            {DISCLAIMER_TEXT}
          </p>
        </Section>
      </div>

      <div
        className="pdf-preview-footer px-10 flex items-center justify-between"
        style={{
          background: POLAR,
          color: DUSK,
          fontFamily: "Roboto, sans-serif",
          fontSize: 11,
          minHeight: 36,
        }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
    </div>
  );
}
