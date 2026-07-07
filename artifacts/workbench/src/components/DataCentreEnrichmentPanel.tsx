import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDataCentreEnrichmentProviders,
  usePreviewDataCentreEnrichment,
  useCommitDataCentreEnrichment,
  getListDataCentreFacilitiesQueryKey,
  type EnrichmentSummary,
  type EnrichmentPreviewInput,
} from "@workspace/api-client-react";
import { Upload, Download, FileText, X } from "lucide-react";

// Owner-gated bulk ENRICHMENT panel for the Data Centre registry.
//
// Workflow (deliberately two-step, no silent writes):
//   1. Pick a provider + upload its export CSV (or the generic template).
//   2. Preview (dry-run) — the engine matches records to facilities and lists
//      the exact per-field changes it WOULD make. Nothing is written.
//   3. Commit — a SEPARATE explicit action applies only the previewed changes.
//
// STRICT no-fabrication: the engine only proposes values that parse cleanly
// from the file; blank/unmappable cells are never invented. Analyst-locked
// fields are skipped server-side, so a manual correction is never overwritten.

// The template route returns plain CSV and is owner-gated; a same-origin anchor
// download carries the session cookie automatically.
const TEMPLATE_URL = "/api/data-centre-enrichment/template.csv";

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  facilityType: "Type",
  capacityMw: "Capacity (MW)",
  itLoadMw: "IT Load (MW)",
};

function fmtVal(v: string | number | null): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export default function DataCentreEnrichmentPanel() {
  const queryClient = useQueryClient();
  const { data: providers = [] } = useListDataCentreEnrichmentProviders();

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("generic");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [countries, setCountries] = useState("");
  const [summary, setSummary] = useState<EnrichmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The Commit button applies the CURRENT preview. If the analyst changes the
  // file, provider or country filter, the stale preview is dropped so a commit
  // can never apply changes the analyst never saw.
  function resetPreview() {
    setSummary(null);
    setError(null);
  }

  const previewMut = usePreviewDataCentreEnrichment({
    mutation: {
      onSuccess: (s) => {
        setSummary(s);
        setError(null);
      },
      onError: (e) => setError(String((e as Error)?.message ?? "Preview failed")),
    },
  });
  const commitMut = useCommitDataCentreEnrichment({
    mutation: {
      onSuccess: (s) => {
        setSummary(s);
        setError(null);
        queryClient.invalidateQueries({ queryKey: getListDataCentreFacilitiesQueryKey() });
      },
      onError: (e) => setError(String((e as Error)?.message ?? "Commit failed")),
    },
  });

  const busy = previewMut.isPending || commitMut.isPending;

  const input: EnrichmentPreviewInput = useMemo(() => {
    const list = countries
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    return { provider, fileContent, ...(list.length ? { countries: list } : {}) };
  }, [provider, fileContent, countries]);

  const canPreview = provider.trim() !== "" && fileContent.trim() !== "" && !busy;
  const committed = summary?.commit === true;
  const canCommit =
    !!summary && !summary.commit && summary.diffs.length > 0 && !busy;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      setFileContent(text);
      resetPreview();
    } catch {
      setError("Could not read that file.");
    }
  }

  function clearFile() {
    setFileName("");
    setFileContent("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    resetPreview();
  }

  // Group the proposed changes by field so the analyst sees coverage at a glance.
  const diffsByField = useMemo(() => {
    const m = new Map<string, EnrichmentSummary["diffs"]>();
    for (const d of summary?.diffs ?? []) {
      const arr = m.get(d.field) ?? [];
      arr.push(d);
      m.set(d.field, arr);
    }
    return [...m.entries()];
  }, [summary]);

  if (!open) {
    return (
      <div className="bg-white border border-border rounded-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-serif font-bold text-primary uppercase tracking-wide">
            Bulk Enrichment
          </h2>
          <p className="text-xs text-muted-foreground font-sans mt-0.5">
            Import a provider export to preview and apply per-field updates.
            Analyst-locked fields are never overwritten.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 h-9 px-4 border border-border rounded-sm text-sm font-medium font-sans hover:bg-muted"
        >
          <Upload className="w-4 h-4" /> Enrich from file
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-serif font-bold text-primary uppercase tracking-tight">
          Bulk Enrichment
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-sm text-[#A33232] bg-[#A33232]/10 border border-[#A33232]/30 rounded-sm font-sans">
          {error}
        </div>
      )}

      {/* Step 1 — pick provider + file */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
            Provider
          </div>
          <select
            className="w-full h-9 bg-white border border-border rounded-sm px-2.5 text-sm font-sans focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              resetPreview();
            }}
          >
            {providers.map((p) => (
              <option key={p.token} value={p.token}>
                {p.name}
              </option>
            ))}
            {providers.length === 0 && <option value="generic">Generic CSV</option>}
          </select>
        </label>

        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
            Countries filter (optional)
          </div>
          <input
            className="w-full h-9 bg-white border border-border rounded-sm px-2.5 text-sm font-sans focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            placeholder="e.g. Indonesia, Singapore"
            value={countries}
            onChange={(e) => {
              setCountries(e.target.value);
              resetPreview();
            }}
          />
        </label>

        <div className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
            Template
          </div>
          <a
            href={TEMPLATE_URL}
            download="data-centre-enrichment-template.csv"
            className="flex items-center gap-2 h-9 px-3 border border-border rounded-sm text-sm font-medium font-sans hover:bg-muted w-fit"
          >
            <Download className="w-4 h-4" /> Download CSV template
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="hidden"
          id="dc-enrich-file"
        />
        <label
          htmlFor="dc-enrich-file"
          className="flex items-center gap-2 h-9 px-4 border border-border rounded-sm text-sm font-medium font-sans hover:bg-muted cursor-pointer"
        >
          <Upload className="w-4 h-4" /> Choose CSV
        </label>
        {fileName ? (
          <span className="flex items-center gap-2 text-sm text-foreground font-sans">
            <FileText className="w-4 h-4 text-muted-foreground" />
            {fileName}
            <button
              type="button"
              onClick={clearFile}
              className="text-muted-foreground hover:text-[#A33232]"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground font-sans italic">
            No file chosen
          </span>
        )}
      </div>

      {/* Step 2 / 3 — preview then commit */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => previewMut.mutate({ data: input })}
          disabled={!canPreview}
          className="h-9 px-5 border border-accent text-accent rounded-sm text-sm font-medium font-sans hover:bg-accent/10 disabled:opacity-40"
        >
          {previewMut.isPending ? "Previewing…" : "Preview (dry-run)"}
        </button>
        <button
          type="button"
          onClick={() => commitMut.mutate({ data: input })}
          disabled={!canCommit}
          className="h-9 px-5 bg-accent text-accent-foreground rounded-sm text-sm font-medium font-sans hover:opacity-90 disabled:opacity-40"
        >
          {commitMut.isPending ? "Committing…" : "Commit changes"}
        </button>
        {summary && !summary.commit && summary.diffs.length === 0 && (
          <span className="text-sm text-muted-foreground font-sans italic">
            No changes to apply.
          </span>
        )}
        {committed && (
          <span className="text-sm text-[#1B6B7A] font-sans">
            Applied {summary?.updatedRows ?? 0} facilities · {summary?.fieldWrites ?? 0} field updates.
          </span>
        )}
      </div>

      {summary && <SummaryView summary={summary} diffsByField={diffsByField} committed={committed} />}
    </div>
  );
}

