import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDataCentreFacilities,
  useCreateDataCentreFacility,
  useUpdateDataCentreFacility,
  useDeleteDataCentreFacility,
  getListDataCentreFacilitiesQueryKey,
  DataCentreStatus,
  DataCentrePlanningRisk,
  type DataCentreFacility,
  type DataCentreFacilityInput,
} from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Plus, Pencil, Trash2, X, ExternalLink } from "lucide-react";

// Owner-gated admin UI for the analyst-maintained Data Centre facility REGISTRY.
//
// CRITICAL PRODUCT RULE: a registry facility is NEVER an incident. This page
// only ever reads/writes the isolated `data_centre_facilities` table via the
// owner-gated CRUD API; nothing here creates, removes or inflates an incident.
// The optional Linked Incident ID is a pure analyst association.
//
// STRICT no-fabrication: blank fields stay blank ("not reported" on read
// surfaces). Status + planning risk are the fixed constrained vocabularies.

const STATUSES = Object.values(DataCentreStatus);
const PLANNING_RISKS = Object.values(DataCentrePlanningRisk);

type FormState = {
  name: string;
  operator: string;
  country: string;
  region: string;
  city: string;
  latitude: string;
  longitude: string;
  status: string;
  planningRisk: string;
  capacityMw: string;
  itLoadMw: string;
  announcedDate: string;
  expectedOnlineDate: string;
  commissionedDate: string;
  notes: string;
  sourceUrl: string;
  linkedIncidentId: string;
  createdBy: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  operator: "",
  country: "",
  region: "",
  city: "",
  latitude: "",
  longitude: "",
  status: "Unknown",
  planningRisk: "Unknown",
  capacityMw: "",
  itLoadMw: "",
  announcedDate: "",
  expectedOnlineDate: "",
  commissionedDate: "",
  notes: "",
  sourceUrl: "",
  linkedIncidentId: "",
  createdBy: "",
};

function facilityToForm(f: DataCentreFacility): FormState {
  const ymd = (v?: string | null) => {
    if (!v) return "";
    try {
      return format(parseISO(v), "yyyy-MM-dd");
    } catch {
      return "";
    }
  };
  return {
    name: f.name ?? "",
    operator: f.operator ?? "",
    country: f.country ?? "",
    region: f.region ?? "",
    city: f.city ?? "",
    latitude: f.latitude != null ? String(f.latitude) : "",
    longitude: f.longitude != null ? String(f.longitude) : "",
    status: f.status ?? "Unknown",
    planningRisk: f.planningRisk ?? "Unknown",
    capacityMw: f.capacityMw != null ? String(f.capacityMw) : "",
    itLoadMw: f.itLoadMw != null ? String(f.itLoadMw) : "",
    announcedDate: ymd(f.announcedDate),
    expectedOnlineDate: ymd(f.expectedOnlineDate),
    commissionedDate: ymd(f.commissionedDate),
    notes: f.notes ?? "",
    sourceUrl: f.sourceUrl ?? "",
    linkedIncidentId: f.linkedIncidentId != null ? String(f.linkedIncidentId) : "",
    createdBy: f.createdBy ?? "",
  };
}

