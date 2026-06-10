import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetSpotReport,
  useCreateSpotReport,
  useUpdateSpotReport,
  useDeleteSpotReport,
  useAppendSpotReportExport,
  useListIncidents,
  getGetSpotReportQueryKey,
  getListSpotReportsQueryKey,
  type SpotReport,
  type Incident,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, FileText, FileType, FileDown, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SEVERITY_LEVELS, CONFIDENCE_LEVELS, TOPIC_LABELS } from "@/lib/topics";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import {
  checkSpotReportQuality,
  spotLocationLabel,
  SPOT_STATUSES,
  type QualityResult,
} from "@/lib/spotReport";
import { downloadSpotReportDocx, downloadSpotReportText } from "@/lib/spotReportExport";
import SpotReportPreview from "@/components/SpotReportPreview";
import { useToast } from "@/hooks/use-toast";

type ExportFormat = "pdf" | "docx" | "text";

interface FormState {
  title: string;
  status: string;
  reportDate: string;
  incidentDate: string;
  country: string;
  province: string;
  city: string;
  latitude: string;
  longitude: string;
  category: string;
  severity: string;
  bluf: string;
  incidentDetails: string;
  currentSituation: string;
  operationalImpact: string;
  assessment: string;
  outlook: string;
  recommendedActions: string;
  analystNotes: string;
  confidenceLevel: string;
  internalSourceNotes: string;
  showSourcesInExport: boolean;
  linkedIncidentIds: number[];
  mapEnabled: boolean;
  affectedRadiusKm: string;
  createdBy: string;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

function emptyForm(): FormState {
  return {
    title: "",
    status: "draft",
    reportDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    incidentDate: "",
    country: "",
    province: "",
    city: "",
    latitude: "",
    longitude: "",
    category: "",
    severity: "",
    bluf: "",
    incidentDetails: "",
    currentSituation: "",
    operationalImpact: "",
    assessment: "",
    outlook: "",
    recommendedActions: "",
    analystNotes: "",
    confidenceLevel: "",
    internalSourceNotes: "",
    showSourcesInExport: false,
    linkedIncidentIds: [],
    mapEnabled: false,
    affectedRadiusKm: "",
    createdBy: "",
  };
}

function formFromReport(r: SpotReport): FormState {
  return {
    title: r.title ?? "",
    status: r.status ?? "draft",
    reportDate: toLocalInput(r.reportDate) || format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    incidentDate: toLocalInput(r.incidentDate),
    country: r.country ?? "",
    province: r.province ?? "",
    city: r.city ?? "",
    latitude: r.latitude != null ? String(r.latitude) : "",
    longitude: r.longitude != null ? String(r.longitude) : "",
    category: r.category ?? "",
    severity: r.severity ?? "",
    bluf: r.bluf ?? "",
    incidentDetails: r.incidentDetails ?? "",
    currentSituation: r.currentSituation ?? "",
    operationalImpact: r.operationalImpact ?? "",
    assessment: r.assessment ?? "",
    outlook: r.outlook ?? "",
    recommendedActions: r.recommendedActions ?? "",
    analystNotes: r.analystNotes ?? "",
    confidenceLevel: r.confidenceLevel ?? "",
    internalSourceNotes: r.internalSourceNotes ?? "",
    showSourcesInExport: r.showSourcesInExport ?? false,
    linkedIncidentIds: r.linkedIncidentIds ?? [],
    mapEnabled: r.mapEnabled ?? false,
    affectedRadiusKm: r.affectedRadiusKm != null ? String(r.affectedRadiusKm) : "",
    createdBy: r.createdBy ?? "",
  };
}

export default function SpotReportEditor() {
  const [, params] = useRoute("/spot-reports/:id");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const idParam = params?.id;
  const isNew = !idParam || idParam === "new";
  const id = isNew ? null : parseInt(idParam, 10);

  const { data: report, isLoading } = useGetSpotReport(id ?? 0, {
    query: { enabled: !isNew && id != null },
  } as never);
  const { data: allIncidents = [] } = useListIncidents({});

  const create = useCreateSpotReport();
  const update = useUpdateSpotReport();
  const del = useDeleteSpotReport();
  const appendExport = useAppendSpotReportExport();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [quality, setQuality] = useState<{
    open: boolean;
    format: ExportFormat | null;
    result: QualityResult;
  }>({ open: false, format: null, result: { errors: [], warnings: [] } });
  const [incidentSearch, setIncidentSearch] = useState("");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const initId = useRef<number | null>(null);
  const prefilled = useRef(false);

  // Load saved report into the form once (re-runs if the id changes).
  useEffect(() => {
    if (report && initId.current !== report.id) {
      setForm(formFromReport(report));
      initId.current = report.id;
    }
  }, [report]);

  // Pre-fill a NEW report from incident(s) passed via query string.
  useEffect(() => {
    if (!isNew || prefilled.current) return;
    const sp = new URLSearchParams(window.location.search);
    const idsParam = sp.get("incidentIds") || sp.get("incidentId");
    if (!idsParam) {
      prefilled.current = true;
      return;
    }
    const ids = idsParam
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      prefilled.current = true;
      return;
    }
    if (allIncidents.length === 0) return; // wait for incident data
    const linked = allIncidents.filter((i) => ids.includes(i.id));
    if (linked.length === 0) {
      prefilled.current = true;
      return;
    }
    const primary = linked[0];
    setForm((f) => ({
      ...f,
      linkedIncidentIds: ids,
      title: f.title || `Spot Report: ${(primary.displayTitle?.trim() || primary.title).trim()}`,
      country: f.country || primary.country || "",
      city: f.city || primary.location || "",
      latitude: f.latitude || (primary.latitude != null ? String(primary.latitude) : ""),
      longitude: f.longitude || (primary.longitude != null ? String(primary.longitude) : ""),
      severity: f.severity || primary.severity || "",
      category: f.category || (TOPIC_LABELS[primary.topic] ?? ""),
      incidentDate: f.incidentDate || toLocalInput(primary.occurredAt),
      bluf: f.bluf || primary.summary || "",
      mapEnabled: true,
    }));
    prefilled.current = true;
  }, [isNew, allIncidents]);

