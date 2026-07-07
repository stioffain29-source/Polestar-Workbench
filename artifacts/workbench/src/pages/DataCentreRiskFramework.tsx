import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDataCentreCountryRisk,
  useCreateDataCentreCountryRisk,
  useUpdateDataCentreCountryRisk,
  useDeleteDataCentreCountryRisk,
  getListDataCentreCountryRiskQueryKey,
  useListDataCentreFacilities,
  type DataCentreCountryRisk,
  type DataCentreCountryRiskInput,
  type DataCentreCountryRiskDimensions,
  type DataCentreRiskDimension,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { CountryRiskStrip } from "../components/CountryRiskStrip";
import {
  DATA_CENTRE_RISK_DIMENSIONS,
  RISK_RATINGS,
  type DataCentreRiskDimensionKey,
} from "../lib/dataCentreRisk";

// Owner-gated editor for the per-country DATA-CENTRE RISK FRAMEWORK.
//
// One row per country carries an analyst assessment across 16 fixed dimensions.
// STRICT no-fabrication: a dimension with no rating is omitted on save and reads
// "not reported". Auto-seeded ratings carry an amber "provisional" badge until
// the analyst reviews and saves, which clears the flag. `overridden` records that
// the analyst moved a seeded rating away from its seed. `seededFrom` provenance
// is preserved across edits.

type DimForm = {
  rating: string; // "" = not reported
  rationale: string;
  source: string;
  analystNote: string;
  provisional: boolean;
  overridden: boolean;
  seededFrom: string | null;
};

const EMPTY_DIM: DimForm = {
  rating: "",
  rationale: "",
  source: "",
  analystNote: "",
  provisional: false,
  overridden: false,
  seededFrom: null,
};

type FormState = {
  country: string;
  overallNote: string;
  createdBy: string;
  dims: Record<DataCentreRiskDimensionKey, DimForm>;
};

function emptyDims(): Record<DataCentreRiskDimensionKey, DimForm> {
  const out = {} as Record<DataCentreRiskDimensionKey, DimForm>;
  for (const { key } of DATA_CENTRE_RISK_DIMENSIONS) out[key] = { ...EMPTY_DIM };
  return out;
}

const EMPTY_FORM: FormState = {
  country: "",
  overallNote: "",
  createdBy: "",
  dims: emptyDims(),
};

function riskToForm(r: DataCentreCountryRisk): FormState {
  const dims = emptyDims();
  const src = (r.dimensions ?? {}) as DataCentreCountryRiskDimensions;
  for (const { key } of DATA_CENTRE_RISK_DIMENSIONS) {
    const d = src[key] as DataCentreRiskDimension | undefined;
    if (!d) continue;
    dims[key] = {
      rating: d.rating ?? "",
      rationale: d.rationale ?? "",
      source: d.source ?? "",
      analystNote: d.analystNote ?? "",
      provisional: Boolean(d.provisional),
      overridden: Boolean(d.overridden),
      seededFrom: d.seededFrom ?? null,
    };
  }
  return {
    country: r.country ?? "",
    overallNote: r.overallNote ?? "",
    createdBy: r.createdBy ?? "",
    dims,
  };
}

