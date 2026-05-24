import { format } from "date-fns";
import { useMemo } from "react";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
import { canonicalTopic, resolveReportTitle } from "@/lib/reportNaming";
import {
  buildShippingReportDataset,
  type ShippingReportIncident,
  type KpiCard,
  type BarRow,
  type ChokepointRow,
  type EnrichedIncident,
  SHIPPING_SEV_COLOR,
  SHIPPING_SEV_LABEL,
  shippingSevKey,
} from "@/lib/shippingReportDataset";

// Shipping-specific on-screen preview. Renders the same sections as
// exportShippingReportPdf, in the same order, from the same dataset
// (buildShippingReportDataset). Anything that draws in the PDF should
// appear here so the editor preview and the export never disagree.

const NAVY = "#0B0A3D";
const ELECTRIC = "#465BFF";
const DUSK = "#363636";
const POLAR = "#E2E2E2";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0B0A3D 0%, #465BFF 100%)";

export interface ShippingPreviewReport {
  title?: string;
  topic?: string;
  issueDate?: string;
  author?: string | null;
  executiveSummary?: string | null;
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

function KpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const sevK = c.severity ? shippingSevKey(c.severity) : "";
        const accent = sevK && SHIPPING_SEV_COLOR[sevK] ? SHIPPING_SEV_COLOR[sevK] : ELECTRIC;
        return (
          <div
            key={i}
            className="bg-white border rounded-sm relative"
            style={{ borderColor: POLAR, paddingLeft: 14, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
          >
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: accent }} />
            <div
              className="uppercase tracking-widest"
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 9, color: DUSK }}
            >
              {c.label}
            </div>
            <div
              style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: NAVY, marginTop: 4, lineHeight: 1.15 }}
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

function SeverityChip({ sevKey: k, label }: { sevKey: string; label: string }) {
  if (!k) return <span style={{ color: DUSK, fontSize: 11 }}>—</span>;
  const bg = SHIPPING_SEV_COLOR[k] ?? "#999";
  return (
    <span
      className="uppercase inline-block text-center"
      style={{
        background: bg,
        color: "#fff",
        fontFamily: "'Roboto Condensed', sans-serif",
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

function ChokepointTable({ rows }: { rows: ChokepointRow[] }) {
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: "1.3fr 0.5fr 0.8fr 0.8fr 2.2fr",
          background: NAVY,
          color: "#fff",
          fontFamily: "'Roboto Condensed', sans-serif",
          fontWeight: 700,
          fontSize: 10,
          padding: "8px 10px",
          gap: 10,
        }}
      >
        <div>Chokepoint</div>
        <div>Records</div>
        <div>Highest Sev</div>
        <div>Latest</div>
        <div>Operational Read</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.name}
          className="grid"
          style={{
            gridTemplateColumns: "1.3fr 0.5fr 0.8fr 0.8fr 2.2fr",
            padding: "8px 10px",
            gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 12,
            color: DUSK,
            alignItems: "center",
          }}
        >
          <div style={{ color: NAVY, fontWeight: 700, fontFamily: "'Roboto Condensed', sans-serif" }}>{r.name}</div>
          <div>{r.count}</div>
          <div><SeverityChip sevKey={r.highestSeverityKey} label={r.highestSeverityLabel} /></div>
          <div>{r.latestDate ? format(r.latestDate, "dd MMM yyyy") : "—"}</div>
          <div style={{ lineHeight: 1.5 }}>{r.readText}</div>
        </div>
      ))}
    </div>
  );
}

interface IncidentTableProps<T extends EnrichedIncident> {
  rows: T[];
  emptyMessage: string;
  actLabel?: string;
  actFor?: (r: T) => string;
  rowLimit?: number;
}

