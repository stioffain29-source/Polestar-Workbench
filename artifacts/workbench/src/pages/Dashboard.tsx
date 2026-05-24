import { useGetDashboardOverview, useGetIncidentCountsByTopic, type DashboardTopicCard } from "@workspace/api-client-react";
import { AlertTriangle, Activity, CheckCircle2, XCircle, FileText, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { severityBadgeStyle } from "@/lib/topics";
import { resolveReportTitle } from "@/lib/reportNaming";

const WINDOW_OPTIONS: Array<{ label: string; days: number }> = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1y", days: 365 },
];

export default function Dashboard() {
  const { data: overview, isLoading, isError } = useGetDashboardOverview();

  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col gap-6 animate-pulse">
        <div className="h-24 bg-muted/50 rounded-sm"></div>
        <div className="grid grid-cols-3 gap-6">
          <div className="h-40 bg-muted/50 rounded-sm"></div>
          <div className="h-40 bg-muted/50 rounded-sm"></div>
          <div className="h-40 bg-muted/50 rounded-sm"></div>
        </div>
      </div>
    );
  }

  if (isError || !overview) {
    return (
      <div className="p-6 bg-destructive/10 border border-destructive/20 text-destructive rounded-sm font-sans flex items-center gap-3">
        <AlertTriangle className="w-5 h-5" />
        Failed to load dashboard overview. Please check connection.
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="text-3xl font-serif text-primary uppercase tracking-tight">Operational Overview</h1>
          <p className="text-muted-foreground font-sans mt-1">Cross-theatre intelligence summary</p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border p-px rounded-sm overflow-hidden">
        <KpiItem label="Total Incidents (7d)" value={overview.totalIncidents7d} />
        <KpiItem label="Critical Incidents (7d)" value={overview.criticalIncidents7d} alert={overview.criticalIncidents7d > 0} />
        <KpiItem label="Active Sources" value={overview.activeSources} />
        <KpiItem label="Failing Sources" value={overview.failingSources} alert={overview.failingSources > 0} />
        <KpiItem label="Reports In Progress" value={overview.reportsInProgress} accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Topics */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-lg font-serif font-bold text-primary uppercase border-b border-border pb-2 flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            Topic Monitors
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {overview.topicCards.map((topic) => (
              <TopicCard key={topic.topic} topic={topic} />
            ))}
          </div>

          <h2 className="text-lg font-serif font-bold text-primary uppercase border-b border-border pb-2 mt-8 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent" />
            Recent Priority Incidents
          </h2>
          
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            {overview.recentIncidents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground font-sans">
                No priority incidents recorded.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {overview.recentIncidents.map((incident) => (
                  <Link key={incident.id} href={`/incidents?id=${incident.id}`} className="block hover:bg-muted/30 transition-colors p-4 group">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                            style={severityBadgeStyle(incident.severity)}
                          >
                            {incident.severity}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">
                            {new Date(incident.occurredAt).toLocaleString()}
                          </span>
                          <span className="text-xs font-serif font-medium text-primary">
                            {incident.country}
                          </span>
                        </div>
                        <h4 className="font-sans font-medium text-foreground group-hover:text-accent transition-colors">
                          {incident.title}
                        </h4>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-accent flex-shrink-0 mt-1" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <div className="p-3 bg-muted/30 border-t border-border text-center">
              <Link href="/incidents" className="text-sm font-sans font-medium text-accent hover:underline">
                View all incidents
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Alerts & Reports */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-sm flex flex-col">
            <div className="p-4 border-b border-border bg-sidebar text-sidebar-foreground flex items-center justify-between">
              <h2 className="font-serif font-bold uppercase tracking-wide flex items-center gap-2">
                <FileText className="w-4 h-4 text-sidebar-accent" />
                Reports Pipeline
              </h2>
            </div>
            <div className="p-0 flex-1">
              {overview.reportsPipeline.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground font-sans">
                  No reports currently in progress.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {overview.reportsPipeline.map((report) => (
                    <Link key={report.id} href={`/reports/${report.id}`} className="block p-4 hover:bg-muted/30 transition-colors group">
                      <div className="flex justify-between items-start">
                        <h4 className="font-sans font-medium text-sm line-clamp-2 group-hover:text-accent transition-colors pr-4">
                          {resolveReportTitle(report.topic, report.title)}
                        </h4>
                        <span className={cn(
                          "flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm",
                          report.status === 'published' ? "bg-sidebar-primary/20 text-sidebar-primary" :
                          report.status === 'review' ? "bg-accent/20 text-accent" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {report.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs font-mono text-muted-foreground flex items-center gap-2">
                        <span>{report.topic}</span>
                        <span>•</span>
                        <span>{new Date(report.issueDate).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-border bg-muted/10 text-center">
               <Link href="/reports" className="text-xs font-sans font-medium text-accent hover:underline uppercase tracking-wide">
                 Go to Report Builder
               </Link>
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm flex flex-col">
            <div className="p-4 border-b border-border bg-muted/50 flex items-center justify-between">
              <h2 className="font-serif font-bold text-primary uppercase tracking-wide flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary" />
                Source Health Alerts
              </h2>
              {overview.failingSources > 0 && (
                <span className="w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
                  {overview.failingSources}
                </span>
              )}
            </div>
            <div className="p-0">
              {overview.sourceAlerts.length === 0 ? (
                <div className="p-6 text-center text-sm font-sans flex flex-col items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 text-sidebar-primary/50" />
                  All critical sources operational.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {overview.sourceAlerts.map((source) => (
                    <div key={source.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-sans font-medium text-sm text-foreground flex items-center gap-1.5">
                            <XCircle className="w-3.5 h-3.5 text-destructive" />
                            {source.name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {source.errorMessage || "Source failing to update"}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {source.topic}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-border bg-muted/10 text-center">
               <Link href="/sources" className="text-xs font-sans font-medium text-accent hover:underline uppercase tracking-wide">
                 View All Sources
               </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicCard({ topic }: { topic: DashboardTopicCard }) {
  const [days, setDays] = useState(7);
  const { data: counts = [] } = useGetIncidentCountsByTopic({ days });
  const windowCount = counts.find((c) => c.topic === topic.topic)?.count ?? 0;
  const windowLabel = WINDOW_OPTIONS.find((w) => w.days === days)?.label ?? `${days}d`;
  const href = `/topics/${topic.topic.replace(/_/g, "-")}`;

  return (
    <div className="bg-card border border-border p-4 rounded-sm hover:border-accent/50 transition-colors group h-full flex flex-col relative overflow-hidden">
      {topic.criticalCount > 0 && (
        <div className="absolute top-0 right-0 w-2 h-full bg-destructive" />
      )}
      <div className="flex justify-between items-start mb-3 gap-3">
        <Link href={href} className="block flex-1 min-w-0">
          <h3 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors truncate">
            {topic.label.toUpperCase()}
          </h3>
        </Link>
        <Link href={href} className="text-right block">
          <div className="text-2xl font-serif font-bold leading-none">{topic.incidentCount}</div>
          <div className="text-[10px] text-muted-foreground font-sans uppercase tracking-wider">Total Incidents</div>
        </Link>
      </div>

      <div className="border-t border-border/50 pt-2 mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground">In selected window</div>
          <div className="text-sm font-serif font-bold text-primary">{windowCount}</div>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-full text-[11px] font-mono bg-muted/40 border border-border rounded-sm px-2 py-1 cursor-pointer hover:bg-muted/60 focus:outline-none focus:border-accent"
          aria-label={`Time window for ${topic.label}`}
        >
          {WINDOW_OPTIONS.map((w) => (
            <option key={w.days} value={w.days}>{w.label}</option>
          ))}
        </select>
        <div className="text-[9px] text-muted-foreground font-mono mt-1 text-right">showing last {windowLabel}</div>
      </div>

      {topic.latestHeadline ? (
        <Link href={href} className="mt-auto pt-2 border-t border-border/50 block">
          <p className="text-sm font-sans line-clamp-2 text-foreground/80 group-hover:text-foreground">
            {topic.latestHeadline}
          </p>
          {topic.latestAt && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {formatDistanceToNow(new Date(topic.latestAt), { addSuffix: true })}
            </p>
          )}
        </Link>
      ) : (
        <div className="mt-auto pt-2 border-t border-border/50 text-sm text-muted-foreground font-sans italic">
          No recent incidents
        </div>
      )}
    </div>
  );
}

function KpiItem({ label, value, alert, accent }: { label: string; value: number; alert?: boolean; accent?: boolean }) {
  return (
    <div className={cn(
      "bg-card p-4 flex flex-col justify-center",
      alert && "bg-destructive/5",
      accent && "bg-sidebar-primary/5"
    )}>
      <div className="text-xs font-sans text-muted-foreground font-medium uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={cn(
        "text-3xl font-serif font-bold leading-none",
        alert ? "text-destructive" : accent ? "text-accent" : "text-primary"
      )}>
        {value}
      </div>
    </div>
  );
}

// Temporary icon component for Radio if not imported
function Radio(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="2"/><path d="M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z"/></svg>
}