function SummaryView({
  summary,
  diffsByField,
  committed,
}: {
  summary: EnrichmentSummary;
  diffsByField: [string, EnrichmentSummary["diffs"]][];
  committed: boolean;
}) {
  return (
    <div className="space-y-5 border-t border-border pt-5">
      {/* Match counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Records" value={summary.totalRecords} />
        <Stat label="Matched" value={summary.matched} accent="#1B6B7A" />
        <Stat label="Unmatched" value={summary.unmatched} accent="#363636" />
        <Stat label="Ambiguous" value={summary.ambiguous} accent="#A33232" />
        <Stat label="Duplicate matches" value={summary.duplicateMatches} accent="#A33232" />
      </div>

      {/* Field coverage */}
      {summary.coverage.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
            Field coverage in file
          </h3>
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Present</th>
                  <th className="px-3 py-2 font-medium">Unmappable</th>
                  <th className="px-3 py-2 font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {summary.coverage.map((c) => (
                  <tr key={c.field} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 text-foreground">
                      {FIELD_LABELS[c.field] ?? c.field}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {c.present} / {c.total}
                    </td>
                    <td className="px-3 py-2 text-foreground">{c.unmappable}</td>
                    <td className="px-3 py-2 text-foreground">{c.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Proposed / applied changes by field */}
      {diffsByField.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
            {committed ? "Applied changes" : "Proposed changes"} ({summary.diffs.length})
          </h3>
          <div className="space-y-4">
            {diffsByField.map(([field, diffs]) => (
              <div key={field} className="border border-border rounded-sm overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-xs font-medium text-primary font-sans uppercase tracking-wide">
                  {FIELD_LABELS[field] ?? field} · {diffs.length}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-sans">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                        <th className="px-3 py-2 font-medium">Facility</th>
                        <th className="px-3 py-2 font-medium">Current</th>
                        <th className="px-3 py-2 font-medium">Proposed</th>
                        <th className="px-3 py-2 font-medium">Source ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffs.map((d, i) => (
                        <tr key={`${d.facilityId}-${i}`} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 text-foreground">{d.facilityName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fmtVal(d.current)}</td>
                          <td className="px-3 py-2 text-foreground font-medium">{fmtVal(d.proposed)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.sourceRef || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched — analyst must resolve these by hand (no fabrication) */}
      {summary.unmatchedRecords.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
            Unmatched records ({summary.unmatched})
          </h3>
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 font-medium">City</th>
                </tr>
              </thead>
              <tbody>
                {summary.unmatchedRecords.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 text-foreground">{r.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.country || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.city || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ambiguous — matched more than one facility; analyst disambiguates */}
      {summary.ambiguousRecords.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
            Ambiguous records ({summary.ambiguous})
          </h3>
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 font-medium">Candidate IDs</th>
                </tr>
              </thead>
              <tbody>
                {summary.ambiguousRecords.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 text-foreground">{r.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.country || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.candidateIds.map((id) => `#${id}`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = "#465bff" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className="text-xl font-serif font-bold text-primary mt-1">{value}</div>
    </div>
  );
}
