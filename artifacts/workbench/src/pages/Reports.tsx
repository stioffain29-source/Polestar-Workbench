import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListReports, useCreateReport, useDeleteReport,
  getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOPICS, TOPIC_LABELS, REPORT_STATUSES, reportStatusClass } from "@/lib/topics";
import { format } from "date-fns";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Reports() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const params: Record<string, unknown> = {};
  if (topic) params.topic = topic;
  if (status) params.status = status;
  const { data: reports = [] } = useListReports(params);
  const del = useDeleteReport();
  const create = useCreateReport();

  const [form, setForm] = useState({
    title: "",
    topic: "fuel",
    issueDate: new Date().toISOString().slice(0, 10),
    status: "draft",
  });

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Operations</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Reports</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">Polestar Insights branded report builder</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"><Plus className="w-4 h-4 mr-2" /> New Report</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-serif uppercase tracking-wide">New Report</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-sm" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Topic">
                  <Select value={form.topic} onValueChange={(v) => setForm({ ...form, topic: v })}>
                    <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Issue Date"><Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="rounded-sm" /></Field>
              </div>
              <Button
                onClick={() =>
                  create.mutate(
                    { data: { title: form.title, topic: form.topic, issueDate: form.issueDate, status: form.status } as never },
                    {
                      onSuccess: (r) => {
                        qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
                        qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
                        setCreateOpen(false);
                        setLocation(`/reports/${(r as { id: number }).id}`);
                      },
                    },
                  )
                }
                disabled={!form.title}
                className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm w-full"
              >
                Create and Open
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-sm p-3 flex gap-2">
        <Select value={topic || "all"} onValueChange={(v) => setTopic(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm w-48"><SelectValue placeholder="All topics" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All topics</SelectItem>
            {TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {REPORT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.length === 0 && <div className="text-sm text-muted-foreground">No reports match.</div>}
        {reports.map((r) => (
          <div key={r.id} className="bg-card border border-border rounded-sm p-5 group">
            <div className="flex items-start justify-between">
              <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", reportStatusClass(r.status))}>{r.status}</span>
              <button onClick={() => { if (confirm("Delete report?")) del.mutate({ id: r.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListReportsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); } }); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <Link href={`/reports/${r.id}`} className="block mt-3">
              <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Polestar Insights</div>
              <div className="text-[11px] font-sans uppercase tracking-wider text-primary mt-0.5">
                {r.topic === "protests" ? "Flashpoint" : TOPIC_LABELS[r.topic]} · {r.topic === "cargo_watch" ? "Monthly" : "Weekly"}
              </div>
              {r.topic === "protests" && (
                <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mt-0.5">Activism, Protests &amp; Civil Unrest</div>
              )}
              <h2 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors mt-1.5">{r.title}</h2>
            </Link>
            <div className="text-xs text-muted-foreground mt-2 font-mono">
              {format(new Date(r.issueDate), "d MMM yyyy")}{r.author ? ` · ${r.author}` : ""}
            </div>
            <Link href={`/reports/${r.id}`}>
              <div className="mt-4 pt-3 border-t border-border text-xs font-sans uppercase tracking-wider text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                Open Editor <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          </div>
        ))}
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