// Build the API payload. A dimension is included only if it carries a rating OR
// any text — otherwise it is omitted (stays "not reported", never fabricated).
// Saving = analyst review, so `provisional` is cleared. `overridden` is set once
// the analyst moves a seeded rating away from its seed. `seededFrom` is kept.
function formToInput(f: FormState): DataCentreCountryRiskInput {
  const dimensions: DataCentreCountryRiskDimensions = {};
  for (const { key } of DATA_CENTRE_RISK_DIMENSIONS) {
    const d = f.dims[key];
    const rationale = d.rationale.trim();
    const source = d.source.trim();
    const analystNote = d.analystNote.trim();
    const hasContent = Boolean(d.rating || rationale || source || analystNote);
    if (!hasContent) continue;
    dimensions[key] = {
      rating: d.rating ? (d.rating as DataCentreRiskDimension["rating"]) : null,
      rationale,
      source,
      analystNote,
      // Saving = analyst review, so the provisional flag is always cleared.
      // `overridden` is tracked live in the rating select (set true once a
      // seeded rating is moved) and preserved here.
      provisional: false,
      overridden: d.overridden,
      seededFrom: d.seededFrom ?? null,
    };
  }
  const overallNote = f.overallNote.trim();
  const createdBy = f.createdBy.trim();
  return {
    country: f.country.trim(),
    dimensions,
    overallNote: overallNote || undefined,
    createdBy: createdBy || undefined,
  };
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full h-9 bg-white border border-border rounded-sm px-2.5 text-sm font-sans focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent";

export default function DataCentreRiskFramework() {
  const queryClient = useQueryClient();
  const { data: risks = [], isLoading } = useListDataCentreCountryRisk();
  const { data: facilities = [] } = useListDataCentreFacilities();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  // Country picker: distinct facility countries + countries already assessed.
  const countryOptions = useMemo(() => {
    const s = new Set<string>();
    facilities.forEach((f) => { if (f.country) s.add(f.country); });
    risks.forEach((r) => { if (r.country) s.add(r.country); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [facilities, risks]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDataCentreCountryRiskQueryKey() });

  const createMut = useCreateDataCentreCountryRisk({
    mutation: {
      onSuccess: () => { invalidate(); closeForm(); },
      onError: (e) => setError(String((e as Error)?.message ?? "Create failed")),
    },
  });
  const updateMut = useUpdateDataCentreCountryRisk({
    mutation: {
      onSuccess: () => { invalidate(); closeForm(); },
      onError: (e) => setError(String((e as Error)?.message ?? "Update failed")),
    },
  });
  const deleteMut = useDeleteDataCentreCountryRisk({
    mutation: { onSuccess: () => invalidate() },
  });

  function setDim(key: DataCentreRiskDimensionKey, patch: Partial<DimForm>) {
    setForm((s) => ({ ...s, dims: { ...s.dims, [key]: { ...s.dims[key], ...patch } } }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }
  function openEdit(r: DataCentreCountryRisk) {
    setEditingId(r.id);
    setForm(riskToForm(r));
    setError(null);
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function submit() {
    setError(null);
    if (!form.country.trim()) {
      setError("Country is required.");
      return;
    }
    const payload = formToInput(form);
    if (editingId != null) {
      // Update is a full-object replace, so send an explicit null (not the
      // omitted `undefined` that `formToInput` uses) when the overall note is
      // blanked — otherwise a previously-saved note can never be cleared.
      updateMut.mutate({
        id: editingId,
        data: { ...payload, overallNote: form.overallNote.trim() || null },
      });
    } else {
      createMut.mutate({ data: payload });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
            Registry
          </div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">
            Data Centre Country Risk
          </h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Analyst-maintained per-country risk framework across sixteen fixed
            dimensions. A dimension with no rating reads "not reported" — never
            guessed. Auto-seeded ratings are flagged provisional until reviewed.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 h-9 px-4 bg-accent text-accent-foreground rounded-sm text-sm font-medium font-sans hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add Country
        </button>
      </div>

      {/* Editor */}
      {showForm && (
        <div className="bg-white border border-border rounded-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-serif font-bold text-primary uppercase tracking-tight">
              {editingId != null ? "Edit Country Risk" : "New Country Risk"}
            </h2>
            <button
              type="button"
              onClick={closeForm}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {error && (
            <div className="mb-4 px-3 py-2 text-sm text-[#A33232] bg-[#A33232]/10 border border-[#A33232]/30 rounded-sm font-sans">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Labelled label="Country *">
              <input
                className={inputCls}
                list="dc-risk-country-list"
                value={form.country}
                onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
              />
              <datalist id="dc-risk-country-list">
                {countryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Labelled>
            <Labelled label="Recorded By">
              <input
                className={inputCls}
                value={form.createdBy}
                onChange={(e) => setForm((s) => ({ ...s, createdBy: e.target.value }))}
              />
            </Labelled>
          </div>

          <div className="mt-3">
            <Labelled label="Overall Note">
              <textarea
                rows={2}
                className="w-full bg-white border border-border rounded-sm px-2.5 py-2 text-sm font-sans focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                value={form.overallNote}
                onChange={(e) => setForm((s) => ({ ...s, overallNote: e.target.value }))}
              />
            </Labelled>
          </div>

          {/* 16 dimension rows */}
          <div className="mt-5 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
              Risk Dimensions
            </div>
            {DATA_CENTRE_RISK_DIMENSIONS.map(({ key, label }) => {
              const d = form.dims[key];
              const showProvisional = d.provisional && Boolean(d.rating) && !d.overridden;
              return (
                <div key={key} className="border border-border rounded-sm p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-medium text-foreground">{label}</div>
                    {showProvisional && (
                      <span className="text-[10px] uppercase tracking-widest text-[#B26B00] bg-[#B26B00]/10 border border-[#B26B00]/30 rounded-sm px-1.5 py-0.5">
                        Provisional — pending review
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <label className="block">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
                        Rating
                      </div>
                      <select
                        className={inputCls}
                        value={d.rating}
                        onChange={(e) => {
                          const rating = e.target.value;
                          setDim(key, {
                            rating,
                            // A manual rating change on a seeded dimension marks
                            // it overridden and clears the provisional flag.
                            overridden: d.seededFrom ? true : d.overridden,
                            provisional: d.seededFrom ? false : d.provisional,
                          });
                        }}
                      >
                        <option value="">— Not reported</option>
                        {RISK_RATINGS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block md:col-span-3">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
                        Rationale
                      </div>
                      <input
                        className={inputCls}
                        value={d.rationale}
                        onChange={(e) => setDim(key, { rationale: e.target.value })}
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
                        Source
                      </div>
                      <input
                        className={inputCls}
                        value={d.source}
                        onChange={(e) => setDim(key, { source: e.target.value })}
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1">
                        Analyst Note
                      </div>
                      <input
                        className={inputCls}
                        value={d.analystNote}
                        onChange={(e) => setDim(key, { analystNote: e.target.value })}
                      />
                    </label>
                  </div>
                  {d.seededFrom && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground font-sans">
                      Seeded from {d.seededFrom}
                      {d.overridden ? " · analyst override" : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="h-9 px-5 bg-accent text-accent-foreground rounded-sm text-sm font-medium font-sans hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId != null ? "Save Changes" : "Create"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="h-9 px-5 border border-border rounded-sm text-sm font-medium font-sans hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-serif font-bold text-primary uppercase tracking-wide">
            Assessed Countries
          </h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : risks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground italic">
            No country assessments on file. Add one to begin.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {risks.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <CountryRiskStrip risk={r} showCountry />
                  {r.overallNote && (
                    <div className="mt-1.5 text-xs text-muted-foreground font-sans">
                      {r.overallNote}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="text-muted-foreground hover:text-accent"
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete risk assessment for "${r.country}"? This cannot be undone.`)) {
                        deleteMut.mutate({ id: r.id });
                      }
                    }}
                    className="text-muted-foreground hover:text-[#A33232]"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
