import { Link, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Report,
  useListReports,
  useCreateReport,
  useDeleteReport,
  getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Plus, ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportStatusClass } from "@/lib/topics";
import { canonicalTopic, isReportableTopic } from "@/lib/reportNaming";
import { cn } from "@/lib/utils";
import { currentReportDate, splitReportsByLifecycle } from "@/lib/reportLifecycle";

/**
 * Report Builder, folded into the topic page it belongs to. Replaces the old
 * "Go to Report Builder" link-out to a disconnected /reports list: drafts for
 * THIS topic live right here, next to the data that feeds them, with a one-
 * click way to start a new one. /reports (Reports.tsx) still exists as the
 * cross-topic overview for when you need to see everything at once.
 *
 * Renders nothing for topics the report API doesn't support yet (see
 * REPORT_TOPICS in lib/reportNaming.ts) rather than offering a "New Report"
 * button that would 400 on submit.
 */
export function TopicReportPanel({ topic }: { topic: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const reportable = isReportableTopic(topic);
  const { data: reports = [], isLoading } = useListReports(
    { topic: topic as never },
    { query: { enabled: reportable } } as never,
  );
  const create = useCreateReport();
  const del = useDeleteReport();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const createBusy = useRef(false);
  useEffect(() => {
    setArchiveOpen(false);
  }, [topic]);

  if (!reportable) return null;

  const canonical = canonicalTopic(topic);
  const { current, older, completed } = splitReportsByLifecycle(reports);
  const archived = [...older, ...completed];
  const allReports = [...current, ...archived];

  const handleNewDraft = () => {
    // Every click is a request for a new identity. The client-side guard
    // prevents double-submit; the API intentionally does not reuse same-day
    // drafts as an identity/idempotency mechanism.
    if (create.isPending || createBusy.current) return;
    createBusy.current = true;
    create.mutate(
      {
        data: {
          title: canonical.title,
          topic: topic as never,
          issueDate: currentReportDate(),
          status: "draft",
        } as never,
      },
      {
        onSuccess: (r) => {
          createBusy.current = false;
          qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
          setLocation(`/reports/${(r as { id: number }).id}`);
        },
        onError: () => {
          createBusy.current = false;
        },
      },
    );
  };

  return (
    <div className="bg-card border border-border rounded-sm p-5" data-testid="panel-topic-reports">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Report Builder</div>
          <h2 className="font-serif font-bold text-lg text-primary uppercase tracking-tight mt-0.5">
            {canonical.title} Drafts
          </h2>
          {canonical.subtitle && (
            <p className="text-xs text-muted-foreground font-sans mt-0.5">{canonical.subtitle}</p>
          )}
        </div>
        <Button
          onClick={handleNewDraft}
          disabled={create.isPending}
          size="sm"
          className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm whitespace-nowrap"
          data-testid="button-new-topic-report"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {create.isPending ? "Creating…" : `New ${canonical.title}`}
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading reports…</div>}

      {!isLoading && allReports.length === 0 && (
        <div className="text-sm text-muted-foreground" data-testid="text-no-topic-reports">
          No reports yet for this topic.
        </div>
      )}

      {allReports.length > 0 && (
        <>
          {current.length > 0 && (
            <>
              <ReportGroupHeading>Current in-progress</ReportGroupHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {current.map((r) => <ReportCard key={r.id} report={r} />)}
              </div>
            </>
          )}
          {archived.length > 0 && (
            <details
              className="mt-4 border-t border-border pt-3"
              open={archiveOpen}
              onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
              data-testid="details-topic-report-archive"
            >
              <summary
                className="cursor-pointer select-none text-xs font-sans uppercase tracking-widest text-muted-foreground hover:text-primary"
                onClick={(event) => {
                  // Keep the card body out of the DOM until explicitly
                  // expanded. Preventing the native toggle also keeps this
                  // controlled state consistent in browsers and test DOMs.
                  event.preventDefault();
                  setArchiveOpen((open) => !open);
                }}
                data-testid="summary-topic-report-archive"
              >
                Archive · {archived.length} older reports
              </summary>
              {archiveOpen && (
                <div className="mt-3">
                  {older.length > 0 && (
                    <>
                      <ReportGroupHeading>Older in-progress</ReportGroupHeading>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {older.map((r) => (
                          <ReportCard
                            key={r.id}
                            report={r}
                            onDelete={
                              r.status === "draft"
                                ? () => {
                                    if (!confirm(`Delete old draft "${r.title}"? This cannot be undone.`)) return;
                                    del.mutate(
                                      { id: r.id },
                                      {
                                        onSuccess: () => {
                                          qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
                                          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
                                        },
                                      },
                                    );
                                  }
                                : undefined
                            }
                            deletePending={del.isPending}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {completed.length > 0 && (
                    <>
                      <ReportGroupHeading>Completed reports</ReportGroupHeading>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {completed.map((r) => <ReportCard key={r.id} report={r} />)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </details>
          )}
        </>
      )}

      {allReports.length > 6 && (
        <div className="mt-3 text-right">
          <Link
            href="/reports"
            className="text-xs font-sans font-medium text-accent hover:underline uppercase tracking-wide"
            data-testid="link-view-all-topic-reports"
          >
            View all {allReports.length} in Report Builder →
          </Link>
        </div>
      )}
    </div>
  );
}

function ReportGroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-2 mt-3">
      {children}
    </div>
  );
}

function ReportCard({
  report: r,
  onDelete,
  deletePending = false,
}: {
  report: Report;
  onDelete?: () => void;
  deletePending?: boolean;
}) {
  return (
    <div className="relative bg-background border border-border rounded-sm hover:border-accent transition-colors group">
      <Link
        href={`/reports/${r.id}`}
        className="block p-3"
        data-testid={`link-topic-report-${r.id}`}
      >
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm",
              reportStatusClass(r.status),
            )}
          >
            {r.status}
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
        </div>
        <div className={cn("text-sm font-sans font-medium text-primary mt-2 truncate", onDelete && "pr-8")}>{r.title}</div>
        <div className={cn("text-xs text-muted-foreground font-mono mt-1", onDelete && "pr-8")}>
          <span>Issue date: </span>
          {(() => {
            try {
              return format(parseISO((r.issueDate ?? "").slice(0, 10)), "d MMM yyyy");
            } catch {
              return r.issueDate ?? "—";
            }
          })()}
          {r.author ? ` · ${r.author}` : ""}
        </div>
      </Link>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deletePending}
          aria-label={`Delete old draft ${r.title}`}
          title="Delete old draft"
          className="absolute bottom-2.5 right-2.5 p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
