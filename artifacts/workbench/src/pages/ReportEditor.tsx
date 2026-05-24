import { useEffect, useState } from "react";
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
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";
import { slugifyForFilename } from "@/lib/exportPdf";
import { exportTopicReportPdf } from "@/lib/exportTopicReportPdf";

const execSummaryStorageKey = (id: number) => `polestar:exec-summary:report:${id}`;

type TopicGuide = {
  scope: string;
  situation: string;
  whatHappened: string;
  whatMatters: string;
  implications: string;
  polestarView: string;
  watchNext: string;
};

const TOPIC_GUIDES: Record<string, TopicGuide> = {
  shipping: {
    scope:
      "Shipping reports cover port disruption, chokepoint risk, vessel attacks, route diversion, shipping delays, insurance and freight pressure, naval / maritime advisories, port strikes and cargo movement disruption. Theft and pilferage belong in Cargo Watch.",
    situation: "Set the maritime backdrop: routes, chokepoints, ports and operators in scope.",
    whatHappened: "Describe the disruption — vessel, port, route, chokepoint, advisory or labour event. Cite source and date.",
    whatMatters: "Why this disruption matters for shipping flows, transit times, freight cost or insurance exposure.",
    implications: "Operational impact on schedules, alternative routes, port calls, premiums and contract terms.",
    polestarView: "Polestar's read on duration, escalation risk and exposure for clients moving cargo through the area.",
    watchNext: "Next maritime triggers to watch: further closures, naval movement, advisory updates, rate moves.",
  },
  cargo_watch: {
    scope:
      "Cargo Watch reports cover cargo theft, pilferage, hijacking, warehouse and depot theft, seal tampering, insider theft and other logistics crime. Port, chokepoint and vessel disruption belong in Shipping.",
    situation: "Set the cargo-crime backdrop: corridor, depot, warehouse cluster or operator under pressure.",
    whatHappened: "Describe the theft, hijack, pilferage or insider event. Note value, cargo type and any companies named.",
    whatMatters: "Why this loss pattern matters — modus operandi, repeat geography, insider involvement, value at risk.",
    implications: "Operational impact on routing, escort needs, depot security, insurance claims and contract risk.",
    polestarView: "Polestar's read on whether this is one-off, opportunistic or part of an organised pattern.",
    watchNext: "Next cargo-crime triggers to watch: copycat incidents, arrests, route shifts, recovery announcements.",
  },
};

function guideFor(topic: string): TopicGuide | null {
  return TOPIC_GUIDES[topic] ?? null;
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
  const { data: incidents = [] } = useListIncidents({});

  const downloadPdf = async () => {
    setExporting(true);
    try {
      await exportTopicReportPdf(
        {
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
        },
        incidents.map((i) => ({
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
        })),
        TOPIC_LABELS,
        `polestar-report-${slugifyForFilename(form.title || "untitled")}.pdf`,
      );
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!report) return;
    let exec = "";
    try {
      exec = (typeof window !== "undefined" && window.localStorage)
        ? (window.localStorage.getItem(execSummaryStorageKey(report.id)) ?? "")
        : "";
    } catch { exec = ""; }
    setForm({
      title: report.title ?? "",
      topic: report.topic ?? "fuel",
      status: report.status ?? "draft",
      issueDate: report.issueDate ?? new Date().toISOString().slice(0, 10),
      executiveSummary: exec,
      situation: report.situation ?? "",
      whatHappened: report.whatHappened ?? "",
      whatMatters: report.whatMatters ?? "",
      implications: report.implications ?? "",
      polestarView: report.polestarView ?? "",
      watchNext: report.watchNext ?? "",
      author: report.author ?? "",
    });
  }, [report]);

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

  const guide = guideFor(form.topic);

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
          {guide && (
            <div
              className="text-[12px] leading-snug p-3 rounded-sm border"
              style={{ background: "#F3F4FA", borderColor: "#4655FF", color: "#0B0B3D", fontFamily: "Roboto, sans-serif" }}
            >
              <div className="uppercase tracking-widest font-bold text-[10px] mb-1" style={{ color: "#4655FF" }}>
                {TOPIC_LABELS[form.topic]} scope
              </div>
              {guide.scope}
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
          <Field label="Executive Summary"><Textarea rows={4} value={form.executiveSummary} onChange={(e) => set("executiveSummary", e.target.value)} placeholder="One short paragraph at the top of the brief: the dominant structural read for this cycle." className="rounded-sm" /></Field>
          <Field label="Situation"><Textarea rows={4} value={form.situation} onChange={(e) => set("situation", e.target.value)} placeholder={guide?.situation} className="rounded-sm" /></Field>
          <Field label="What Happened"><Textarea rows={5} value={form.whatHappened} onChange={(e) => set("whatHappened", e.target.value)} placeholder={guide?.whatHappened} className="rounded-sm" /></Field>
          <Field label="What Matters"><Textarea rows={4} value={form.whatMatters} onChange={(e) => set("whatMatters", e.target.value)} placeholder={guide?.whatMatters} className="rounded-sm" /></Field>
          <Field label="Implications for Business"><Textarea rows={4} value={form.implications} onChange={(e) => set("implications", e.target.value)} placeholder={guide?.implications} className="rounded-sm" /></Field>
          <Field label="Watch Next"><Textarea rows={3} value={form.watchNext} onChange={(e) => set("watchNext", e.target.value)} placeholder={guide?.watchNext} className="rounded-sm" /></Field>
          <Field label="Polestar View"><Textarea rows={3} value={form.polestarView} onChange={(e) => set("polestarView", e.target.value)} placeholder={guide?.polestarView} className="rounded-sm" /></Field>
        </div>

        <div className="bg-white border border-border rounded-sm overflow-hidden">
          <ReportPreview report={form} />
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
