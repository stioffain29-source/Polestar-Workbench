import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCountryReport,
  useListIncidents,
  useUpdateCountryReport,
  getGetCountryReportQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { TOPIC_LABELS, severityBadgeStyle } from "@/lib/topics";
import { ArrowLeft, Download, Loader2, Pencil, Save, X } from "lucide-react";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import { slugifyForFilename } from "@/lib/exportPdf";
import { exportCountryReportPdf } from "@/lib/exportCountryReportPdf";

interface Draft {
  name: string;
  region: string;
  overview: string;
  trendSummary: string;
  implications: string;
}

const EMPTY_DRAFT: Draft = { name: "", region: "", overview: "", trendSummary: "", implications: "" };

export default function CountryReport() {
  const [, params] = useRoute("/countries/:slug");
  const slug = params?.slug ?? "";
  const qc = useQueryClient();
  const { data: country, isLoading } = useGetCountryReport(slug);
  const { data: incidents = [] } = useListIncidents(country ? { country: country.name } : {}, {
    query: { enabled: !!country },
  } as never);
  const update = useUpdateCountryReport();

  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!country) return;
    setDraft({
      name: country.name ?? "",
      region: country.region ?? "",
      overview: country.overview ?? "",
      trendSummary: country.trendSummary ?? "",
      implications: country.implications ?? "",
    });
  }, [country]);

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

  const downloadPdf = async () => {
    if (!effective) return;
    setExporting(true);
    try {
      await exportCountryReportPdf(
        effective,
        incidents,
        TOPIC_LABELS,
        `polestar-country-report-${slugifyForFilename(effective.name)}.pdf`,
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

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!country || !effective) return <div className="text-sm text-muted-foreground">Country report not found.</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between no-print">
        <Link href="/countries" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> All Countries
        </Link>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={cancel}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium border border-border rounded-sm bg-card hover:bg-muted disabled:opacity-60"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={save}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium border border-primary rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {update.isPending ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium border border-border rounded-sm bg-card hover:bg-muted"
              title="Edit report"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={exporting || editing}
            title={editing ? "Save or cancel edits before exporting" : "Download PDF"}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium border border-accent rounded-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </button>
        </div>
      </div>

      <div
        className="report-hero rounded-sm px-10 py-10 text-white flex items-center justify-between gap-10"
        style={{
          background: "linear-gradient(to right, #0B0B3D 0%, #0B0B3D 38%, #4655FF 100%)",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          className="shrink-0 h-10 w-auto"
          style={{ maxWidth: 240 }}
        />
        {editing ? (
          <div className="flex flex-col items-end gap-1 w-1/2">
            <input
              value={draft.region}
              onChange={(e) => setField("region", e.target.value)}
              placeholder="Region"
              className="bg-white/10 border border-white/30 rounded-sm px-2 py-1 text-xs uppercase tracking-widest text-white placeholder-white/60 text-right w-48"
            />
            <input
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Country name"
              className="bg-white/10 border border-white/30 rounded-sm px-3 py-2 text-2xl font-serif font-bold uppercase tracking-tight text-white text-right w-full"
            />
          </div>
        ) : (
          <h1 className="text-2xl font-serif font-bold uppercase tracking-tight text-right">
            {effective.name}
          </h1>
        )}
      </div>

      {effective.keyNumbers && effective.keyNumbers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {effective.keyNumbers.map((k, i) => (
            <div key={i} className="bg-card border-l-4 border-accent border-y border-r border-y-border border-r-border p-4 rounded-sm">
              <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{k.label}</div>
              <div className="text-2xl font-serif font-bold text-primary leading-none mt-1">{k.value}</div>
              {k.context && <div className="text-xs text-muted-foreground mt-2">{k.context}</div>}
            </div>
          ))}
        </div>
      )}

      <EditableSection
        title="Overview"
        value={draft.overview}
        savedValue={country.overview ?? ""}
        editing={editing}
        onChange={(v) => setField("overview", v)}
      />
      <EditableSection
        title="Trend Summary"
        value={draft.trendSummary}
        savedValue={country.trendSummary ?? ""}
        editing={editing}
        onChange={(v) => setField("trendSummary", v)}
      />
      <EditableSection
        title="Implications"
        value={draft.implications}
        savedValue={country.implications ?? ""}
        editing={editing}
        onChange={(v) => setField("implications", v)}
      />

      <div>
        <h2 className="font-serif font-bold text-lg text-primary uppercase border-b-2 border-accent pb-1 mb-3">Related Incidents</h2>
        <div className="bg-card border border-border rounded-sm divide-y divide-border">
          {incidents.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No related incidents recorded for {effective.name}.</div>
          ) : incidents.map((i) => (
            <div key={i.id} className="grid grid-cols-[180px_120px_1fr_100px] items-center text-sm hover:bg-muted/30">
              <div className="p-3 font-mono text-xs">{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
              <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-secondary text-secondary-foreground">{TOPIC_LABELS[i.topic]}</span></div>
              <div className="p-3 font-medium">{i.title}</div>
              <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>{i.severity}</span></div>
            </div>
          ))}
        </div>
      </div>
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
  if (!editing && !savedValue) return null;
  return (
    <div>
      <h2 className="font-serif font-bold text-lg text-primary uppercase border-b-2 border-accent pb-1 mb-3">{title}</h2>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(5, Math.min(20, value.split("\n").length + 2))}
          placeholder={`Write the ${title.toLowerCase()} narrative...`}
          className="w-full bg-card border border-border rounded-sm p-3 text-sm font-sans text-foreground leading-relaxed focus:outline-none focus:border-accent"
        />
      ) : (
        <div className="prose max-w-none font-sans text-foreground">
          {(value || savedValue).split(/\n+/).map((p, i) => (
            <p key={i} className="mb-3 leading-relaxed text-sm">{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}
