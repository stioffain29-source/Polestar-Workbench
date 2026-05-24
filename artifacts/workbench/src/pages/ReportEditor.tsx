import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetReport, useUpdateReport, useListIncidents,
  getGetReportQueryKey, getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOPICS, TOPIC_LABELS, REPORT_STATUSES } from "@/lib/topics";
import ReportPreview from "@/components/ReportPreview";
import ShippingReportPreview from "@/components/ShippingReportPreview";
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";
import { slugifyForFilename } from "@/lib/exportPdf";
import { exportTopicReportPdf } from "@/lib/exportTopicReportPdf";
import { exportShippingReportPdf } from "@/lib/exportShippingReportPdf";
import { draftTopicReportProse, type DraftableIncident } from "@/lib/draftReportProse";
import { resolveReportTitle } from "@/lib/reportNaming";

const execSummaryStorageKey = (id: number) => `polestar:exec-summary:report:${id}`;

// Short scope reminders shown above the editor. Kept tight on purpose so
// they read as a topic map, not a writing prompt.
const TOPIC_SCOPE: Record<string, string> = {
  shipping:
    "Shipping covers vessel attack, port and chokepoint disruption, route diversion, naval advisories and freight pressure. Theft and pilferage sit in Cargo Watch.",
  cargo_watch:
    "Cargo Watch covers cargo theft, hijack, pilferage, warehouse and depot loss, seal tampering and insider crime. Port and vessel disruption sit in Shipping.",
  fuel:
    "Fuel covers shortage, price moves, subsidy change, refinery and transport disruption, and fuel related unrest.",
  fertiliser:
    "Fertiliser covers supply, price, export controls, production disruption and farmer pressure.",
  energy:
    "Energy covers outages, load shedding, grid disruption, generation shortfall and fuel to power issues.",
  protests:
    "Civil protest and unrest covers public order activity, disruption to transport and access, and escalation risk.",
  flashpoint:
    "Flashpoint reads as a short operational warning derived from civil unrest data. Keep it tight and actionable.",
};

function scopeFor(topic: string): string | null {
  return TOPIC_SCOPE[topic] ?? null;
}

interface FormState {
  title: string;
  topic: string;
  status: string;
  issueDate: string;
  executiveSummary: string;
  situation: string;
  whatHappened: string;
  whatMatters: string;
  implications: string;
  polestarView: string;
  watchNext: string;
  author: string;
}

const EMPTY: FormState = {
  title: "", topic: "fuel", status: "draft", issueDate: new Date().toISOString().slice(0, 10),
  executiveSummary: "",
  situation: "", whatHappened: "",
  whatMatters: "", implications: "", polestarView: "", watchNext: "", author: "",
};

