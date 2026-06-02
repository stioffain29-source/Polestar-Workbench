import { useRoute } from "wouter";
import { useListIncidents } from "@workspace/api-client-react";
import { TOPIC_LABELS, SEVERITY_LEVELS, severityBadgeStyle, ratingColor } from "@/lib/topics";
import { format, subDays } from "date-fns";
import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";
import { resolveTrueIncidents } from "@/lib/trueIncidents";

export default function Topic() {
  const [, params] = useRoute("/topics/:topic");
  const slug = params?.topic ?? "";
  // Slug → label key (cargo-watch URL uses an underscored topic id).
  const labelKey = slug === "cargo-watch" ? "cargo_watch" : slug;
  // Data topic. The "protests" monitor is fed by the scraper under the
  // "flashpoint" topic (the scraper writes topic='flashpoint'; "protests" is a
  // legacy/manual snapshot with no live feed). Resolve it to the live topic so
  // the monitor reflects fresh ingested data — consistent with the
  // protests→flashpoint mapping the reports / data-status already use.
  const topic = labelKey === "protests" ? "flashpoint" : labelKey;
  const label = TOPIC_LABELS[labelKey] ?? topic;

  const { data: rawIncidents = [], isLoading } = useListIncidents({ topic: topic as never });

  // Reconcile to the same "true" (scoped, noise-filtered) set the reports use,
  // so the page tallies with the dashboard card and the report document.
  const incidents = useMemo(() => resolveTrueIncidents(topic, rawIncidents), [topic, rawIncidents]);

  const { count30d, critical30d } = useMemo(() => {
    const cutoff = subDays(new Date(), 30);
    let count30d = 0;
    let critical30d = 0;
    for (const i of incidents) {
      const d = new Date(i.occurredAt);
      if (isNaN(d.getTime()) || d < cutoff) continue;
      count30d += 1;
      if (i.severity === "extreme") critical30d += 1;
    }
    return { count30d, critical30d };
  }, [incidents]);

  const severityData = SEVERITY_LEVELS.map((s) => ({
    severity: s,
    count: incidents.filter((i) => i.severity === s).length,
  }));

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">{label}</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border p-px rounded-sm overflow-hidden">
        <Kpi label="Incidents (30d)" value={count30d} />
        <Kpi label="Critical (30d)" value={critical30d} accent />
        <Kpi label="Total Recorded" value={incidents.length} />
        <Kpi label="Latest" value={incidents[0] ? format(new Date(incidents[0].occurredAt), "dd MMM HH:mm") : "—"} small />
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h2 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">Severity Distribution</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={severityData}>
              <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
              <XAxis dataKey="severity" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
              <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
              <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count">
                {severityData.map((d) => (
                  <Cell key={d.severity} fill={ratingColor(d.severity)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">
          Incidents
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !incidents.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No incidents recorded for this topic.</div>
        ) : (
          <div className="divide-y divide-border">
            {incidents.map((i) => (
              <div key={i.id} className="grid grid-cols-[180px_1fr_140px_100px] items-center text-sm hover:bg-muted/30">
                <div className="p-3 font-mono text-xs">{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
                <div className="p-3 font-medium">{i.title}</div>
                <div className="p-3 text-xs">{i.country}</div>
                <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>{i.severity}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, small }: { label: string; value: string | number; accent?: boolean; small?: boolean }) {
  return (
    <div className="bg-card p-4">
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("font-serif font-bold leading-none", small ? "text-xl" : "text-3xl", accent ? "text-accent" : "text-primary")}>
        {value}
      </div>
    </div>
  );
}