  const linkedIncidents = useMemo(
    () => allIncidents.filter((i) => form.linkedIncidentIds.includes(i.id)),
    [allIncidents, form.linkedIncidentIds],
  );

  const previewReport = useMemo<SpotReport>(() => {
    const num = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: report?.id ?? 0,
      title: form.title,
      status: form.status as SpotReport["status"],
      reportDate: form.reportDate
        ? new Date(form.reportDate).toISOString()
        : new Date().toISOString(),
      incidentDate: form.incidentDate ? new Date(form.incidentDate).toISOString() : null,
      country: form.country || null,
      province: form.province || null,
      city: form.city || null,
      latitude: num(form.latitude),
      longitude: num(form.longitude),
      category: form.category || null,
      severity: (form.severity || null) as SpotReport["severity"],
      bluf: form.bluf || null,
      incidentDetails: form.incidentDetails || null,
      currentSituation: form.currentSituation || null,
      operationalImpact: form.operationalImpact || null,
      assessment: form.assessment || null,
      outlook: form.outlook || null,
      recommendedActions: form.recommendedActions || null,
      analystNotes: form.analystNotes || null,
      confidenceLevel: (form.confidenceLevel || null) as SpotReport["confidenceLevel"],
      internalSourceNotes: form.internalSourceNotes || null,
      showSourcesInExport: form.showSourcesInExport,
      linkedIncidentIds: form.linkedIncidentIds,
      mapEnabled: form.mapEnabled,
      affectedRadiusKm: num(form.affectedRadiusKm),
      createdBy: form.createdBy || null,
      exportHistory: report?.exportHistory ?? [],
      createdAt: report?.createdAt ?? new Date().toISOString(),
      lastEditedAt: report?.lastEditedAt ?? new Date().toISOString(),
    };
  }, [form, report]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function buildData(forCreate: boolean): Record<string, unknown> {
    const num = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const out: Record<string, unknown> = {
      title: form.title.trim(),
      status: form.status,
      reportDate: form.reportDate
        ? new Date(form.reportDate).toISOString()
        : new Date().toISOString(),
      showSourcesInExport: form.showSourcesInExport,
      mapEnabled: form.mapEnabled,
      linkedIncidentIds: form.linkedIncidentIds,
    };

    const textFields: Array<[keyof FormState, string]> = [
      ["country", form.country],
      ["province", form.province],
      ["city", form.city],
      ["category", form.category],
      ["bluf", form.bluf],
      ["incidentDetails", form.incidentDetails],
      ["currentSituation", form.currentSituation],
      ["operationalImpact", form.operationalImpact],
      ["assessment", form.assessment],
      ["outlook", form.outlook],
      ["recommendedActions", form.recommendedActions],
      ["analystNotes", form.analystNotes],
      ["internalSourceNotes", form.internalSourceNotes],
      ["createdBy", form.createdBy],
    ];
    for (const [key, raw] of textFields) {
      const v = raw.trim();
      if (forCreate) {
        if (v) out[key] = v;
      } else {
        out[key] = v;
      }
    }

    // Enum fields: on CREATE omit when empty (the create contract is
    // non-nullable); on UPDATE send null to CLEAR so an analyst can reset
    // severity/confidence back to "—" without the old value silently sticking.
    if (forCreate) {
      if (form.severity) out.severity = form.severity;
      if (form.confidenceLevel) out.confidenceLevel = form.confidenceLevel;
    } else {
      out.severity = form.severity ? form.severity : null;
      out.confidenceLevel = form.confidenceLevel ? form.confidenceLevel : null;
    }

    const incidentDate = form.incidentDate
      ? new Date(form.incidentDate).toISOString()
      : null;
    const lat = num(form.latitude);
    const lng = num(form.longitude);
    const rad = num(form.affectedRadiusKm);
    if (forCreate) {
      if (incidentDate) out.incidentDate = incidentDate;
      if (lat !== null) out.latitude = lat;
      if (lng !== null) out.longitude = lng;
      if (rad !== null) out.affectedRadiusKm = rad;
    } else {
      out.incidentDate = incidentDate;
      out.latitude = lat;
      out.longitude = lng;
      out.affectedRadiusKm = rad;
    }
    return out;
  }

