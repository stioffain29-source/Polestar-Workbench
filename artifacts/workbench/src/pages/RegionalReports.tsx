import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  createReport as createReportRequest,
  type Report,
  useDeleteReport,
  useListReports,
  getGetDashboardOverviewQueryKey,
  getListReportsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowRight, Globe2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { reportStatusClass } from "@/lib/topics";
import {
  canonicalTopic,
  canonicalReportTitle,
  REGIONAL_REPORT_TOPICS,
  type ReportTopic,
} from "@/lib/reportNaming";
import {
  currentReportDate,
  splitReportsByLifecycle,
} from "@/lib/reportLifecycle";

type RegionalTopic = Extract<ReportTopic, "apac_weekly" | "middle_east_weekly">;

export default function RegionalReports() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: reports = [] } = useListReports();
  const regionalReports = reports.filter((report) =>
    (REGIONAL_REPORT_TOPICS as readonly string[]).includes(report.topic),
  );
  const {
    current: currentReports,
    older: olderReports,
    completed: completedReports,
  } = splitReportsByLifecycle(regionalReports);
  const del = useDeleteReport();
  const createBusy = useRef(false);
  const [creatingTopic, setCreatingTopic] = useState<RegionalTopic | null>(null);

  const createRegionalReport = async (topic: RegionalTopic) => {
    if (createBusy.current) return;
    const issueDate = currentReportDate();
    createBusy.current = true;
    setCreatingTopic(topic);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const report = await createReportRequest(
        {
          title: canonicalReportTitle(topic),
          topic,
          issueDate,
          status: "draft",
        } as never,
        { signal: controller.signal },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }),
      ]);
      setLocation(`/reports/${report.id}`);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      toast.error(
        timedOut
          ? "Report creation timed out. The request was stopped; please try again."
          : "Report creation failed. Please try again.",
      );
    } finally {
      window.clearTimeout(timeout);
      createBusy.current = false;
      setCreatingTopic(null);
    }
  };

  const deleteReport = (report: Report) => {
    if (!confirm(`Delete ${canonicalTopic(report.topic).title}?`)) return;
    del.mutate(
      { id: report.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
        },
      },
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <header>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
          Intelligence Products
        </div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">
          Regional Reports
        </h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">
          Curated weekly security, risk and operational intelligence.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {REGIONAL_REPORT_TOPICS.map((topic) => {
          const product = canonicalTopic(topic);
          const currentReport = currentReports.find((report) => report.topic === topic);
          return (
            <section
              key={topic}
              className="bg-card border border-border rounded-sm p-6 flex items-start justify-between gap-5"
            >
              <div>
                <div className="inline-flex items-center gap-2 text-[10px] font-sans uppercase tracking-[0.16em] text-accent font-bold">
                  <Globe2 className="w-3.5 h-3.5" />
                  {product.cadence} Regional Intelligence
                </div>
                <h2 className="font-serif font-bold text-xl text-primary mt-2">
                  {product.title}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {product.subtitle}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2">
                {currentReport && (
                  <Button asChild variant="outline" className="rounded-sm">
                    <Link href={`/reports/${currentReport.id}`}>
                      <ArrowRight className="w-4 h-4 mr-2" />
                      Open Current Report
                    </Link>
                  </Button>
                )}
                <Button
                  onClick={() => createRegionalReport(topic)}
                  disabled={creatingTopic !== null}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {creatingTopic === topic
                    ? "Creating…"
                    : "Create Report"}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {regionalReports.length === 0 && (
          <div className="col-span-full border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No regional reports yet. Create the current APAC or Middle East weekly report above.
          </div>
        )}
        {currentReports.length > 0 && <GroupHeading>Current in-progress</GroupHeading>}
        {currentReports.map((report) => (
          <RegionalReportCard key={report.id} report={report} onDelete={deleteReport} />
        ))}
        {olderReports.length > 0 && <GroupHeading>Older in-progress</GroupHeading>}
        {olderReports.map((report) => (
          <RegionalReportCard key={report.id} report={report} onDelete={deleteReport} />
        ))}
        {completedReports.length > 0 && <GroupHeading>Completed reports</GroupHeading>}
        {completedReports.map((report) => (
          <RegionalReportCard key={report.id} report={report} onDelete={deleteReport} />
        ))}
      </div>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full text-[10px] font-sans uppercase tracking-widest text-muted-foreground mt-2">
      {children}
    </div>
  );
}

function RegionalReportCard({
  report,
  onDelete,
}: {
  report: Report;
  onDelete: (report: Report) => void;
}) {
  const product = canonicalTopic(report.topic);
  return (
    <article className="bg-card border border-border rounded-sm p-5 group">
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm",
            reportStatusClass(report.status),
          )}
        >
          {report.status}
        </span>
        <button
          type="button"
          onClick={() => onDelete(report)}
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${product.title}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <Link href={`/reports/${report.id}`} className="block mt-3">
        <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
          Polestar Insights
        </div>
        <div className="text-[11px] font-sans uppercase tracking-wider text-primary mt-0.5">
          Regional Intelligence · Weekly
        </div>
        <h2 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors mt-1.5">
          {product.title}
        </h2>
      </Link>
      <div className="text-xs text-muted-foreground mt-2 font-mono">
        Issue date: {format(parseISO((report.issueDate ?? "").slice(0, 10)), "d MMM yyyy")}
        {report.author ? ` · ${report.author}` : ""}
      </div>
      <Link href={`/reports/${report.id}`}>
        <div className="mt-4 pt-3 border-t border-border text-xs font-sans uppercase tracking-wider text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
          Open Editor <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </Link>
    </article>
  );
}