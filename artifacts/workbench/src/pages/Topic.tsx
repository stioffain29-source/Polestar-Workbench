import { useRoute } from "wouter";
import { useListIncidents, useGetIncidentCountsByTopic } from "@workspace/api-client-react";
import { TOPIC_LABELS, SEVERITY_LEVELS, severityClass } from "@/lib/topics";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

export default function Topic() {
  const [, params] = useRoute("/topics/:topic");
  const slug = params?.topic ?? "";
  const topic = slug === "cargo-watch" ? "cargo_watch" : slug;
  const label = TOPIC_LABELS[topic] ?? topic;

  const { data: incidents = [], isLoading } = useListIncidents({ topic: topic as never });
  const { data: counts = [] } = useGetIncidentCountsByTopic({ days: 30 });
  const myCount = counts.find((c) => c.topic === topic);

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
        <Kpi label="Incidents (30d)" value={myCount?.count ?? 0} />
        <Kpi label="Critical (30d)" value={myCount?.criticalCount ?? 0} accent />
        <Kpi label="Total Recorded" value={incidents.length} />
        <Kpi label="Latest" value={incidents[0] ? format(new Date(incidents[0].occurredAt), "dd MMM HH:mm") : "—"} small />
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h2 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">Severity Distribution</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={severityData}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="severity" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#4655FF" />
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
                <div className="p-3"><span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", severityClass(i.severity))}>{i.severity}</span></div>
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
