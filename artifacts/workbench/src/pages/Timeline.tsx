import { useListIncidents } from "@workspace/api-client-react";
import { format } from "date-fns";
import { TOPIC_LABELS, severityClass } from "@/lib/topics";
import { cn } from "@/lib/utils";

export default function Timeline() {
  const { data: incidents = [], isLoading } = useListIncidents({});

  const grouped = incidents.reduce<Record<string, typeof incidents>>((acc, i) => {
    const k = format(new Date(i.occurredAt), "yyyy-MM-dd");
    (acc[k] = acc[k] || []).push(i);
    return acc;
  }, {});
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      <div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Timeline</h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">Chronological feed of recorded incidents</p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}

      <div className="space-y-8">
        {days.map((day) => (
          <div key={day}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-serif font-bold text-lg text-primary uppercase">{format(new Date(day), "EEEE · d MMMM yyyy")}</h2>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-muted-foreground">{grouped[day].length} events</span>
            </div>
            <div className="bg-card border border-border rounded-sm divide-y divide-border">
              {grouped[day].map((i) => (
                <div key={i.id} className="grid grid-cols-[80px_120px_1fr_140px_100px] items-center text-sm hover:bg-muted/30">
                  <div className="p-3 font-mono text-xs text-muted-foreground">{format(new Date(i.occurredAt), "HH:mm")}</div>
                  <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-secondary text-secondary-foreground">{TOPIC_LABELS[i.topic]}</span></div>
                  <div className="p-3 font-medium">{i.title}</div>
                  <div className="p-3 text-xs">{i.country}</div>
                  <div className="p-3"><span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", severityClass(i.severity))}>{i.severity}</span></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
