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
import { TOPIC_LABELS, REPORT_STATUSES, reportStatusClass } from "@/lib/topics";
import { format } from "date-fns";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopicReportsProps {
  topic: string;
}

export default function TopicReports({ topic }: TopicReportsProps) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const params: Record<string, unknown> = { topic };
  if (status) params.status = status;
  const { data: reports = [] } = useListReports(params);
  const del = useDeleteReport();
  const create = useCreateReport();

  const label = TOPIC_LABELS[topic] ?? topic;

  const [form, setForm] = useState({
    title: "",
    issueDate: new Date().toISOString().slice(0, 10),
    status: "draft",
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
  };

  return (
    <div className="bg-card border border-border rounded-sm">
      <div className="p-3 border-b border-border bg-muted/50 flex items-center justify-between gap-3">
        <div className="font-serif font-bold uppercase text-sm text-primary">
          {label} Report Builder
        </div>
        <div className="flex items-center gap-2">
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="rounded-sm h-8 w-40 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {REPORT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm h-8">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New {label} Report
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif uppercase tracking-wide">New {label} Report</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Field label="Title">
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-sm" />
                </Field>
                <Field label="Issue Date">
                  <Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="rounded-sm" />
                </Field>
                <Button
                  onClick={() =>
                    create.mutate(
                      { data: { title: form.title, topic, issueDate: form.issueDate, status: form.status } as never },
                      {
                        onSuccess: (r) => {
                          invalidate();
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
      </div>

      {reports.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No {label} reports yet. Click "New {label} Report" to start one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {reports.map((r) => (
            <div key={r.id} className="bg-card p-4 group">
              <div className="flex items-start justify-between">
                <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", reportStatusClass(r.status))}>{r.status}</span>
                <button
                  onClick={() => {
                    if (confirm("Delete report?")) del.mutate({ id: r.id }, { onSuccess: invalidate });
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete report"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Link href={`/reports/${r.id}`} className="block mt-2">
                <h3 className="font-serif font-bold text-base text-primary group-hover:text-accent transition-colors leading-tight">{r.title}</h3>
              </Link>
              <div className="text-[11px] text-muted-foreground mt-1.5 font-mono">
                {format(new Date(r.issueDate), "d MMM yyyy")}{r.author ? ` · ${r.author}` : ""}
              </div>
              <Link href={`/reports/${r.id}`}>
                <div className="mt-3 pt-2 border-t border-border text-[10px] font-sans uppercase tracking-wider text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open Editor <ArrowRight className="w-3 h-3" />
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
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
