import { Link, useLocation } from "wouter";
import {
  useListSpecialReports,
  useDeleteSpecialReport,
  getListSpecialReportsQueryKey,
  type SpecialReport,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SEV_COLOR,
  SEV_LABEL,
  sevKey,
  specialLocationLabel,
} from "@/lib/specialReport";

export default function SpecialReports() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: reports = [] } = useListSpecialReports();
  const del = useDeleteSpecialReport();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListSpecialReportsQueryKey() });

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Operations</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Special Reports</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">
            One-off, multi-domain reports with a chosen front cover, maps and charts
          </p>
        </div>
        <Button
          onClick={() => setLocation("/special-reports/new")}
          className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
        >
          <Plus className="w-4 h-4 mr-2" /> New Special Report
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.length === 0 && (
          <div className="text-sm text-muted-foreground">No special reports yet.</div>
        )}
        {reports.map((r) => (
          <SpecialReportCard
            key={r.id}
            report={r}
            onDelete={() => {
              if (confirm("Delete special report?")) {
                del.mutate({ id: r.id }, { onSuccess: invalidate });
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SpecialReportCard({ report: r, onDelete }: { report: SpecialReport; onDelete: () => void }) {
  const sevK = sevKey(r.severity);
  const location = specialLocationLabel(r);
  const linkedCount = r.linkedIncidentIds?.length ?? 0;
  const exportCount = r.exportHistory?.length ?? 0;
  return (
    <div className="bg-card border border-border rounded-sm p-5 group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm",
              r.status === "final"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {r.status}
          </span>
          {sevK && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm text-white"
              style={{ background: SEV_COLOR[sevK] ?? "#999" }}
            >
              {SEV_LABEL[sevK] ?? r.severity}
            </span>
          )}
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <Link href={`/special-reports/${r.id}`} className="block mt-3">
        <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
          Polestar Advisory · Special Report
        </div>
        <h2 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors mt-1">
          {r.title}
        </h2>
        {location && (
          <div className="text-xs text-muted-foreground mt-1 font-sans">{location}</div>
        )}
      </Link>

      <div className="text-xs text-muted-foreground mt-2 font-mono">
        {format(new Date(r.reportDate), "d MMM yyyy")}
        {r.createdBy ? ` · ${r.createdBy}` : ""}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 font-sans">
        {linkedCount} linked {linkedCount === 1 ? "incident" : "incidents"} · {exportCount}{" "}
        {exportCount === 1 ? "export" : "exports"}
      </div>

      <Link href={`/special-reports/${r.id}`}>
        <div className="mt-4 pt-3 border-t border-border text-xs font-sans uppercase tracking-wider text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
          Open Builder <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </Link>
    </div>
  );
}