function IncidentTable<T extends EnrichedIncident>({ rows, emptyMessage, actLabel, actFor, rowLimit = 15 }: IncidentTableProps<T>) {
  if (rows.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        {emptyMessage}
      </p>
    );
  }
  const limited = rows.slice(0, rowLimit);
  const showAct = !!actLabel && !!actFor;
  const cols = showAct ? "0.7fr 0.9fr 2.4fr 0.7fr" : "0.7fr 2.4fr 0.7fr";
  return (
    <div className="w-full overflow-hidden border" style={{ borderColor: POLAR }}>
      <div
        className="grid uppercase tracking-widest"
        style={{
          gridTemplateColumns: cols,
          background: NAVY,
          color: "#fff",
          fontFamily: "'Roboto Condensed', sans-serif",
          fontWeight: 700,
          fontSize: 10,
          padding: "8px 10px",
          gap: 10,
        }}
      >
        <div>Date</div>
        {showAct && <div>{actLabel}</div>}
        <div>Title</div>
        <div>Severity</div>
      </div>
      {limited.map((r, i) => (
        <div
          key={String(r.id)}
          className="grid"
          style={{
            gridTemplateColumns: cols,
            padding: "8px 10px",
            gap: 10,
            borderTop: i === 0 ? "none" : `1px solid ${POLAR}`,
            fontFamily: "Roboto, sans-serif",
            fontSize: 12,
            color: DUSK,
            alignItems: "center",
          }}
        >
          <div>{format(r.date, "dd MMM yyyy")}</div>
          {showAct && <div>{actFor!(r)}</div>}
          <div style={{ color: NAVY }}>{r.title}</div>
          <div>
            <SeverityChip
              sevKey={shippingSevKey(r.severity)}
              label={SHIPPING_SEV_LABEL[shippingSevKey(r.severity)] ?? r.severity}
            />
          </div>
        </div>
      ))}
      {rows.length > limited.length && (
        <div style={{ padding: "8px 10px", borderTop: `1px solid ${POLAR}`, fontSize: 11, fontStyle: "italic", color: DUSK }}>
          Showing {limited.length} most recent of {rows.length} records in window. Older records remain available in the Workbench.
        </div>
      )}
    </div>
  );
}

function HorizontalBarChart({ rows, labelW = 160, emptyMessage }: { rows: BarRow[]; labelW?: number; emptyMessage?: string }) {
  if (rows.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        {emptyMessage ?? "No data in window."}
      </p>
    );
  }
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3" style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: NAVY }}>
            <div style={{ width: labelW, flexShrink: 0 }}>{r.label}</div>
            <div className="flex-1 relative" style={{ background: POLAR, height: 14 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: r.color ?? ELECTRIC }} />
            </div>
            <div style={{ width: 30, textAlign: "right", color: DUSK, fontWeight: 700 }}>{r.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineChart({ series, peak }: { series: { date: string; label: string; count: number }[]; peak: { label: string; count: number } | null }) {
  if (series.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 13 }}>
        No timeline data available.
      </p>
    );
  }
  const max = series.reduce((m, s) => Math.max(m, s.count), 0) || 1;
  const tickIdx = [0, Math.floor(series.length / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div>
      <div
        className="flex items-end gap-[2px] border-b"
        style={{ height: 120, borderColor: POLAR, paddingTop: 4 }}
      >
        {series.map((s, i) => {
          const h = Math.max(2, (s.count / max) * 110);
          return (
            <div key={i} className="flex-1" style={{ background: NAVY, height: h, minWidth: 2 }} title={`${s.label}: ${s.count}`} />
          );
        })}
      </div>
      <div className="flex justify-between mt-2" style={{ fontSize: 10, color: DUSK, fontFamily: "Roboto, sans-serif" }}>
        {tickIdx.map((idx) => (
          <span key={idx}>{series[idx].label}</span>
        ))}
      </div>
      {peak && (
        <div className="mt-2" style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 12, color: NAVY }}>
          Peak: {peak.count} on {peak.label}
        </div>
      )}
    </div>
  );
}