// Build the API payload from the form. Empty strings become undefined so blank
// optional fields are omitted (never fabricated). Numeric/date strings are
// coerced; invalid numbers are dropped rather than sent as NaN.
function formToInput(f: FormState): DataCentreFacilityInput {
  const num = (v: string): number | undefined => {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };
  const iso = (v: string): string | undefined => {
    const t = v.trim();
    if (!t) return undefined;
    const d = new Date(`${t}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const str = (v: string): string | undefined => {
    const t = v.trim();
    return t ? t : undefined;
  };
  return {
    name: f.name.trim(),
    operator: str(f.operator),
    country: f.country.trim(),
    region: str(f.region),
    city: str(f.city),
    latitude: num(f.latitude),
    longitude: num(f.longitude),
    status: f.status as DataCentreFacilityInput["status"],
    planningRisk: f.planningRisk as DataCentreFacilityInput["planningRisk"],
    capacityMw: num(f.capacityMw),
    itLoadMw: num(f.itLoadMw),
    announcedDate: iso(f.announcedDate),
    expectedOnlineDate: iso(f.expectedOnlineDate),
    commissionedDate: iso(f.commissionedDate),
    notes: str(f.notes),
    sourceUrl: str(f.sourceUrl),
    linkedIncidentId: num(f.linkedIncidentId),
    createdBy: str(f.createdBy),
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
const selectCls = inputCls;

export default function DataCentreRegistry() {
  const queryClient = useQueryClient();
  const { data: facilities = [], isLoading } = useListDataCentreFacilities();
  const search = useSearch();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  // Deep link from the facility overlay map: `?facility=<id>` opens that
  // facility's full record. Guarded so it only fires once the target row is
  // loaded, and never re-fires after the analyst navigates within the page.
  const deepLinkHandledRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const requested = Number(new URLSearchParams(search).get("facility"));
    if (!Number.isFinite(requested) || requested <= 0) return;
    if (deepLinkHandledRef.current === requested) return;
    const target = facilities.find((f) => f.id === requested);
    if (!target) return;
    deepLinkHandledRef.current = requested;
    setEditingId(target.id);
    setForm(facilityToForm(target));
    setError(null);
    setShowForm(true);
    // Scroll the matching row into view and briefly highlight it so the
    // analyst gets visual confirmation of which record they landed on.
    setHighlightedId(target.id);
    requestAnimationFrame(() => {
      rowRefs.current.get(target.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 2600);
  }, [search, facilities]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDataCentreFacilitiesQueryKey() });

  const createMut = useCreateDataCentreFacility({
    mutation: {
      onSuccess: () => {
        invalidate();
        closeForm();
      },
      onError: (e) => setError(String((e as Error)?.message ?? "Create failed")),
    },
  });
  const updateMut = useUpdateDataCentreFacility({
    mutation: {
      onSuccess: () => {
        invalidate();
        closeForm();
      },
      onError: (e) => setError(String((e as Error)?.message ?? "Update failed")),
    },
  });
  const deleteMut = useDeleteDataCentreFacility({
    mutation: { onSuccess: () => invalidate() },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }
  function openEdit(f: DataCentreFacility) {
    setEditingId(f.id);
    setForm(facilityToForm(f));
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
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.country.trim()) {
      setError("Country is required.");
      return;
    }
    const payload = formToInput(form);
    if (editingId != null) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate({ data: payload });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;

  // Registry summary — counts only, never fabricated.
  const summary = useMemo(() => {
    const byStatus = new Map<string, number>();
    const countries = new Set<string>();
    let movers = 0;
    for (const f of facilities) {
      byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
      if (f.country) countries.add(f.country);
      if (f.statusChanged) movers += 1;
    }
    return {
      total: facilities.length,
      countries: countries.size,
      operational: byStatus.get("Operational") ?? 0,
      movers,
    };
  }, [facilities]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
            Registry
          </div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">
            Data Centre Registry
          </h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Analyst-maintained catalogue of tracked data-centre facilities. A
            facility is never an incident — it lives in its own registry and can
            never inflate an incident count.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 h-9 px-4 bg-accent text-accent-foreground rounded-sm text-sm font-medium font-sans hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add Facility
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Facilities Tracked" value={summary.total} accent="#465bff" />
        <SummaryTile label="Countries" value={summary.countries} accent="#363636" />
        <SummaryTile label="Operational" value={summary.operational} accent="#1B6B7A" />
        <SummaryTile label="Recent Status Movers" value={summary.movers} accent="#A33232" />
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-border rounded-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-serif font-bold text-primary uppercase tracking-tight">
              {editingId != null ? "Edit Facility" : "New Facility"}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <Labelled label="Name *">
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Labelled>
            <Labelled label="Operator">
              <input className={inputCls} value={form.operator} onChange={(e) => set("operator", e.target.value)} />
            </Labelled>
            <Labelled label="Country *">
              <input className={inputCls} value={form.country} onChange={(e) => set("country", e.target.value)} />
            </Labelled>
            <Labelled label="Region">
              <input className={inputCls} value={form.region} onChange={(e) => set("region", e.target.value)} />
            </Labelled>
            <Labelled label="City">
              <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} />
            </Labelled>
            <Labelled label="Status">
              <select className={selectCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Labelled>
            <Labelled label="Planning Risk">
              <select className={selectCls} value={form.planningRisk} onChange={(e) => set("planningRisk", e.target.value)}>
                {PLANNING_RISKS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Labelled>
            <Labelled label="Latitude">
              <input className={inputCls} value={form.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" />
            </Labelled>
            <Labelled label="Longitude">
              <input className={inputCls} value={form.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" />
            </Labelled>
            <Labelled label="Capacity (MW)">
              <input className={inputCls} value={form.capacityMw} onChange={(e) => set("capacityMw", e.target.value)} inputMode="decimal" />
            </Labelled>
            <Labelled label="IT Load (MW)">
              <input className={inputCls} value={form.itLoadMw} onChange={(e) => set("itLoadMw", e.target.value)} inputMode="decimal" />
            </Labelled>
            <Labelled label="Linked Incident ID">
              <input className={inputCls} value={form.linkedIncidentId} onChange={(e) => set("linkedIncidentId", e.target.value)} inputMode="numeric" />
            </Labelled>
            <Labelled label="Announced Date">
              <input type="date" className={inputCls} value={form.announcedDate} onChange={(e) => set("announcedDate", e.target.value)} />
            </Labelled>
            <Labelled label="Expected Online">
              <input type="date" className={inputCls} value={form.expectedOnlineDate} onChange={(e) => set("expectedOnlineDate", e.target.value)} />
            </Labelled>
            <Labelled label="Commissioned Date">
              <input type="date" className={inputCls} value={form.commissionedDate} onChange={(e) => set("commissionedDate", e.target.value)} />
            </Labelled>
            <Labelled label="Source URL">
              <input className={inputCls} value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
            </Labelled>
            <Labelled label="Recorded By">
              <input className={inputCls} value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} />
            </Labelled>
          </div>
          <div className="mt-3">
            <Labelled label="Notes">
              <textarea
                rows={3}
                className="w-full bg-white border border-border rounded-sm px-2.5 py-2 text-sm font-sans focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Labelled>
          </div>
          <div className="flex items-center gap-3 mt-5">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="h-9 px-5 bg-accent text-accent-foreground rounded-sm text-sm font-medium font-sans hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId != null ? "Save Changes" : "Create Facility"}
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

      {/* Table */}
      <div className="bg-white border border-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-serif font-bold text-primary uppercase tracking-wide">
            Tracked Facilities
          </h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : facilities.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground italic">
            No facilities on file. Add one to begin tracking.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-4 py-2 font-medium">Country</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Planning Risk</th>
                  <th className="px-4 py-2 font-medium">Capacity</th>
                  <th className="px-4 py-2 font-medium">Linked</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {facilities.map((f) => (
                  <tr
                    key={f.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(f.id, el);
                      else rowRefs.current.delete(f.id);
                    }}
                    className={`border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors duration-700 ${
                      highlightedId === f.id ? "bg-accent/15" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{f.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.operator || "Operator not reported"}
                        {f.city ? ` · ${f.city}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{f.country}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-foreground">{f.status}</span>
                      {f.statusChanged && f.previousStatus && (
                        <div className="text-[10px] text-[#A33232] uppercase tracking-wide">
                          moved from {f.previousStatus}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{f.planningRisk}</td>
                    <td className="px-4 py-2.5 text-foreground">
                      {f.capacityMw != null ? `${f.capacityMw} MW` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {f.linkedIncidentId != null ? `#${f.linkedIncidentId}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {f.sourceUrl && (
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-accent"
                            aria-label="Open source"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(f)}
                          className="text-muted-foreground hover:text-accent"
                          aria-label="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete "${f.name}"? This cannot be undone.`)) {
                              deleteMut.mutate({ id: f.id });
                            }
                          }}
                          className="text-muted-foreground hover:text-[#A33232]"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className="text-2xl font-serif font-bold text-primary mt-1">{value}</div>
    </div>
  );
}
