import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCountryReport,
  useListIncidents,
  useUpdateCountryReport,
  getGetCountryReportQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import { TOPIC_LABELS } from "@/lib/topics";
import { classifyIncidentType } from "@/lib/incidentClassifier";
import { draftCountryReportProse, type DraftableIncident } from "@/lib/draftReportProse";
import { ArrowLeft, Download, Loader2, Pencil, Save, X } from "lucide-react";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import { slugifyForFilename } from "@/lib/exportPdf";
import { exportCountryReportPdf } from "@/lib/exportCountryReportPdf";
import { computeCountryFastFacts, titleCaseLocation, type CountryFastFactsIncident, type CountryFastFactCard } from "@/lib/countryFastFacts";
import CountryReportMap from "@/components/CountryReportMap";
import { countryCoverUrl } from "@/lib/coverImages";

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const ROBOTO = "Roboto, sans-serif";

const SEV_COLOR: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};
const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};
const SEV_ORDER = ["extreme", "high", "moderate", "low", "insignificant"] as const;

interface Draft {
  name: string;
  region: string;
  overview: string;       // Situation
  trendSummary: string;   // What Happened
  implications: string;   // Implications for Business
}

const EMPTY_DRAFT: Draft = { name: "", region: "", overview: "", trendSummary: "", implications: "" };