export default function ShippingReportPreview({
  report,
  incidents,
}: {
  report: ShippingPreviewReport;
  incidents: ShippingReportIncident[];
}) {
  const topic = report.topic ?? "shipping";
  const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
  const resolvedTitle = resolveReportTitle(topic, report.title);
  void canonicalTopic; void format;

  const ds = useMemo(
    () => buildShippingReportDataset(incidents, topic, issueDate),
    [incidents, topic, issueDate],
  );

  return (
    <div className="print-report bg-white" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
      {/* 1. Top gradient band — full width, logo left, no margins. */}
      <div
        className="flex items-center"
        style={{ background: BRAND_GRADIENT, color: "#fff", height: 64, paddingLeft: 24, paddingRight: 24 }}
      >
        <img src={polestarLogo} alt="Polestar Advisory" style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }} />
      </div>

      {/* 2. Hero image — full width, cropped, no borders. */}
      <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", display: "block" }}>
        <img
          src={shippingCoverUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>

      {/* 3. Bottom gradient title block — full width, title + subtitle + period + website. */}
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
          REPORTING PERIOD: {ds.reportingPeriodLong.toUpperCase()}
        </div>
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
          <KpiGrid cards={ds.fastFacts} />
        </Section>

        <Section title="Key Metrics">
          <KpiGrid cards={ds.keyMetrics} />
        </Section>

        <Section title="Chokepoint Watch">
          <ChokepointTable rows={ds.chokepointRows} />
        </Section>

        <Section title="Vessel Attacks">
          <IncidentTable
            rows={ds.vesselRows}
            actLabel="Act"
            actFor={(r) => r.vesselType}
            emptyMessage="No hostile vessel incidents on file in the selected window."
          />
        </Section>

        <Section title="Piracy and Armed Robbery">
          <IncidentTable
            rows={ds.piracyRows}
            actLabel="Act"
            actFor={(r) => r.act}
            emptyMessage="No current piracy or armed-robbery records in the selected window."
          />
        </Section>

        <Section title="Issue Type Breakdown">
          <HorizontalBarChart rows={ds.issueRows} labelW={200} emptyMessage="No issue-type classifications in window." />
        </Section>

        <Section title="Daily Intelligence Summary">
          {ds.dailyIntelLines.map((l, i) => (
            <p key={i} className="text-[14px] leading-[1.7] mb-3 font-light" style={{ color: DUSK }}>
              {l}
            </p>
          ))}
        </Section>

        <Section title="Regional and Country View">
          <div className="mb-5">
            <HorizontalBarChart rows={ds.regionRows} labelW={180} emptyMessage="No regional classifications in window." />
          </div>
          <div
            className="uppercase mb-2"
            style={{ fontFamily: "'Roboto Condensed', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: DUSK }}
          >
            Incidents by Country (Top 12)
          </div>
          <HorizontalBarChart rows={ds.countryRows} labelW={180} emptyMessage="No identified incident countries in window." />
        </Section>

        <Section title="Incident Timeline">
          <TimelineChart series={ds.timelineSeries} peak={ds.timelinePeak} />
        </Section>

        <Section title="Severity Distribution">
          <HorizontalBarChart rows={ds.severityRows} labelW={140} />
        </Section>

        <Section title="Commercial Impact">
          <IncidentTable
            rows={ds.commercialRows}
            actLabel="Issue"
            actFor={(r) => r.issue}
            emptyMessage="No commercial shipping or freight/insurance records in the selected window."
          />
        </Section>

        {report.watchNext && report.watchNext.trim() && (
          <Section title="Watch Next"><Paragraphs text={report.watchNext} /></Section>
        )}
        {report.polestarView && report.polestarView.trim() && (
          <Section title="Polestar View"><Paragraphs text={report.polestarView} /></Section>
        )}

        <Section title="Source Notes / Data Notes">
          <p className="text-[12px] leading-[1.7]" style={{ color: DUSK }}>{ds.dataNote}</p>
        </Section>
      </div>

      <div
        className="px-10 flex items-center justify-between"
        style={{ background: POLAR, color: DUSK, fontFamily: "Roboto, sans-serif", fontSize: 11, minHeight: 36 }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
    </div>
  );
}