export default function ReportEditor() {
  const qc = useQueryClient();
  const [, params] = useRoute("/reports/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const { data: report, isLoading } = useGetReport(id);
  const update = useUpdateReport();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const { data: incidents } = useListIncidents({});
  const seededForId = useRef<number | null>(null);

  const incidentsForExport = incidents ?? [];

  const downloadPdf = async () => {
    setExporting(true);
    try {
      const reportData = {
        title: form.title,
        topic: form.topic,
        issueDate: form.issueDate,
        author: form.author,
        executiveSummary: form.executiveSummary,
        situation: form.situation,
        whatHappened: form.whatHappened,
        whatMatters: form.whatMatters,
        implications: form.implications,
        watchNext: form.watchNext,
        polestarView: form.polestarView,
      };
      const mappedIncidents = incidentsForExport.map((i) => ({
        id: i.id,
        title: i.title,
        topic: i.topic,
        severity: i.severity,
        occurredAt: i.occurredAt,
        country: i.country,
        summary: i.summary,
        source: i.source,
        sourceUrl: i.sourceUrl,
        location: i.location,
      }));
      const filename = `polestar-report-${slugifyForFilename(form.title || "untitled")}.pdf`;
      // Shipping uses a bespoke section layout (Chokepoint Watch, Vessel
      // Attacks, Piracy, Port/Route Disruption, Commercial Impact) so it
      // does not run through the generic topic exporter.
      if (form.topic === "shipping") {
        await exportShippingReportPdf(reportData, mappedIncidents, filename);
      } else {
        await exportTopicReportPdf(reportData, mappedIncidents, TOPIC_LABELS, filename);
      }
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!report) return;
    // Wait until incidents have loaded before seeding so the draft prose is
    // built from the actual window. Seed exactly once per report id.
    if (!incidents) return;
    if (seededForId.current === report.id) return;
    seededForId.current = report.id;
    let exec = "";
    try {
      exec = (typeof window !== "undefined" && window.localStorage)
        ? (window.localStorage.getItem(execSummaryStorageKey(report.id)) ?? "")
        : "";
    } catch { exec = ""; }

    // Generate an operational draft for any section that is still empty.
    // Saved content always wins; the draft only seeds blank fields so a new
    // report opens with usable prose rather than writing prompts.
    const topic = report.topic ?? "fuel";
    const issueDate = report.issueDate ?? new Date().toISOString().slice(0, 10);
    const inputs: DraftableIncident[] = (incidents ?? []).map((i) => ({
      topic: i.topic,
      title: i.title,
      summary: i.summary,
      source: i.source,
      sourceUrl: i.sourceUrl,
      location: i.location,
      severity: i.severity,
      occurredAt: i.occurredAt,
      country: i.country,
    }));
    const draft = draftTopicReportProse({ topic, issueDate, incidents: inputs });
    const pick = (saved: string | null | undefined, drafted: string) => {
      const s = (saved ?? "").trim();
      return s ? (saved as string) : drafted;
    };

    // Replace empty titles and the well-known old regional defaults (e.g.
    // "APAC Fuel Watch", "Hormuz Maritime Watch") with the canonical title.
    // Any other stored title is treated as a manual edit and preserved.
    setForm({
      title: resolveReportTitle(topic, report.title),
      topic,
      status: report.status ?? "draft",
      issueDate,
      executiveSummary: exec.trim() ? exec : draft.executiveSummary,
      situation: pick(report.situation, draft.situation),
      whatHappened: pick(report.whatHappened, draft.whatHappened),
      whatMatters: pick(report.whatMatters, draft.whatMatters),
      implications: pick(report.implications, draft.implications),
      polestarView: pick(report.polestarView, draft.polestarView),
      watchNext: pick(report.watchNext, draft.watchNext),
      author: report.author ?? "",
    });
  }, [report, incidents]);

  // Reset the seed guard if the route id changes.
  useEffect(() => {
    if (seededForId.current !== null && seededForId.current !== id) {
      seededForId.current = null;
    }
  }, [id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    const { executiveSummary, ...persistable } = form;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(execSummaryStorageKey(id), executiveSummary);
      }
    } catch { /* ignore */ }
    update.mutate({ id, data: persistable as never }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
      },
    });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!report) return <div className="text-sm text-muted-foreground">Report not found.</div>;

  const scope = scopeFor(form.topic);

  return (
    <div className="max-w-[1900px] mx-auto space-y-4">
      <div className="flex items-end justify-between no-print">
        <div>
          <Link href="/reports" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> All Reports
          </Link>
          <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mt-2">Polestar Insights</div>
          <h1 className="text-2xl font-serif font-bold text-primary uppercase tracking-tight mt-0.5">{form.title || "Untitled report"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadPdf} disabled={exporting} className="rounded-sm">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </Button>
          <Button onClick={save} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"><Save className="w-4 h-4 mr-2" /> Save</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-sm p-5 space-y-3 no-print">
          {scope && (
            <div
              className="text-[12px] leading-snug p-3 rounded-sm border"
              style={{ background: "#F3F4FA", borderColor: "#4655FF", color: "#0B0B3D", fontFamily: "Roboto, sans-serif" }}
            >
              <div className="uppercase tracking-widest font-bold text-[10px] mb-1" style={{ color: "#4655FF" }}>
                {TOPIC_LABELS[form.topic]} scope
              </div>
              {scope}
            </div>
          )}
          <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} className="rounded-sm" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Topic">
              <Select value={form.topic} onValueChange={(v) => set("topic", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{REPORT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Issue Date"><Input type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} className="rounded-sm" /></Field>
          </div>
          <Field label="Author"><Input value={form.author} onChange={(e) => set("author", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Executive Summary"><Textarea rows={4} value={form.executiveSummary} onChange={(e) => set("executiveSummary", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Situation"><Textarea rows={4} value={form.situation} onChange={(e) => set("situation", e.target.value)} className="rounded-sm" /></Field>
          <Field label="What Happened"><Textarea rows={5} value={form.whatHappened} onChange={(e) => set("whatHappened", e.target.value)} className="rounded-sm" /></Field>
          <Field label="What Matters"><Textarea rows={4} value={form.whatMatters} onChange={(e) => set("whatMatters", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Implications for Business"><Textarea rows={4} value={form.implications} onChange={(e) => set("implications", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Watch Next"><Textarea rows={3} value={form.watchNext} onChange={(e) => set("watchNext", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Polestar View"><Textarea rows={3} value={form.polestarView} onChange={(e) => set("polestarView", e.target.value)} className="rounded-sm" /></Field>
        </div>

        <div className="bg-white border border-border rounded-sm overflow-hidden">
          {form.topic === "shipping" ? (
            <ShippingReportPreview report={form} incidents={incidentsForExport} />
          ) : (
            <ReportPreview report={form} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
