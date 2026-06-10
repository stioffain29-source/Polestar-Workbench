import { useState } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import { format } from "date-fns";
import { TOPIC_LABELS, severityBadgeStyle } from "@/lib/topics";
import { RANGE_DAYS, RANGE_NOTE, type RangeKey } from "@/lib/dateRange";
import { RangeToggle } from "@/components/RangeToggle";

// The /incidents API caps its `days` window at 365, so the timeline omits the
// 2y range (730d) the topic monitors offer — requesting it would be rejected.
const TIMELINE_RANGES: RangeKey[] = ["24h", "7d", "14d", "30d", "90d", "180d", "1y"];

export default function Timeline() {
  // Fetch only the records within the selected window instead of the whole
  // table. Switching ranges issues a new request (React Query keys on the
  // params) rather than downloading every incident and grouping in memory, so
  // the payload stays bounded as the incidents table grows.
  const [range, setRange] = useState<RangeKey>("1y");
  const { data: incidents = [], isLoading } = useListIncidents({ days: RANGE_DAYS[range] });

  const grouped = incidents.reduce<Record<string, typeof incidents>>((acc, i) => {
    const k = format(new Date(i.occurredAt), "yyyy-MM-dd");
    (acc[k] = acc[k] || []).push(i);
    return acc;
  }, {});
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Timeline</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">Chronological feed of recorded incidents · {RANGE_NOTE[range]}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-serif font-medium text-muted-foreground">
            Range
          </span>
          <RangeToggle range={range} onChange={setRange} keys={TIMELINE_RANGES} />
        </div>
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
                  <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>{i.severity}</span></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
