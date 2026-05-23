import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetReport, useUpdateReport,
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
import { ArrowLeft, Plus, Printer, Save, Trash2 } from "lucide-react";

type KpiCard = { label: string; value: string; accent?: string; context?: string };

interface FormState {
  title: string;
  topic: string;
  status: string;
  issueDate: string;
  situation: string;
  whatHappened: string;
  hardNumbers: KpiCard[];
  whatMatters: string;
  implications: string;
  polestarView: string;
  watchNext: string;
  author: string;
}

const EMPTY: FormState = {
  title: "", topic: "fuel", status: "draft", issueDate: new Date().toISOString().slice(0, 10),
  situation: "", whatHappened: "", hardNumbers: [],
  whatMatters: "", implications: "", polestarView: "", watchNext: "", author: "",
};

export default function ReportEditor() {
  const qc = useQueryClient();
  const [, params] = useRoute("/reports/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const { data: report, isLoading } = useGetReport(id);
  const update = useUpdateReport();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (!report) return;
    setForm({
      title: report.title ?? "",
      topic: report.topic ?? "fuel",
      status: report.status ?? "draft",
      issueDate: report.issueDate ?? new Date().toISOString().slice(0, 10),
      situation: report.situation ?? "",
      whatHappened: report.whatHappened ?? "",
      hardNumbers: (report.hardNumbers as KpiCard[]) ?? [],
      whatMatters: report.whatMatters ?? "",
      implications: report.implications ?? "",
      polestarView: report.polestarView ?? "",
      watchNext: report.watchNext ?? "",
      author: report.author ?? "",
    });
  }, [report]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    update.mutate({ id, data: form as never }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
      },
    });
  };

  const addKpi = () => set("hardNumbers", [...form.hardNumbers, { label: "", value: "", accent: "#4655FF", context: "" }]);
  const updateKpi = (i: number, k: Partial<KpiCard>) =>
    set("hardNumbers", form.hardNumbers.map((c, idx) => (idx === i ? { ...c, ...k } : c)));
  const removeKpi = (i: number) => set("hardNumbers", form.hardNumbers.filter((_, idx) => idx !== i));

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!report) return <div className="text-sm text-muted-foreground">Report not found.</div>;

  return (
    <div className="max-w-[1900px] mx-auto space-y-4">
      <div className="flex items-end justify-between no-print">
        <div>
          <Link href="/reports" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> All Reports
          </Link>
          <h1 className="text-2xl font-serif font-bold text-primary uppercase tracking-tight mt-1">{form.title || "Untitled report"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="rounded-sm"><Printer className="w-4 h-4 mr-2" /> Print / PDF</Button>
          <Button onClick={save} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"><Save className="w-4 h-4 mr-2" /> Save</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-sm p-5 space-y-3 no-print">
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
          <Field label="Situation"><Textarea rows={4} value={form.situation} onChange={(e) => set("situation", e.target.value)} className="rounded-sm" /></Field>
          <Field label="What Happened"><Textarea rows={5} value={form.whatHappened} onChange={(e) => set("whatHappened", e.target.value)} className="rounded-sm" /></Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Hard Numbers (KPI Cards)</label>
              <button onClick={addKpi} className="text-xs text-accent flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" /> Add</button>
            </div>
            <div className="space-y-2">
              {form.hardNumbers.map((k, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_60px_30px] gap-2 items-center">
                  <Input value={k.label} onChange={(e) => updateKpi(i, { label: e.target.value })} placeholder="Label" className="rounded-sm" />
                  <Input value={k.value} onChange={(e) => updateKpi(i, { value: e.target.value })} placeholder="Value" className="rounded-sm" />
                  <Input value={k.context ?? ""} onChange={(e) => updateKpi(i, { context: e.target.value })} placeholder="Context" className="rounded-sm" />
                  <Input value={k.accent ?? "#4655FF"} onChange={(e) => updateKpi(i, { accent: e.target.value })} placeholder="Accent" className="rounded-sm" />
                  <button onClick={() => removeKpi(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              {form.hardNumbers.length === 0 && <div className="text-xs text-muted-foreground italic">No KPI cards yet.</div>}
            </div>
          </div>

          <Field label="What Matters"><Textarea rows={4} value={form.whatMatters} onChange={(e) => set("whatMatters", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Implications for Business"><Textarea rows={4} value={form.implications} onChange={(e) => set("implications", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Polestar View"><Textarea rows={3} value={form.polestarView} onChange={(e) => set("polestarView", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Watch Next"><Textarea rows={3} value={form.watchNext} onChange={(e) => set("watchNext", e.target.value)} className="rounded-sm" /></Field>
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