export default function CountryReport() {
  const [, params] = useRoute("/countries/:slug");
  const slug = params?.slug ?? "";
  const qc = useQueryClient();
  const { data: country, isLoading } = useGetCountryReport(slug);
  const { data: incidentsData } = useListIncidents(country ? { country: country.name } : {}, {
    query: { enabled: !!country },
  } as never);
  const incidents = useMemo(() => incidentsData ?? [], [incidentsData]);
  const update = useUpdateCountryReport();

  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const seededForSlug = useRef<string | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);

  const issueDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Compute Fast Facts + windowed incidents once per render.
  const facts = useMemo(
    () => computeCountryFastFacts({
      issueDate,
      incidents: incidents as CountryFastFactsIncident[],
    }),
    [incidents, issueDate],
  );

  // Auto-derived prose (executiveSummary, whatMatters, watchNext, polestarView).
  const draftedProse = useMemo(() => {
    if (!country) return null;
    const inputs: DraftableIncident[] = incidents.map((i) => ({
      topic: i.topic, title: i.title, summary: i.summary,
      source: i.source, sourceUrl: i.sourceUrl, location: i.location,
      severity: i.severity, occurredAt: i.occurredAt, country: i.country,
    }));
    return draftCountryReportProse({
      countryName: country.name ?? "",
      region: country.region ?? "",
      incidents: inputs,
      issueDate,
    });
  }, [country, incidents, issueDate]);

  useEffect(() => {
    if (!country) return;
    if (!incidentsData) return;
    if (seededForSlug.current === slug) return;
    seededForSlug.current = slug;
    const pick = (saved: string | null | undefined, drafted: string) => {
      const s = (saved ?? "").trim();
      return s ? (saved as string) : drafted;
    };
    setDraft({
      name: country.name ?? "",
      region: country.region ?? "",
      overview: pick(country.overview, draftedProse?.overview ?? ""),
      trendSummary: pick(country.trendSummary, draftedProse?.trendSummary ?? ""),
      implications: pick(country.implications, draftedProse?.implications ?? ""),
    });
  }, [country, incidentsData, slug, draftedProse]);

  useEffect(() => {
    if (seededForSlug.current !== null && seededForSlug.current !== slug) {
      seededForSlug.current = null;
    }
  }, [slug]);

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const effective = country
    ? {
        ...country,
        name: editing ? draft.name : country.name,
        region: editing ? draft.region : country.region,
        overview: editing ? draft.overview : country.overview,
        trendSummary: editing ? draft.trendSummary : country.trendSummary,
        implications: editing ? draft.implications : country.implications,
      }
    : null;

  const coverUrl = effective ? countryCoverUrl(effective.name) : undefined;

  const downloadPdf = async () => {
    if (!effective || !draftedProse) return;
    setExporting(true);
    try {
      // Snapshot the map for the PDF. If html2canvas fails (CORS, missing
      // tiles), the exporter falls back to a coords-only note instead of
      // blocking the export.
      let mapImage: string | undefined;
      if (mapRef.current) {
        try {
          const canvas = await html2canvas(mapRef.current, {
            useCORS: true,
            backgroundColor: "#ffffff",
            scale: 2,
            logging: false,
          });
          mapImage = canvas.toDataURL("image/png");
        } catch (err) {
          console.warn("[CountryReport] map snapshot failed; PDF will skip the map image", err);
        }
      }
      await exportCountryReportPdf(
        effective,
        incidents,
        TOPIC_LABELS,
        `polestar-country-report-${slugifyForFilename(effective.name)}.pdf`,
        {
          executiveSummary: draftedProse.executiveSummary,
          whatMatters: draftedProse.whatMatters,
          watchNext: draftedProse.watchNext,
          polestarView: draftedProse.polestarView,
          mapImage,
        },
      );
    } finally {
      setExporting(false);
    }
  };

  const save = () => {
    if (!country) return;
    update.mutate(
      {
        slug,
        data: {
          name: draft.name,
          region: draft.region,
          overview: draft.overview,
          trendSummary: draft.trendSummary,
          implications: draft.implications,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCountryReportQueryKey(slug) });
          setEditing(false);
        },
      },
    );
  };

  const cancel = () => {
    if (country) {
      setDraft({
        name: country.name ?? "",
        region: country.region ?? "",
        overview: country.overview ?? "",
        trendSummary: country.trendSummary ?? "",
        implications: country.implications ?? "",
      });
    }
    setEditing(false);
  };

  if (isLoading) return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK }}>Loading...</div>;
  if (!country || !effective) return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK }}>Country report not found.</div>;

  const windowIncidents = facts.windowIncidents;
  const totalInWindow = windowIncidents.length;
  const severityTotal = SEV_ORDER.reduce((s, k) => s + facts.severityCounts[k], 0);
  const typeChartData = Array.from(facts.typeCounts.entries())
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const typeChartMax = typeChartData.length > 0 ? Math.max(...typeChartData.map((d) => d.n)) : 0;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6" style={{ fontFamily: ROBOTO, color: DUSK }}>
      {/* Top toolbar (not printed) */}
      <div className="flex items-center justify-between no-print">
        <Link
          href="/countries"
          className="text-xs uppercase tracking-widest hover:opacity-70 inline-flex items-center gap-1"
          style={{ color: DUSK, fontFamily: ROBOTO }}
        >
          <ArrowLeft className="w-3 h-3" /> All Countries
        </Link>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={cancel}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={save}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
                style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${NAVY}`, background: NAVY, color: "#fff" }}
              >
                {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {update.isPending ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm"
              style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
              title="Edit report"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={exporting || editing}
            title={editing ? "Save or cancel edits before exporting" : "Download PDF"}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
            style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${ELECTRIC}`, background: ELECTRIC, color: "#fff" }}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </button>
        </div>
      </div>

      {/* Polestar header band — matches Watch report cover treatment */}
      <div
        className="px-10 py-8 text-white flex items-center justify-between gap-10"
        style={{
          background: `linear-gradient(to right, ${NAVY} 0%, ${NAVY} 38%, ${ELECTRIC} 100%)`,
          borderRadius: 2,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          className="shrink-0 h-9 w-auto"
          style={{ maxWidth: 220 }}
        />
        {editing ? (
          <div className="flex flex-col items-end gap-1 w-1/2">
            <input
              value={draft.region}
              onChange={(e) => setField("region", e.target.value)}
              placeholder="Region"
              style={{ fontFamily: ROBOTO }}
              className="bg-white/10 border border-white/30 rounded-sm px-2 py-1 text-xs uppercase tracking-widest text-white placeholder-white/60 text-right w-48"
            />
            <input
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Country name"
              style={{ fontFamily: ROBOTO, fontWeight: 700 }}
              className="bg-white/10 border border-white/30 rounded-sm px-3 py-2 text-2xl uppercase tracking-tight text-white text-right w-full"
            />
          </div>
        ) : (
          <div className="text-right">
            <div style={{ fontFamily: ROBOTO, fontSize: 11, letterSpacing: "0.18em", opacity: 0.85 }} className="uppercase">
              Polestar Insights · Country Report
            </div>
            <h1 style={{ fontFamily: ROBOTO, fontWeight: 700, fontSize: 30, letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: 6 }} className="uppercase">
              {effective.name}
            </h1>
            {effective.region && (
              <div style={{ fontFamily: ROBOTO, fontSize: 12, letterSpacing: "0.12em", opacity: 0.9, marginTop: 6 }} className="uppercase">
                {effective.region}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cover photo (if registered) */}
      {coverUrl && (
        <div
          style={{
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            height: 220,
            borderRadius: 2,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
      )}

      {/* 1. Executive Summary */}
      <Section title="Executive Summary">
        <Prose text={draftedProse?.executiveSummary ?? ""} />
      </Section>

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <FastFactsGrid cards={facts.cards} />
      </Section>

      {/* 3. Situation (editable: overview) */}
      <EditableSection
        title="Situation"
        value={draft.overview}
        savedValue={(editing ? draft.overview : effective.overview) ?? ""}
        editing={editing}
        onChange={(v) => setField("overview", v)}
      />

      {/* 4. What Happened (editable: trendSummary) */}
      <EditableSection
        title="What Happened"
        value={draft.trendSummary}
        savedValue={(editing ? draft.trendSummary : effective.trendSummary) ?? ""}
        editing={editing}
        onChange={(v) => setField("trendSummary", v)}
      />

      {/* 5. What Matters (auto) */}
      <Section title="What Matters">
        <Prose text={draftedProse?.whatMatters ?? ""} />
      </Section>

      {/* 6. Implications for Business (editable: implications) */}
      <EditableSection
        title="Implications for Business"
        value={draft.implications}
        savedValue={(editing ? draft.implications : effective.implications) ?? ""}
        editing={editing}
        onChange={(v) => setField("implications", v)}
      />

      {/* 7. Map */}
      <Section title="Map">
        <div ref={mapRef}>
          <CountryReportMap incidents={windowIncidents as CountryFastFactsIncident[]} domId="country-report-map" />
        </div>
      </Section>

      {/* 8. Severity Distribution */}
      <Section title="Severity Distribution">
        {severityTotal === 0 ? (
          <EmptyNote>No incidents in the weekly window to chart.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {SEV_ORDER.map((k) => {
              const n = facts.severityCounts[k];
              const w = severityTotal === 0 ? 0 : (n / severityTotal) * 100;
              return (
                <div key={k} className="grid items-center" style={{ gridTemplateColumns: "140px 1fr 40px", gap: 8 }}>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{SEV_LABEL[k]}</div>
                  <div style={{ background: POLAR, height: 12, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: SEV_COLOR[k] }} />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" }}>{n}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 9. Incident Breakdown by Type */}
      <Section title="Incident Breakdown by Type">
        {typeChartData.length === 0 ? (
          <EmptyNote>No classifiable incident types in the weekly window.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {typeChartData.map((d) => {
              const w = typeChartMax === 0 ? 0 : (d.n / typeChartMax) * 100;
              return (
                <div key={d.label} className="grid items-center" style={{ gridTemplateColumns: "180px 1fr 40px", gap: 8 }}>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{d.label}</div>
                  <div style={{ background: POLAR, height: 12, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: ELECTRIC }} />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" }}>{d.n}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Watch Next (auto) */}
      <Section title="Watch Next">
        <Prose text={draftedProse?.watchNext ?? ""} />
      </Section>

      {/* Polestar View (auto) */}
      <Section title="Polestar View">
        <Prose text={draftedProse?.polestarView ?? ""} />
      </Section>

      {/* 10. Related Incidents */}
      <Section title="Related Incidents">
        {totalInWindow === 0 ? (
          <EmptyNote>No related incidents recorded for {effective.name} in the weekly window.</EmptyNote>
        ) : (
          <div style={{ border: `1px solid ${POLAR}`, borderRadius: 2, overflow: "hidden", background: "#fff" }}>
            <div className="grid" style={{ gridTemplateColumns: "180px 160px 1fr 110px", background: NAVY, color: "#fff", fontFamily: ROBOTO, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <div className="p-2.5">Date</div>
              <div className="p-2.5">Type</div>
              <div className="p-2.5">Title</div>
              <div className="p-2.5">Severity</div>
            </div>
            {[...windowIncidents].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((i) => {
              const sk = (i.severity ?? "").toLowerCase();
              const sevColor = SEV_COLOR[sk] ?? "#999";
              return (
                <div key={i.id} className="grid items-center" style={{ gridTemplateColumns: "180px 160px 1fr 110px", borderTop: `1px solid ${POLAR}`, fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>
                  <div className="p-2.5" style={{ fontFamily: "monospace", fontSize: 11 }}>{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
                  <div className="p-2.5">{classifyIncidentType(i)}</div>
                  <div className="p-2.5" style={{ fontWeight: 500, color: NAVY }}>{i.title}</div>
                  <div className="p-2.5">
                    <span
                      style={{
                        background: sevColor, color: "#fff", padding: "2px 8px",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase", borderRadius: 2, display: "inline-block",
                      }}
                    >
                      {SEV_LABEL[sk] ?? i.severity}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 11. Source Notes */}
      <Section title="Source Notes">
        <Prose text={[
          `Records sourced from the Polestar Workbench incident database for ${effective.name}.`,
          `Reporting window is the rolling 7-day weekly cycle, capped at 10 days for late-landing records.`,
          `Locations are shown as reported and may use local-language spellings; coordinates, where present, are sourced with the record.`,
        ].join("\n\n")} />
      </Section>

      {/* 12. Disclaimer */}
      <Section title="Disclaimer">
        <Prose text="This report is intended for the named recipient's internal operational use only. It draws on open-source and Polestar-curated reporting and represents Polestar Advisory's analytical judgement at the time of issue. It is not a directive, does not replace in-country security guidance and should be read alongside the recipient's own risk and travel policies." />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local presentation components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        style={{
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 18,
          color: NAVY,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          borderBottom: `2px solid ${ELECTRIC}`,
          paddingBottom: 6,
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  if (!text) return <EmptyNote>Not populated.</EmptyNote>;
  return (
    <div>
      {text.split(/\n+/).map((p, i) => (
        <p
          key={i}
          style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: "0 0 10px 0" }}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK, fontStyle: "italic" }}>{children}</div>
  );
}

function FastFactsGrid({ cards }: { cards: CountryFastFactCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const stripColor = c.severity ? (SEV_COLOR[c.severity] ?? ELECTRIC) : ELECTRIC;
        return (
          <div
            key={i}
            style={{
              background: "#fff",
              border: `1px solid ${POLAR}`,
              borderLeft: `4px solid ${stripColor}`,
              padding: "12px 14px",
              borderRadius: 2,
            }}
          >
            <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: DUSK, fontWeight: 700 }}>
              {c.label}
            </div>
            <div style={{ fontFamily: ROBOTO, fontSize: 20, fontWeight: 700, color: NAVY, lineHeight: 1.15, marginTop: 4 }}>
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 4 }}>
                {c.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditableSection({
  title, value, savedValue, editing, onChange,
}: {
  title: string;
  value: string;
  savedValue: string;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Section title={title}>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(5, Math.min(20, value.split("\n").length + 2))}
          style={{
            width: "100%", background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2,
            padding: 12, fontFamily: ROBOTO, fontSize: 14, color: DUSK, lineHeight: 1.55,
            outline: "none",
          }}
        />
      ) : (
        <Prose text={savedValue} />
      )}
    </Section>
  );
}

// Suppress an unused-import warning during development when titleCaseLocation
// is referenced from the prose draft path but not directly here.
void titleCaseLocation;