  function handleSave() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (isNew) {
      create.mutate(
        { data: buildData(true) as never },
        {
          onSuccess: (created) => {
            qc.invalidateQueries({ queryKey: getListSpotReportsQueryKey() });
            toast({ title: "Spot report created" });
            setLocation(`/spot-reports/${(created as SpotReport).id}`);
          },
          onError: () => toast({ title: "Failed to create", variant: "destructive" }),
        },
      );
    } else if (id != null) {
      update.mutate(
        { id, data: buildData(false) as never },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetSpotReportQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListSpotReportsQueryKey() });
            toast({ title: "Saved" });
          },
          onError: () => toast({ title: "Failed to save", variant: "destructive" }),
        },
      );
    }
  }

  async function doExport(fmt: ExportFormat) {
    const slug = slugifyForFilename(previewReport.title || "spot-report");
    try {
      if (fmt === "pdf") {
        const el = previewRef.current?.querySelector(".print-report") as HTMLElement | null;
        if (!el) {
          toast({ title: "Preview not ready", variant: "destructive" });
          return;
        }
        await exportElementToPdf(el, `${slug}.pdf`);
      } else if (fmt === "docx") {
        await downloadSpotReportDocx(previewReport, linkedIncidents, `${slug}.docx`);
      } else {
        downloadSpotReportText(previewReport, linkedIncidents, `${slug}.txt`);
      }
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
      return;
    }
    if (id != null) {
      appendExport.mutate(
        { id, data: { format: fmt } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetSpotReportQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListSpotReportsQueryKey() });
          },
        },
      );
    }
  }

  function attemptExport(fmt: ExportFormat) {
    if (id == null) {
      toast({ title: "Save the report before exporting", variant: "destructive" });
      return;
    }
    const result = checkSpotReportQuality(previewReport, linkedIncidents);
    if (result.errors.length === 0 && result.warnings.length === 0) {
      doExport(fmt);
      return;
    }
    setQuality({ open: true, format: fmt, result });
  }

  function runQualityCheck() {
    setQuality({
      open: true,
      format: null,
      result: checkSpotReportQuality(previewReport, linkedIncidents),
    });
  }

  const searchResults = useMemo(() => {
    const q = incidentSearch.trim().toLowerCase();
    const base = allIncidents.filter((i) => !form.linkedIncidentIds.includes(i.id));
    if (!q) return base.slice(0, 8);
    return base
      .filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q) ||
          (i.country ?? "").toLowerCase().includes(q) ||
          (i.location ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [incidentSearch, allIncidents, form.linkedIncidentIds]);

  function addIncident(i: Incident) {
    if (form.linkedIncidentIds.includes(i.id)) return;
    set("linkedIncidentIds", [...form.linkedIncidentIds, i.id]);
  }
  function removeIncident(incidentId: number) {
    set(
      "linkedIncidentIds",
      form.linkedIncidentIds.filter((x) => x !== incidentId),
    );
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isNew && !report) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Spot report not found.</div>;
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => setLocation("/spot-reports")}
            className="rounded-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Spot Reports
          </Button>
          <h1 className="text-xl font-serif font-bold text-primary uppercase tracking-tight">
            {isNew ? "New Spot Report" : "Edit Spot Report"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={runQualityCheck} className="rounded-sm">
            <ShieldCheck className="w-4 h-4 mr-2" /> Quality Check
          </Button>
          <Button
            variant="outline"
            onClick={() => attemptExport("pdf")}
            disabled={id == null}
            className="rounded-sm"
          >
            <FileDown className="w-4 h-4 mr-2" /> PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => attemptExport("docx")}
            disabled={id == null}
            className="rounded-sm"
          >
            <FileType className="w-4 h-4 mr-2" /> Word
          </Button>
          <Button
            variant="outline"
            onClick={() => attemptExport("text")}
            disabled={id == null}
            className="rounded-sm"
          >
            <FileText className="w-4 h-4 mr-2" /> Text
          </Button>
          {!isNew && id != null && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm("Delete this spot report?")) {
                  del.mutate(
                    { id },
                    {
                      onSuccess: () => {
                        qc.invalidateQueries({ queryKey: getListSpotReportsQueryKey() });
                        setLocation("/spot-reports");
                      },
                    },
                  );
                }
              }}
              className="rounded-sm text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Builder form */}
        <div className="space-y-4 no-print">
          <Card title="Identification">
            <Field label="Title">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="rounded-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPOT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Severity">
                <Select value={form.severity || "none"} onValueChange={(v) => set("severity", v === "none" ? "" : v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {SEVERITY_LEVELS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Input value={form.category} onChange={(e) => set("category", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Prepared By">
                <Input value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Report Date">
                <Input type="datetime-local" value={form.reportDate} onChange={(e) => set("reportDate", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Incident Date">
                <Input type="datetime-local" value={form.incidentDate} onChange={(e) => set("incidentDate", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
          </Card>

          <Card title="Location">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Country">
                <Input value={form.country} onChange={(e) => set("country", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Province / State">
                <Input value={form.province} onChange={(e) => set("province", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Town / City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Latitude">
                <Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Longitude">
                <Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} className="rounded-sm" />
              </Field>
              <Field label="Affected Radius (km)">
                <Input value={form.affectedRadiusKm} onChange={(e) => set("affectedRadiusKm", e.target.value)} className="rounded-sm" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none mt-1">
              <input
                type="checkbox"
                checked={form.mapEnabled}
                onChange={(e) => set("mapEnabled", e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <span>Include incident map in the report</span>
            </label>
          </Card>

          <Card title="Linked Incidents">
            {linkedIncidents.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {linkedIncidents.map((i) => (
                  <span
                    key={i.id}
                    className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-sm text-xs"
                  >
                    {(i.displayTitle?.trim() || i.title).trim()}
                    <button onClick={() => removeIncident(i.id)} className="hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              placeholder="Search incidents to link…"
              className="rounded-sm"
            />
            <div className="mt-2 border border-border rounded-sm divide-y divide-border max-h-56 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No matching incidents.</div>
              ) : (
                searchResults.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => addIncident(i)}
                    className="w-full text-left p-2.5 hover:bg-muted/40 text-sm"
                  >
                    <div className="font-medium truncate">{(i.displayTitle?.trim() || i.title).trim()}</div>
                    <div className="text-xs text-muted-foreground">
                      {[i.country, i.location].filter(Boolean).join(", ")} ·{" "}
                      {format(new Date(i.occurredAt), "dd MMM yyyy")} · {i.severity}
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card title="Narrative">
            <Field label="Bottom Line Up Front (BLUF)">
              <Textarea value={form.bluf} onChange={(e) => set("bluf", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Incident Details">
              <Textarea value={form.incidentDetails} onChange={(e) => set("incidentDetails", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Current Situation">
              <Textarea value={form.currentSituation} onChange={(e) => set("currentSituation", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Operational Impact">
              <Textarea value={form.operationalImpact} onChange={(e) => set("operationalImpact", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Assessment">
              <Textarea value={form.assessment} onChange={(e) => set("assessment", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Outlook (24–72h)">
              <Textarea value={form.outlook} onChange={(e) => set("outlook", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <Field label="Recommended Actions (one per line)">
              <Textarea value={form.recommendedActions} onChange={(e) => set("recommendedActions", e.target.value)} rows={4} className="rounded-sm" />
            </Field>
          </Card>

          <Card title="Internal (not exported unless enabled)">
            <Field label="Analyst Notes (never exported)">
              <Textarea value={form.analystNotes} onChange={(e) => set("analystNotes", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Confidence">
                <Select value={form.confidenceLevel || "none"} onValueChange={(v) => set("confidenceLevel", v === "none" ? "" : v)}>
                  <SelectTrigger className="rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {CONFIDENCE_LEVELS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Internal Source Notes">
              <Textarea value={form.internalSourceNotes} onChange={(e) => set("internalSourceNotes", e.target.value)} rows={3} className="rounded-sm" />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none mt-1">
              <input
                type="checkbox"
                checked={form.showSourcesInExport}
                onChange={(e) => set("showSourcesInExport", e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <span>Show sources & confidence in client export</span>
            </label>
          </Card>

          {!isNew && report && report.exportHistory.length > 0 && (
            <Card title="Export History">
              <div className="space-y-1.5">
                {[...report.exportHistory].reverse().map((e, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span className="uppercase tracking-wider">{e.format}</span>
                    <span>{format(new Date(e.exportedAt), "dd MMM yyyy HH:mm")}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Live preview */}
        <div className="xl:sticky xl:top-4 h-fit">
          <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-2 no-print">
            Live preview — identical to every export
          </div>
          <div ref={previewRef} className="border border-border rounded-sm overflow-hidden bg-white">
            <SpotReportPreview report={previewReport} incidents={linkedIncidents} />
          </div>
        </div>
      </div>

      <QualityDialog
        state={quality}
        onClose={() => setQuality((q) => ({ ...q, open: false }))}
        onProceed={() => {
          const fmt = quality.format;
          setQuality((q) => ({ ...q, open: false }));
          if (fmt) doExport(fmt);
        }}
      />
    </div>
  );
}

function QualityDialog({
  state,
  onClose,
  onProceed,
}: {
  state: { open: boolean; format: ExportFormat | null; result: QualityResult };
  onClose: () => void;
  onProceed: () => void;
}) {
  const { errors, warnings } = state.result;
  const clean = errors.length === 0 && warnings.length === 0;
  const blocked = errors.length > 0;
  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif uppercase tracking-wide">Pre-Export Quality Check</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {clean && <p className="text-muted-foreground">No issues found. The report is ready to export.</p>}
          {errors.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "#A33232" }}>
                Must fix before export
              </div>
              <ul className="list-disc pl-5 space-y-1">
                {errors.map((e, i) => (
                  <li key={i} style={{ color: "#A33232" }}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1 text-muted-foreground">
                Advisory
              </div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-sm">Close</Button>
          {state.format && !blocked && (
            <Button onClick={onProceed} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm">
              Export anyway
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-sm p-4 space-y-3">
      <div className="text-xs font-serif font-bold uppercase tracking-wider text-primary">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
