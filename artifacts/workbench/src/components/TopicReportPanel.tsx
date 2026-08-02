import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListReports,
  useCreateReport,
  getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
} from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportStatusClass } from "@/lib/topics";
import { canonicalTopic, isReportableTopic } from "@/lib/reportNaming";
import { cn } from "@/lib/utils";

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

  if (!reportable) return null;

  const canonical = canonicalTopic(topic);
  const sorted = [...reports].sort(
    (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
  );
  const visible = sorted.slice(0, 6);

  const handleNewDraft = () => {
    // Same isPending guard used on the standalone Reports page's create
    // button — stops an impatient re-click or slow network from firing the
    // create request twice. The server also dedupes identical draft
    // creates (same topic + issueDate + title) as a backstop.
    if (create.isPending) return;
    create.mutate(
      {
        data: {
          title: canonical.title,
          topic: topic as never,
          issueDate: new Date().toISOString().slice(0, 10),
          status: "draft",
        } as never,
      },
      {
        onSuccess: (r) => {
          qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
          setLocation(`/reports/${(r as { id: number }).id}`);
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

      {!isLoading && visible.length === 0 && (
        <div className="text-sm text-muted-foreground" data-testid="text-no-topic-reports">
          No reports yet for this topic.
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((r) => (
            <Link
              key={r.id}
              href={`/reports/${r.id}`}
              className="block bg-background border border-border rounded-sm p-3 hover:border-accent transition-colors group"
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
              <div className="text-sm font-sans font-medium text-primary mt-2 truncate">{r.title}</div>
              <div className="text-xs text-muted-foreground font-mono mt-1">
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
          ))}
        </div>
      )}

      {sorted.length > visible.length && (
        <div className="mt-3 text-right">
          <Link
            href="/reports"
            className="text-xs font-sans font-medium text-accent hover:underline uppercase tracking-wide"
            data-testid="link-view-all-topic-reports"
          >
            View all {sorted.length} in Report Builder →
          </Link>
        </div>
      )}
    </div>
  );
}
